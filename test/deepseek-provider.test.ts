import "./helpers/offline.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as z from "zod";
import { AgentLoop } from "../agent-loop/agent-loop.js";
import { AssistantMessage, SystemMessage, Tool, ToolMessage, UserMessage } from "../core/protocol.js";
import { Model } from "../model/model.js";
import { ModelError } from "../model/errors.js";
import { DeepSeekProvider } from "../model/providers/deepseek-provider.js";
import { call, reasoning, response, text } from "./fixtures/deepseek.js";
import { mockHttp } from "./helpers/http.js";

function makeProvider() {
    return new DeepSeekProvider("offline-test-key", "deepseek-flash");
}

function makeAddition(onExecute: () => void = () => {}) {
    return new Tool({
        name: "addition", description: "Add two numbers",
        parametersZodSchema: z.strictObject({ a: z.number(), b: z.number() }),
        func: ({ a, b }) => { onExecute(); return a + b; },
    });
}

test("sends a real SDK request through a mocked fetch with the correct endpoint and tool schema", async t => {
    const http = mockHttp(t, [{ body: response([text("Hello", " world")]) }]);
    const messages = [new SystemMessage("Be concise"), new UserMessage("Hi")];
    const spec = makeAddition().getSpec();

    const reply = await new Model(makeProvider()).invoke(messages, [spec]);

    http.assertConsumed();
    const request = http.requests[0]!;
    assert.equal(request.url, "https://api.deepseek.com/responses");
    assert.equal(request.method, "POST");
    assert.equal(request.body.model, "deepseek-flash");
    assert.deepEqual(request.body.input, [
        { type: "message", role: "system", content: "Be concise" },
        { type: "message", role: "user", content: "Hi" },
    ]);
    assert.deepEqual(request.body.tools, [spec]);
    assert.equal(reply.content, "Hello world");
    assert.deepEqual(reply.toolCalls, []);
});

test("preserves reasoning, call IDs, outputs and tool errors when adapting conversation history", async t => {
    const http = mockHttp(t, [{ body: response([text("Done")]) }]);
    const messages = [
        new SystemMessage("Be concise"),
        new UserMessage("Add"),
        new AssistantMessage("Checking", {
            reasoning: "Need the tools",
            toolCalls: [
                { callId: "ok-1", toolName: "addition", arguments: '{"a":1,"b":2}' },
                { callId: "bad-1", toolName: "lookup", arguments: "{}" },
            ],
        }),
        new ToolMessage({ callId: "ok-1", toolName: "addition", toolOutput: "3" }),
        new ToolMessage({ callId: "bad-1", toolName: "lookup", toolOutput: "Lookup failed", isError: true }),
        new UserMessage("Continue"),
    ];
    const before = JSON.stringify(messages);

    await makeProvider().invoke(messages, []);

    http.assertConsumed();
    const input = http.requests[0]!.body.input;
    assert.ok(Array.isArray(input));
    assert.deepEqual(input.map(item => item.type), ["message", "message", "reasoning", "message", "function_call", "function_call", "function_call_output", "function_call_output", "message"]);
    const reasoningInput = input.find(item => item.type === "reasoning");
    assert.ok(reasoningInput?.type === "reasoning");
    assert.deepEqual(reasoningInput.content, [{ type: "reasoning_text", text: "Need the tools" }]);
    const calls = input.filter(item => item.type === "function_call");
    assert.deepEqual(calls.map(item => [item.call_id, item.name, item.arguments]), [
        ["ok-1", "addition", '{"a":1,"b":2}'], ["bad-1", "lookup", "{}"],
    ]);
    const results = input.filter(item => item.type === "function_call_output");
    assert.equal(results[0]!.call_id, "ok-1");
    assert.equal(results[0]!.output, "3");
    assert.equal(results[1]!.call_id, "bad-1");
    assert.equal(typeof results[1]!.output, "string");
    assert.deepEqual(JSON.parse(results[1]!.output as string), { isError: true, error: "Lookup failed" });
    assert.equal(JSON.stringify(messages), before, "Adapting history must not modify caller messages");
});

