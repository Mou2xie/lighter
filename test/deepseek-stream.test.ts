import "./helpers/offline.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import OpenAI from "openai";
import { Responses } from "openai/resources/responses/responses";
import { Agent } from "../agent/agent.js";
import { UserMessage } from "../core/messages.js";
import { Model } from "../model/model.js";
import { ModelError } from "../model/errors.js";
import { DeepSeekProvider } from "../model/providers/deepseek-provider.js";
import { call, reasoning, response, text } from "./fixtures/deepseek.js";
import { mockHttp } from "./helpers/http.js";
import { collect, sse } from "./helpers/stream.js";

const provider = () => new DeepSeekProvider("offline-test-key", "deepseek-flash");
const stream = () => provider().stream([new UserMessage("Hi")], []);

test("DeepSeek stream decodes real SSE deltas and uses the completed response for the final message", async t => {
    const http = mockHttp(t, [{ sse: true, body: sse(
        { type: "response.created", response: response([], { status: "in_progress" }) },
        { type: "response.reasoning_text.delta", delta: "想" },
        { type: "response.reasoning_text.delta", delta: "好了" },
        { type: "response.output_text.delta", delta: "你" },
        { type: "response.output_text.delta", delta: "好" },
        { type: "response.function_call_arguments.delta", delta: '{"n":' },
        { type: "response.completed", response: response([reasoning("想好了"), text("你好"), call("actual-call-id", "lookup", '{"n":1}')]) },
    ) }]);
    const items = await collect(new Model(provider()).stream([new UserMessage("Hi")], []));
    http.assertConsumed();
    assert.equal(http.requests[0]!.body.stream, true);
    assert.equal(http.requests[0]!.url, "https://api.deepseek.com/responses");
    assert.deepEqual(items.slice(0, -1), [
        { type: "reasoning_delta", text: "想" }, { type: "reasoning_delta", text: "好了" },
        { type: "text_delta", text: "你" }, { type: "text_delta", text: "好" },
    ]);
    const last = items.at(-1);
    assert.ok(last?.type === "message");
    assert.equal(last.message.content, "你好");
    assert.equal(last.message.reasoning, "想好了");
    assert.deepEqual(last.message.toolCalls, [{ callId: "actual-call-id", toolName: "lookup", arguments: '{"n":1}' }]);
});

for (const status of ["failed", "incomplete"] as const) {
    for (const withDetails of [true, false]) {
        test(`stream rejects ${status} with details=${withDetails} after preserving emitted deltas`, async t => {
            const http = mockHttp(t, [{ sse: true, body: sse(
                { type: "response.output_text.delta", delta: "partial" },
                { type: `response.${status}`, response: response([text("must not be committed")], {
                    status,
                    ...(withDetails ? status === "failed"
                        ? { error: { code: "server_error", message: "Generation failed" } }
                        : { incomplete_details: { reason: "max_output_tokens" } } : {}),
                }) },
            ) }]);
            const iterator = stream();
            assert.deepEqual((await iterator.next()).value, { type: "text_delta", text: "partial" });
            await assert.rejects(iterator.next(), error => {
                assert.ok(error instanceof ModelError);
                assert.equal(error.code, "bad_response");
                assert.equal(error.responseStatus, status);
                assert.equal(error.httpStatus, undefined);
                assert.match(error.message, withDetails ? /Generation failed|max_output_tokens/ : /No .* provided/);
                return true;
            });
            assert.equal((await iterator.next()).done, true);
            http.assertConsumed();
        });
    }
}

for (const [status, code] of [[401, "auth_error"], [429, "rate_limit"], [503, "server_error"]] as const) {
    test(`stream classifies HTTP ${status} before any SSE is received`, async t => {
        const http = mockHttp(t, [{ status, body: { error: { message: "Request failed" } } }]);
        await assert.rejects(collect(stream()), error => {
            assert.ok(error instanceof ModelError);
            assert.equal(error.code, code);
            assert.equal(error.httpStatus, status);
            return true;
        });
        http.assertConsumed();
    });
}

for (const [original, code] of [
    [new OpenAI.APIConnectionError({ message: "Connection lost" }), "network_error"],
    [new OpenAI.APIUserAbortError(), "aborted"],
    [new TypeError("Unexpected error"), undefined],
] as const) {
    test(`stream preserves or classifies iteration-time ${original.name}`, async t => {
        t.mock.method(Responses.prototype, "create", async () => (async function* () {
            yield { type: "response.output_text.delta", delta: "partial" };
            throw original;
        })());
        const iterator = stream();
        assert.deepEqual((await iterator.next()).value, { type: "text_delta", text: "partial" });
        await assert.rejects(iterator.next(), error => {
            if (code) {
                assert.ok(error instanceof ModelError);
                assert.equal(error.code, code);
                assert.ok(error.message.includes(original.message));
            } else assert.equal(error, original);
            return true;
        });
    });
}

test("Agent stream completes through SDK and SSE without committing partial text twice", async t => {
    const http = mockHttp(t, [{ sse: true, body: sse(
        { type: "response.output_text.delta", delta: "Hello" },
        { type: "response.completed", response: response([text("Hello")]) },
    ) }]);
    const items = await collect(new Agent({ model: new Model(provider()) }).stream([new UserMessage("Hi")]));
    http.assertConsumed();
    assert.equal(items.length, 2);
    const last = items.at(-1);
    assert.ok(last && "status" in last);
    assert.equal(last.status, "completed");
    assert.equal(last.messages.length, 1);
    assert.ok(last.messages[0]?.role === "assistant");
    assert.equal(last.messages[0].content, "Hello");
});

for (const partial of [false, true]) {
    test(`DeepSeek rejects SSE termination without a terminal response (partial=${partial})`, async t => {
        const http = mockHttp(t, [{ sse: true, body: sse(...(partial ? [{ type: "response.output_text.delta", delta: "partial" }] : [])) }]);
        await assert.rejects(collect(stream()), error => {
            assert.ok(error instanceof ModelError);
            assert.equal(error.code, "bad_response");
            return true;
        });
        http.assertConsumed();
    });
}
