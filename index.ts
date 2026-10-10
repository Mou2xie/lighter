console.log("Hello, World!");

import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { loadEnvFile } from "node:process";
import Openai from "openai";

loadEnvFile();

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not set.");
}

const openai = new Openai({
    baseURL: 'https://api.deepseek.com',
    apiKey: apiKey,
});

type DeepSeekChatParams = ChatCompletionCreateParamsNonStreaming & {
  thinking: { type: "enabled" | "disabled" };
};

const request = {
    messages: [{ role: "system", content: "You are a helpful assistant." }],
    model: "deepseek-flash",
    thinking: { "type": "enabled" },
    reasoning_effort: "low",
    stream: false,
} as DeepSeekChatParams;

const response = await openai.chat.completions.create(request);

console.log("Model:", response.choices[0].message?.content);