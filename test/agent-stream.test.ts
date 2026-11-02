import "./helpers/offline.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as z from "zod";
import { Agent, type AgentStreamEvent } from "../agent/agent.js";
import { AssistantMessage, SystemMessage, UserMessage } from "../core/messages.js";
import { Tool } from "../core/tool.js";
import { Model } from "../model/model.js";
import { assertCompletedRun, assertFailedRun } from "./helpers/run-result.js";
import { collect, events, ScriptedStreamProvider } from "./helpers/stream.js";

function result(items: AgentStreamEvent[]) {
    const last = items.at(-1);
    assert.ok(last && "status" in last, "The last yielded event must be an AgentResult");
    assert.equal(items.filter(item => "status" in item).length, 1);
    return last;
}

const input = () => [new UserMessage("Hi")];
const message = (reply: AssistantMessage) => ({ type: "message" as const, message: reply });

test("stream is lazy and yields deltas before the completed result without duplicating message events", async () => {
    const reply = new AssistantMessage("你好", { reasoning: "想好了" });
    const provider = new ScriptedStreamProvider([events(
        { type: "reasoning_delta", text: "想好了" },
        { type: "text_delta", text: "你" }, { type: "text_delta", text: "好" }, message(reply),
    )]);
    const history = input();
    const before = structuredClone(history);
    const stream = new Agent({ model: new Model(provider), systemPrompt: new SystemMessage("Be brief") }).stream(history);
    assert.equal(provider.requests.length, 0);
    assert.deepEqual(await stream.next(), { done: false, value: { type: "reasoning_delta", text: "想好了" } });
    assert.equal(provider.requests.length, 1);
    const rest = await collect(stream);
    assert.deepEqual(rest.slice(0, 2), [{ type: "text_delta", text: "你" }, { type: "text_delta", text: "好" }]);
    assert.deepEqual(assertCompletedRun(result(rest)), [reply]);
    assert.deepEqual(provider.requests[0]!.messages.map(m => m.role), ["system", "user"]);
    assert.equal(provider.requests[0]!.messages[0]!.role === "system" && provider.requests[0]!.messages[0].content, "Be brief");
    assert.deepEqual(provider.requests[0]!.tools, []);
    assert.deepEqual(structuredClone(history), before);
    assert.equal(provider.closed, 1);
});

test("stream executes mixed tool calls in order, returns paired errors, and supplies complete context to the next turn", async () => {
    const order: string[] = [];
    const tools = [
        new Tool({ name: "echo", description: "Echo", parametersZodSchema: z.object({ text: z.string() }),
            func: async ({ text }) => { order.push(text); await Promise.resolve(); return text; } }),
        new Tool({ name: "broken", description: "Fail", parametersZodSchema: z.object({}),
            func: () => { order.push("broken"); throw new Error("Tool failed"); } }),
    ];
    const calls = [
        ["missing", "{}"], ["echo", "{"], ["echo", '{"text":2}'],
        ["echo", '{"text":"first"}'], ["broken", "{}"], ["echo", '{"text":"last"}'],
    ].map(([toolName, args], i) => ({ callId: `call-${i}`, toolName, arguments: args }));
    const toolReply = new AssistantMessage("Checking", { reasoning: "Need tools", toolCalls: calls });
    const final = new AssistantMessage("Done");
    const provider = new ScriptedStreamProvider([events(message(toolReply)), events({ type: "text_delta", text: "Done" }, message(final))]);
    const history = input();
    const items = await collect(new Agent({ model: new Model(provider), tools }).stream(history));
    const generated = assertCompletedRun(result(items));
    assert.deepEqual(order, ["first", "broken", "last"]);
    assert.deepEqual(generated.map(m => m.role), ["assistant", ...calls.map(() => "tool"), "assistant"]);
    const outputs = generated.filter(m => m.role === "tool");
    assert.deepEqual(outputs.map(m => m.callId), calls.map(c => c.callId));
    assert.deepEqual(outputs.map(m => m.isError), [true, true, true, false, true, false]);
    assert.match(outputs[0]!.toolOutput, /not found/);
    assert.match(outputs[1]!.toolOutput, /Invalid JSON/);
    assert.match(outputs[4]!.toolOutput, /Tool failed/);
    assert.equal(outputs[3]!.toolOutput, '"first"');
    assert.equal(outputs[5]!.toolOutput, '"last"');
    assert.deepEqual(provider.requests[1]!.messages, structuredClone([new SystemMessage("You are a helpful assistant."), ...history, ...generated.slice(0, -1)]));
    assert.deepEqual(provider.requests.map(r => r.tools), [tools.map(t => t.getSpec()), tools.map(t => t.getSpec())]);
    assert.deepEqual(items.filter(i => "type" in i), [{ type: "text_delta", text: "Done" }]);
    assert.equal(history.length, 1);
    assert.equal(provider.closed, 2);
});

