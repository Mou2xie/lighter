import "./helpers/offline.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as z from "zod";
import type {
    Response,
    ResponseOutputMessage,
    ResponseReasoningItem,
} from "openai/resources/responses/responses.js";
import { Agent } from "../agent/agent.js";
import { AssistantMessage, SystemMessage, ToolMessage, UserMessage } from "../core/messages.js";
import { Tool } from "../core/tool.js";
import { Model } from "../model/model.js";
import { ModelError } from "../model/errors.js";
import { OpenAIProvider, type OpenAIProviderOptions } from "../providers/openai-provider.js";
import { call, response, text } from "./fixtures/deepseek.js";
import { mockHttp } from "./helpers/http.js";
import { assertCompletedRun } from "./helpers/run-result.js";
import { collect, sse } from "./helpers/stream.js";

const ENDPOINT = "https://api.openai.com/v1/responses";

function makeProvider(options: OpenAIProviderOptions = {}) {
    return new OpenAIProvider("offline-test-key", "gpt-5", options);
}

function makeAddition(onExecute: () => void = () => {}) {
    return new Tool({
        name: "addition", description: "Add two numbers",
        parametersZodSchema: z.strictObject({ a: z.number(), b: z.number() }),
        func: ({ a, b }) => { onExecute(); return a + b; },
    });
}

// OpenAI surfaces reasoning as summaries, unlike DeepSeek's reasoning_text content,
// so the shared DeepSeek fixture cannot express it.
function summary(...parts: string[]): ResponseReasoningItem {
    return {
        id: "rs_summary",
        type: "reasoning",
        summary: parts.map(part => ({ type: "summary_text", text: part })),
    };
}

function refusal(text: string): ResponseOutputMessage {
    return {
        id: "msg_refusal",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "refusal", refusal: text }],
    };
}

test("sends a stateless request with mapped input and the raw tool schema", async t => {
    const http = mockHttp(t, [{ body: response([text("Hello", " world")]) }]);
    const spec = makeAddition().getSpec();

    const reply = await new Model(makeProvider()).invoke({
        messages: [new SystemMessage("Be concise"), new UserMessage("Hi")],
        toolSpecs: [spec],
    });

    http.assertConsumed();
    const request = http.requests[0]!;
    assert.equal(request.url, ENDPOINT);
    assert.equal(request.method, "POST");
    assert.equal(request.body.model, "gpt-5");
    assert.equal(request.body.store, false, "the provider must not rely on server-side state");
    assert.equal(request.body.stream, undefined);
    assert.deepEqual(request.body.input, [
        { type: "message", role: "system", content: "Be concise" },
        { type: "message", role: "user", content: "Hi" },
    ]);
    assert.deepEqual(request.body.tools, [spec]);
    assert.equal(reply.content, "Hello world");
    assert.deepEqual(reply.toolCalls, []);
});

test("forwards the reasoning and maxOutputTokens options verbatim, and omits them when unset", async t => {
    const http = mockHttp(t, [
        { body: response([text("a")]) },
        { body: response([text("b")]) },
    ]);
    const reasoning: OpenAIProviderOptions["reasoning"] = { effort: "low", summary: "auto" };

    await makeProvider({ reasoning, maxOutputTokens: 256 }).invoke({ messages: [new UserMessage("Hi")], toolSpecs: [] });
    await makeProvider().invoke({ messages: [new UserMessage("Hi")], toolSpecs: [] });

    http.assertConsumed();
    assert.deepEqual(http.requests[0]!.body.reasoning, { effort: "low", summary: "auto" });
    assert.equal(http.requests[0]!.body.max_output_tokens, 256);
    assert.equal("reasoning" in http.requests[1]!.body, false, "unset options must not reach the wire");
    assert.equal("max_output_tokens" in http.requests[1]!.body, false);
});

