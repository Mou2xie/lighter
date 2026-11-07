# @yong_xie/lighter

A TypeScript framework for building AI agents with model providers, tools,
streaming, and lifecycle hooks.

## Installation

```bash
npm install @yong_xie/lighter
```

This package uses ESM (`import` / `export`). Use `.mjs` files or set
`"type": "module"` in your application's `package.json`. TypeScript declarations
are included. Development checks currently run on Node.js 22.23.3; other Node.js
versions have not been verified.

## Quick start

The package exports `DeepSeekProvider`, `OpenAIProvider`, and `ClaudeProvider`.
Pass your API key and the model ID supported by your provider:

```js
import { Agent, Model, OpenAIProvider, UserMessage } from "@yong_xie/lighter";

const apiKey = process.env.OPENAI_API_KEY;
const modelId = process.env.OPENAI_MODEL_ID;
if (!apiKey || !modelId) throw new Error("Set OPENAI_API_KEY and OPENAI_MODEL_ID");

const agent = new Agent({ model: new Model(new OpenAIProvider(apiKey, modelId)) });
const result = await agent.run({ messages: [new UserMessage("Hello")] });
if (result.status === "failed") throw result.error;
console.log(result.messages);
```

`run` returns a `status`, the messages generated during this run, and an optional
`error`. The caller retains conversation history and can append these generated
messages before the next run.

Importing the package does not read API keys or make model requests. Applications
supply credentials when constructing a real provider. Real provider calls require
an account and may incur charges from that provider.

## Tools

Install Zod in your application if you define tool schemas directly:

```bash
npm install zod
```

```ts
import { Tool } from "@yong_xie/lighter";
import * as z from "zod";

const addition = new Tool({
  name: "addition",
  description: "Adds two numbers.",
  parametersZodSchema: z.strictObject({ a: z.number(), b: z.number() }),
  func: ({ a, b }) => a + b,
});
```

Pass tools as `new Agent({ model, tools: [addition] })`. Tool arguments are
validated before execution. Tool errors are returned to the model as tool messages.

## Streaming

```js
for await (const event of agent.stream({ messages: [new UserMessage("Hello")] })) {
  if ("status" in event) {
    if (event.status === "failed") throw event.error;
    console.log(event.messages);
  } else if (event.type === "text_delta") {
    process.stdout.write(event.text);
  }
}
```

`stream` yields text/reasoning deltas and then a terminal result. Complete generated
messages belong to that terminal result. Reasoning events depend on provider and
model settings.

## Public API

- `Agent`, `Model`, `Tool` and their exported configuration/request/result types.
- `SystemMessage`, `UserMessage`, `AssistantMessage`, `ToolMessage` and message types.
- `BeforeAgentHook`, `AfterAgentHook`, `BeforeModelHook`, `AfterModelHook`.
- The three providers above, provider contracts, and `ModelError`.

The initial 0.x API may change. Automated tests use mocked provider responses;
they do not establish live model API compatibility.

## Development and local packaging

```bash
pnpm install --frozen-lockfile
npm run check
npm run build
npm pack --dry-run
npm pack
```

`npm run check` runs type checking and offline tests. `npm pack` builds JavaScript
and declarations into `dist`, then creates a local `.tgz` archive. Only `dist`
and npm's standard package metadata/documentation files are published. Tests
and `.env` are excluded.

## License

ISC. See [LICENSE](./LICENSE).
