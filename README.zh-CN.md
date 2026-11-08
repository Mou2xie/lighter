# Lighter

![Lighter 橙黄火花 Logo 与深色品牌头图](./assets/readme-hero.svg)

[English](./README.md) · **简体中文**

Lighter 是一个 TypeScript 智能体框架，让模型能在对话中调用你的 JavaScript 函数。给 Agent 配好模型、传入消息，再按需注册工具。模型请求调用工具时，Lighter 会执行函数，把结果交回模型，直到模型给出无需再调用工具的回复。

## 为什么选择 Lighter？

- **轻量。** Agent 循环直接在你的 Node.js 进程里运行。框架只有三个直接运行时依赖，分别是 OpenAI SDK、Anthropic SDK 和 Zod。对话记录由应用自行保存。
- **简单。** 同一个 Agent 可以用 `run({ messages })` 获取完整结果，也可以用 `stream({ messages })` 逐段读取输出。为函数加上名称、描述和 Zod 参数定义，即可把它注册为工具。
- **高可靠。** Lighter 会在执行工具前校验参数。参数不合法或函数抛错时，模型会收到对应的错误消息，有机会修正调用。如果流在完整消息到达前中断，Agent 会返回失败状态，并保留本轮已经生成的完整消息。
- **可定制。** 内置 `OpenAIProvider`、`ClaudeProvider` 和 `DeepSeekProvider`。要接入其他服务，可按 [Provider 接口](./providers/provider.ts) 提供名称、`invoke` 和 `stream` 方法。还可以通过 `SystemMessage` 设置 `systemPrompt`、注册业务工具，或在运行和模型调用前后插入钩子。

## 快速开始

在 Node.js 项目中安装 Lighter。包采用 ESM，附带 TypeScript 类型声明。以下示例使用 Node.js 22.23.3。

```sh
npm install @yong_xie/lighter
```

在环境变量中设置 `OPENAI_API_KEY` 和 `OPENAI_MODEL_ID`，模型 ID 请填写你的账号可用的值。将下面的代码保存为 `hello.mjs`，执行 `node hello.mjs` 即可发起一次 OpenAI API 调用。

```js
import { Agent, Model, OpenAIProvider, UserMessage } from "@yong_xie/lighter";

const { OPENAI_API_KEY, OPENAI_MODEL_ID } = process.env;
if (!OPENAI_API_KEY || !OPENAI_MODEL_ID) {
  throw new Error("Set OPENAI_API_KEY and OPENAI_MODEL_ID");
}

const model = new Model(new OpenAIProvider(OPENAI_API_KEY, OPENAI_MODEL_ID));
const agent = new Agent({ model });
const history = [new UserMessage("给一家开在月球上的书店起个名字。")];
const result = await agent.run({ messages: history });

if (result.status === "failed") throw result.error;
history.push(...result.messages);
console.log(result.messages.at(-1)?.content);
```

`result.messages` 只包含本轮新生成的消息。示例已把它们追加到 `history`；要继续对话，再追加一条 `UserMessage`，然后把 `history` 传给 `agent.run` 即可。

## 演示 · 让模型调用一个函数

![一次工具调用示例：用户询问 19 + 23，模型请求调用 add(19, 23)，工具返回 42，助手据此回答 42](./assets/tool-roundtrip.svg)

先运行 `npm install zod@4`，再把下面的代码追加到 `hello.mjs`，复用前面创建的 `model`。选用支持工具调用的模型时，上图展示了这次计算的一种可能过程。

```js
import { Tool } from "@yong_xie/lighter";
import * as z from "zod";

const add = new Tool({
  name: "add",
  description: "返回两个数的和。",
  parametersZodSchema: z.strictObject({ a: z.number(), b: z.number() }),
  func: ({ a, b }) => a + b,
});

const calculator = new Agent({ model, tools: [add] });
const answer = await calculator.run({
  messages: [new UserMessage("请用 add 工具计算 19 + 23。")],
});
if (answer.status === "failed") throw answer.error;
for (const message of answer.messages) {
  if (message.role === "tool") console.log(message.toolName, message.toolOutput);
  if (message.role === "assistant" && message.content) console.log(message.content);
}
```

如果模型一次请求调用多个工具，Lighter 会按请求顺序逐个执行。每条工具结果都带有对应的调用 ID，模型在下一步就能区分各次调用的结果。

## 流式读取回复

复用快速开始中的 `agent`，收到文本片段就打印，并在最后检查本轮运行的状态。

```js
for await (const event of agent.stream({ messages: [new UserMessage("你好！")] })) {
  if ("status" in event) {
    if (event.status === "failed") throw event.error;
  } else if (event.type === "text_delta") {
    process.stdout.write(event.text);
  }
}
```

部分模型还会产生 `reasoning_delta` 推理片段。要保存流式对话，可将最终结果里的 `messages` 追加到历史记录，其中包含完整的助手消息和工具结果。

## 生命周期钩子

通过 `new Agent({ model, hooks: { … } })` 注册钩子。每个钩子都支持同步或异步回调。如果回调返回替换值，下一步就会使用这个新值。

| 钩子 | 调用时机 | 回调接收的值 |
| --- | --- | --- |
| `BeforeAgentHook` | 每次运行开始时 | 本次 Agent 请求 |
| `BeforeModelHook` | 每次请求模型前，包括工具返回后的下一次请求 | 消息和可选工具定义组成的模型请求 |
| `AfterModelHook` | 收到完整模型消息时 | 助手消息，含模型请求的工具调用 |
| `AfterAgentHook` | Agent 循环成功结束后 | 本轮生成的消息数组 |

## 本地开发

```sh
pnpm install --frozen-lockfile
npm run check
npm run build
```

`npm run check` 会执行类型检查和离线测试。Provider 测试使用模拟 HTTP 响应，覆盖 SDK 请求编码、流式响应解析和错误处理。具体用例见[测试指南](./test/README.md)。如需生成可本地安装的压缩包，运行 `npm pack`。

项目采用 [ISC 许可证](./LICENSE)。
