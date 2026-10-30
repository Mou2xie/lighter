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

`Agent.run(inputMessages)` returns an `AgentResult`:

```ts
{
    status: "completed" | "failed";
    messages: BaseMessages;
    error?: unknown;
}
```

`messages` contains only the assistant and tool messages generated during this run. The agent adds its configured system prompt to the local request context and does not append to the caller's input array. Callers can retain the returned messages and pass them into a later run.

When a model request throws, the agent returns `status: "failed"`, the messages generated so far, and the original thrown value in `error`. The type declares `error` as optional; runtime tests check that caught model failures preserve it, including when the thrown value is `undefined`. Provider invocation itself rejects on failure.

Tool lookup failures, invalid JSON, invalid arguments, and tool exceptions produce paired error messages for the model. Later tools in the same response still execute in order. Tools are awaited sequentially before the next model request.

## Coverage

| File | Coverage |
| --- | --- |
| `agent.test.ts` | Prompts, tool round trips and ordering, error correction, mixed valid/invalid calls, model failures and partial progress, caller-managed continuation, unchanged inputs, and independent/concurrent run contexts |
| `deepseek-provider.test.ts` | SDK request serialization over mocked HTTP, tool schemas, history/reasoning adaptation, call IDs, response extraction, authentication errors, and an agent tool/error-correction round trip |
| `deepseek-errors.test.ts` | HTTP/SDK error classification, response statuses, missing error details, and preserving completed tool progress after an incomplete response |
| `tool.test.ts` | Sync/async execution, validation/defaults, exceptions, text output, and JSON Schema export |
| `mock-provider.test.ts` | Model invocation, scripted replies, and mock exhaustion |
| `offline.test.ts` | Rejection of unmocked fetch calls |
| `types/tool.types.ts` | Tool argument inference and accepting unvalidated execution input |
| `types/agent.types.ts` | The current `run` return type, generated messages, supported statuses, and optional error |

`ModelError.code` provides the common error category. `httpStatus` retains an HTTP error's status code; `responseStatus` retains a generation status such as `failed` or `incomplete`. Tests check these separately. Network failures can have neither field. Unexpected non-SDK exceptions propagate unchanged.

## Isolation and limits

Every runtime test imports `helpers/offline.ts`. Tests never load `.env`, import the live demo, or use real credentials. HTTP mocks are installed before provider construction and restored after each test. Fixtures and mock providers have finite responses; unexpected HTTP requests fail.

`RecordingProvider` snapshots requests because the agent continues appending to its local context. Controlled promises verify tool ordering without timing-dependent sleeps. Assertions use public results and observed requests, without accessing private agent or provider fields.

Continuation tests verify that a caller can save partial progress and supply it to the next run without repeating a completed tool. They do not establish crash recovery or exactly-once side effects. Concurrent runs use separate caller histories and do not establish safety for shared application state or tool side effects.

These are offline tests against synthetic responses, not live provider compatibility checks. Future behavior should receive tests when it is implemented or explicitly agreed, rather than being imposed by a previous roadmap.
