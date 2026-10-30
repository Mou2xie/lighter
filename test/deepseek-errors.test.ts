import "./helpers/offline.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import OpenAI, { type OpenAIError } from "openai";
import { Responses } from "openai/resources/responses/responses";
import * as z from "zod";
import { AgentLoop } from "../agent/agent.js";
import { Tool, UserMessage } from "../core/protocol.js";
import { Model } from "../model/model.js";
import { ModelError, type ModelErrorCode } from "../model/errors.js";
import { DeepSeekProvider } from "../model/providers/deepseek-provider.js";
import { call, response } from "./fixtures/deepseek.js";
import { mockHttp } from "./helpers/http.js";
import { assertFailedRunOutcome } from "./helpers/run-result.js";

test("a failed response rejects with ModelError instead of resolving to undefined", async t => {
    const http = mockHttp(t, [{ body: {
        ...response([]),
        status: "failed",
        error: { code: "server_error", message: "Test service failure" },
    } }]);
    const provider = new DeepSeekProvider("offline-test-key", "deepseek-flash");

    await assert.rejects(provider.invoke([new UserMessage("Hi")], []), error => {
        assert.ok(error instanceof ModelError, "Response failures must remain explicit model errors");
        assert.equal(error.name, "ModelError");
        assert.equal(error.code, "bad_response");
        assert.equal(error.responseStatus, "failed");
        assert.match(error.message, /Test service failure/);
        return true;
    });

    http.assertConsumed();
});

test("an incomplete response rejects with ModelError instead of resolving to undefined", async t => {
    const http = mockHttp(t, [{ body: {
        ...response([]),
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
    } }]);
    const provider = new DeepSeekProvider("offline-test-key", "deepseek-flash");

    await assert.rejects(provider.invoke([new UserMessage("Hi")], []), error => {
        assert.ok(error instanceof ModelError, "Incomplete generation must not become a successful result");
        assert.equal(error.code, "bad_response");
        assert.equal(error.responseStatus, "incomplete");
        assert.match(error.message, /max_output_tokens/);
        return true;
    });

    http.assertConsumed();
});

const httpErrors: [number, ModelErrorCode][] = [
    [400, "invalid_request"],
    [403, "auth_error"],
    [404, "invalid_request"],
    [409, "invalid_request"],
    [422, "invalid_request"],
    [429, "rate_limit"],
    [500, "server_error"],
    [503, "server_error"],
];

for (const [status, code] of httpErrors) {
    test(`HTTP ${status} becomes ${code} while retaining its status and failure message`, async t => {
        const http = mockHttp(t, [{ status, body: { error: { message: `Test HTTP ${status} failure`, code: "test_error" } } }]);
        const provider = new DeepSeekProvider("offline-test-key", "deepseek-flash");

        await assert.rejects(provider.invoke([new UserMessage("Hi")], []), error => {
            assert.ok(error instanceof ModelError);
            assert.equal(error.code, code);
            assert.equal(error.status, status);
            assert.match(error.message, new RegExp(`Test HTTP ${status} failure`));
            return true;
        });

        http.assertConsumed();
    });
}

const sdkErrors: [string, () => OpenAIError, ModelErrorCode][] = [
    ["connection failure", () => new OpenAI.APIConnectionError({ message: "Test connection failure" }), "network_error"],
    ["timeout", () => new OpenAI.APIConnectionTimeoutError({ message: "Test timeout" }), "network_error"],
    ["SDK cancellation", () => new OpenAI.APIUserAbortError({ message: "Test cancellation" }), "aborted"],
    ["unclassified SDK failure", () => new OpenAI.OpenAIError("Test unknown SDK failure"), "unknown"],
];

