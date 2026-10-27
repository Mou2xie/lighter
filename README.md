# lighter

lighter consists of two subprojects: lighter-framework and lighter-agent.

lighter-framework is a TypeScript framework for building AI agents, aimed at developers and taking product inspiration from LangChain.

lighter-agent is a planned coding agent built on lighter-framework, designed to work out of the box and taking product inspiration from Pi. It will be developed as a separate project.

**This repository is dedicated to lighter-framework.** The framework will provide independently usable, composable capabilities through its `model`, `agent`, and `harness` modules, helping developers build and extend their own agent applications.

## Current Status

The repository is currently a single-package prototype with the following foundations:

- [`core/protocol.ts`](./core/protocol.ts): Messages, tool calls, tool results, and basic tool definitions.
- [`model/`](./model/model.ts): `Model`, `Provider`, non-streaming DeepSeek integration, and message adaptation.
- [`agent/agent.ts`](./agent/agent.ts): A basic execution loop that awaits asynchronous tool results.
- [`index.ts`](./index.ts): An addition demo that manually assembles a model and a tool.
- The demo reads its API key from an environment variable. Agent accepts an explicit system prompt and provides a short built-in default.

A complete harness, public SDK exports, and a test suite have not been implemented yet. The checklists below describe target capabilities; the existing prototype does not mean those capabilities have passed full acceptance testing.

## Run the Current Prototype Locally

The development environment has been verified with Node.js 22.23.3. The project uses pnpm to manage dependencies.

```bash
pnpm install
```

Create a local `.env` file with your API key, or provide it directly through an environment variable:

```dotenv
DEEPSEEK_API_KEY=replace_with_your_key
```

`.env` is included in `.gitignore`. Keep real keys in your local or runtime environment, and use placeholders in examples and committed files.

```bash
pnpm start
```

The start script uses Node.js to load the optional `.env` file, then runs `index.ts` through tsx. This entry point calls the real DeepSeek API to run the addition tool demo. OpenAI and Anthropic integrations are beta roadmap items below.

Run the type checker:

```bash
pnpm exec tsc --noEmit
```

The current `test` script is still a placeholder. The test suite will be added as part of this milestone.

## lighter-framework v0.9 Beta Milestone

**Release goal: Provide independently usable, composable, and extensible foundations for agent development, validated through a public SDK, tests, and examples.**

This milestone focuses on model integration, the execution loop, and session management. Deliverables include the public SDK, essential tests, documentation, and runnable examples.

**Built-in providers for beta: DeepSeek, OpenAI, and Anthropic.** The baseline for all three is non-streaming text conversations and tool calling. Supported models and parameters will be defined during integration.

Developers should be able to:

1. Use `model` independently to call models and replace providers.
2. Use `agent` to execute a task with a supplied model, messages, and custom tools.
3. Use `harness` to compose multi-turn agent applications, manage in-memory sessions, and integrate events and hooks.

### Module Responsibilities and Boundaries

| Module | Core responsibility | Beta capabilities |
| --- | --- | --- |
| `core` | Shared contracts | Messages, tool definitions and results, execution context, and public types |
| `model` | Unified model access | Provider adaptation, model configuration, request parameters, normalized responses, errors, and cancellation |
| `agent` | Task execution | Agent loop, tool execution, error recovery, cancellation, run results, and events |
| `harness` | Runtime composition and session management | In-memory history, explicit assembly, caller-supplied context, event subscriptions, and execution hooks |

`core` provides shared contracts for the three main modules. `Model` can be used independently, `Agent` depends on model and tool contracts, and `Harness` composes Agent and manages sessions.

- When using harness, Session owns the history. Agent receives the current context and produces new messages. When using agent independently, the caller manages the context.
- Models, prompts, tools, credentials, and execution context are supplied explicitly by the caller. Helper loaders are optional; importing the public API does not read local configuration.
- A working directory can be passed as part of the caller-supplied context. Project scanning, file access, and default directory rules are defined by the application.
- Public contracts are independent of vendor SDKs. Each provider converts vendor-specific requests, responses, and tool formats.
- Events observe execution; awaitable hooks influence it. Each has defined ordering, error handling, and cleanup behavior.
- Implement framework modules in the existing repository first. Organize package entry points and publishing configuration during SDK delivery.

### Beta Scope and Behavioral Contracts

| Area | Contract |
| --- | --- |
| Runtime | Validate beta on Node.js with ESM; explicitly declare the minimum supported version at release |
| Model capabilities | Non-streaming text conversations and tool calling across the three providers; maintain a list of verified models, parameters, and capability differences |
| Provider replacement | Allow provider replacement for new tasks or sessions without changing the agent loop; evaluate migration of history containing vendor-specific context separately |
| Tool execution | Execute multiple tool calls from the same turn sequentially, in the order returned by the model; reject duplicate tool names during registration |
| Agent loop | Beta does not impose a maximum step count; a run continues until completion, cancellation, or failure |
| Sessions | Use in-memory history owned by Session; reject overlapping runs within the same Session |
| Cancellation | Use cancellation signals to cooperatively stop requests and tool execution, stop scheduling further work, and define how tools that ignore cancellation are finalized |
| Execution context | Available to tools and hooks by default; the caller explicitly chooses what information enters model input |

