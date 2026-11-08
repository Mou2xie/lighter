# Lighter

![Lighter 橙黄火花 Logo 与深色品牌头图](./assets/readme-hero.svg)

[![npm 版本](https://img.shields.io/npm/v/@yong_xie/lighter?style=flat-square&logo=npm&logoColor=white&color=007EC6)](https://www.npmjs.com/package/@yong_xie/lighter)

[English](./README.md) · **简体中文**

**一个基于 TypeScript 的小型 AI agent  开发框架。**

Lighter 维护了一个精简但可靠的 agent 核心 loop，
Agent 负责在模型和你的代码之间循环：模型可以请求工具，Lighter 执行工具，然后模型继续。循环运行在你的 Node.js 进程里，对话历史由你的应用保存。

> **状态：** 当前为 alpha 版本，API 可能发生破坏性变化；仅支持 ESM。

## 开始之前

- Node.js 22+
- ESM 项目：把示例保存为 `.mjs`（示例使用了顶层 `await`），或在 `package.json` 中设置 `"type": "module"`
- 你的模型 provider 的 API key 和模型 ID。模型调用由该 provider 计费。

## 第一个 Agent

1. 在一个新目录里安装：

```sh
mkdir my-agent
cd my-agent
npm init -y
npm install @yong_xie/lighter
```

2. 在代码旁边创建 `.env` 文件。`OPENAI_MODEL_ID` 是你自己的变量名，值填写你的账号可用的模型 ID：

```ini
OPENAI_API_KEY=sk-...
OPENAI_MODEL_ID=your-model-id
```

不要把 `.env` 提交到版本库。

3. 创建 `hello.mjs`：

```js
import { Agent, Model, OpenAIProvider, UserMessage } from "@yong_xie/lighter";

// 1. 连接模型 provider。
const provider = new OpenAIProvider(
  process.env.OPENAI_API_KEY,
  process.env.OPENAI_MODEL_ID,
);

// 2. 把 provider 包装成 model。
const model = new Model(provider);

// 3. 用这个 model 创建 agent。
const agent = new Agent({ model });

const result = await agent.run({
  messages: [new UserMessage("给一家开在月球上的书店起个名字。")],
});

// 打印最后一条消息，也就是助手的回复。
console.log(result.messages.at(-1)?.content);
```

4. 运行：

```sh
node --env-file=.env hello.mjs
```

你应该会看到一句简短的回复，例如：

```text
月宫书店
```

`result.messages` 包含本轮生成的消息。示例为了简短省略了错误处理；真实代码里请先检查 `result.status`，再读取 `result.messages`。

### 这段代码做了什么？

- `OpenAIProvider` 负责和模型 API 通信：发送消息，读取回复。
- `Model` 把 provider 包装起来，让 Agent 用一个统一的对象调用模型，而不关心底层是哪家 provider。
- `Agent` 负责循环：调用模型，执行模型请求的工具，再调用模型，直到没有新的工具请求。

目前只需要这三个对象。第四个对象 `Tool` 在下一节。

## 添加一个工具

工具是可选的。如果你只需要一次模型回复，看完第一个示例就可以停下。

工具是允许模型调用的函数。你用 Zod schema 描述它的参数，模型请求时由 Lighter 执行。

在应用中安装 Zod：

```sh
npm install zod@4
```

把 import 加到 `hello.mjs` 顶部，其余代码放在模型设置之后：

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

`func` 的参数类型由 Zod schema 自动推导。执行前，`Tool` 会用 schema 校验模型传来的 JSON 参数。如果模型请求了不存在的工具、传了不合法的 JSON，或参数不符合 schema，错误会作为工具消息交回模型；`func` 抛错时也是一样。循环继续，模型可以修正调用。

成功返回值会经过 `JSON.stringify`，因此返回字符串 `hello` 时，模型收到的是带引号的 `"hello"`。工具按模型请求的顺序执行。

你应该会在打印出的数组里看到一条输出为 `42` 的工具消息，以及一条助手回复。

## 核心概念

Lighter 有四个对象，每个对象只做一件事。

| 对象 | 它是什么 | 你用它做什么 |
| --- | --- | --- |
| `Provider` | 某个模型 API 的适配器。 | 用 API key 和模型 ID 创建。 |
| `Model` | Agent 调用的模型。 | 把一个 provider 包装成 `Model`。 |
| `Tool` | 模型可以请求的函数。 | 给它名称、描述、Zod schema 和函数。 |
| `Agent` | 负责循环的对象。 | 给它 model 和 tools，调用 `run()` 或 `stream()`。 |

一次运行大致是这样：

```text
Agent
  ├─ 调用 Model → Provider → 模型 API
  ├─ 模型请求工具时，执行 Tool
  └─ 重复，直到模型不再请求工具
```

`Agent` 是唯一负责循环的对象。`Model`、`Tool` 和 `Provider` 每次调用都只做一件事。

`Agent` 接受 `model`、`tools`、`systemPrompt` 和 `hooks`，其中只有 `model` 是必填的。`systemPrompt` 是一个 `SystemMessage`；省略时，Lighter 使用 `You are a helpful assistant.` 作为默认提示词。

## 继续深入

下面的章节是可选的，按需阅读。

### 流式输出

用 `stream()` 代替 `run()`，在文本到达时逐步处理。下面的示例复用第一个示例中的 `agent`：

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

### 对话历史

历史记录由你的应用保存。下面的示例复用 `agent`：

```js
const conversation = [new UserMessage("给一家开在月球上的书店起个名字。")];

const first = await agent.run({ messages: conversation });
conversation.push(...first.messages);

conversation.push(new UserMessage("再给我三个选项。"));
const second = await agent.run({ messages: conversation });

console.log(second.messages.at(-1)?.content);
```

`result.messages` 只包含本轮生成的消息。`run()` 不会修改你传入的数组；返回的消息需要你手动追加。

每次运行都有独立的消息上下文，所以同一个 `Agent` 可以并发处理多个请求。

### 生命周期钩子

在 `new Agent({ model, hooks: { ... } })` 中传入钩子实例。下面的示例复用 `model`：

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

每个钩子都有 `hookName`、可选的 `description`，以及一个可以同步或异步执行的 `hookFunction`。

| 钩子 | 调用时机 | 接收的值 |
| --- | --- | --- |
| `BeforeAgentHook` | 每次运行开始时，调用一次 | `AgentRequest` |
| `BeforeModelHook` | 每次模型调用前，包括工具返回后的下一次调用 | `ModelRequest` |
| `AfterModelHook` | 收到完整的助手消息时 | `AssistantMessage` |
| `AfterAgentHook` | 循环成功结束后 | 本轮生成的 `BaseMessages` |

返回替换值可以改变请求、消息或结果；不返回值则保持原值。钩子适合用来做日志、脱敏、请求改写或防护。

替换或修改助手消息可能会丢失后续轮次使用的 provider 特定上下文。例如，OpenAI 的 reasoning item 和 Claude 的 thinking block 只有在消息未被修改时才能重放。如果你只是读取或记录消息，不会有这个问题。

### Provider 选项

`Model` 接受任何实现 `Provider` 接口的对象：`name`、`invoke` 和 `stream`。`invoke` 返回一条完整的 `AssistantMessage`；`stream` 产生 `reasoning_delta`、`text_delta`，最后产生一条 `message` 事件。

内置适配器位于 [`providers/`](./providers/)：

| Provider | 模型 API | 选项 |
| --- | --- | --- |
| `OpenAIProvider` | OpenAI Responses API | `reasoning`、`maxOutputTokens`；固定发送 `store: false` |
| `ClaudeProvider` | Anthropic Messages API | `maxOutputTokens`（默认 8192）、`thinking` |
| `DeepSeekProvider` | DeepSeek 的 OpenAI 兼容接口 | API key 和模型 ID |

每个适配器负责把共享消息类型转换成对应 API 的格式，再把响应转换回来，并把 SDK 错误归类为 `ModelError`。OpenAI 和 Claude 还会在消息未被修改时保留 provider 特定上下文，供后续轮次使用。

要接入其他服务，实现 `Provider` 并传给 `new Model(provider)`。接口定义见 [`providers/provider.ts`](./providers/provider.ts)。

## 错误与排查

### 跑不通时

- `ERR_REQUIRE_ESM` 或 `Cannot use import statement`：把文件保存为 `.mjs`，或在 `package.json` 中设置 `"type": "module"`。
- `401` 或 `auth_error`：检查 `OPENAI_API_KEY`。
- 模型不存在：检查 `OPENAI_MODEL_ID`。
- `result.status === "failed"`：读取 `result.error`。

### 错误码

运行失败时，`result.status` 是 `"failed"`，`result.error` 保存原因：

```ts
{ status: "failed"; messages: BaseMessages; error: unknown }
```

`error` 的类型是 `unknown`，而且可能为 `undefined`，使用前请先判断。Provider SDK 的错误会被归一化为带 `code` 的 `ModelError`：

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

Lighter 只负责循环，不包含：

- 对话持久化
- 最大模型轮数
- 超出 provider SDK 的请求取消或超时
- 自己的重试策略
- 追踪、指标或面板
- 工具代码沙箱
- 并行工具执行

如果模型持续请求工具，循环会继续运行；需要的话，请自己加轮数上限。提前停止流式消费可以阻止后续工具执行，但不会取消已经在运行的工具。

工具参数校验只检查格式，不代表权限。工具以你的应用权限运行，模型输出应当视为不可信输入。请在工具内部做权限检查，不要把模型输出直接交给 shell、数据库或文件系统。如果需要隔离，请把工具代码放在单独的进程或服务里运行。

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