test("collects output text, refusals, reasoning summaries and tool calls keyed by call_id", async t => {
    const http = mockHttp(t, [{ body: response([
        summary("Need ", "tools"),
        text("Checking ", "both"),
        refusal("I cannot help with that."),
        call("call-add", "addition", '{"a":1,"b":2}'),
        call("call-lookup", "lookup", '{"id":42}'),
    ]) }]);

    const reply = await makeProvider().invoke({ messages: [new UserMessage("Go")], toolSpecs: [] });

    http.assertConsumed();
    assert.equal(reply.content, "Checking bothI cannot help with that.");
    assert.equal(reply.reasoning, "Need tools");
    assert.deepEqual(reply.toolCalls, [
        { callId: "call-add", toolName: "addition", arguments: '{"a":1,"b":2}' },
        { callId: "call-lookup", toolName: "lookup", arguments: '{"id":42}' },
    ]);
});

test("replays the untouched native output items so reasoning IDs and phases survive", async t => {
    const nativeOutput = [
        summary("Need tools"),
        text("Checking"),
        call("call-add", "addition", '{"a":1,"b":2}'),
    ];
    const http = mockHttp(t, [
        { body: response(nativeOutput) },
        { body: response([text("3")]) },
    ]);
    const provider = makeProvider();

    const first = await provider.invoke({ messages: [new UserMessage("Add")], toolSpecs: [] });
    await provider.invoke({ messages: [new UserMessage("Add"), first], toolSpecs: [] });

    http.assertConsumed();
    const input = http.requests[1]!.body.input;
    assert.ok(Array.isArray(input));
    assert.deepEqual(input.slice(1), nativeOutput, "native items must be replayed verbatim, not rebuilt");
});

test("rebuilds from current fields when an assistant message is replaced or cloned", async t => {
    const http = mockHttp(t, [
        { body: response([summary("Need tools"), text("Checking"), call("call-add", "addition", '{"a":1,"b":2}')]) },
        { body: response([text("3")]) },
    ]);
    const provider = makeProvider();

    const first = await provider.invoke({ messages: [new UserMessage("Add")], toolSpecs: [] });
    // A hook replacement or structuredClone loses the provider-private prototype,
    // which must fall back to the lossy-but-safe reconstruction path.
    const replacement = new AssistantMessage(first.content, {
        reasoning: first.reasoning,
        toolCalls: first.toolCalls,
    });
    await provider.invoke({ messages: [replacement], toolSpecs: [] });

    http.assertConsumed();
    const input = http.requests[1]!.body.input;
    assert.ok(Array.isArray(input));
    assert.deepEqual(input, [
        { type: "message", role: "assistant", content: "Checking" },
        { type: "function_call", call_id: "call-add", name: "addition", arguments: '{"a":1,"b":2}' },
    ]);
});

test("stops replaying native items once the message fields are mutated in place", async t => {
    const http = mockHttp(t, [
        { body: response([text("Checking"), call("call-add", "addition", '{"a":1,"b":2}')]) },
        { body: response([text("3")]) },
    ]);
    const provider = makeProvider();

    const first = await provider.invoke({ messages: [new UserMessage("Add")], toolSpecs: [] });
    first.toolCalls.push({ callId: "call-extra", toolName: "addition", arguments: '{"a":3,"b":4}' });
    await provider.invoke({ messages: [first], toolSpecs: [] });

    http.assertConsumed();
    const input = http.requests[1]!.body.input;
    assert.ok(Array.isArray(input));
    assert.deepEqual(input, [
        { type: "message", role: "assistant", content: "Checking" },
        { type: "function_call", call_id: "call-add", name: "addition", arguments: '{"a":1,"b":2}' },
        { type: "function_call", call_id: "call-extra", name: "addition", arguments: '{"a":3,"b":4}' },
    ]);
    assert.equal(input.every(item => !("id" in item)), true, "mutated messages must not reuse stale native items");
});

