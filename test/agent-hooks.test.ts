import "./helpers/offline.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as z from "zod";
import { Agent, type AgentResponse } from "../agent/agent.js";
import { BeforeAgentHook, AfterAgentHook } from "../core/hooks.js";
import { AssistantMessage, UserMessage, type BaseMessages } from "../core/messages.js";
import { Tool } from "../core/tool.js";
import { Model } from "../model/model.js";
import { MockProvider } from "../providers/mock-provider.js";
import { RecordingProvider } from "./helpers/recording-provider.js";
import { assertCompletedRun, assertFailedRun } from "./helpers/run-result.js";
import { collect } from "./helpers/stream.js";

type Mode = "run" | "stream";
async function run(agent: Agent, mode: Mode): Promise<AgentResponse> {
    const request = { messages: [new UserMessage("Original input")] };
    if (mode === "run") return agent.run(request);
    const items = await collect(agent.stream(request));
    const results = items.filter(item => "status" in item);
    assert.equal(results.length, 1, "Stream must yield exactly one terminal AgentResponse");
    const result = results[0];
    assert.ok(result);
    return result;
}

for (const mode of ["run", "stream"] as const) {
    test(`${mode}: awaits beforeAgent and runs it once across multiple model turns`, async () => {
        const provider = new RecordingProvider(new MockProvider([
            new AssistantMessage("", { toolCalls: [{ callId: "count-1", toolName: "count", arguments: "{}" }] }),
            new AssistantMessage("Done"),
        ]));
        let calls = 0;
        let executions = 0;
        const beforeAgent = new BeforeAgentHook({ hookName: "load-context", hookFunction: async request => {
            calls++;
            assert.equal(provider.requests.length, 0, "Run before the first model request");
            await Promise.resolve();
            return { ...request, messages: [new UserMessage("Loaded context")] };
        } });
        const agent = new Agent({ model: new Model(provider), hooks: { beforeAgent }, tools: [
            new Tool({ name: "count", description: "Count", parametersZodSchema: z.object({}), func: () => ++executions }),
        ] });
        const generated = assertCompletedRun(await run(agent, mode));
        assert.equal(calls, 1);
        assert.equal(executions, 1);
        assert.equal(provider.requests.length, 2);
        for (const request of provider.requests) {
            const user = request.messages.find(message => message.role === "user");
            assert.equal(user?.content, "Loaded context");
        }
        assert.deepEqual(generated.map(message => message.role), ["assistant", "tool", "assistant"]);
    });

    test(`${mode}: beforeAgent can observe input and return nothing`, async () => {
        const provider = new RecordingProvider(new MockProvider([new AssistantMessage("Done")]));
        let calls = 0;
        const beforeAgent = new BeforeAgentHook({ hookName: "observe", hookFunction: request => {
            calls++;
            const user = request.messages[0];
            assert.ok(user?.role === "user");
            assert.equal(user.content, "Original input");
        } });
        const agent = new Agent({ model: new Model(provider), hooks: { beforeAgent } });
        assertCompletedRun(await run(agent, mode));
        assert.equal(calls, 1);
        assert.deepEqual(provider.requests[0]!.messages.map(message => message.role), ["system", "user"]);
    });

    test(`${mode}: awaits afterAgent and wraps its replacement messages in the only final response`, async () => {
        const provider = new RecordingProvider(new MockProvider([new AssistantMessage("Original reply")]));
        const replacement: BaseMessages = [new AssistantMessage("Formatted reply")];
        let calls = 0;
        const afterAgent = new AfterAgentHook({ hookName: "format", hookFunction: async messages => {
            calls++;
            assert.equal(provider.requests.length, 1);
            const original = messages[0];
            assert.ok(original?.role === "assistant");
            assert.equal(original.content, "Original reply");
            await Promise.resolve();
            return replacement;
        } });
        const agent = new Agent({ model: new Model(provider), hooks: { afterAgent } });
        const result = await run(agent, mode);
        assert.equal(assertCompletedRun(result), replacement);
        assert.equal(calls, 1);
    });

    test(`${mode}: afterAgent can return nothing without changing or duplicating the result`, async () => {
        const original = new AssistantMessage("Done");
        const provider = new RecordingProvider(new MockProvider([original]));
        let calls = 0;
        const afterAgent = new AfterAgentHook({ hookName: "observe", hookFunction: () => { calls++; } });
        const agent = new Agent({ model: new Model(provider), hooks: { afterAgent } });
        assert.deepEqual(assertCompletedRun(await run(agent, mode)), [original]);
        assert.equal(calls, 1);
    });

    test(`${mode}: a rejected beforeAgent produces a failed result and prevents model requests`, async () => {
        const failure = new Error("Cannot load context");
        const provider = new RecordingProvider(new MockProvider([new AssistantMessage("Must not run")]));
        const beforeAgent = new BeforeAgentHook({ hookName: "fail", hookFunction: async () => { throw failure; } });
        const agent = new Agent({ model: new Model(provider), hooks: { beforeAgent } });
        const result = assertFailedRun(await run(agent, mode));
        assert.equal(result.error, failure);
        assert.deepEqual(result.messages, []);
        assert.equal(provider.requests.length, 0);
    });

    test(`${mode}: an afterAgent exception produces a failed result retaining generated progress`, async () => {
        const original = new AssistantMessage("Generated reply");
        const failure = new Error("Formatting failed");
        const provider = new RecordingProvider(new MockProvider([original]));
        const afterAgent = new AfterAgentHook({ hookName: "fail", hookFunction: () => { throw failure; } });
        const agent = new Agent({ model: new Model(provider), hooks: { afterAgent } });
        const result = assertFailedRun(await run(agent, mode));
        assert.equal(result.error, failure);
        assert.deepEqual(result.messages, [original]);
        assert.equal(provider.requests.length, 1);
    });
}
