# Offline tests

The repository-level [testing and collaboration rules](../README.md#testing-and-collaboration-rules) define ownership and permissions. All test implementation, fixtures, helpers, and compile-only checks live in this directory.

## Commands

Run from the project root:

```bash
pnpm test
pnpm typecheck
pnpm check
```

Run one runtime test file:

```bash
pnpm exec node --import tsx --test --test-timeout=10000 test/agent.test.ts
```

`pnpm test` discovers top-level `test/*.test.ts` files and uses the existing `tsx` dependency with Node's built-in test runner. Put runtime entry points at this level; supporting modules belong in the subdirectories. Each runtime test imports `helpers/offline.ts`, which blocks unmocked `fetch` calls even when a single test file is run directly.

`pnpm typecheck` checks both production and test TypeScript. `types/tool.types.ts` contains compile-only assertions; `@ts-expect-error` verifies that incorrect argument types really produce compiler errors. It is not a runtime test.

## Coverage

| File | Behavior covered |
| --- | --- |
| `tool.test.ts` | Synchronous/asynchronous execution, Zod validation, defaults reaching tool functions, paired errors, text output, JSON Schema export |
| `agent.test.ts` | Plain replies, prompts, tool round trips, awaited sequential calls, argument correction, multiple result pairing, model request failures, existing Agent history behavior |
| `deepseek-provider.test.ts` | Actual SDK request serialization through mocked HTTP, message/reasoning conversion, function-call IDs, tool error transport, response extraction, HTTP errors, an Agent round trip |
| `deepseek-errors.test.ts` | Request error classification, HTTP status and failure messages, failed/incomplete/cancelled response bodies, unexpected exceptions, and prevention of tool execution from incomplete responses |
| `mock-provider.test.ts` | Provider substitution through Model, ordered replies, explicit sequence exhaustion |
| `offline.test.ts` | Default rejection of unmocked fetch calls |
| `types/tool.types.ts` | Tool callback argument inference and the unvalidated execution boundary |

The HTTP helper replaces `globalThis.fetch` before creating a provider. It does not access private provider fields or bypass the SDK's request serialization. Node's per-test mock tracker restores the offline guard after each test. Synthetic connection, timeout, cancellation, and unexpected-exception tests mock the SDK's public Responses resource method; they test error normalization separately from HTTP serialization and avoid network retry delays. All mocks are restored after each test. Fixtures use dummy credentials and partial, explicitly typed wire-response examples; they do not claim that a real DeepSeek endpoint or model has been verified.

The 10-second timeout is a test-runner limit for detecting stalled tests. It does not add a step count, timeout, or cancellation feature to the production Agent. Scripted model replies are finite so an unexpected extra loop fails explicitly instead of continuing indefinitely. Sequential execution tests use a controlled promise rather than timing-dependent sleeps.

## Scope and failure handling

The current ModelError contract includes its message, code, optional HTTP status, and optional response status. The user has intentionally deferred original-cause chaining; tests must not require a cause field until that capability is explicitly added. Unexpected non-SDK exceptions still propagate unchanged.

The suite covers the implemented prototype, including request error normalization and rejection of non-completed response bodies. Structured result serialization, duplicate tool registration, malformed or unsupported completed response content, refusals, cooperative cancellation, events/hooks, and Harness sessions remain roadmap work. Recognizing an SDK abort error or a cancelled response does not establish end-to-end cancellation support. Failed and incomplete response bodies have separate regression tests; they are not covered by the HTTP authentication test. A failing regression is retained for the user to fix and is not a completed feature.

Tests do not certify the entire beta milestone. Add coverage as features are implemented. Do not turn unsupported behavior into a passing contract just because the current implementation exhibits it.

When a test exposes a production defect, retain the meaningful regression case and report its trigger, expected result, actual result, and reproduction command. Do not weaken, skip, or remove an assertion merely to obtain a passing run, and do not change production code without explicit user authorization. Tests may be corrected when their own setup or expectations are demonstrably wrong; explain material changes.
