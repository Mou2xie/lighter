# Lighter

![Lighter 橙黄火花 Logo 与深色品牌头图](./assets/readme-hero.svg)

[![npm 版本](https://img.shields.io/npm/v/@yong_xie/lighter?style=flat-square&logo=npm&logoColor=white&color=007EC6)](https://www.npmjs.com/package/@yong_xie/lighter)

[English](./README.md) · **简体中文**

**一个面向 TypeScript 的小型 Agent 框架。**

Lighter 在你的 Node.js 进程里运行工具调用循环。你把 `Provider`、`Model`、`Tool`、`Agent` 四个对象组合起来，对话存储、UI 和基础设施仍由你的应用掌握。

> **状态：** 0.x，API 可能在小版本间变化；仅支持 ESM。

## 为什么选择 Lighter？

- **四个对象，各司其职。** `Provider` 负责和模型 API 对话，`Model` 绑定 provider 并应用模型调用钩子，`Tool` 负责校验和执行函数，`Agent` 负责循环。对象之间没有隐藏的编排层。
- **工具参数有类型。** Zod schema 让 `func` 直接获得 TypeScript 参数类型，并在执行前校验模型传来的参数。参数不合法会变成工具错误，模型可以据此修正。
- **流式输出和钩子，不是平台。** `stream()` 逐段输出文本和推理内容，最后给出一个完整结果；四个生命周期钩子覆盖整轮运行和每次模型调用。
- **没有隐藏的对话状态。** `run()` 只返回本轮生成的消息。每次运行都有独立上下文，同一个 `Agent` 可以并发处理多个请求。

Lighter 适合已经有地方存放状态、UI 和基础设施的应用。它不提供持久化、RAG、多 Agent 编排、追踪或沙箱。

## 核心概念

| 对象 | 只做一件事 | 它持有什么 |
| --- | --- | --- |
| `Provider` | 在 Lighter 的消息类型和某个模型 API 之间做转换。 | `name`、`invoke` 和 `stream`。 |
| `Model` | 通过 provider 发起一次模型调用。 | 一个 `Provider`，并应用收到的模型调用钩子。 |
| `Tool` | 描述并执行一个模型可以调用的函数。 | 名称、描述、Zod schema 和 `func`。 |
| `Agent` | 运行循环，直到模型不再请求工具。 | 模型、工具、system prompt、生命周期钩子，以及本轮的消息上下文。 |

一次运行的过程：

```text
system prompt + 输入消息
              │
              ▼
      Agent ─ Model ─ Provider ─ 模型 API
              │
              ▼
      AssistantMessage
        ├─ 没有工具调用 ──▶ 返回本轮生成的消息
        └─ 有工具调用 ───▶ 按顺序对每个调用执行 Tool.execute()
                                  │
                                  ▼
                              ToolMessage
                                  │
                                  └──▶ 下一次模型调用
```

只有 `Agent` 拥有循环。`Model` 只发起一次调用，`Tool` 只执行一个函数，`Provider` 只转换一次 API 请求。需要自己控制循环时，你也可以直接使用下面几层。

`Agent` 接受 `model`、`tools`、`systemPrompt` 和 `hooks`，其中只有 `model` 是必填的。`systemPrompt` 是一个 `SystemMessage`；省略时使用默认的助手提示词（`You are a helpful assistant.`）。Agent 不会修改你传入的数组：每次运行都会用 system prompt 和你的消息构造本地上下文，然后返回本轮生成的消息。

## 安装

需要 Node.js 22+（在 Node.js 22 上测试）和 ESM 项目（`"type": "module"` 或 `.mjs`）。包自带 TypeScript 类型声明。Lighter 仅支持 ESM，不能使用 `require()`。

```sh
npm install @yong_xie/lighter
```

导入包不会读取凭据，也不会发起请求。真实的模型调用使用你的 API key，并由对应 provider 计费。

## 快速开始

设置 `OPENAI_API_KEY` 和 `OPENAI_MODEL_ID`（填写你的账号可用的模型 ID），然后运行：

```js
import { Agent, Model, OpenAIProvider, UserMessage } from "@yong_xie/lighter";

const model = new Model(
  new OpenAIProvider(process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL_ID),
);
const agent = new Agent({ model });

const history = [new UserMessage("给一家开在月球上的书店起个名字。")];
const result = await agent.run({ messages: history });

history.push(...result.messages);
console.log(result.messages.at(-1)?.content);
```

`result` 是一个 `AgentResponse`：

```ts
{
  status: "completed" | "failed";
  messages: BaseMessages;
  error?: unknown;
}
```

`result.messages` 只包含本轮生成的助手消息和工具消息，不包含 system prompt，也不包含你传入的消息。要继续对话，把 `result.messages` 和一条新的 `UserMessage` 追加到历史记录，然后再次调用 `agent.run`。

## 工具调用

在应用中安装 Zod，然后定义一个工具。下面的示例复用快速开始中的 `model` 和 `UserMessage`：

```sh
npm install zod@4
```

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

console.log(answer.messages);
```

![一次工具调用示例：用户询问 19 + 23，模型请求调用 add(19, 23)，工具返回 42，助手据此回答 42](./assets/tool-roundtrip.svg)

上图展示了支持工具调用的模型的一种可能交互过程。

`func` 的参数类型由 Zod schema 自动推导，可以是同步函数，也可以是异步函数。执行前，`Agent` 会解析模型返回的 JSON 参数，`Tool` 再用 schema 校验。未知的工具名、不合法的 JSON、不符合 schema 的参数以及 `func` 抛出的错误，都会变成 `isError: true` 的错误 `ToolMessage`；循环继续，模型可以据此修正调用。

工具按模型请求的顺序串行执行，每条结果都带有模型给出的调用 ID。返回值需要可以被 JSON 序列化；成功结果会经过 `JSON.stringify`，因此返回字符串 `hello` 时，模型收到的是带引号的 `"hello"`。

## 流式输出

用 `stream()` 代替 `run()`，在结果到达时逐步处理。下面的示例复用快速开始中的 `agent`：

```js
for await (const event of agent.stream({ messages: [new UserMessage("你好！")] })) {
  if ("status" in event) {
    console.log(event.status, event.messages);
  } else if (event.type === "text_delta") {
    process.stdout.write(event.text);
  }
}
```

`stream()` 会产生 `text_delta`；如果 provider 支持，还会产生 `reasoning_delta`。最后产生一个完整的 `AgentResponse`。完整的助手消息和工具消息都在这个最终结果里，不在增量事件里。工具调用在循环内部执行，不会作为单独事件流式输出。

推理片段取决于 provider 和模型设置；需要时请开启对应的 reasoning 或 thinking 选项。

## 对话历史

`Agent` 保存的是配置，不是对话状态。历史记录由你的应用保管。下面的示例复用 `agent`：

```js
const conversation = [new UserMessage("给一家开在月球上的书店起个名字。")];

const first = await agent.run({ messages: conversation });
conversation.push(...first.messages);

conversation.push(new UserMessage("再给我三个选项。"));
const second = await agent.run({ messages: conversation });
```

`run()` 不会修改你传入的数组。返回的消息需要你手动追加，历史记录存在哪里、何时裁剪或持久化，也都由你的应用决定。

每次运行都有独立的消息上下文，所以同一个 `Agent` 可以并发处理多个请求。

## 生命周期钩子

在 `new Agent({ model, hooks: { ... } })` 中传入钩子实例。每个钩子都有 `hookName`、可选的 `description`，以及一个可以同步或异步执行的 `hookFunction`。下面的示例复用 `model`：

```js
import { BeforeModelHook } from "@yong_xie/lighter";

const logModelRequest = new BeforeModelHook({
  hookName: "log-model-request",
  hookFunction: (request) => {
    console.log(request.messages.length, "messages");
    // 不返回值 = 保持原请求
  },
});

const loggedAgent = new Agent({
  model,
  hooks: { beforeModel: logModelRequest },
});
```

| 钩子 | 调用时机 | 接收的值 |
| --- | --- | --- |
| `BeforeAgentHook` | 每次运行开始时，调用一次 | `AgentRequest` |
| `BeforeModelHook` | 每次模型调用前，包括工具返回后的下一次调用 | `ModelRequest` |
| `AfterModelHook` | 收到完整的助手消息时 | `AssistantMessage` |
| `AfterAgentHook` | 循环成功结束后 | 本轮生成的 `BaseMessages` |

返回替换值可以改变请求、消息或结果；不返回值则保持原值。钩子适合用来做日志、脱敏、请求改写或防护。

替换或修改助手消息可能会丢失 provider 的原生上下文重放（在 provider 支持的情况下）。OpenAI 的 reasoning item 和 Claude 的 signed thinking block 只有在消息未被修改时才能重放；替换后，下一次请求会从公开字段重建。

## Provider

`Model` 接受任何实现 `Provider` 接口的对象：`name`、`invoke` 和 `stream`。`invoke` 返回一条完整的 `AssistantMessage`；`stream` 产生 `reasoning_delta`、`text_delta`，最后产生一条 `message` 事件。内置适配器位于 [`providers/`](./providers/)：

| Provider | 模型 API | 选项 |
| --- | --- | --- |
| `OpenAIProvider` | OpenAI Responses API | `reasoning`、`maxOutputTokens`；固定发送 `store: false` |
| `ClaudeProvider` | Anthropic Messages API | `maxOutputTokens`（默认 8192）、`thinking` |
| `DeepSeekProvider` | DeepSeek 的 OpenAI 兼容接口 | API key 和模型 ID |

每个适配器负责把共享消息类型转换成对应 API 的格式，再把响应转换回来，并把 SDK 错误归类为 `ModelError`。OpenAI 和 Claude 还会在消息未被修改时保留原生推理或工具上下文，供后续轮次重放。

要接入其他服务，实现 `Provider` 并传给 `new Model(provider)`。接口定义见 [`providers/provider.ts`](./providers/provider.ts)。

## 错误处理

模型或 provider 失败时，`Agent` 会返回失败的 `AgentResponse`，其中包含本轮已经生成的消息：

```ts
{ status: "failed"; messages: BaseMessages; error: unknown }
```

`error` 的类型是 `unknown`，而且可能为 `undefined`，抛出前请先判断。Provider SDK 的错误会被归一化为带 `code` 的 `ModelError`：

| Code | 含义 |
| --- | --- |
| `auth_error` | 认证或权限失败 |
| `rate_limit` | 触发 provider 限流 |
| `invalid_request` | 发给 provider 的请求不合法 |
| `network_error` | 网络连接失败 |
| `server_error` | Provider 服务端失败 |
| `bad_response` | 响应不完整、失败或无法解析 |
| `aborted` | 请求被取消 |
| `unknown` | 未分类的失败 |

`ModelError` 还提供 `httpStatus`（HTTP 错误状态码）和 `responseStatus`（如 `failed`、`incomplete` 等生成状态）。

## 边界与安全

Lighter 刻意保持小。它不包含：

- 对话持久化
- 最大模型轮数
- 超出 provider SDK 的请求取消或超时
- 自己的重试策略
- 追踪、指标或面板
- 工具代码沙箱
- 并行工具执行

如果模型持续请求工具，循环会继续运行；需要的话，请自己加轮数上限。提前停止流式消费可以阻止后续工具执行，但不会取消已经在运行的工具。

工具参数校验只检查形状，不代表授权。工具以你的应用权限运行，模型输出应当视为不可信输入。请在工具内部做权限检查，不要把模型输出直接交给 shell、数据库或文件系统。如果需要隔离，请把工具代码放在单独的进程或服务里运行。

## API 一览

包导出：

- `Agent`、`Model`、`Tool`，以及它们的配置、请求和结果类型
- `SystemMessage`、`UserMessage`、`AssistantMessage`、`ToolMessage` 和 `BaseMessages`
- `BeforeAgentHook`、`AfterAgentHook`、`BeforeModelHook`、`AfterModelHook`
- `Provider`、`OpenAIProvider`、`ClaudeProvider`、`DeepSeekProvider`
- `ModelError` 和 `ModelErrorCode`

源码入口是 [`index.ts`](./index.ts)。类型声明随包发布。

## 本地开发

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm pack --dry-run
```

`pnpm check` 会执行 TypeScript 类型检查和离线测试。测试使用模拟 HTTP，不会访问真实模型 API，也不构成真实兼容性验证。覆盖范围和当前限制见[测试指南](./test/README.md)。

## 许可证

ISC。见 [LICENSE](./LICENSE)。

[GitHub](https://github.com/Mou2xie/lighter) · [Issues](https://github.com/Mou2xie/lighter/issues) · [npm](https://www.npmjs.com/package/@yong_xie/lighter)
