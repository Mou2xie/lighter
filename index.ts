import {DeepseekProvider} from "./model/providers/deepseekProvider.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const deepseek = new DeepseekProvider();

const systemPrompt = "You are a helpful assistant.";

const messages: ChatCompletionMessageParam[] = [{ role: "system", content: systemPrompt }];

messages.push({ role: "user", content: "Hello, how are you?" });

const response = await deepseek.deepseek.chat.completions.create({
    messages,
    model: "deepseek-flash",
    reasoning_effort: "low",
    stream: false,
});

// console.log("Model:", response.choices[0].message?.content);
process.stdout.write(response.choices[0].message?.content ?? "Model no response.");