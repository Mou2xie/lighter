import "./helpers/offline.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as z from "zod";
import { Agent } from "../agent/agent.js";
import { AfterModelHook, BeforeModelHook } from "../core/hooks.js";
import { AssistantMessage, UserMessage } from "../core/messages.js";
import { Tool } from "../core/tool.js";
import { Model } from "../model/model.js";
import type { Provider } from "../model/providers/provider.js";
import { MockProvider } from "../model/providers/mock-provider.js";
import { RecordingProvider } from "./helpers/recording-provider.js";
import { assertCompletedRun } from "./helpers/run-result.js";
import { collect } from "./helpers/stream.js";

type Mode = "invoke" | "stream";
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

function source(message: AssistantMessage) {
    let closed = false;
    const provider: Provider = {
        name: "after-model-source",
        async invoke() { return message; },
        async *stream() {
            try {
                yield { type: "reasoning_delta", text: "thinking" };
                yield { type: "text_delta", text: message.content };
                yield { type: "message", message };
            } finally { closed = true; }
        },
    };
    return { model: new Model(provider), isClosed: () => closed };
}

async function call(model: Model, mode: Mode, hook: AfterModelHook): Promise<AssistantMessage> {
    const request = { messages: [new UserMessage("Hi")] };
    if (mode === "invoke") return model.invoke(request, { afterModel: hook });
    const items = await collect(model.stream(request, { afterModel: hook }));
    const last = items.at(-1);
    assert.ok(last?.type === "message");
    return last.message;
}

for (const mode of ["invoke", "stream"] as const) {
    test(`Model.${mode}: replaces the complete assistant message including reasoning and tool calls`, async () => {
        const original = new AssistantMessage("Original");
        const replacement = new AssistantMessage("Rewritten", { reasoning: "Updated reasoning", toolCalls: [
            { callId: "adjusted", toolName: "lookup", arguments: '{"id":7}' },
        ] });
        const { model } = source(original);
        let calls = 0;
        const hook = new AfterModelHook({ hookName: "rewrite", hookFunction: message => {
            calls++;
            assert.equal(message, original);
            return replacement;
        } });
        assert.equal(await call(model, mode, hook), replacement);
        assert.equal(calls, 1, "Run once per complete response, not once per delta");
    });

    for (const asynchronous of [false, true]) {
        test(`Model.${mode}: ${asynchronous ? "async" : "sync"} no-op after hook preserves the original message`, async () => {
            const original = new AssistantMessage("Unchanged");
            const { model } = source(original);
            let observed: AssistantMessage | undefined;
            const observe = (message: AssistantMessage) => { observed = message; };
            const hook = new AfterModelHook({ hookName: "observe", hookFunction: asynchronous ? async message => observe(message) : observe });
            assert.equal(await call(model, mode, hook), original);
            assert.equal(observed, original);
        });

        test(`Model.${mode}: propagates ${asynchronous ? "async" : "sync"} after-hook failure`, async () => {
            const { model, isClosed } = source(new AssistantMessage("Original"));
            const failure = new Error("After hook failed");
            const fail = () => { throw failure; };
            const hook = new AfterModelHook({ hookName: "fail", hookFunction: asynchronous ? async () => fail() : fail });
            await assert.rejects(call(model, mode, hook), error => error === failure);
            if (mode === "stream") assert.equal(isClosed(), true, "A rejected hook must close the provider iterator");
        });
    }

    test(`Model.${mode}: waits for an asynchronous after hook before delivering the final message`, async () => {
        const entered = deferred();
        const release = deferred();
        const { model } = source(new AssistantMessage("Original"));
        const replacement = new AssistantMessage("Ready");
        const hook = new AfterModelHook({ hookName: "await-result", hookFunction: async message => {
            entered.resolve();
            await release.promise;
            // Conditional async return also checks Promise<AssistantMessage | void>.
            if (message.content === "Original") return replacement;
        } });
        let delivered = false;
        const pending = call(model, mode, hook).then(message => { delivered = true; return message; });
        await entered.promise;
        try { assert.equal(delivered, false); }
        finally { release.resolve(); }
        assert.equal(await pending, replacement);
    });

    test(`Model.${mode}: executes before hook, provider, and after hook in order`, async () => {
        const order: string[] = [];
        const original = new AssistantMessage("Original");
        const checkRequest = (request: { messages: unknown[] }) => {
            order.push("provider");
            assert.equal(request.messages.length, 0);
        };
        const provider: Provider = {
            name: "ordered",
            async invoke(request) { checkRequest(request); return original; },
            async *stream(request) { checkRequest(request); yield { type: "message", message: original }; },
        };
        const beforeModel = new BeforeModelHook({ hookName: "before", hookFunction: request => {
            order.push("before"); return { ...request, messages: [] };
        } });
        const afterModel = new AfterModelHook({ hookName: "after", hookFunction: () => { order.push("after"); } });
        const model = new Model(provider);
        if (mode === "invoke") await model.invoke({ messages: [new UserMessage("Hi")] }, { beforeModel, afterModel });
        else await collect(model.stream({ messages: [new UserMessage("Hi")] }, { beforeModel, afterModel }));
        assert.deepEqual(order, ["before", "provider", "after"]);
    });
}

