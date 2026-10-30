import "./helpers/offline.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as z from "zod";
import { AgentLoop } from "../agent/agent.js";
import { AssistantMessage, SystemMessage, Tool, UserMessage } from "../core/protocol.js";
import type { BaseMessages, ToolCall } from "../core/protocol.js";
import { Model } from "../model/model.js";
import { MockProvider } from "../model/providers/mock-provider.js";
import { RecordingProvider } from "./helpers/recording-provider.js";
import { assertCompletedRun, assertFailedRunOutcome } from "./helpers/run-result.js";

function toolReply(name: string, args: string, callId = "call-1") {
    return new AssistantMessage("", { toolCalls: [{ callId, toolName: name, arguments: args }] });
}

function finalText(messages: BaseMessages): string {
    const last = messages.at(-1);
    assert.ok(last?.role === "assistant");
    return last.content;
}

function textContents(messages: BaseMessages): string[] {
    return messages.map(message => {
        assert.ok(message.role !== "tool", "This conversation should contain only text messages");
        return message.content;
    });
}

function makeAddition(onExecute: () => void = () => {}) {
    return new Tool({
        name: "addition",
        description: "Add two numbers",
        parametersZodSchema: z.strictObject({ a: z.number(), b: z.number() }),
        func: ({ a, b }) => { onExecute(); return a + b; },
    });
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

test("a plain reply completes the run and uses the default system prompt once", async () => {
    const provider = new RecordingProvider(new MockProvider([new AssistantMessage("Hello")]));
    const messages = assertCompletedRun(await new AgentLoop({ model: new Model(provider) }).runLoop([new UserMessage("Hi")]));

    assert.equal(provider.requests.length, 1);
    assert.deepEqual(provider.requests[0]!.messages.map(message => message.role), ["system", "user"]);
    assert.deepEqual(provider.requests[0]!.tools, []);
    assert.equal(textContents(provider.requests[0]!.messages)[0], "You are a helpful assistant.");
    assert.deepEqual(messages.map(message => message.role), ["assistant"]);
    assert.equal(finalText(messages), "Hello");
});

test("an explicit system prompt replaces the default prompt", async () => {
    const prompt = new SystemMessage("Only answer in numbers");
    const provider = new RecordingProvider(new MockProvider([new AssistantMessage("3")]));
    const messages = assertCompletedRun(await new AgentLoop({
        model: new Model(provider),
        systemPrompt: prompt,
    }).runLoop([new UserMessage("1 + 2?")]));

    assert.deepEqual(provider.requests[0]!.messages.filter(message => message.role === "system").map(message => message.content), [prompt.content]);
    assert.deepEqual(messages.map(message => message.role), ["assistant"]);
    assert.equal(finalText(messages), "3");
});

test("executes a tool once and supplies its paired result and tool definition to the next request", async () => {
    let executions = 0;
    const provider = new RecordingProvider(new MockProvider([
        toolReply("addition", '{"a":11,"b":7}', "add-1"),
        new AssistantMessage("18"),
    ]));
    const messages = assertCompletedRun(await new AgentLoop({ model: new Model(provider), tools: [makeAddition(() => executions++)] })
        .runLoop([new UserMessage("11 + 7?")]));

    assert.equal(executions, 1);
    assert.equal(provider.requests.length, 2);
    assert.equal(provider.requests[0]!.tools[0]!.name, "addition");
    assert.equal(provider.requests[0]!.tools[0]!.parameters.type, "object");
    assert.deepEqual(provider.requests[1]!.messages.map(message => message.role), ["system", "user", "assistant", "tool"]);
    const result = provider.requests[1]!.messages.find(message => message.role === "tool");
    assert.equal(result?.callId, "add-1");
    assert.equal(result?.toolName, "addition");
    assert.equal(result?.toolOutput, "18");
    assert.equal(result?.isError, false);
    assert.deepEqual(messages.map(message => message.role), ["assistant", "tool", "assistant"]);
    assert.deepEqual(messages[0]!.role === "assistant" ? messages[0].toolCalls : [], [
        { callId: "add-1", toolName: "addition", arguments: '{"a":11,"b":7}' },
    ]);
    const returnedToolResult = messages[1];
    assert.ok(returnedToolResult?.role === "tool");
    assert.equal(returnedToolResult.callId, "add-1");
    assert.equal(returnedToolResult.toolOutput, "18");
    assert.equal(returnedToolResult.isError, false);
    assert.equal(finalText(messages), "18");
});

test("awaits an asynchronous tool before starting the next call in the same turn", async () => {
    const started = deferred();
    const release = deferred();
    const order: string[] = [];
    const calls: ToolCall[] = [
        { callId: "first-1", toolName: "first", arguments: "{}" },
        { callId: "second-1", toolName: "second", arguments: "{}" },
    ];
    const provider = new RecordingProvider(new MockProvider([
        new AssistantMessage("", { toolCalls: calls }), new AssistantMessage("Done"),
    ]));
    const loop = new AgentLoop({
        model: new Model(provider),
        tools: [
            new Tool({
                name: "first", description: "Wait for release", parametersZodSchema: z.strictObject({}),
                func: async () => {
                    order.push("first:start");
                    started.resolve();
                    await release.promise;
                    order.push("first:end");
                    return "first result";
                },
            }),
            new Tool({
                name: "second", description: "Run second", parametersZodSchema: z.strictObject({}),
                func: () => { order.push("second"); return "second result"; },
            }),
        ],
    });

    const run = loop.runLoop([new UserMessage("Run both")]);
    await started.promise;
    try {
        assert.deepEqual(order, ["first:start"]);
        assert.equal(provider.requests.length, 1, "No follow-up model request before tools finish");
    } finally {
        release.resolve();
    }
    assertCompletedRun(await run);

    assert.deepEqual(order, ["first:start", "first:end", "second"]);
    assert.deepEqual(provider.requests[1]!.messages.filter(message => message.role === "tool").map(message => [message.callId, message.toolOutput]), [
        ["first-1", "first result"], ["second-1", "second result"],
    ]);
});

for (const [label, argumentsText] of [
    ["invalid JSON", "{"],
    ["invalid parameter types", '{"a":"11","b":7}'],
    ["a missing required parameter", '{"a":11}'],
] as const) {
    test(`returns ${label} to the model and executes a corrected call`, async () => {
        let executions = 0;
        const provider = new RecordingProvider(new MockProvider([
            toolReply("addition", argumentsText, "invalid-1"),
            toolReply("addition", '{"a":11,"b":7}', "corrected-1"),
            new AssistantMessage("18"),
        ]));
        const messages = assertCompletedRun(await new AgentLoop({ model: new Model(provider), tools: [makeAddition(() => executions++)] })
            .runLoop([new UserMessage("11 + 7?")]));

        const failure = provider.requests[1]!.messages.at(-1);
        assert.ok(failure?.role === "tool");
        assert.equal(failure.callId, "invalid-1");
        assert.equal(failure.toolName, "addition");
        assert.equal(failure.isError, true);
        assert.ok(failure.toolOutput.length > 0);
        const success = provider.requests[2]!.messages.at(-1);
        assert.ok(success?.role === "tool");
        assert.equal(success.callId, "corrected-1");
        assert.equal(success.isError, false);
        assert.equal(success.toolOutput, "18");
        assert.equal(executions, 1);
        assert.equal(finalText(messages), "18");
    });
}

test("unknown tools and tool exceptions do not leave unpaired calls or skip later tools", async () => {
    const calls: ToolCall[] = [
        { callId: "missing-1", toolName: "missing", arguments: "{}" },
        { callId: "broken-1", toolName: "broken", arguments: "{}" },
        { callId: "add-1", toolName: "addition", arguments: '{"a":1,"b":2}' },
    ];
    const provider = new RecordingProvider(new MockProvider([
        new AssistantMessage("", { toolCalls: calls }), new AssistantMessage("Recovered"),
    ]));
    const broken = new Tool({
        name: "broken", description: "Reject", parametersZodSchema: z.strictObject({}),
        func: async () => { throw new Error("Test tool failure"); },
    });

    const messages = assertCompletedRun(await new AgentLoop({ model: new Model(provider), tools: [broken, makeAddition()] })
        .runLoop([new UserMessage("Try the tools")]));

    const results = provider.requests[1]!.messages.filter(message => message.role === "tool");
    assert.deepEqual(results.map(message => [message.callId, message.toolName, message.isError]), [
        ["missing-1", "missing", true], ["broken-1", "broken", true], ["add-1", "addition", false],
    ]);
    assert.match(results[0]!.toolOutput, /missing.*not found/);
    assert.match(results[1]!.toolOutput, /Test tool failure/);
    assert.equal(results[2]!.toolOutput, "3");
    assert.equal(finalText(messages), "Recovered");
});

test("[M1] an initial model failure returns its error and no generated messages", async () => {
    const failure = new Error("Model unavailable");
    const provider = new RecordingProvider({ name: "failing", invoke: async () => { throw failure; } });
    const loop = new AgentLoop({ model: new Model(provider) });
    const inputMessages = [new UserMessage("Hi")];
    const before = JSON.stringify(inputMessages);

    const [outcome] = await Promise.allSettled([loop.runLoop(inputMessages)]);

    assert.equal(provider.requests.length, 1);
    assert.deepEqual(provider.requests[0]!.messages.map(message => message.role), ["system", "user"]);
    assert.equal(JSON.stringify(inputMessages), before);
    const result = assertFailedRunOutcome(outcome);
    assert.equal(result.error, failure);
    assert.deepEqual(result.addedMessages, []);
});

test("[M1] a later model failure returns completed tools and supports continuation without re-execution", async () => {
    const failure = new Error("Follow-up request failed");
    let executions = 0;
    let modelCalls = 0;
    const provider = new RecordingProvider({
        name: "fail-after-tool",
        invoke: async () => {
            switch (++modelCalls) {
                case 1: return toolReply("addition", '{"a":1,"b":2}', "completed-1");
                case 2: throw failure;
                case 3: return new AssistantMessage("3");
                default: throw new Error("Unexpected extra model request");
            }
        },
    });
    const loop = new AgentLoop({ model: new Model(provider), tools: [makeAddition(() => executions++)] });
    const history: BaseMessages = [new UserMessage("Add")];
    const [outcome] = await Promise.allSettled([loop.runLoop(history)]);

    assert.equal(modelCalls, 2);
    assert.equal(executions, 1);
    assert.deepEqual(history.map(message => message.role), ["user"]);
    const result = assertFailedRunOutcome(outcome);
    assert.equal(result.error, failure);
    assert.deepEqual(result.addedMessages.map(message => message.role), ["assistant", "tool"]);
    const assistant = result.addedMessages[0];
    assert.ok(assistant?.role === "assistant");
    assert.equal(assistant.toolCalls[0]!.callId, "completed-1");
    const toolResult = result.addedMessages[1];
    assert.ok(toolResult?.role === "tool");
    assert.equal(toolResult.callId, "completed-1");
    assert.equal(toolResult.toolName, "addition");
    assert.equal(toolResult.toolOutput, "3");
    assert.equal(toolResult.isError, false);

    // The caller commits progress and retries the model with the retained
    // context, without adding the user input or executing the tool again.
    history.push(...result.addedMessages);
    const addedMessages = assertCompletedRun(await loop.runLoop(history));
    assert.equal(finalText(addedMessages), "3");
    assert.equal(executions, 1);
    assert.equal(modelCalls, 3);
    assert.deepEqual(provider.requests[2]!.messages.map(message => message.role), ["system", "user", "assistant", "tool"]);
});

test("caller-managed history supplies the preceding turn without duplicating inputs or system prompts", async () => {
    const provider = new RecordingProvider(new MockProvider([new AssistantMessage("First reply"), new AssistantMessage("Second reply")]));
    const loop = new AgentLoop({ model: new Model(provider) });
    const history: BaseMessages = [new UserMessage("First input")];

    history.push(...assertCompletedRun(await loop.runLoop(history)));
    history.push(new UserMessage("Second input"));
    const addedMessages = assertCompletedRun(await loop.runLoop(history));
    history.push(...addedMessages);

    assert.deepEqual(provider.requests[1]!.messages.map(message => message.role), ["system", "user", "assistant", "user"]);
    for (const request of provider.requests) {
        assert.equal(request.messages.filter(message => message.role === "system").length, 1);
    }
    assert.deepEqual(history.map(message => message.role), ["user", "assistant", "user", "assistant"]);
    assert.deepEqual(addedMessages.map(message => message.role), ["assistant"]);
    assert.equal(finalText(addedMessages), "Second reply");
});

test("a tool round trip leaves caller history unchanged and excludes that history from its increment", async () => {
    const provider = new RecordingProvider(new MockProvider([
        toolReply("addition", '{"a":1,"b":2}', "new-call"), new AssistantMessage("3"),
    ]));
    const loop = new AgentLoop({ model: new Model(provider), tools: [makeAddition()] });
    const inputMessages: BaseMessages = [
        new UserMessage("Earlier input"), new AssistantMessage("Earlier reply"), new UserMessage("Add"),
    ];
    const before = JSON.stringify(inputMessages);
    const originalMessages = [...inputMessages];

    const addedMessages = assertCompletedRun(await loop.runLoop(inputMessages));

    assert.equal(JSON.stringify(inputMessages), before);
    assert.deepEqual(inputMessages, originalMessages);
    assert.notEqual(addedMessages, inputMessages);
    assert.deepEqual(addedMessages.map(message => message.role), ["assistant", "tool", "assistant"]);
    assert.ok(addedMessages.every(message => !originalMessages.includes(message)));
    assert.deepEqual(provider.requests[0]!.messages.slice(1), structuredClone(inputMessages));
});

test("reusing a loop does not change a previously returned increment", async () => {
    const loop = new AgentLoop({ model: new Model(new MockProvider([
        new AssistantMessage("First"), new AssistantMessage("Second"),
    ])) });
    const first = assertCompletedRun(await loop.runLoop([new UserMessage("One")]));
    const before = JSON.stringify(first);

    const second = assertCompletedRun(await loop.runLoop([new UserMessage("Two")]));

    assert.equal(JSON.stringify(first), before);
    assert.deepEqual(first.map(message => message.role), ["assistant"]);
    assert.equal(finalText(first), "First");
    assert.equal(finalText(second), "Second");
    assert.notEqual(first, second);
});

test("independent histories can reuse one loop without leaking context between them", async () => {
    const provider = new RecordingProvider(new MockProvider([
        new AssistantMessage("Reply A"), new AssistantMessage("Reply B"), new AssistantMessage("Follow-up A"),
    ]));
    const loop = new AgentLoop({ model: new Model(provider) });
    const historyA: BaseMessages = [new UserMessage("Input A")];
    const historyB: BaseMessages = [new UserMessage("Input B")];

    historyA.push(...assertCompletedRun(await loop.runLoop(historyA)));
    historyB.push(...assertCompletedRun(await loop.runLoop(historyB)));
    historyA.push(new UserMessage("Follow-up"));
    historyA.push(...assertCompletedRun(await loop.runLoop(historyA)));

    assert.deepEqual(textContents(provider.requests[1]!.messages), ["You are a helpful assistant.", "Input B"]);
    assert.deepEqual(textContents(provider.requests[2]!.messages), ["You are a helpful assistant.", "Input A", "Reply A", "Follow-up"]);
    assert.deepEqual(textContents(historyB), ["Input B", "Reply B"]);
});

test("concurrent runs with different input histories keep their local contexts isolated", async () => {
    let requests = 0;
    const provider = new RecordingProvider({
        name: "concurrent",
        async invoke(messages) {
            assert.ok(++requests <= 2, "No unexpected follow-up request");
            const input = messages.at(-1);
            assert.ok(input?.role === "user");
            await Promise.resolve();
            return new AssistantMessage(`Reply to ${input.content}`);
        },
    });
    const loop = new AgentLoop({ model: new Model(provider) });
    const historyA = [new UserMessage("A")];
    const historyB = [new UserMessage("B")];

    const [resultA, resultB] = await Promise.all([loop.runLoop(historyA), loop.runLoop(historyB)]);
    const addedA = assertCompletedRun(resultA);
    const addedB = assertCompletedRun(resultB);

    assert.equal(finalText(addedA), "Reply to A");
    assert.equal(finalText(addedB), "Reply to B");
    assert.deepEqual(provider.requests.map(request => textContents(request.messages)), [
        ["You are a helpful assistant.", "A"], ["You are a helpful assistant.", "B"],
    ]);
    assert.deepEqual(historyA.map(message => message.role), ["user"]);
    assert.deepEqual(historyB.map(message => message.role), ["user"]);
});
