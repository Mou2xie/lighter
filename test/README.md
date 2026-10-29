# Offline tests

Follow the root [testing and collaboration rules](../README.md#testing-and-collaboration-rules). All runtime tests, fixtures, helpers, and compile-only assertions live under `test/`. Production code is maintained by the user.

## Commands

```bash
pnpm typecheck
pnpm test
pnpm check
```

`pnpm check` runs TypeScript checks before the complete offline runtime suite. Runtime tests use Node's test runner and tsx, with a 10-second per-test timeout. This timeout detects stalled tests; it is not an AgentLoop step limit or cancellation policy.

Run the loop tests alone:

```bash
pnpm exec node --import tsx --test --test-timeout=10000 test/agent.test.ts
```

Focus on M1's failure regressions:

```bash
pnpm exec node --import tsx --test --test-timeout=10000 --test-name-pattern='\[M1\]' test/agent.test.ts test/deepseek-errors.test.ts
```

These focused commands supplement the full check; do not skip or weaken regressions to make the default suite pass.

## Current contract and coverage

Tests use `AgentLoop.runLoop(inputMessages)`. Inputs contain caller-owned conversation history and the current user message. AgentLoop injects its configured system prompt into local context. Runs return a discriminated result: `{ status: "completed", addedMessages }` or `{ status: "failed", addedMessages, error }`. The caller appends the generated assistant/tool increment to history once, including on failure, before deciding whether to continue.

| File | Coverage |
| --- | --- |
| `agent.test.ts` | Default/custom prompts in model requests, full generated increments, sequential asynchronous tools, argument correction, paired tool errors, caller-managed multi-turn history, unchanged inputs, stable prior outputs, and independent/concurrent run isolation; two M1 failure regressions |
| `deepseek-provider.test.ts` | Actual SDK serialization over mocked HTTP, tool schemas, history/reasoning adaptation, call IDs, response extraction, authentication errors, and a complete AgentLoop tool/error-correction increment |
| `deepseek-errors.test.ts` | HTTP/SDK error normalization, failed/incomplete/cancelled response statuses, missing error details, and an M1 regression for retaining completed tools after output truncation |
| `tool.test.ts` | Synchronous/asynchronous tools, Zod validation/defaults, paired exceptions, text output, and JSON Schema export |
| `mock-provider.test.ts` | Standalone Model invocation, finite scripted replies, and explicit mock exhaustion |
| `offline.test.ts` | Rejection of unmocked fetch calls |
| `types/tool.types.ts` | Compile-only tool argument inference and the unvalidated execution boundary |
| `types/agent-loop.types.ts` | Compile-only run result narrowing and mandatory failure error field |

Input/output tests use public return values and recorded requests, not removed Agent history fields. The simulated histories in tests are plain caller-owned arrays, not a Session implementation. Concurrent runs use different histories; they do not establish same-Session concurrency safety.

## M1 failure regressions

Three tests marked `[M1]` verify the requirement to return failure details and partial progress to the caller:

1. The first model request fails: return the error and an empty generated-message increment without changing the input.
2. A tool succeeds, then the next model request fails: return the assistant call and paired tool result. After the caller saves that increment, a continuation request must not re-execute the tool.
3. DeepSeek returns an incomplete response after a completed tool: preserve the prior completed call/result and the `ModelError`; never execute the truncated response's tool call.

The failed-run shape used by `helpers/run-result.ts` is:

```ts
{ status: "failed", addedMessages: BaseMessages, error: unknown }
```

`helpers/run-result.ts` validates public results without catching and repairing production failures. Failure assertions reject a bare Promise rejection and check the status, message increment, and presence of the original error. Success assertions require `status: "completed"` before inspecting `addedMessages`, so a failed result cannot silently pass a normal-path test. Provider-level tests still expect rejected model requests.

The migrated runtime suite contains 60 tests, including all three M1 regressions. Type checking and all 60 runtime tests pass; no tests are skipped or marked TODO. The continuation regression verifies that the caller saves the failed increment and supplies it to the next run, which completes with the tool execution count still at one. This does not guarantee crash recovery or exactly-once external side effects.

## Isolation and scope

Every runtime test imports `helpers/offline.ts`. Never load `.env`, import the live demo, or use real credentials. HTTP tests replace fetch before provider creation and restore it to the offline guard. `helpers/http.ts` rejects unexpected requests; scripted providers have finite replies. Fixtures are synthetic and do not verify a live endpoint or model.

`RecordingProvider` snapshots requests because AgentLoop continues appending to its local context. Controlled promises verify tool ordering without timing-dependent sleeps. Restore mocks/global changes after tests and keep temporary resources in `test/` or OS temporary directories.

The `ModelError` contract includes its message, code, optional HTTP status, and optional response status. Original-cause chaining remains deferred. Unexpected non-SDK exceptions propagate unchanged. Provider-level invocation tests continue to assert rejection while AgentLoop returns explicit failure results at the AgentLoop boundary.

Session, cancellation, hooks/events, streaming, additional real providers, structured-result serialization, duplicate tool registration, and unsupported/refused completed outputs are not certified by this suite. Add tests as their milestone contracts are defined; SDK abort classification alone does not demonstrate end-to-end cancellation. Do not change production code under a test-only request, or treat passing fixtures as proof of Preview readiness.
