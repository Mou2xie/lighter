# Lighter

![Lighter logo on a charcoal banner with an orange spark pattern](./assets/readme-hero.svg)

[![npm version](https://img.shields.io/npm/v/@yong_xie/lighter?style=flat-square&logo=npm&logoColor=white&color=007EC6)](https://www.npmjs.com/package/@yong_xie/lighter)

**English** · [简体中文](./README.zh-CN.md)

**A small TypeScript framework for agents that call your functions.**

An agent runs a loop between a model and your code: the model can ask for a tool, Lighter runs it, and the model continues. The loop runs in your Node.js process; your app keeps the conversation history.

> **Status:** 0.x. The API may change between minor releases. Lighter is ESM-only.

## Before you start

- Node.js 22+
- An ESM project: save the examples as `.mjs` (they use top-level `await`), or set `"type": "module"` in `package.json`
- An API key and a model ID from your model provider. Model calls are billed by that provider.

## Your first agent

1. Install the package in a new folder:

```sh
mkdir my-agent
cd my-agent
npm init -y
npm install @yong_xie/lighter
```

2. Create a `.env` file next to your code. `OPENAI_MODEL_ID` is your own variable; set it to a model ID your account can access:

```ini
OPENAI_API_KEY=sk-...
OPENAI_MODEL_ID=your-model-id
```

Do not commit `.env`.

3. Create `hello.mjs`:

```js
import { Agent, Model, OpenAIProvider, UserMessage } from "@yong_xie/lighter";

// 1. Connect to the model provider.
const provider = new OpenAIProvider(
  process.env.OPENAI_API_KEY,
  process.env.OPENAI_MODEL_ID,
);

// 2. Wrap the provider in a model.
const model = new Model(provider);

// 3. Create an agent with that model.
const agent = new Agent({ model });

const result = await agent.run({
  messages: [new UserMessage("Suggest a name for a bookshop on the moon.")],
});

// Print the last message, which is the assistant's reply.
console.log(result.messages.at(-1)?.content);
```

4. Run it:

```sh
node --env-file=.env hello.mjs
```

You should see a short reply, for example:

```text
The Lunar Shelf
```

`result.messages` contains the messages generated in this run. The examples omit error handling to stay short; in real code, check `result.status` before reading `result.messages`.

### What just happened?

- `OpenAIProvider` is the connection to the model API. It sends messages and reads replies.
- `Model` wraps the provider. It gives the agent one object to call, regardless of which provider you use.
- `Agent` runs the loop: it calls the model, runs any tools the model requests, and calls the model again until there are no more tool requests.

You only need these three for now. The fourth object, `Tool`, is next.

## Add a tool

Tools are optional. If you only need a single model reply, you can stop after the first example.

A tool is a function you allow the model to call. You describe its arguments with a Zod schema, and Lighter runs it when the model asks.

Install Zod in your application:

```sh
npm install zod@4
```

Add the imports at the top of `hello.mjs` and the rest below the model setup:

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

`func` receives the argument type inferred from the Zod schema. Before it runs, `Tool` validates the model's JSON arguments against that schema. If the model asks for an unknown tool, sends invalid JSON, or passes arguments that do not match the schema, the error is returned to the model as a tool message. The same happens if `func` throws. The loop continues so the model can correct its call.

Successful results are passed through `JSON.stringify`, so returning the string `hello` sends `"hello"` (including the quotes) to the model. Tool calls run in the order the model requests them.

You should see a tool message whose output is `42` in the printed array, followed by an assistant message.

## Core concepts

Lighter has four objects. Each does one thing.

| Object | What it is | What you do with it |
| --- | --- | --- |
| `Provider` | The adapter for one model API. | Create one with an API key and model ID. |
| `Model` | The model your agent calls. | Wrap a provider in a `Model`. |
| `Tool` | A function the model may request. | Give it a name, description, Zod schema, and function. |
| `Agent` | The object that runs the loop. | Give it a model and tools; call `run()` or `stream()`. |

A run looks like this:

```text
Agent
  ├─ calls Model → Provider → model API
  ├─ if the model requests tools, runs Tool
  └─ repeats until the model returns no tool calls
```

`Agent` is the only object that runs the agent loop. `Model`, `Tool`, and `Provider` each do one thing per call.

`Agent` accepts `model`, `tools`, `systemPrompt`, and `hooks`; only `model` is required. `systemPrompt` is a `SystemMessage`; when omitted, Lighter uses `You are a helpful assistant.` as the default prompt.

## Going further

The sections below are optional. Read the one you need.

### Streaming

Use `stream()` instead of `run()` to receive text as it arrives. This example reuses `agent` from the first example:

```js
for await (const event of agent.stream({ messages: [new UserMessage("Hello!")] })) {
  if ("status" in event) {
    console.log(event.status, event.messages);
  } else if (event.type === "text_delta") {
    process.stdout.write(event.text);
  }
}
```

`stream()` yields `text_delta` events and, when the provider supports it, `reasoning_delta` events. It then yields one final `AgentResponse`. Complete assistant and tool messages are in that final result, not in the deltas. Tool calls run inside the loop and are not streamed as separate events.

Reasoning deltas depend on the provider and model settings. Enable the provider's reasoning or thinking option when required.

### Conversations

Your app keeps the conversation history. This example reuses `agent`:

```js
const conversation = [new UserMessage("Suggest a name for a bookshop on the moon.")];

const first = await agent.run({ messages: conversation });
conversation.push(...first.messages);

conversation.push(new UserMessage("Give me three more options."));
const second = await agent.run({ messages: conversation });

console.log(second.messages.at(-1)?.content);
```

`result.messages` contains only the messages generated in that run. `run()` does not append to the array you pass in; append the returned messages yourself.

Each run has its own message context, so one `Agent` can handle concurrent runs.

### Lifecycle hooks

Pass hook instances in `new Agent({ model, hooks: { ... } })`. This example reuses `model`:

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

Each hook has a `hookName`, an optional `description`, and a `hookFunction` that may be synchronous or asynchronous.

| Hook | When it runs | Value it receives |
| --- | --- | --- |
| `BeforeAgentHook` | Once at the start of a run | `AgentRequest` |
| `BeforeModelHook` | Before every model call, including tool follow-ups | `ModelRequest` |
| `AfterModelHook` | When a complete assistant message arrives | `AssistantMessage` |
| `AfterAgentHook` | After the loop completes successfully | Generated `BaseMessages` |

Return a replacement value to change the request, message, or result; return nothing to keep the original. Use hooks for logging, redaction, request rewriting, or guardrails.

Replacing or mutating an assistant message can drop provider-specific context used in later turns. For example, OpenAI reasoning items and Claude thinking blocks can only be replayed while the message is unchanged. If you only read or log messages, you are fine.

### Provider options

`Model` accepts any object that implements the `Provider` interface: `name`, `invoke`, and `stream`. `invoke` returns one complete `AssistantMessage`; `stream` yields `reasoning_delta` and `text_delta` events, then one `message` event.

Built-in adapters live in [`providers/`](./providers/):

| Provider | Model API | Options |
| --- | --- | --- |
| `OpenAIProvider` | OpenAI Responses API | `reasoning`, `maxOutputTokens`; sends `store: false` |
| `ClaudeProvider` | Anthropic Messages API | `maxOutputTokens` (default 8192), `thinking` |
| `DeepSeekProvider` | DeepSeek's OpenAI-compatible endpoint | API key and model ID |

Each adapter translates the shared message types to its API and back, and classifies SDK errors as `ModelError`. OpenAI and Claude also keep provider-specific context for later turns while the message is unchanged.

To add another service, implement `Provider` and pass it to `new Model(provider)`. See [`providers/provider.ts`](./providers/provider.ts) for the contract.

## Errors and troubleshooting

### If it doesn't work

- `ERR_REQUIRE_ESM` or `Cannot use import statement`: save the file as `.mjs`, or set `"type": "module"` in `package.json`.
- `401` or `auth_error`: check `OPENAI_API_KEY`.
- Model not found: check `OPENAI_MODEL_ID`.
- `result.status === "failed"`: read `result.error`.

### Error codes

When a run fails, `result.status` is `"failed"` and `result.error` holds the reason:

```ts
{ status: "failed"; messages: BaseMessages; error: unknown }
```

`error` is `unknown` and may be `undefined`, so check it before using it. Provider SDK errors are normalized to `ModelError` with a `code`:

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

Lighter focuses on the loop. It does not include:

- conversation persistence
- a maximum number of model turns
- request cancellation or timeouts beyond what the provider SDK does
- a retry policy of its own
- tracing, metrics, or a dashboard
- a sandbox for tool code
- parallel tool execution

A model that keeps requesting tools can keep the loop running; add your own turn limit if that matters. Stopping a stream early prevents later tools from running, but does not cancel a tool that is already in progress.

Tool argument validation checks the format, not permissions. Tools run with your application's privileges, and model output should be treated as untrusted input. Enforce permissions inside each tool, and do not pass model output directly to a shell, database, or filesystem without validation. If you need isolation, run tool code in a separate process or service.

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
