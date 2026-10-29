# lighter-framework

A TypeScript framework for building AI agents. This repository focuses on model access, task execution, and session management. The first release targets an installable Alpha / Preview with runnable examples and documented limitations.

## Current Status

The project is a prototype; it does not yet provide an installable public SDK.

- [`core/protocol.ts`](./core/protocol.ts): messages, tool definitions, Zod argument validation, and synchronous/asynchronous tool execution.
- [`model/`](./model/model.ts): non-streaming DeepSeek integration, message adaptation, error classification, and an offline mock provider.
- [`agent-loop/agent-loop.ts`](./agent-loop/agent-loop.ts): sequential model/tool execution using local context; `runLoop()` returns the messages generated during the run.
- [`index.ts`](./index.ts): a live addition demo with externally maintained conversation history.

Session, hooks, cancellation, streaming, and additional real providers are planned. Model failures currently throw without returning partial run progress. Tests use the current AgentLoop API; three enabled M1 regressions fail until explicit failure results and partial progress are implemented. See [test/README.md](./test/README.md).

## Local Development

Use Node.js and pnpm. The supported minimum Node.js version will be declared before release.

```bash
pnpm install
```

To run the live demo, set `DEEPSEEK_API_KEY` in your environment or a local `.env` file:

```dotenv
DEEPSEEK_API_KEY=replace_with_your_key
```

```bash
pnpm start
```

The demo calls the real DeepSeek API. Keep credentials out of version control.

Offline checks do not load `.env` or require API keys:

```bash
pnpm typecheck
pnpm test
pnpm check
```

`pnpm check` runs type checking followed by tests. See [test/README.md](./test/README.md) for test setup and coverage.

## Module Boundaries

| Module | Responsibility |
| --- | --- |
| `core` | Shared message, tool, and execution contracts |
| `model` | Model invocation, provider adaptation, normalized output, and request errors |
| `agent-loop` | One task's execution loop, tool scheduling, and generated-message increment |
| `harness` | Planned in-memory Session and lifecycle management; no separate `Harness` class is required |

A run may contain multiple model requests and tool calls. A Session spans multiple runs and owns their history, including intermediate tool calls and results. When using AgentLoop directly, the caller saves the returned increment.

Applications supply credentials, tools, prompts, and business-specific access rules. Vendor clients stay inside providers. The current AgentLoop adds its system prompt to local context; M2 will formalize prompt ownership and prevent duplicate insertion.

## Milestones

Complete these in order, with offline tests and a small example at each stage.

| Milestone | Scope | Acceptance |
| --- | --- | --- |
| **M1. AgentLoop failure handling — next** | Typed run outcomes, partial progress, continuation semantics, and test migration | A tool succeeds before a later model failure; the caller receives the error and completed tool records and can continue without repeating the tool |
| **M2. In-memory Session** | History ownership, input, snapshots, clearing, run status, and cancellation entry points | Multi-turn history is saved once; Sessions are isolated, one Session rejects overlapping runs, and active-run cleanup is defined |
| **M3. Hooks / middleware** | Awaitable hooks before model requests and before/after tools; typed observation events and caller context | Hook rejection produces a paired tool result; ordering, hook failures, and observer errors have explicit behavior |
| **M4. Streaming** | Text/tool deltas, complete message assembly, final results, and cancellation | Fragmented tool arguments assemble before execution; history is recorded once, and early termination/errors retain defined progress |
| **M5. Multiple providers** | DeepSeek, OpenAI, and Anthropic under shared invocation/streaming contracts | New Sessions switch providers without changing AgentLoop; supported models, options, and capability differences are documented and verified |
| **M6. SDK delivery** | Public exports, build, types, examples, documentation, and package validation | The packed SDK installs and runs outside this repository without development tools or import side effects |

M1 starts with a model failure after a successful tool call. Define the returned status, error, and generated messages; preserve them in external history. Use the migrated tests and enabled M1 regressions to validate this change; migrate success assertions too if the result type changes. Automatic whole-task retries are deferred.

### Execution Contracts

- Session owns cross-run history; AgentLoop owns only local run context. Append user input and generated increments exactly once, and protect history from external mutation.
- Execute tools sequentially in model-returned order, reject duplicate tool names, and preserve call/result pairing after errors, hook rejection, or cancellation.
- Define supported tool schemas and result types. Preserve text and serialize structured output without losing its contents. Handle refusals, truncation, and unsupported model output explicitly.
- Implement cooperative cancellation across M1–M5: propagate signals through model requests, tools, and hooks; stop scheduling new work and define finalization for tools that ignore cancellation. Runs end through completion, cancellation, or failure; no maximum step count is imposed.
- Events observe execution; awaited hooks influence it. Specify error isolation and emit exactly one run-end event. Streaming and non-streaming entry points share these execution semantics.
- Retain completed tool records on failure. Continuing a request must not automatically repeat completed tools; retained messages do not guarantee crash recovery or exactly-once external side effects.

### Preview Release Checks

- [ ] All milestone acceptance scenarios, type checking, offline tests, and builds pass.
- [ ] Public exports and type declarations work from an installation outside the repository; importing the SDK does not run demos or load credentials. Declare and verify the minimum Node.js version and ESM support.
- [ ] Examples cover standalone model/loop use, a multi-turn Session with an asynchronous structured-result tool, failure handling, cancellation, hooks, streaming, and provider selection.
- [ ] Each released real provider has recorded model IDs, validation dates, and results for text, tool-call round trips, and claimed streaming behavior. Live checks are separately authorized and excluded from the default suite.
- [ ] Package metadata, contents, installation instructions, limitations, and Preview compatibility expectations match the release. Inspect packed files to exclude credentials and temporary resources.

The Preview API may change. A later Beta will be scoped from feedback and a more settled public contract; no release version is selected yet.

## Testing and Collaboration Rules

- Keep tests, fixtures, helpers, and compile-only assertions under `test/`. Testing work may also update test/check scripts and testing documentation.
- The user maintains production implementation. Test requests do not authorize production edits; report defects and propose fixes unless explicitly authorized to implement them.
- Tests are offline by default: import the offline guard, use dummy keys and finite fixtures, mock HTTP before constructing real providers, and never import the live demo or load credentials. Live integration runs require separate explicit authorization.
- Isolate test state and temporary resources, restore mocks/global changes, and clean up. Do not use real business data or depend on execution order.
- Assert public behavior, failure recovery, and type inference. Prefer controlled promises to sleeps and semantic checks to full schema snapshots. Test-runner timeouts do not define production execution policy.
- Preserve meaningful failing assertions. Report the command, trigger, expected result, and actual result; do not weaken tests or silently modify production to obtain a passing run. Correct outdated expectations against the agreed contract.
- After changes, run `pnpm check` and report the result. Offline fixtures do not certify real provider availability or completion of unimplemented milestones.

## Deferred Scope

Persistence/crash recovery, context compaction, cross-provider history migration, parallel tools, additional providers, automatic extension discovery, and multi-agent orchestration are outside the first Preview. RAG and workflow abstractions require separate use cases.

The planned lighter-agent coding application remains a separate project; small framework examples are sufficient to validate this release.