test("Model.stream: deltas remain unchanged while afterModel replaces the final message", async () => {
    const { model } = source(new AssistantMessage("Original"));
    const hook = new AfterModelHook({ hookName: "rewrite", hookFunction: () => new AssistantMessage("Rewritten") });
    const items = await collect(model.stream({ messages: [] }, { afterModel: hook }));
    assert.deepEqual(items.slice(0, -1), [
        { type: "reasoning_delta", text: "thinking" }, { type: "text_delta", text: "Original" },
    ]);
    const last = items.at(-1);
    assert.ok(last?.type === "message");
    assert.equal(last.message.content, "Rewritten");
});

test("Model.stream: stopping at a delta does not run afterModel and closes the provider", async () => {
    const { model, isClosed } = source(new AssistantMessage("Original"));
    let calls = 0;
    const hook = new AfterModelHook({ hookName: "observe", hookFunction: () => { calls++; } });
    for await (const _ of model.stream({ messages: [] }, { afterModel: hook })) break;
    assert.equal(calls, 0);
    assert.equal(isClosed(), true);
});

for (const mode of ["run", "stream"] as const) {
    test(`Agent.${mode}: configured afterModel updates tool arguments before execution and replaces final output`, async () => {
        const original = new AssistantMessage("", { toolCalls: [{ callId: "count-1", toolName: "count", arguments: '{"value":1}' }] });
        const provider = new RecordingProvider(new MockProvider([original, new AssistantMessage("Original final")]));
        let executions = 0;
        let calls = 0;
        const afterModel = new AfterModelHook({ hookName: "rewrite", hookFunction: message => {
            calls++;
            if (message.toolCalls.length) return new AssistantMessage("Adjusted call", {
                toolCalls: message.toolCalls.map(call => ({ ...call, arguments: '{"value":7}' })),
            });
            return new AssistantMessage("Rewritten final");
        } });
        // Configure both hooks to verify Agent forwards afterModel alongside
        // beforeModel on every turn.
        const hooks = { beforeModel: new BeforeModelHook({ hookName: "noop", hookFunction: () => {} }), afterModel };
        const agent = new Agent({ model: new Model(provider), hooks, tools: [
            new Tool({ name: "count", description: "Count", parametersZodSchema: z.object({ value: z.number() }),
                func: ({ value }) => { executions++; return value * 2; } }),
        ] });
        const request = { messages: [new UserMessage("Count")] };
        const result = mode === "run" ? await agent.run(request) : (await collect(agent.stream(request))).at(-1);
        assert.ok(result && "status" in result);
        const generated = assertCompletedRun(result);
        assert.equal(calls, 2, "Agent must forward afterModel on every model turn");
        assert.equal(executions, 1);
        const tool = generated.find(message => message.role === "tool");
        assert.ok(tool);
        assert.equal(tool.toolOutput, "14");
        assert.equal(generated[0]?.role === "assistant" && generated[0].toolCalls[0]?.arguments, '{"value":7}');
        const final = generated.at(-1);
        assert.ok(final?.role === "assistant");
        assert.equal(final.content, "Rewritten final");
        assert.deepEqual(provider.requests[1]!.messages, structuredClone([
            ...provider.requests[0]!.messages, ...generated.slice(0, -1),
        ]));
    });
}
