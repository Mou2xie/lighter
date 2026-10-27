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
| `mock-provider.test.ts` | Provider substitution through Model, ordered replies, explicit sequence exhaustion |
| `offline.test.ts` | Default rejection of unmocked fetch calls |
| `types/tool.types.ts` | Tool callback argument inference and the unvalidated execution boundary |

The HTTP helper replaces `globalThis.fetch` before creating a provider. It does not access private provider fields or bypass the SDK's request serialization. Node's per-test mock tracker restores the offline guard after each test. Fixtures use dummy credentials and partial, explicitly typed wire-response examples; they do not claim that a real DeepSeek endpoint or model has been verified.

The 10-second timeout is a test-runner limit for detecting stalled tests. It does not add a step count, timeout, or cancellation feature to the production Agent. Scripted model replies are finite so an unexpected extra loop fails explicitly instead of continuing indefinitely. Sequential execution tests use a controlled promise rather than timing-dependent sleeps.

## Scope and failure handling

The suite covers the implemented prototype. Structured result serialization, duplicate tool registration, response-level failures/truncation/refusals, cancellation, events/hooks, and Harness sessions remain roadmap work. In particular, an HTTP error test does not establish correct handling of a successful HTTP response whose body has `status: "failed"` or `status: "incomplete"`.

Tests do not certify the entire beta milestone. Add coverage as features are implemented. Do not turn unsupported behavior into a passing contract just because the current implementation exhibits it.

When a test exposes a production defect, retain the meaningful regression case and report its trigger, expected result, actual result, and reproduction command. Do not weaken, skip, or remove an assertion merely to obtain a passing run, and do not change production code without explicit user authorization. Tests may be corrected when their own setup or expectations are demonstrably wrong; explain material changes.