test("collects response text parts, reasoning and every tool call using call_id rather than item id", async t => {
    const http = mockHttp(t, [{ body: response([
        reasoning("Need ", "tools"),
        text("Checking ", "both"),
        call("call-add", "addition", '{"a":1,"b":2}'),
        call("call-lookup", "lookup", '{"id":42}'),
    ]) }]);

    const reply = await makeProvider().invoke([new UserMessage("Go")], []);

    http.assertConsumed();
    assert.equal(reply.content, "Checking both");
    assert.equal(reply.reasoning, "Need tools");
    assert.deepEqual(reply.toolCalls, [
        { callId: "call-add", toolName: "addition", arguments: '{"a":1,"b":2}' },
        { callId: "call-lookup", toolName: "lookup", arguments: '{"id":42}' },
    ]);
});

test("accepts a tool-only response without requiring assistant text or reasoning", async t => {
    const http = mockHttp(t, [{ body: response([call("call-only", "addition", '{"a":1,"b":2}')]) }]);

    const reply = await makeProvider().invoke([new UserMessage("Go")], []);

    http.assertConsumed();
    assert.equal(reply.content, "");
    assert.equal(reply.reasoning, undefined);
    assert.equal(reply.toolCalls[0]!.callId, "call-only");
});

test("handles reasoning items that omit their optional content", async t => {
    const http = mockHttp(t, [{ body: response([{ type: "reasoning", id: "rs_empty", summary: [] }, text("Hello")]) }]);

    const reply = await makeProvider().invoke([new UserMessage("Hi")], []);

    http.assertConsumed();
    assert.equal(reply.content, "Hello");
    assert.equal(reply.reasoning, undefined);
});

test("HTTP authentication failures reject instead of becoming successful empty replies", async t => {
    const http = mockHttp(t, [{ status: 401, body: { error: { message: "Invalid test key", type: "authentication_error", code: "invalid_api_key" } } }]);

    await assert.rejects(makeProvider().invoke([new UserMessage("Hi")], []), error => {
        assert.ok(error instanceof ModelError);
        assert.equal(error.code, "auth_error");
        assert.equal(error.status, 401);
        assert.match(error.message, /Invalid test key/);
        return true;
    });

    http.assertConsumed();
});

test("AgentLoop returns the complete generated increment through the actual SDK and mocked HTTP", async t => {
    let executions = 0;
    const http = mockHttp(t, [
        { body: response([call("bad-args", "addition", '{"a":"31","b":17}')]) },
        { body: response([call("corrected", "addition", '{"a":31,"b":17}')]) },
        { body: response([text("48")]) },
    ]);
    const loop = new AgentLoop({ model: new Model(makeProvider()), tools: [makeAddition(() => executions++)] });

    const inputMessages = [new UserMessage("31 + 17?")];
    const messages = await loop.runLoop(inputMessages);

    http.assertConsumed();
    assert.equal(executions, 1);
    assert.deepEqual(inputMessages.map(message => message.role), ["user"]);
    assert.deepEqual(messages.map(message => message.role), ["assistant", "tool", "assistant", "tool", "assistant"]);
    assert.deepEqual(messages.filter(message => message.role === "tool").map(message => [message.callId, message.isError]), [
        ["bad-args", true], ["corrected", false],
    ]);
    for (const request of http.requests) {
        const spec = request.body.tools?.[0];
        assert.ok(spec?.type === "function");
        assert.equal(spec.name, "addition");
        assert.equal(spec.parameters?.type, "object");
        assert.equal("parametersJSONSchema" in spec, false);
        assert.equal("parametersZodSchema" in spec, false);
    }
    const secondInput = http.requests[1]!.body.input;
    assert.ok(Array.isArray(secondInput));
    const failure = secondInput.find(item => item.type === "function_call_output" && item.call_id === "bad-args");
    assert.ok(failure?.type === "function_call_output");
    assert.equal(typeof failure.output, "string");
    assert.equal(JSON.parse(failure.output as string).isError, true);
    const thirdInput = http.requests[2]!.body.input;
    assert.ok(Array.isArray(thirdInput));
    const success = thirdInput.find(item => item.type === "function_call_output" && item.call_id === "corrected");
    assert.ok(success?.type === "function_call_output");
    assert.equal(success.output, "48");
    const last = messages.at(-1);
    assert.ok(last?.role === "assistant");
    assert.equal(last.content, "48");
});