test("omits the assistant text item for a tool-only message when rebuilding", async t => {
    const http = mockHttp(t, [{ body: response([text("3")]) }]);

    await makeProvider().invoke({
        messages: [new AssistantMessage("", { toolCalls: [{ callId: "call-add", toolName: "addition", arguments: "{}" }] })],
        toolSpecs: [],
    });

    http.assertConsumed();
    const input = http.requests[0]!.body.input;
    assert.ok(Array.isArray(input));
    assert.deepEqual(input, [
        { type: "function_call", call_id: "call-add", name: "addition", arguments: "{}" },
    ]);
});

for (const [status, code] of [
    ["failed", "bad_response"],
    ["incomplete", "bad_response"],
    ["cancelled", "aborted"],
    ["queued", "bad_response"],
] as const) {
    test(`rejects a ${status} response body instead of returning a partial reply`, async t => {
        const http = mockHttp(t, [{ body: response([text("must not be committed")], {
            status,
            ...(status === "failed" ? { error: { code: "server_error", message: "Generation failed" } } : {}),
            ...(status === "incomplete" ? { incomplete_details: { reason: "max_output_tokens" } } : {}),
        }) }]);

        await assert.rejects(makeProvider().invoke({ messages: [new UserMessage("Hi")], toolSpecs: [] }), error => {
            assert.ok(error instanceof ModelError);
            assert.equal(error.code, code);
            assert.equal(error.responseStatus, status);
            assert.equal(error.httpStatus, undefined);
            return true;
        });

        http.assertConsumed();
    });
}

test("rejects output items it cannot model rather than silently dropping them", async t => {
    const unsupported = [{ type: "web_search_call", id: "ws_1", status: "completed" }] as unknown as Response["output"];
    const http = mockHttp(t, [{ body: response(unsupported) }]);

    await assert.rejects(makeProvider().invoke({ messages: [new UserMessage("Hi")], toolSpecs: [] }), error => {
        assert.ok(error instanceof ModelError);
        assert.equal(error.code, "bad_response");
        assert.match(error.message, /Unsupported OpenAI output item/);
        return true;
    });

    http.assertConsumed();
});

for (const [status, code] of [
    [401, "auth_error"],
    [403, "auth_error"],
    [429, "rate_limit"],
    [503, "server_error"],
    [400, "invalid_request"],
] as const) {
    test(`classifies HTTP ${status} as ${code}`, async t => {
        const http = mockHttp(t, [{ status, body: { error: { message: "Request failed", type: "invalid_request_error" } } }]);

        await assert.rejects(makeProvider().invoke({ messages: [new UserMessage("Hi")], toolSpecs: [] }), error => {
            assert.ok(error instanceof ModelError);
            assert.equal(error.code, code);
            assert.equal(error.httpStatus, status);
            assert.match(error.message, /Request failed/);
            return true;
        });

        http.assertConsumed();
    });
}

test("streams reasoning summary and text deltas, then the completed message exactly once", async t => {
    const http = mockHttp(t, [{ sse: true, body: sse(
        { type: "response.created", response: response([], { status: "in_progress" }) },
        { type: "response.reasoning_summary_text.delta", delta: "Need " },
        { type: "response.reasoning_summary_text.delta", delta: "tools" },
        { type: "response.output_text.delta", delta: "Hel" },
        { type: "response.output_text.delta", delta: "lo" },
        { type: "response.completed", response: response([
            summary("Need tools"),
            text("Hello"),
            call("call-add", "addition", '{"a":1,"b":2}'),
        ]) },
    ) }]);

    const items = await collect(new Model(makeProvider()).stream({
        messages: [new UserMessage("Hi")],
        toolSpecs: [],
    }));

    http.assertConsumed();
    assert.equal(http.requests[0]!.body.stream, true);
    assert.equal(http.requests[0]!.url, ENDPOINT);
    assert.deepEqual(items.slice(0, -1), [
        { type: "reasoning_delta", text: "Need " },
        { type: "reasoning_delta", text: "tools" },
        { type: "text_delta", text: "Hel" },
        { type: "text_delta", text: "lo" },
    ]);
    const last = items.at(-1);
    assert.ok(last?.type === "message");
    assert.equal(last.message.content, "Hello");
    assert.equal(last.message.reasoning, "Need tools");
    assert.deepEqual(last.message.toolCalls, [{ callId: "call-add", toolName: "addition", arguments: '{"a":1,"b":2}' }]);
});