for (const [label, makeError, code] of sdkErrors) {
    test(`classifies ${label} and preserves its failure message`, async t => {
        const original = makeError();
        // Synthetic SDK-only failures use the public resource seam, avoiding
        // actual network delays/retries and private provider fields.
        t.mock.method(Responses.prototype, "create", async () => { throw original; });
        const provider = new DeepSeekProvider("offline-test-key", "deepseek-flash");

        await assert.rejects(provider.invoke([new UserMessage("Hi")], []), error => {
            assert.ok(error instanceof ModelError);
            assert.equal(error.code, code);
            assert.equal(error.name, "ModelError");
            assert.ok(error.message.includes(original.message));
            assert.equal(error.status, undefined);
            return true;
        });
    });
}

test("unexpected non-SDK exceptions are rethrown unchanged", async t => {
    const original = new TypeError("Unexpected test SDK exception");
    t.mock.method(Responses.prototype, "create", async () => { throw original; });
    const provider = new DeepSeekProvider("offline-test-key", "deepseek-flash");

    await assert.rejects(provider.invoke([new UserMessage("Hi")], []), error => error === original);
});

for (const [status, code] of [
    ["cancelled", "aborted"],
    ["queued", "bad_response"],
    ["in_progress", "bad_response"],
] as const) {
    test(`non-streaming response status ${status} ends with an explicit ${code} error`, async t => {
        const http = mockHttp(t, [{ body: response([], { status }) }]);
        const provider = new DeepSeekProvider("offline-test-key", "deepseek-flash");

        await assert.rejects(provider.invoke([new UserMessage("Hi")], []), error => {
            assert.ok(error instanceof ModelError);
            assert.equal(error.code, code);
            assert.equal(error.responseStatus, status);
            return true;
        });

        http.assertConsumed();
    });
}

for (const status of ["failed", "incomplete"] as const) {
    test(`${status} responses still produce a useful error when optional details are absent`, async t => {
        const http = mockHttp(t, [{ body: response([], { status }) }]);
        const provider = new DeepSeekProvider("offline-test-key", "deepseek-flash");

        await assert.rejects(provider.invoke([new UserMessage("Hi")], []), error => {
            assert.ok(error instanceof ModelError);
            assert.equal(error.code, "bad_response");
            assert.equal(error.responseStatus, status);
            assert.match(error.message, /No (error details|reason) provided/);
            return true;
        });

        http.assertConsumed();
    });
}

test("[M1] an incomplete response returns completed tool progress without executing truncated calls", async t => {
    let executions = 0;
    const tool = new Tool({
        name: "addition", description: "Add two numbers",
        parametersZodSchema: z.strictObject({ a: z.number(), b: z.number() }),
        func: ({ a, b }) => { executions++; return a + b; },
    });
    const http = mockHttp(t, [
        { body: response([call("completed-1", "addition", '{"a":1,"b":2}')]) },
        { body: response([call("must-not-run", "addition", '{"a":100,"b":200}')], {
            status: "incomplete", incomplete_details: { reason: "max_output_tokens" },
        }) },
    ]);
    const loop = new AgentLoop({
        model: new Model(new DeepSeekProvider("offline-test-key", "deepseek-flash")),
        tools: [tool],
    });

    const inputMessages = [new UserMessage("Add")];
    const [outcome] = await Promise.allSettled([loop.runLoop(inputMessages)]);

    http.assertConsumed();
    assert.equal(executions, 1);
    assert.deepEqual(inputMessages.map(message => message.role), ["user"]);
    const result = assertFailedRunOutcome(outcome);
    assert.ok(result.error instanceof ModelError);
    assert.equal(result.error.responseStatus, "incomplete");
    assert.deepEqual(result.addedMessages.map(message => message.role), ["assistant", "tool"]);
    const assistant = result.addedMessages[0];
    assert.ok(assistant?.role === "assistant");
    assert.deepEqual(assistant.toolCalls.map(call => call.callId), ["completed-1"]);
    const last = result.addedMessages.at(-1);
    assert.ok(last?.role === "tool");
    assert.equal(last.callId, "completed-1");
    assert.equal(last.toolOutput, "3");
});
