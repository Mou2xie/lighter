import "./helpers/offline.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as z from "zod";
import type {
    ContentBlock,
    Message,
    MessageCreateParams,
    RedactedThinkingBlock,
    TextBlock,
    ThinkingBlock,
    ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { Agent } from "../agent/agent.js";
import { AssistantMessage, SystemMessage, ToolMessage, UserMessage } from "../core/messages.js";
import { Tool } from "../core/tool.js";
import { Model } from "../model/model.js";
import { ModelError } from "../model/errors.js";
import { ClaudeProvider, type ClaudeProviderOptions } from "../providers/claude-provider.js";
import { mockHttp } from "./helpers/http.js";
import { assertCompletedRun } from "./helpers/run-result.js";
import { collect, sse } from "./helpers/stream.js";

const ENDPOINT = "https://api.anthropic.com/v1/messages";

function makeProvider(options: ClaudeProviderOptions = {}) {
    return new ClaudeProvider("offline-test-key", "claude-test", options);
}

function makeAddition(onExecute: () => void = () => {}) {
    return new Tool({
        name: "addition", description: "Add two numbers",
        parametersZodSchema: z.strictObject({ a: z.number(), b: z.number() }),
        func: ({ a, b }) => { onExecute(); return a + b; },
    });
}

// Deliberately partial wire messages: include the fields the SDK accumulator and
// the adapter read, without pretending these are complete Message objects.
function message(content: ContentBlock[], overrides: Partial<Message> = {}): Message {
    return {
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-test",
        content,
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 2 },
        ...overrides,
    } as unknown as Message;
}

const text = (...parts: string[]): TextBlock => ({ type: "text", text: parts.join(""), citations: null });
const thinking = (think: string, signature: string): ThinkingBlock => ({ type: "thinking", thinking: think, signature });
const toolUse = (id: string, name: string, input: unknown): ToolUseBlock =>
    ({ type: "tool_use", id, name, input, caller: { type: "direct" } });
const redacted = (data: string): RedactedThinkingBlock => ({ type: "redacted_thinking", data });

// mockHttp records OpenAI-shaped bodies; a Claude request is structurally different.
function sentBody(http: ReturnType<typeof mockHttp>, index: number): MessageCreateParams {
    return http.requests[index]!.body as unknown as MessageCreateParams;
}

test("sends the required max_tokens, hoists the system prompt and maps tool schemas", async t => {
    const http = mockHttp(t, [{ body: message([text("Hi")]) }]);
    const spec = makeAddition().getSpec();

    const reply = await new Model(makeProvider()).invoke({
        messages: [new SystemMessage("Be concise"), new UserMessage("Hello")],
        toolSpecs: [spec],
    });

    http.assertConsumed();
    const request = http.requests[0]!;
    const body = sentBody(http, 0);
    assert.equal(request.url, ENDPOINT);
    assert.equal(request.method, "POST");
    assert.equal(body.model, "claude-test");
    assert.equal(body.max_tokens, 8192, "Claude requires max_tokens on every request");
    assert.equal(body.stream, undefined);
    assert.equal(body.system, "Be concise");
    assert.deepEqual(body.messages, [{ role: "user", content: [{ type: "text", text: "Hello" }] }]);
    assert.deepEqual(body.tools, [{
        name: "addition",
        description: "Add two numbers",
        input_schema: { ...spec.parameters, type: "object" },
        strict: false,
    }]);
    assert.equal(reply.content, "Hi");
});

test("applies maxOutputTokens and thinking options, omitting thinking when unset", async t => {
    const http = mockHttp(t, [
        { body: message([text("a")]) },
        { body: message([text("b")]) },
    ]);
    const thinkingOption: ClaudeProviderOptions["thinking"] = { type: "enabled", budget_tokens: 1024 };

    await makeProvider({ maxOutputTokens: 2048, thinking: thinkingOption }).invoke({ messages: [new UserMessage("Hi")], toolSpecs: [] });
    await makeProvider().invoke({ messages: [new UserMessage("Hi")], toolSpecs: [] });

    http.assertConsumed();
    assert.equal(sentBody(http, 0).max_tokens, 2048);
    assert.deepEqual(sentBody(http, 0).thinking, { type: "enabled", budget_tokens: 1024 });
    assert.equal("thinking" in sentBody(http, 1), false, "unset options must not reach the wire");
});

test("rejects unusable maxOutputTokens and thinking budgets before any request", async () => {
    for (const maxOutputTokens of [0, -1, 1.5]) {
        assert.throws(() => makeProvider({ maxOutputTokens }), error => {
            assert.ok(error instanceof ModelError);
            assert.equal(error.code, "invalid_request");
            return true;
        });
    }
    // A thinking budget must fit inside max_tokens and respect the 1024 floor.
    for (const [budget_tokens, maxOutputTokens] of [[1023, 4096], [4096, 4096], [5000, 4096]] as const) {
        assert.throws(() => makeProvider({ maxOutputTokens, thinking: { type: "enabled", budget_tokens } }), error => {
            assert.ok(error instanceof ModelError);
            assert.equal(error.code, "invalid_request");
            return true;
        });
    }
    assert.doesNotThrow(() => makeProvider({ maxOutputTokens: 4096, thinking: { type: "enabled", budget_tokens: 2048 } }));
});