test("stream rejects a failed response after preserving the deltas already emitted", async t => {
    const http = mockHttp(t, [{ sse: true, body: sse(
        { type: "response.output_text.delta", delta: "partial" },
        { type: "response.failed", response: response([text("must not be committed")], {
            status: "failed",
            error: { code: "server_error", message: "Generation failed" },
        }) },
    ) }]);
    const iterator = makeProvider().stream({ messages: [new UserMessage("Hi")], toolSpecs: [] });

    assert.deepEqual((await iterator.next()).value, { type: "text_delta", text: "partial" });
    await assert.rejects(iterator.next(), error => {
        assert.ok(error instanceof ModelError);
        assert.equal(error.code, "bad_response");
        assert.equal(error.responseStatus, "failed");
        assert.match(error.message, /Generation failed/);
        return true;
    });
    assert.equal((await iterator.next()).done, true);
    http.assertConsumed();
});

test("stream rejects a stream that ends without a completed response", async t => {
    const http = mockHttp(t, [{ sse: true, body: sse(
        { type: "response.created", response: response([], { status: "in_progress" }) },
        { type: "response.output_text.delta", delta: "partial" },
    ) }]);

    const items: unknown[] = [];
    await assert.rejects((async () => {
        for await (const item of makeProvider().stream({ messages: [new UserMessage("Hi")], toolSpecs: [] })) {
            items.push(item);
        }
    })(), error => {
        assert.ok(error instanceof ModelError);
        assert.equal(error.code, "bad_response");
        assert.match(error.message, /ended without a completed message/);
        return true;
    });
    assert.deepEqual(items, [{ type: "text_delta", text: "partial" }]);
    http.assertConsumed();
});

test("Agent completes a tool round trip through the real SDK and mocked HTTP", async t => {
    let executions = 0;
    const http = mockHttp(t, [
        { body: response([call("bad-args", "addition", '{"a":"31","b":17}')]) },
        { body: response([summary("Fix the args"), call("corrected", "addition", '{"a":31,"b":17}')]) },
        { body: response([text("48")]) },
    ]);
    const agent = new Agent({ model: new Model(makeProvider()), tools: [makeAddition(() => executions++)] });

    const inputMessages = [new UserMessage("31 + 17?")];
    const messages = assertCompletedRun(await agent.run({ messages: inputMessages }));

    http.assertConsumed();
    assert.equal(executions, 1);
    assert.deepEqual(inputMessages.map(message => message.role), ["user"], "the caller's history must not be mutated");
    assert.deepEqual(messages.map(message => message.role), ["assistant", "tool", "assistant", "tool", "assistant"]);
    const toolMessages = messages.filter(message => message.role === "tool");
    assert.ok(toolMessages.every(message => message instanceof ToolMessage));
    assert.deepEqual(toolMessages.map(message => [message.callId, message.isError]), [
        ["bad-args", true], ["corrected", false],
    ]);

    // The third request must replay the second assistant turn from its native items,
    // including the reasoning summary that the flat message model cannot rebuild.
    const thirdInput = http.requests[2]!.body.input;
    assert.ok(Array.isArray(thirdInput));
    const replayed = thirdInput.filter(item => item.type === "reasoning");
    assert.deepEqual(replayed, [{ id: "rs_summary", type: "reasoning", summary: [{ type: "summary_text", text: "Fix the args" }] }]);
    const last = messages.at(-1);
    assert.ok(last?.role === "assistant");
    assert.equal(last.content, "48");
});