Streaming, cross-provider history migration, persistence, parallel tool scheduling, and automatic extension discovery are part of the future roadmap.

### Model: Unified Model Access

- [ ] Define the responsibilities of `Model`, `Provider`, and Adapter. `Model` manages unified configuration and invocation, while Provider encapsulates vendor adaptation.
- [ ] Support default generation parameters and per-request overrides, with clear ownership and merge rules for model identifiers and parameters.
- [ ] Normalize non-streaming requests and responses, preserving reply content, tool calls, and explicit stop reasons.
- [ ] Detect request failures, response failures, and output truncation, and expose clear outcomes to callers.
- [ ] Define how refusals, unknown output types, and vendor context required to continue a conversation are handled. Avoid reporting errors or unsupported responses as successful empty replies.
- [ ] Propagate cancellation signals to model requests. Define failure handling boundaries to avoid executing completed tools again.
- [ ] Define request timeout and vendor SDK automatic retry settings, expose caller control, and distinguish these from the execution boundaries of an entire task.
- [ ] Isolate vendor differences and provide explicit feedback for unsupported parameters or capabilities.
- [x] Keep the public Provider interface independent of concrete SDK clients, with vendor-specific Adapter input and output types encapsulated in each implementation.
- [ ] Complete the built-in `DeepSeekProvider` to satisfy the unified invocation contract.
- [ ] Implement a built-in `OpenAIProvider` supporting text conversations and tool calling.
- [ ] Implement a built-in `AnthropicProvider` supporting text conversations and tool calling.
- [x] Provide a standalone mock provider for offline testing and contract substitution checks.
- [ ] Maintain a list of verified models, common parameters, tool calling capabilities, and known limitations for all three providers. Distinguish portable capabilities from vendor-specific options.

### Agent: Reliable Task Execution

- [x] Define tool definitions and execution supporting synchronous and asynchronous tool functions.
- [ ] Provide caller-supplied execution context to tools.
- [x] Parse and validate arguments before execution, using valid tool schemas.
- [x] Infer tool argument types from their Zod parameter schemas.
- [ ] Provide typed tool result interfaces and document supported schema features, keeping type declarations and validation rules consistent.
- [x] Execute tool calls from the same turn sequentially in the order returned by the model.
- [ ] Reject duplicate tool names during registration.
- [ ] Support text and structured tool results, with explicit rules for serialization into model input.
- [x] Convert invalid arguments, unknown tools, and tool exceptions into error results with matching call IDs so the model can correct the problem and continue.
- [ ] Distinguish tool failures, model failures, and run termination. Define how messages and results remain paired when multiple tool calls fail or are cancelled.
- [ ] Support cancellation and propagate cancellation signals. Return explicit outcomes for completion, cancellation, or failure, along with messages added during the run.
- [ ] Expose typed events for run start, complete replies, tool start, tool end, and run end.
- [ ] Provide injection points for execution hooks and report progress through events or a caller-supplied logging interface.
- [ ] Define event ordering and how subscriber exceptions are handled. Emit exactly one run-end event for every exit path.

### Harness: General Session Management and Runtime Assembly

- [ ] Implement in-memory Session support for creation, multi-turn input, clearing history, and querying run status.
- [ ] Expose history through controlled access or snapshots, maintaining consistent history and tool results after completion, failure, or cancellation.
- [ ] Define concurrency behavior for a Session. Beta rejects overlapping runs with a clear error.
- [ ] Assemble models, prompts, tools, and run options through explicit parameters, and pass caller-supplied context to the execution layer.
- [ ] Assemble prompts and configuration through explicit parameters, leaving credential sources and file loading methods to the caller.
- [ ] Define the default behavior when no system prompt is provided. Use one assembly point to avoid inserting duplicate system messages.
- [ ] Support awaitable hooks before model requests, before tool execution, and after tool execution to add context, inspect or reject calls, and record results.
- [ ] Register tools and hooks through ordinary functions or objects, with explicit hook ordering and failure semantics.
- [ ] When a pre-execution hook rejects a tool call, skip execution and return an error result with the matching call ID. Include this behavior in session consistency checks.
- [ ] Provide interfaces for event subscription, unsubscription, task cancellation, and session resource cleanup.

### Public SDK and Composition Examples