for (const failure of [new Error("Stream failed"), "failure", null, undefined]) {
    test(`stream preserves thrown ${String(failure)} after partial deltas`, async () => {
        const provider = new ScriptedStreamProvider([async function* () {
            yield { type: "text_delta", text: "partial" };
            throw failure;
        }]);
        const items = await collect(new Agent({ model: new Model(provider) }).stream(input()));
        const failed = assertFailedRun(result(items));
        assert.equal(failed.error, failure);
        assert.deepEqual(failed.messages, [], "Unfinished text is not a committed assistant message");
        assert.deepEqual(items[0], { type: "text_delta", text: "partial" });
        assert.equal(provider.requests.length, 1);
        assert.equal(provider.closed, 1);
    });
}

test("stream failure retains completed tool progress and permits caller-managed continuation", async () => {
    let executions = 0;
    const tool = new Tool({ name: "count", description: "Count", parametersZodSchema: z.object({}), func: () => ++executions });
    const toolReply = new AssistantMessage("", { toolCalls: [{ callId: "once", toolName: "count", arguments: "{}" }] });
    const failure = new Error("Follow-up failed");
    const provider = new ScriptedStreamProvider([
        events(message(toolReply)), async function* () { throw failure; }, events(message(new AssistantMessage("Done"))),
    ]);
    const agent = new Agent({ model: new Model(provider), tools: [tool] });
    const history = input();
    const failed = assertFailedRun(result(await collect(agent.stream(history))));
    assert.equal(failed.error, failure);
    assert.deepEqual(failed.messages.map(m => m.role), ["assistant", "tool"]);
    const resumed = assertCompletedRun(result(await collect(agent.stream([...history, ...failed.messages]))));
    assert.equal(executions, 1);
    assert.equal(resumed.length, 1);
    assert.deepEqual(provider.requests[2]!.messages.map(m => m.role), ["system", "user", "assistant", "tool"]);
});

test("stopping at a delta closes the provider and prevents later tools or follow-up requests", async () => {
    let executions = 0;
    const tool = new Tool({ name: "count", description: "Count", parametersZodSchema: z.object({}), func: () => ++executions });
    const provider = new ScriptedStreamProvider([events({ type: "text_delta", text: "Wait" }, message(new AssistantMessage("", {
        toolCalls: [{ callId: "never", toolName: "count", arguments: "{}" }],
    })))]);
    const stream = new Agent({ model: new Model(provider), tools: [tool] }).stream(input());
    for await (const item of stream) { assert.deepEqual(item, { type: "text_delta", text: "Wait" }); break; }
    assert.equal(provider.closed, 1);
    assert.equal(provider.requests.length, 1);
    assert.equal(executions, 0);
    assert.equal((await stream.next()).done, true);
});

for (const partial of [false, true]) {
    test(`a stream ending without a message fails without requesting the same turn again (partial=${partial})`, async () => {
        // The finite script bounds the current bug: a retry throws immediately,
        // instead of making this regression spin forever or hit a real API.
        const provider = new ScriptedStreamProvider([events(...(partial ? [{ type: "text_delta" as const, text: "partial" }] : []))]);
        const items = await collect(new Agent({ model: new Model(provider) }).stream(input()));
        assertFailedRun(result(items));
        assert.equal(provider.requests.length, 1, "An unfinished stream must fail, not silently retry the same context");
    });
}

test("stream awaits the first tool before starting the second or requesting the next turn", async () => {
    let started!: () => void;
    const hasStarted = new Promise<void>(resolve => { started = resolve; });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const order: string[] = [];
    const provider = new ScriptedStreamProvider([
        events(message(new AssistantMessage("", { toolCalls: [
            { callId: "first", toolName: "first", arguments: "{}" },
            { callId: "second", toolName: "second", arguments: "{}" },
        ] }))), events(message(new AssistantMessage("Done"))),
    ]);
    const agent = new Agent({ model: new Model(provider), tools: [
        new Tool({ name: "first", description: "Wait", parametersZodSchema: z.object({}), func: async () => {
            order.push("first:start"); started(); await gate; order.push("first:end"); return 1;
        } }),
        new Tool({ name: "second", description: "Second", parametersZodSchema: z.object({}), func: () => { order.push("second"); return 2; } }),
    ] });
    const pending = collect(agent.stream(input()));
    await hasStarted;
    try {
        assert.deepEqual(order, ["first:start"]);
        assert.equal(provider.requests.length, 1);
    } finally { release(); }
    assertCompletedRun(result(await pending));
    assert.deepEqual(order, ["first:start", "first:end", "second"]);
    assert.equal(provider.requests.length, 2);
});
