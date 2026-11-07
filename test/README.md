# Offline tests

Tests describe the current implementation: `Agent`, `Model`, providers, messages, and tools. They do not require Session or other planned modules. Production code is maintained by the user; tests, fixtures, helpers, and compile-only checks live under `test/`.

## Commands

```bash
pnpm typecheck
pnpm test
pnpm check
```

`pnpm check` runs TypeScript checks followed by the full offline runtime suite. Runtime tests use Node's test runner and tsx, with a 10-second per-test timeout to detect stalled tests.

Run only the agent tests:

```bash
pnpm exec node --import tsx --test --test-timeout=10000 test/agent.test.ts
```

## Current behavior

`Agent.run({ messages: inputMessages })` returns an `AgentResponse`:

```ts
{
    status: "completed" | "failed";
    messages: BaseMessages;
    error?: unknown;
}
```

`messages` contains only the assistant and tool messages generated during this run. The agent adds its configured system prompt to the local request context and does not append to the caller's input array. Callers can retain the returned messages and pass them into a later run.

When a model request throws, the agent returns `status: "failed"`, the messages generated so far, and the original thrown value in `error`. The type declares `error` as optional; runtime tests check that caught model failures preserve it, including when the thrown value is `undefined`. Provider invocation itself rejects on failure.

`Agent.stream({ messages: inputMessages })` returns an async generator. It yields `reasoning_delta`
and `text_delta` events as they arrive, then yields one terminal `AgentResponse`.
The current agent consumes provider `message` events internally; complete assistant
and tool messages appear in the terminal result. Partial deltas are not committed
messages. Breaking consumption at a delta closes the underlying iterator and
prevents later tools from executing. This does not establish cancellation of a
tool that is already running.

Tool lookup failures, invalid JSON, invalid arguments, and tool exceptions produce paired error messages for the model. Later tools in the same response still execute in order. Tools are awaited sequentially before the next model request.

`Model.invoke` / `Model.stream` and provider methods accept a request object
containing `messages` and optional `toolSpecs`. An Agent can configure
`hooks: { beforeModel: new BeforeModelHook(...) }`. The hook runs before every
model call in both modes, is awaited, and may return a replacement request or
return nothing to retain the request. Model-hook failures become failed Agent results;
they prevent the provider call and preserve previously completed tool progress.

## Coverage

| File | Coverage |
| --- | --- |
| `agent-hooks.test.ts` | Before-agent request replacement and once-per-run timing, after-agent message-array replacement and no-op behavior, one terminal stream response, and lifecycle-hook failures |
| `after-model-hook.test.ts` | Complete response replacement, sync/async no-op and error behavior, async waiting, before/provider/after ordering, unchanged deltas, iterator cleanup, and Agent forwarding regressions |
| `before-model-hook.test.ts` | Replacement requests and tool definitions, awaited async callbacks, sync/async no-op and failure behavior, hook execution on every model turn, retained tool progress, and request-array isolation regressions |
| `agent-stream.test.ts` | Lazy iteration, incremental delivery, tool ordering and errors, complete context, partial failures and continuation, iterator cleanup, and missing-message regressions |
| `deepseek-stream.test.ts` | Real SDK SSE decoding, reasoning/text deltas, final-message extraction, HTTP and iteration-time errors, failed/incomplete status details, agent integration, and missing-terminal-response regressions |
| `agent.test.ts` | Prompts, tool round trips and ordering, error correction, mixed valid/invalid calls, model failures and partial progress, caller-managed continuation, unchanged inputs, and independent/concurrent run contexts |
| `deepseek-provider.test.ts` | SDK request serialization over mocked HTTP, tool schemas, history/reasoning adaptation, call IDs, response extraction, authentication errors, and an agent tool/error-correction round trip |
| `deepseek-errors.test.ts` | HTTP/SDK error classification, response statuses, missing error details, and preserving completed tool progress after an incomplete response |
| `openai-provider.test.ts` | SDK request serialization over mocked HTTP, `store: false`, `reasoning`/`maxOutputTokens` forwarding, output extraction including refusals, native item replay versus rebuilt fallback, response statuses, HTTP error classification, SSE reasoning/text deltas, and an agent tool round trip |
| `claude-provider.test.ts` | Required `max_tokens`, constructor budget validation, system-prompt hoisting, alternating block adaptation with tool results, native thinking-block replay and its loss after replacement, `stop_reason` mapping, HTTP error classification, SSE thinking/text deltas, and an agent tool round trip |
| `tool.test.ts` | Sync/async execution, validation/defaults, exceptions, text output, and JSON Schema export |
| `mock-provider.test.ts` | Model invocation and streaming, shared mock exhaustion, event identity, and iterator cleanup |
| `offline.test.ts` | Rejection of unmocked fetch calls |
| `types/tool.types.ts` | Tool argument inference and accepting unvalidated execution input |
| `types/agent.types.ts` | The current `run` return type and `stream` event narrowing, generated messages, supported statuses, and optional error |
| `types/hooks.types.ts` | After-agent message-array input/output, sync/async replacement and no-op callbacks, and rejection of complete response objects as callback results |

`ModelError.code` provides the common error category. `httpStatus` retains an HTTP error's status code; `responseStatus` retains a generation status such as `failed` or `incomplete`. Tests check these separately. Network failures can have neither field. Unexpected non-SDK exceptions propagate unchanged.

