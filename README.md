# Lighter

![Lighter logo on a charcoal banner with an orange spark pattern](./assets/readme-hero.svg)

[![npm version](https://img.shields.io/npm/v/@yong_xie/lighter?style=flat-square&logo=npm&logoColor=white&color=007EC6)](https://www.npmjs.com/package/@yong_xie/lighter)

**English** · [简体中文](./README.zh-CN.md)

**A small, explicit agent framework for TypeScript.**

Lighter runs the tool-calling loop in your Node.js process. You compose four objects—`Provider`, `Model`, `Tool`, and `Agent`—and keep ownership of conversation storage, UI, and infrastructure.

> **Status:** 0.x. The API may change between minor releases. Lighter is ESM-only.

## Why Lighter?

- **Four objects, one job each.** `Provider` talks to a model API, `Model` binds a provider and applies model-call hooks, `Tool` validates and runs a function, and `Agent` owns the loop. There is no hidden orchestration layer between them.
- **Typed tools.** A Zod schema gives `func` its TypeScript argument type and validates the model's arguments at runtime. Invalid arguments become a tool error the model can correct.
- **Streaming and hooks, not a platform.** `stream()` yields text and reasoning deltas, then one terminal result. Four lifecycle hooks cover the run and each model call.
- **No hidden conversation state.** `run()` returns only the messages generated in this run. Each run has its own context, and one `Agent` can serve concurrent runs.

Lighter is for applications that already have a home for state, UI, and infrastructure. It does not provide persistence, RAG, multi-agent orchestration, tracing, or a sandbox.

## Core concepts

| Object | One job | What it owns |
| --- | --- | --- |
| `Provider` | Translate between Lighter's message types and a model API. | `name`, `invoke`, and `stream`. |
| `Model` | Make one model call through a provider. | A `Provider`; applies the before/after model hooks it receives. |
| `Tool` | Describe and execute one function the model may call. | A name, description, Zod schema, and `func`. |
| `Agent` | Run the loop until the model stops requesting tools. | A model, tools, system prompt, lifecycle hooks, and the per-run message context. |

A run looks like this:

```text
system prompt + input messages
              │
              ▼
      Agent ─ Model ─ Provider ─ model API
              │
              ▼
      AssistantMessage
        ├─ no tool calls ──▶ return generated messages
        └─ tool calls ─────▶ Tool.execute() for each call, in order
                                  │
                                  ▼
                              ToolMessage(s)
                                  │
                                  └──▶ next model call
```

Only `Agent` owns a loop. `Model` makes one call, `Tool` executes one function, and `Provider` translates one API. You can use the lower layers directly if you need a different loop.

`Agent` accepts `model`, `tools`, `systemPrompt`, and `hooks`; only `model` is required. `systemPrompt` is a `SystemMessage`; when omitted, the agent uses `You are a helpful assistant.` as the default prompt. The agent does not append to the array you pass in: each run builds a local context from the system prompt and your messages, then returns the messages generated during that run.

## Install

Requires Node.js 22+ (tested on Node.js 22) and an ESM project (`"type": "module"` or `.mjs`). TypeScript declarations are included. Lighter is ESM-only, so `require()` is not supported.

```sh
npm install @yong_xie/lighter
```

Importing the package does not read credentials or make requests. Real provider calls use your API key and are billed by that provider.

## Quick start

Set `OPENAI_API_KEY` and `OPENAI_MODEL_ID` to a model ID your account can use, then run:

```js
import { Agent, Model, OpenAIProvider, UserMessage } from "@yong_xie/lighter";

const model = new Model(
  new OpenAIProvider(process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL_ID),
);
const agent = new Agent({ model });

const history = [new UserMessage("Suggest a name for a bookshop on the moon.")];
const result = await agent.run({ messages: history });

history.push(...result.messages);
console.log(result.messages.at(-1)?.content);
```

`result` is an `AgentResponse`:

```ts
{
  status: "completed" | "failed";
  messages: BaseMessages;
  error?: unknown;
}
```

`result.messages` contains only the assistant and tool messages generated during this run. It does not include the system prompt or the messages you passed in. To continue the conversation, append `result.messages` and a new `UserMessage` to your history, then call `agent.run` again.

## Tool calling

Install Zod in your application, then define a tool. This example reuses `model` and `UserMessage` from the quick start:

```sh
npm install zod@4
```

```js
import { Tool } from "@yong_xie/lighter";
import * as z from "zod";

const add = new Tool({
  name: "add",
  description: "Return the sum of two numbers.",
  parametersZodSchema: z.strictObject({ a: z.number(), b: z.number() }),
  func: ({ a, b }) => a + b,
});

const calculator = new Agent({ model, tools: [add] });
const answer = await calculator.run({
  messages: [new UserMessage("Use the add tool to calculate 19 + 23.")],
});

console.log(answer.messages);
```

![Example exchange: the user asks for 19 + 23, the model requests add(19, 23), the tool returns 42, and the assistant answers 42](./assets/tool-roundtrip.svg)

The diagram shows one possible exchange with a model that supports tool calls.

`func` receives the argument type inferred from the Zod schema and may be synchronous or asynchronous. Before it runs, the `Agent` parses the model's JSON arguments and `Tool` validates them against the schema. Unknown tool names, invalid JSON, schema failures, and thrown errors all become error `ToolMessage`s with `isError: true`; the loop continues so the model can correct its call.

Tool calls run sequentially in the order the model requested them, and each result carries the model's call ID. Return a JSON-serializable value; successful results are passed through `JSON.stringify`, so returning the string `hello` sends `"hello"` (including the quotes) to the model.

## Streaming

Use `stream()` instead of `run()` to receive output as it arrives. This example reuses `agent` from the quick start:

```js
for await (const event of agent.stream({ messages: [new UserMessage("Hello!")] })) {
  if ("status" in event) {
    console.log(event.status, event.messages);
  } else if (event.type === "text_delta") {
    process.stdout.write(event.text);
  }
}
```

`stream()` yields `text_delta` and, when the provider supports it, `reasoning_delta` events. It then yields one terminal `AgentResponse`. Complete assistant and tool messages are in that terminal result, not in the deltas. Tool calls are executed inside the loop and are not streamed as separate events.

Reasoning deltas depend on the provider and model settings; enable the provider's reasoning or thinking option when required.

## Conversations

The `Agent` holds configuration, not conversation state. Keep history in your application. This example reuses `agent`:

```js
const conversation = [new UserMessage("Suggest a name for a bookshop on the moon.")];

const first = await agent.run({ messages: conversation });
conversation.push(...first.messages);

conversation.push(new UserMessage("Give me three more options."));
const second = await agent.run({ messages: conversation });
```

`run()` does not append to the array you pass in. Append the returned messages yourself, and decide where history lives and when to trim or persist it.

Because each run gets its own message context, one `Agent` can handle concurrent runs.

## Lifecycle hooks

Pass hook instances in `new Agent({ model, hooks: { ... } })`. Each hook has a `hookName`, an optional `description`, and a `hookFunction` that may be synchronous or asynchronous. This example reuses `model`:

```js
import { BeforeModelHook } from "@yong_xie/lighter";

const logModelRequest = new BeforeModelHook({
  hookName: "log-model-request",
  hookFunction: (request) => {
    console.log(request.messages.length, "messages");
    // Return nothing to keep the request unchanged.
  },
});

const loggedAgent = new Agent({
  model,
  hooks: { beforeModel: logModelRequest },
});
```

| Hook | When it runs | Value it receives |
| --- | --- | --- |
| `BeforeAgentHook` | Once at the start of a run | `AgentRequest` |
| `BeforeModelHook` | Before every model call, including tool follow-ups | `ModelRequest` |
| `AfterModelHook` | When a complete assistant message arrives | `AssistantMessage` |
| `AfterAgentHook` | After the loop completes successfully | Generated `BaseMessages` |

Return a replacement value to change the request, message, or result; return nothing to keep the original. Use hooks for logging, redaction, request rewriting, or guardrails.

Replacing or mutating an assistant message can drop provider-native replay where supported. OpenAI reasoning items and Claude signed thinking blocks can only be replayed while the message is unchanged; after a replacement, the next request is rebuilt from the public fields.

## Provider

`Model` accepts any object that implements the `Provider` interface: `name`, `invoke`, and `stream`. `invoke` returns one complete `AssistantMessage`; `stream` yields `reasoning_delta` and `text_delta` events, then one `message` event. Built-in adapters live in [`providers/`](./providers/):

| Provider | Model API | Options |
| --- | --- | --- |
| `OpenAIProvider` | OpenAI Responses API | `reasoning`, `maxOutputTokens`; sends `store: false` |
| `ClaudeProvider` | Anthropic Messages API | `maxOutputTokens` (default 8192), `thinking` |
| `DeepSeekProvider` | DeepSeek's OpenAI-compatible endpoint | API key and model ID |

Each adapter translates the shared message types to its API and back, and classifies SDK errors as `ModelError`. OpenAI and Claude also retain native reasoning or tool context for replay while the message is unchanged.

To add another service, implement `Provider` and pass it to `new Model(provider)`. See [`providers/provider.ts`](./providers/provider.ts) for the contract.

## Errors

Model and provider failures become a failed `AgentResponse` with the messages generated so far:

```ts
{ status: "failed"; messages: BaseMessages; error: unknown }
```

`error` is `unknown` and may be `undefined`, so guard before throwing it. Provider SDK errors are normalized to `ModelError` with a `code`:

| Code | Meaning |
| --- | --- |
| `auth_error` | Authentication or permission failure |
| `rate_limit` | Provider rate limit |
| `invalid_request` | Invalid request to the provider |
| `network_error` | Connection failure |
| `server_error` | Provider-side failure |
| `bad_response` | Incomplete, failed, or unparseable response |
| `aborted` | Request cancelled |
| `unknown` | Unclassified failure |

`ModelError` also exposes `httpStatus` for HTTP errors and `responseStatus` for generation statuses such as `failed` or `incomplete`.

## Limits and security

Lighter is intentionally small. It does not include:

- conversation persistence
- a maximum number of model turns
- request cancellation or timeouts beyond what the provider SDK does
- a retry policy of its own
- tracing, metrics, or a dashboard
- a sandbox for tool code
- parallel tool execution

A model that keeps requesting tools can keep the loop running; add your own turn limit if that matters. Stopping a stream early prevents later tools from running, but does not cancel a tool that is already in progress.

Tool argument validation checks shape, not authorization. Tools run with your application's privileges, and model output should be treated as untrusted input. Enforce permissions inside each tool, and do not pass model output directly to a shell, database, or filesystem without validation. If you need isolation, run tool code in a separate process or service.

## API at a glance

The package exports:

- `Agent`, `Model`, `Tool`, and their configuration, request, and result types
- `SystemMessage`, `UserMessage`, `AssistantMessage`, `ToolMessage`, and `BaseMessages`
- `BeforeAgentHook`, `AfterAgentHook`, `BeforeModelHook`, `AfterModelHook`
- `Provider`, `OpenAIProvider`, `ClaudeProvider`, `DeepSeekProvider`
- `ModelError` and `ModelErrorCode`

The source entry point is [`index.ts`](./index.ts). Type declarations ship with the package.

## Development

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm pack --dry-run
```

`pnpm check` runs TypeScript checks and the offline test suite. Tests use mocked HTTP and do not contact live model APIs; they are not a live compatibility check. See the [test guide](./test/README.md) for coverage and current limitations.

## License

ISC. See [LICENSE](./LICENSE).

[GitHub](https://github.com/Mou2xie/lighter) · [Issues](https://github.com/Mou2xie/lighter/issues) · [npm](https://www.npmjs.com/package/@yong_xie/lighter)
