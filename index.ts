import { loadEnvFile } from "node:process";
import Openai from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

// Load environment variables from a .env file
loadEnvFile();
const apiKey = process.env.DEEPSEEK_API_KEY;

if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not set.");
}

const openai = new Openai({
    baseURL: 'https://api.deepseek.com',
    apiKey: apiKey,
});

const systemPrompt = "You are a helpful assistant.";

const messages: ChatCompletionMessageParam[] = [{ role: "system", content: systemPrompt }];

messages.push({ role: "user", content: "Hello, how are you?" });

const response = await openai.chat.completions.create({
    messages,
    model: "deepseek-flash",
    reasoning_effort: "low",
    stream: false,
});

// console.log("Model:", response.choices[0].message?.content);
process.stdout.write(response.choices[0].message?.content ?? "Model no response.");