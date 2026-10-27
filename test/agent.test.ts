import "./helpers/offline.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as z from "zod";
import { Agent } from "../agent/agent.js";
import { AssistantMessage, SystemMessage, Tool, UserMessage } from "../core/protocol.js";
import type { BaseMessages, ToolCall } from "../core/protocol.js";
import { Model } from "../model/model.js";
import { MockProvider } from "../model/providers/mock-provider.js";
import { RecordingProvider } from "./helpers/recording-provider.js";

function toolReply(name: string, args: string, callId = "call-1") {
    return new AssistantMessage("", { toolCalls: [{ callId, toolName: name, arguments: args }] });
}

function finalText(messages: BaseMessages): string {
    const last = messages.at(-1);
    assert.ok(last?.role === "assistant");
    return last.content;
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
    const messages = await new Agent({ model: new Model(provider) }).run(new UserMessage("Hi"));

    assert.equal(provider.requests.length, 1);
    assert.deepEqual(provider.requests[0]!.messages.map(message => message.role), ["system", "user"]);
    assert.deepEqual(provider.requests[0]!.tools, []);
    assert.equal(messages.filter(message => message.role === "system").length, 1);
    assert.equal(finalText(messages), "Hello");
});

test("an explicit system prompt replaces the default prompt", async () => {
    const prompt = new SystemMessage("Only answer in numbers");
    const messages = await new Agent({
        model: new Model(new MockProvider([new AssistantMessage("3")])),
        systemPrompt: prompt,
    }).run(new UserMessage("1 + 2?"));

    assert.deepEqual(messages.filter(message => message.role === "system"), [prompt]);
});

test("executes a tool once and supplies its paired result and tool definition to the next request", async () => {
    let executions = 0;
    const provider = new RecordingProvider(new MockProvider([
        toolReply("addition", '{"a":11,"b":7}', "add-1"),
        new AssistantMessage("18"),
    ]));
    const messages = await new Agent({ model: new Model(provider), tools: [makeAddition(() => executions++)] })
        .run(new UserMessage("11 + 7?"));

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
    const agent = new Agent({
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

    const run = agent.run(new UserMessage("Run both"));
    await started.promise;
    try {
        assert.deepEqual(order, ["first:start"]);
        assert.equal(provider.requests.length, 1, "No follow-up model request before tools finish");
    } finally {
        release.resolve();
    }
    await run;

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
        const messages = await new Agent({ model: new Model(provider), tools: [makeAddition(() => executions++)] })
            .run(new UserMessage("11 + 7?"));

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

    const messages = await new Agent({ model: new Model(provider), tools: [broken, makeAddition()] })
        .run(new UserMessage("Try the tools"));

    const results = provider.requests[1]!.messages.filter(message => message.role === "tool");
    assert.deepEqual(results.map(message => [message.callId, message.toolName, message.isError]), [
        ["missing-1", "missing", true], ["broken-1", "broken", true], ["add-1", "addition", false],
    ]);
    assert.match(results[0]!.toolOutput, /missing.*not found/);
    assert.match(results[1]!.toolOutput, /Test tool failure/);
    assert.equal(results[2]!.toolOutput, "3");
    assert.equal(finalText(messages), "Recovered");
});

test("a model request failure rejects the run and retains the user input", async () => {
    const failure = new Error("Model unavailable");
    const provider = new RecordingProvider({ name: "failing", invoke: async () => { throw failure; } });
    const agent = new Agent({ model: new Model(provider) });

    await assert.rejects(agent.run(new UserMessage("Hi")), error => error === failure);

    assert.equal(provider.requests.length, 1);
    assert.deepEqual(agent.agentMessages.map(message => message.role), ["system", "user"]);
});

test("a later model request failure retains completed tools without executing them again", async () => {
    const failure = new Error("Follow-up request failed");
    let executions = 0;
    let modelCalls = 0;
    const provider = new RecordingProvider({
        name: "fail-after-tool",
        invoke: async () => {
            if (++modelCalls === 1) return toolReply("addition", '{"a":1,"b":2}', "completed-1");
            throw failure;
        },
    });
    const agent = new Agent({ model: new Model(provider), tools: [makeAddition(() => executions++)] });

    await assert.rejects(agent.run(new UserMessage("Add")), error => error === failure);

    assert.equal(modelCalls, 2);
    assert.equal(executions, 1);
    const last = agent.agentMessages.at(-1);
    assert.ok(last?.role === "tool");
    assert.equal(last.callId, "completed-1");
    assert.equal(last.toolOutput, "3");
});

test("a second input on the same Agent includes the preceding turn without duplicating the system prompt", async () => {
    const provider = new RecordingProvider(new MockProvider([new AssistantMessage("First reply"), new AssistantMessage("Second reply")]));
    const agent = new Agent({ model: new Model(provider) });

    await agent.run(new UserMessage("First input"));
    const messages = await agent.run(new UserMessage("Second input"));

    assert.deepEqual(provider.requests[1]!.messages.map(message => message.role), ["system", "user", "assistant", "user"]);
    assert.equal(provider.requests[1]!.messages.filter(message => message.role === "system").length, 1);
    assert.equal(finalText(messages), "Second reply");
});