test("adapts history into alternating blocks, joining system prompts and tool results", async t => {
    const http = mockHttp(t, [{ body: message([text("Done")]) }]);
    const messages = [
        new SystemMessage("Be concise"),
        new SystemMessage("Answer in English"),
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

    await makeProvider().invoke({ messages: messages, toolSpecs: [] });

    http.assertConsumed();
    const body = sentBody(http, 0);
    assert.equal(body.system, "Be concise\n\nAnswer in English");
    assert.deepEqual(body.messages, [
        { role: "user", content: [{ type: "text", text: "Add" }] },
        { role: "assistant", content: [
            { type: "text", text: "Checking" },
            { type: "tool_use", id: "ok-1", name: "addition", input: { a: 1, b: 2 } },
            { type: "tool_use", id: "bad-1", name: "lookup", input: {} },
        ] },
        { role: "user", content: [
            { type: "tool_result", tool_use_id: "ok-1", content: "3", is_error: false },
            { type: "tool_result", tool_use_id: "bad-1", content: "Lookup failed", is_error: true },
            { type: "text", text: "Continue" },
        ] },
    ]);
    // A generic rebuild cannot reconstruct a signed thinking block; only replay can.
    assert.equal(JSON.stringify(messages), before, "Adapting history must not modify caller messages");
});

test("rejects tool arguments that cannot be replayed as a JSON object", async t => {
    // Both failures happen while building the request, so no HTTP fixture is consumed.
    const http = mockHttp(t, []);

    await assert.rejects(makeProvider().invoke({
        messages: [new AssistantMessage("", { toolCalls: [{ callId: "c-1", toolName: "addition", arguments: "not json" }] })],
        toolSpecs: [],
    }), error => {
        assert.ok(error instanceof ModelError);
        assert.equal(error.code, "invalid_request");
        assert.match(error.message, /Invalid Claude tool arguments/);
        return true;
    });

    await assert.rejects(makeProvider().invoke({
        messages: [new AssistantMessage("", { toolCalls: [{ callId: "c-2", toolName: "addition", arguments: '"scalar"' }] })],
        toolSpecs: [],
    }), error => {
        assert.ok(error instanceof ModelError);
        assert.equal(error.code, "invalid_request");
        assert.match(error.message, /must be an object/);
        return true;
    });

    http.assertConsumed();
});

test("collects text, thinking, redacted thinking and tool calls from the response blocks", async t => {
    const http = mockHttp(t, [{ body: message([
        thinking("Let me add", "sig-abc"),
        text("Checking ", "both"),
        toolUse("toolu_1", "addition", { a: 1, b: 2 }),
        redacted("opaque"),
    ]) }]);

    const reply = await makeProvider().invoke({ messages: [new UserMessage("Go")], toolSpecs: [] });

    http.assertConsumed();
    assert.equal(reply.content, "Checking both");
    assert.equal(reply.reasoning, "Let me add");
    assert.deepEqual(reply.toolCalls, [{ callId: "toolu_1", toolName: "addition", arguments: '{"a":1,"b":2}' }]);
});

test("replays native blocks so thinking signatures survive the next turn", async t => {
    const native = [thinking("Let me add", "sig-abc"), text("Checking"), toolUse("toolu_1", "addition", { a: 1, b: 2 })];
    const http = mockHttp(t, [
        { body: message(native, { stop_reason: "tool_use" }) },
        { body: message([text("3")]) },
    ]);
    const provider = makeProvider();

    const first = await provider.invoke({ messages: [new UserMessage("Add")], toolSpecs: [] });
    await provider.invoke({
        messages: [
            new UserMessage("Add"),
            first,
            new ToolMessage({ callId: "toolu_1", toolName: "addition", toolOutput: "3" }),
        ],
        toolSpecs: [],
    });

    http.assertConsumed();
    const body = sentBody(http, 1);
    assert.deepEqual(body.messages[1], { role: "assistant", content: native });
    assert.equal((body.messages[1]!.content as ThinkingBlock[])[0]!.signature, "sig-abc");
});

test("drops native blocks once the assistant message is replaced, since a summary cannot be re-signed", async t => {
    const http = mockHttp(t, [
        { body: message([thinking("Let me add", "sig-abc"), text("Checking"), toolUse("toolu_1", "addition", { a: 1, b: 2 })], { stop_reason: "tool_use" }) },
        { body: message([text("3")]) },
    ]);
    const provider = makeProvider();

    const first = await provider.invoke({ messages: [new UserMessage("Add")], toolSpecs: [] });
    const replacement = new AssistantMessage(first.content, { reasoning: first.reasoning, toolCalls: first.toolCalls });
    await provider.invoke({ messages: [replacement], toolSpecs: [] });

    http.assertConsumed();
    const body = sentBody(http, 1);
    assert.deepEqual(body.messages[0], { role: "assistant", content: [
        { type: "text", text: "Checking" },
        { type: "tool_use", id: "toolu_1", name: "addition", input: { a: 1, b: 2 } },
    ] });
});

for (const reason of ["end_turn", "tool_use", "stop_sequence", "refusal"] as const) {
    test(`accepts stop_reason ${reason} as a completed turn`, async t => {
        const http = mockHttp(t, [{ body: message([text("Done")], { stop_reason: reason }) }]);

        const reply = await makeProvider().invoke({ messages: [new UserMessage("Hi")], toolSpecs: [] });

        http.assertConsumed();
        assert.equal(reply.content, "Done");
    });
}

for (const reason of ["max_tokens", "pause_turn", "model_context_window_exceeded", null] as const) {
    test(`rejects stop_reason ${reason} instead of returning a partial reply`, async t => {
        const http = mockHttp(t, [{ body: message([text("must not be committed")], { stop_reason: reason }) }]);

        await assert.rejects(makeProvider().invoke({ messages: [new UserMessage("Hi")], toolSpecs: [] }), error => {
            assert.ok(error instanceof ModelError);
            assert.equal(error.code, "bad_response");
            assert.equal(error.responseStatus, reason ?? undefined);
            assert.match(error.message, reason === null ? /missing stop reason/ : new RegExp(String(reason)));
            return true;
        });

        http.assertConsumed();
    });
}

for (const [status, type, code] of [
    [401, "authentication_error", "auth_error"],
    [403, "permission_error", "auth_error"],
    [429, "rate_limit_error", "rate_limit"],
    [503, "api_error", "server_error"],
    [400, "invalid_request_error", "invalid_request"],
] as const) {
    test(`classifies HTTP ${status} as ${code}`, async t => {
        const http = mockHttp(t, [{ status, body: { type: "error", error: { type, message: "Request failed" } } }]);

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

test("streams thinking and text deltas, then emits the accumulated message once", async t => {
    const http = mockHttp(t, [{ sse: true, body: sse(
        { type: "message_start", message: message([], { stop_reason: null }) },
        { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Let me " } },
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "add" } },
        { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-abc" } },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_start", index: 1, content_block: { type: "text", text: "", citations: null } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hel" } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "lo" } },
        { type: "content_block_stop", index: 1 },
        { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_1", name: "addition", input: {} } },
        { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"a":1,"b":2}' } },
        { type: "content_block_stop", index: 2 },
        { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 12 } },
        { type: "message_stop" },
    ) }]);

    const items = await collect(new Model(makeProvider()).stream({
        messages: [new UserMessage("Hi")],
        toolSpecs: [],
    }));

    http.assertConsumed();
    const request = http.requests[0]!;
    assert.equal(request.url, ENDPOINT);
    assert.equal(sentBody(http, 0).stream, true);
    assert.deepEqual(items.slice(0, -1), [
        { type: "reasoning_delta", text: "Let me " },
        { type: "reasoning_delta", text: "add" },
        { type: "text_delta", text: "Hel" },
        { type: "text_delta", text: "lo" },
    ]);
    const last = items.at(-1);
    assert.ok(last?.type === "message");
    assert.equal(last.message.content, "Hello");
    assert.equal(last.message.reasoning, "Let me add");
    assert.deepEqual(last.message.toolCalls, [{ callId: "toolu_1", toolName: "addition", arguments: '{"a":1,"b":2}' }]);
});

test("stream classifies an HTTP failure before any SSE is received", async t => {
    const http = mockHttp(t, [{ status: 529, body: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } } }]);

    await assert.rejects(collect(makeProvider().stream({ messages: [new UserMessage("Hi")], toolSpecs: [] })), error => {
        assert.ok(error instanceof ModelError);
        assert.equal(error.code, "server_error");
        assert.equal(error.httpStatus, 529);
        return true;
    });

    http.assertConsumed();
});

test("Agent completes a tool round trip and replays thinking signatures between turns", async t => {
    let executions = 0;
    const http = mockHttp(t, [
        { body: message([thinking("First try", "sig-1"), toolUse("toolu_bad", "addition", { a: "31", b: 17 })], { stop_reason: "tool_use" }) },
        { body: message([thinking("Fix the args", "sig-2"), toolUse("toolu_ok", "addition", { a: 31, b: 17 })], { stop_reason: "tool_use" }) },
        { body: message([text("48")]) },
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
        ["toolu_bad", true], ["toolu_ok", false],
    ]);

    // Both assistant turns must come back with their original signatures, otherwise
    // Claude rejects a tool-result turn produced under extended thinking.
    const assistantTurns = sentBody(http, 2).messages.filter(turn => turn.role === "assistant");
    assert.equal(assistantTurns.length, 2);
    assert.deepEqual(assistantTurns.map(turn => (turn.content as ContentBlock[]).map(block => block.type)), [
        ["thinking", "tool_use"], ["thinking", "tool_use"],
    ]);
    assert.deepEqual(assistantTurns.map(turn => (turn.content as ThinkingBlock[])[0]!.signature), ["sig-1", "sig-2"]);
    const last = messages.at(-1);
    assert.ok(last?.role === "assistant");
    assert.equal(last.content, "48");
});
