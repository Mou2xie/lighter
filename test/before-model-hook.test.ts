import "./helpers/offline.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as z from "zod";
import { Agent, type AgentResponse } from "../agent/agent.js";
import { BeforeModelHook } from "../core/hooks.js";
import { AssistantMessage, UserMessage, type BaseMessages } from "../core/messages.js";
import { Tool, type ToolSpec } from "../core/tool.js";
import { Model } from "../model/model.js";
import { MockProvider } from "../model/providers/mock-provider.js";
import { RecordingProvider } from "./helpers/recording-provider.js";
import { assertCompletedRun, assertFailedRun } from "./helpers/run-result.js";
import { collect } from "./helpers/stream.js";

async function run(agent: Agent, mode: "run" | "stream", messages: BaseMessages): Promise<AgentResponse> {
    if (mode === "run") return agent.run({ messages });
    const items = await collect(agent.stream({ messages }));
    const last = items.at(-1);
    assert.ok(last && "status" in last, "Expected one terminal AgentResponse");
    assert.equal(items.filter(item => "status" in item).length, 1);
    return last;
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

for (const mode of ["run", "stream"] as const) {
    test(`${mode}: the provider receives the replacement messages and tool definitions`, async () => {
        const provider = new RecordingProvider(new MockProvider([new AssistantMessage("Done")]));
        const replacement = [new UserMessage("Rewritten request")];
        const tools: ToolSpec[] = [{ type: "function", name: "lookup", description: "Lookup", parameters: {}, strict: false }];
        const hook = new BeforeModelHook({
            hookName: "replace-request",
            hookFunction: request => {
                assert.deepEqual(request.messages.map(m => m.role), ["system", "user"]);
                assert.deepEqual(request.toolSpecs, []);
                return { messages: replacement, toolSpecs: tools };
            },
        });
        const history = [new UserMessage("Original request")];
        const before = structuredClone(history);
        const agent = new Agent({ model: new Model(provider), hooks: { beforeModel: hook } });
        const generated = assertCompletedRun(await run(agent, mode, history));
        assert.deepEqual(provider.requests, [{ messages: structuredClone(replacement), tools }]);
        assert.deepEqual(generated.map(m => m.role), ["assistant"]);
        assert.deepEqual(structuredClone(history), before);
    });

    test(`${mode}: awaits an asynchronous hook before calling the provider`, async () => {
        const entered = deferred();
        const release = deferred();
        const provider = new RecordingProvider(new MockProvider([new AssistantMessage("Done")]));
        const hook = new BeforeModelHook({
            hookName: "load-context",
            hookFunction: async request => {
                entered.resolve();
                await release.promise;
                return { ...request, messages: [new UserMessage("Loaded context")] };
            },
        });
        const agent = new Agent({ model: new Model(provider), hooks: { beforeModel: hook } });
        const pending = run(agent, mode, [new UserMessage("Hi")]);
        await entered.promise;
        try { assert.equal(provider.requests.length, 0); }
        finally { release.resolve(); }
        assertCompletedRun(await pending);
        const sent = provider.requests[0]!.messages[0];
        assert.ok(sent?.role === "user");
        assert.equal(sent.content, "Loaded context");
    });

    for (const asynchronous of [false, true]) {
        test(`${mode}: ${asynchronous ? "async" : "sync"} no-op hook preserves the request`, async () => {
            const provider = new RecordingProvider(new MockProvider([new AssistantMessage("Done")]));
            let calls = 0;
            const observe = () => { calls++; };
            const hook = new BeforeModelHook({ hookName: "observe", hookFunction: asynchronous ? async () => observe() : observe });
            const agent = new Agent({ model: new Model(provider), hooks: { beforeModel: hook } });
            assertCompletedRun(await run(agent, mode, [new UserMessage("Hi")]));
            assert.equal(calls, 1);
            assert.deepEqual(provider.requests[0]!.messages.map(m => m.role), ["system", "user"]);
        });

        test(`${mode}: ${asynchronous ? "async" : "sync"} hook failure prevents the provider call and retains the error`, async () => {
            const provider = new RecordingProvider(new MockProvider([]));
            const failure = new Error("Context unavailable");
            const fail = () => { throw failure; };
            const hook = new BeforeModelHook({ hookName: "fail", hookFunction: asynchronous ? async () => fail() : fail });
            const agent = new Agent({ model: new Model(provider), hooks: { beforeModel: hook } });
            const result = assertFailedRun(await run(agent, mode, [new UserMessage("Hi")]));
            assert.equal(result.error, failure);
            assert.deepEqual(result.messages, []);
            assert.equal(provider.requests.length, 0);
        });
    }

    test(`${mode}: reruns the hook after tools and keeps replacement messages local to each model request`, async () => {
        const reply = new AssistantMessage("", { toolCalls: [{ callId: "count-1", toolName: "count", arguments: "{}" }] });
        const provider = new RecordingProvider(new MockProvider([reply, new AssistantMessage("Done")]));
        let executions = 0;
        const tool = new Tool({ name: "count", description: "Count", parametersZodSchema: z.object({}), func: () => ++executions });
        const seen: string[][] = [];
        const hook = new BeforeModelHook({
            hookName: "trim-system",
            hookFunction: async request => {
                seen.push(request.messages.map(m => m.role));
                // First turn returns a replacement, second turn returns void.
                if (seen.length === 1) return { ...request, messages: request.messages.slice(1), toolSpecs: [] };
            },
        });
        const agent = new Agent({ model: new Model(provider), tools: [tool], hooks: { beforeModel: hook } });
        const generated = assertCompletedRun(await run(agent, mode, [new UserMessage("Count")]));
        assert.deepEqual(seen, [["system", "user"], ["system", "user", "assistant", "tool"]]);
        assert.deepEqual(provider.requests[0]!.messages.map(m => m.role), ["user"]);
        assert.deepEqual(provider.requests[0]!.tools, []);
        assert.deepEqual(provider.requests[1]!.tools, [tool.getSpec()]);
        assert.equal(executions, 1);
        assert.deepEqual(generated.map(m => m.role), ["assistant", "tool", "assistant"]);
    });

    test(`${mode}: a hook failing on a later turn retains completed tool progress`, async () => {
        const reply = new AssistantMessage("", { toolCalls: [{ callId: "once", toolName: "count", arguments: "{}" }] });
        const provider = new RecordingProvider(new MockProvider([reply]));
        let executions = 0;
        let calls = 0;
        const failure = new Error("Follow-up hook failed");
        const hook = new BeforeModelHook({ hookName: "fail-second", hookFunction: () => { if (++calls === 2) throw failure; } });
        const agent = new Agent({ model: new Model(provider), hooks: { beforeModel: hook }, tools: [
            new Tool({ name: "count", description: "Count", parametersZodSchema: z.object({}), func: () => ++executions }),
        ] });
        const result = assertFailedRun(await run(agent, mode, [new UserMessage("Count")]));
        assert.equal(result.error, failure);
        assert.deepEqual(result.messages.map(m => m.role), ["assistant", "tool"]);
        assert.equal(executions, 1);
        assert.equal(provider.requests.length, 1);
    });

    test(`${mode}: trimming the request array inside a hook must not lose the final generated message`, async () => {
        const reply = new AssistantMessage("Done");
        const provider = new RecordingProvider(new MockProvider([reply]));
        const hook = new BeforeModelHook({ hookName: "trim-in-place", hookFunction: request => {
            request.messages.splice(0, 1);
            return request;
        } });
        const agent = new Agent({ model: new Model(provider), hooks: { beforeModel: hook } });
        const generated = assertCompletedRun(await run(agent, mode, [new UserMessage("Hi")]));
        assert.deepEqual(provider.requests[0]!.messages.map(m => m.role), ["user"]);
        assert.deepEqual(generated, [reply], "Request-only trimming must not invalidate the agent's generated-message offset");
    });
}
