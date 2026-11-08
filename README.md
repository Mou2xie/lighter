# Lighter

![Lighter logo on a charcoal banner with an orange spark pattern](./assets/readme-hero.svg)

[![npm version](https://img.shields.io/npm/v/@yong_xie/lighter?style=flat-square&logo=npm&logoColor=white&color=007EC6)](https://www.npmjs.com/package/@yong_xie/lighter)

**English** · [简体中文](./README.zh-CN.md)

**A lightweight TypeScript-based AI agent development framework.**

Lighter maintains a lean but reliable core loop and provides out-of-the-box Provider, Model, Tool, and Hook components, so you can quickly build AI agent products.

Lighter's design is inspired by Pi. The core stays lean while leaving enough room for customization. Ease of use is a priority: the API is simple and intuitive, and suitable for developers of all levels.

> **Status:** Alpha. The API may make breaking changes.

## Before you start

- Node.js 22+
- An API key and a model ID from your model provider.

## Your first agent

In a project with `@yong_xie/lighter` installed, create `hello.ts`:

```ts
import { Agent, Model, OpenAIProvider, UserMessage } from "@yong_xie/lighter";

// 1. Connect to the model provider.
// Replace the key and model ID with your own.
const provider = new OpenAIProvider("sk-xxxxxxxxxx", "gpt-4.1-mini");

// 2. Wrap the provider in a model.
const model = new Model(provider);

// 3. Create an agent with that model.
const agent = new Agent({ model });

const result = await agent.run({
  messages: [new UserMessage("Suggest a name for a bookshop on the moon.")],
});

// Print the last message.
console.log(result.messages.at(-1));
```

Run it:

```sh
node hello.ts
```

You should see an assistant message containing a short reply, for example:

```text
The Lunar Shelf
```

This is a minimal agent prototype. Compose a `Provider`, a `Model`, and an `Agent` in order, and you can easily build a working AI agent.

## Add a tool

Tools are optional. If you only need a single model reply, the example above is enough.

A tool is a function the model is allowed to call. You just define the tool and hand it to Lighter.

To standardize the function's argument format, install Zod:

```sh
npm install zod@4
```

Create a new `tool.ts` with the complete code:

```ts
import { Agent, Model, OpenAIProvider, Tool, UserMessage } from "@yong_xie/lighter";
import * as z from "zod";

const provider = new OpenAIProvider("sk-xxxxxxxxxx", "gpt-4.1-mini");
const model = new Model(provider);

// Define a tool.
const add = new Tool({
  name: "add",
  description: "Return the sum of two numbers.",
  parametersZodSchema: z.strictObject({ a: z.number(), b: z.number() }),
  func: ({ a, b }) => a + b,
});

// Create an agent with the tool and run it.
const agent = new Agent({ model, tools: [add] });
const answer = await agent.run({
  messages: [new UserMessage("Use the add tool to calculate 19 + 23.")],
});

console.log(answer.messages);
```

Run it:

```sh
node tool.ts
```

You should see a tool message with output `42` and an assistant reply in the printed array. The output looks roughly like this:

```text
[
  AssistantMessage { content: '', toolCalls: [ add(19, 23) ] },
  ToolMessage { toolName: 'add', toolOutput: '42', isError: false },
  AssistantMessage { content: '19 + 23 = 42.', toolCalls: [] }
]
```

The diagram below shows how Lighter handles a tool call.

![Example exchange: the user asks for 19 + 23, the model requests add(19, 23), the tool returns 42, and the assistant answers 42](./assets/tool-roundtrip.svg)

`func` receives the argument type inferred from the Zod schema. Before it runs, `Tool` validates the model's JSON arguments against that schema. If the model asks for an unknown tool, sends invalid JSON, or passes arguments that do not match the schema, the error is returned to the model as a tool message. The same happens if `func` throws. The loop continues so the model can correct its call.

Successful results are passed through `JSON.stringify`, so returning the string `hello` sends `"hello"` (including the quotes) to the model. Tool calls run in the order the model requests them.

## Lighter's core concepts

By now, you have a first impression of how Lighter works. Next, we'll briefly introduce its core concepts.

### Core classes

`Provider`, `Model`, and `Agent` are the three core classes that make an agent run.

| Class | What it does |
| --- | --- |
| `Provider` | Talks to the corresponding LLM API. |
| `Model` | Wraps model calls. |
| `Agent` | Runs the core loop. |

### Components

`Message`, `Tool`, and `Hook` are the components that make the agent work and extend its capabilities.

| Component | What it does |
| --- | --- |
| `Message` | Carries the messages exchanged with the agent. |
| `Tool` | A function the agent can call to complete a specific task. |
| `Hook` | Lifecycle hooks that can affect the agent at specific points. |

A run looks roughly like this:

```text
Agent
  ├─ calls Model → Provider → model API
  ├─ runs Tool when the model requests tools
  └─ repeats until the model stops requesting tools
```

`Agent` accepts `model`, `tools`, `systemPrompt`, and `hooks`; only `model` is required. `systemPrompt` is a `SystemMessage`; when omitted, Lighter uses `You are a helpful assistant.` as the default prompt.

## Advanced usage

### Streaming

Use `stream()` instead of `run()` to receive and process model output incrementally. Create a `stream.ts`:

```ts
import { Agent, Model, OpenAIProvider, UserMessage } from "@yong_xie/lighter";

const provider = new OpenAIProvider("sk-xxxxxxxxxx", "gpt-4.1-mini");
const model = new Model(provider);
const agent = new Agent({ model });

const streamEvent = agent.stream({
  messages: [new UserMessage("Hello!")]
});

// Read and print the stream.
for await (const event of streamEvent) {
  if ("type" in event && event.type === "text_delta") {
    process.stdout.write(event.text);
  }
}
```

Run it:

```sh
node stream.ts
```

This example prints only `text_delta`; `reasoning_delta` and the final result are skipped.

The stream returns, in order:

- `text_delta`: a piece of text;
- `reasoning_delta`: a piece of reasoning, supported by some providers;
- a complete `AgentResponse`: the full response containing the messages generated in this run.

Handle the events you need.

### Conversation history

Your application maintains and stores the conversation history. To keep context, pass the full conversation history to `agent.run()` and append the returned messages back to it. The example below reuses `agent` from the first example:

```js
const conversationHistory = [new UserMessage("Suggest a name for a bookshop on the moon.")];

// Receive the agent's reply and save it to the conversation history.
const firstReply = await agent.run({ messages: conversationHistory });
conversationHistory.push(...firstReply.messages);

// Add a new user question.
conversationHistory.push(new UserMessage("Give me three more options."));

// Receive the new reply and save it.
const secondReply = await agent.run({ messages: conversationHistory });
conversationHistory.push(...secondReply.messages);

console.log(secondReply.messages.at(-1)?.content);
```

`firstReply.messages` and `secondReply.messages` contain only the messages generated in that run, not the messages already in `conversationHistory`. `run()` does not modify the array you pass in, so you need to `push` the returned messages yourself, as the example does.

Note that `messages` in the `Agent` result is an array, not just the model's final answer. It may contain:

- assistant messages: the final answer, possibly with `reasoning`;
- tool messages: the results of tool calls;
- subsequent assistant messages after tool calls.

So don't treat `messages` as a single string; handle it by message role.

Each run has its own message context, so one `Agent` can handle concurrent requests.

### Lifecycle hooks

Pass hook instances in `new Agent({ model, hooks: { ... } })`. The example below reuses `model` from the first example:

```js
import { BeforeModelHook } from "@yong_xie/lighter";

const logModelRequest = new BeforeModelHook({
  hookName: "log-model-request",
  hookFunction: (request) => {
    console.log(request.messages.length, "messages");
    // Return a new request to change what is sent to the model.
    // Return nothing to call the model with the original request.
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

Return a replacement value to change the request, message, or result; return nothing to keep the original. Hooks are useful for logging, redaction, request rewriting, or guardrails.

Note that replacing or modifying an assistant message may lose provider-specific context used in later turns. For example, OpenAI reasoning items and Claude thinking blocks can only be replayed while the message is unchanged. If you only read or log messages, you are fine.

This is a current limitation.

### Provider options

`Model` accepts any object that implements the `Provider` interface. The object must contain `name`, `invoke`, and `stream`. `invoke` returns one complete `AssistantMessage`; `stream` yields `reasoning_delta` and `text_delta`, then one `message` event.

Built-in adapters live in [`providers/`](./providers/):

| Provider | Model API | Configuration |
| --- | --- | --- |
| `OpenAIProvider` | OpenAI Responses API | `reasoning`, `maxOutputTokens`; always sends `store: false` |
| `ClaudeProvider` | Anthropic Messages API | `maxOutputTokens` (default 8192), `thinking` |
| `DeepSeekProvider` | DeepSeek's OpenAI-compatible endpoint | Constructor arguments: API key, model ID |

Each adapter translates the shared message types to its API and back, and classifies SDK errors as `ModelError`. OpenAI and Claude also keep provider-specific context for later turns while the message is unchanged.

To add another service, implement `Provider` and pass it to `new Model(provider)`. See [`providers/provider.ts`](./providers/provider.ts) for the contract.

## Errors and troubleshooting

### If it doesn't work

- `ERR_REQUIRE_ESM` or `Cannot use import statement`: use ESM and set `"type": "module"` in `package.json`.
- `401` or `auth_error`: check the API key in your code.
- Model not found: check the model ID in your code.
- The result's `status` is `"failed"`: read `error`.

### Error codes

When a run fails, the result's `status` is `"failed"` and `error` holds the reason:

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

Lighter only runs the loop. It does not include:

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