## Stream completion regressions

The four stream-completion regression tests pass. Type checking passes.
The four regression tests for missing complete responses remain active:

- `agent-stream.test.ts`: an empty stream, or one ending after partial deltas,
  produces a failed result without requesting the same context again.
- `deepseek-stream.test.ts`: an SSE stream ending at `[DONE]` without a terminal
  response rejects with a `ModelError` categorized as `bad_response`. Both empty
  and partial-text variants are covered.

The completion flags reset for each request. Normal replies, tool-call follow-up
turns, partial failures, and early consumer cancellation remain covered.

## Before-model request isolation regression

The before-model request-isolation regressions pass. Type checking passes.
The two active regressions in `before-model-hook.test.ts` verify that both `run`
and `stream` preserve generated replies when a hook trims its request array in
place using `splice`.

Agent creates an independent message array for each model request, preserving
its internal history and the generated-message offset. Hook changes to the
request array stay local to that model call. The tests cover array isolation,
not deep immutability of nested message objects.
Production implementation remains maintained by the user.

## After-model hook integration

The model-hook tests pass. Type checking passes.
`AfterModelHook` and direct Model invocation/streaming pass their tests: callbacks
run on complete messages, are awaited, may replace the result or return nothing,
and propagate errors. Stream deltas remain unchanged; stopping before a complete
message does not run the hook.

Agent declares and forwards `afterModel` in both `run` and `stream`. The two active
Agent regression tests verify that the hook runs on every model turn, modified
tool arguments are executed and committed to history, and the final reply is
also transformed.

## Agent lifecycle hook regressions

The full suite currently has **183 tests: all pass**. Type checking passes.
`agent-hooks.test.ts` covers 12 cases around `beforeAgent` and `afterAgent`.
Both modes invoke `beforeAgent` once and deliver only one result after
`afterAgent`. Lifecycle callback errors become failed results, retaining the
original error and any generated progress. In stream mode, failures are yielded
before the generator returns, so for-await consumers receive the terminal result.

`AfterAgentHook` receives the generated `BaseMessages` array and may return a
replacement array or nothing, synchronously or asynchronously. Agent wraps that
array in a completed `AgentResponse`; the callback does not return the complete
response object. Compile-only checks also enforce this distinction.

The current implementation skips `afterAgent` when model execution fails or
stream consumption is cancelled. The lifecycle tests do not establish those
paths as a stable public contract.

Successful string tool outputs are JSON-serialized by the current implementation,
so tests expect `JSON.stringify("hello")`, including JSON quotes.

## OpenAI and Claude providers

The provider suites pass. Type checking passes.
`openai-provider.test.ts` (21 cases) and `claude-provider.test.ts` (24 cases) drive
the real OpenAI and Anthropic SDKs over mocked HTTP, so request serialization, SSE
decoding, and error classification are exercised end to end rather than mocked at
the provider boundary.

Both providers reduce the shared `AssistantMessage` to a lossy projection of their
native turn, so each returns a private subclass holding the original items and
replays them verbatim while the message is still unchanged. The tests pin that
distinction: an untouched message is replayed with its native ids, reasoning
summaries, and thinking signatures intact, while a replaced, cloned, or in-place
mutated message falls back to rebuilding items from the public fields. The fallback
is covered for OpenAI `function_call` reconstruction and for the loss of Claude
`thinking` blocks, which cannot be re-signed from a displayed summary.

Current behavior that the suites record rather than endorse:

- Claude `stop_reason` values `pause_turn` and `model_context_window_exceeded` are
  rejected as `bad_response` instead of being continued or reported separately.
- Claude requests always send `strict: false` and pass the Zod-generated `$schema`
  through inside `input_schema`. Both are asserted as-is.
- Enabling Claude `thinking` and then replacing the assistant message drops the
  signed thinking block, so a subsequent tool-result turn may be rejected by the
  API. This is a failure, not a degradation.
- OpenAI reasoning deltas, and `AssistantMessage.reasoning` itself, depend on the
  `reasoning.summary` option. Without it the stream carries no reasoning events.
- `OpenAIProvider` exposes the retained native items on the message object, while
  `ClaudeProvider` keeps them private behind `replayContent()`. The Claude shape is
  the stricter of the two.
- Neither provider test suite is a live compatibility check: no test contacts a
  real endpoint, and none establishes that the current wire shape is accepted by
  the real Claude or OpenAI API.

## Isolation and limits

Every runtime test imports `helpers/offline.ts`. Tests never load `.env` or use real credentials. HTTP mocks are installed before provider construction and restored after each test. SSE fixtures pass through the actual SDK decoder using mocked HTTP. Synthetic
iteration failures mock the public SDK resource method. Fixtures and mock providers have finite responses; unexpected HTTP requests fail.

`RecordingProvider` snapshots requests because the agent continues appending to its local context. Controlled promises verify tool ordering without timing-dependent sleeps. Assertions use public results and observed requests, without accessing private agent or provider fields.

Continuation tests verify that a caller can save partial progress and supply it to the next run without repeating a completed tool. They do not establish crash recovery or exactly-once side effects. Concurrent runs use separate caller histories and do not establish safety for shared application state or tool side effects.

These are offline tests against synthetic responses, not live provider compatibility checks. Future behavior should receive tests when it is implemented or explicitly agreed, rather than being imposed by a previous roadmap.