- [ ] Export the framework package and TypeScript types, allowing selective use of model, agent, harness, and shared contracts.
- [ ] Move the current demo to `examples/`. The SDK entry point exports public interfaces only; credentials are read and model requests are made when the caller runs an example.
- [ ] Importing the public API does not run demos, require local credential files, or require a project working directory.
- [ ] Provide minimal examples of standalone model invocation and direct use of the agent loop.
- [ ] Provide configuration and provider-switching examples for DeepSeek, OpenAI, and Anthropic, with credentials supplied explicitly by the caller.
- [ ] Provide a multi-turn example using harness, a custom asynchronous tool, and an in-memory session.
- [ ] Provide an assistant example with an in-memory data lookup tool to validate the framework's general applicability.
- [ ] Provide examples of substituting a mock provider, subscribing to events, and registering hooks.
- [ ] Use public interfaces in all examples so developers can extend applications by composing framework capabilities.

### Testing and SDK Delivery

- [x] Build a mock provider that requires neither network access nor an API key to test core execution behavior.
- [ ] Verify recovery from invalid arguments, synchronous and asynchronous tools, structured results, tool exceptions, and matching results for multiple tool calls.
- [ ] Verify model failures, output truncation, cancellation, and their corresponding run outcomes.
- [ ] Verify multi-turn history, history snapshots, rejection of overlapping runs, and the ordering and failure semantics of events and hooks.
- [ ] Verify duplicate tool names, sequential execution of multiple tools, hook rejection, subscriber exceptions, and run-end events across all exit paths.
- [ ] Establish shared invocation contract tests for DeepSeek, OpenAI, and Anthropic, and test each provider's request and response adaptation separately.
- [ ] Provide real integration tests for all three providers that can be run on demand. Before release, select at least one model per provider and verify both text conversations and a complete tool calling round trip. Record the model ID, validation date, and results. Keep the default test suite offline.
- [ ] Add build, type-check, and test scripts, SDK exports, and type declarations.
- [ ] Declare the minimum Node.js version and ESM support scope. Verify that the installed SDK runs directly without development tools such as tsx.
- [ ] Align package metadata and resources with lighter-framework, and set the package version to match v0.9 beta before release.
- [ ] Use a publishing allowlist and inspect package contents to exclude local credentials, logs, and temporary test files.
- [ ] Install the packaged artifact outside the repository and verify public imports and composition examples.
- [ ] Document SDK installation, explicit configuration, module responsibilities, execution semantics, examples, and beta API compatibility expectations.

### Implementation Order

Follow dependency order, adding the necessary tests and examples at each stage.

| Stage | Main work | Acceptance outcome |
| --- | --- | --- |
| 1. Shared contracts and Model | Define public contracts, configuration, errors, and cancellation; complete DeepSeek, then integrate OpenAI and Anthropic | Model can be used independently; all three built-in providers and the mock provider satisfy the same public contract, with capability differences documented |
| 2. Reliable agent loop | Tool validation, sequential execution, result serialization, error recovery, cancellation, and run events | A mock model corrects invalid arguments and successfully calls an asynchronous tool; tool results are correctly paired and the task ends with an explicit outcome |
| 3. Harness composition | In-memory sessions, explicit assembly, caller-supplied context, hooks, and lifecycle management | The data lookup assistant runs across multiple turns with correct history, and callers can observe and intervene in tool execution |
| 4. Framework beta delivery | Public exports, type declarations, documentation, examples, and package validation | Developers can independently use modules and compose agent applications through the SDK outside the repository |

### Beta Release Acceptance Criteria

- [ ] Model, agent, and harness each provide functional capabilities and runnable examples, and can be used independently according to their dependency boundaries.
- [ ] Each built-in provider—DeepSeek, OpenAI, and Anthropic—has recorded real text conversation and tool calling validation for at least one model. Developers can install and configure them explicitly by following the documentation.
- [ ] Developers can register custom asynchronous tools, conduct multi-turn conversations, subscribe to events, and use execution hooks through the public SDK.
- [ ] New tasks or sessions can switch between the three built-in providers and the mock provider without changing the agent loop.
- [ ] Invalid arguments, tool failures, model failures, and cancellation have explicit, verified behavior.
- [ ] Messages and tool results remain consistent across multiple turns and after failures or cancellation.
- [ ] Tool ordering, hook rejection, event ordering, and exit behavior follow the contracts above. System prompts are assembled exactly once as specified.
- [ ] The data lookup assistant example demonstrates that the framework supports general-purpose agent applications.
- [ ] Type checking, offline tests, and builds pass. The packaged artifact is validated outside the repository in the declared Node.js environment, imports without demo side effects, does not depend on tsx, and contains no real credentials.

## lighter-framework Future Roadmap

Expand based on feedback from beta usage:

- Streaming output, incremental tool argument assembly, and usage information.
- Additional built-in providers, including Gemini and OpenRouter.
- Session storage interfaces, file persistence and recovery, and context compaction.
- Cross-provider history migration, parallel tool scheduling, richer execution strategies, additional instructions during a run, queuing, and multi-agent orchestration.
- General resource loading and extension mechanisms, with application-defined configuration discovery rules.

LangChain is a reference for the framework's product direction. Broader capabilities such as RAG, vector database integrations, and workflows will be evaluated separately when concrete use cases arise.
