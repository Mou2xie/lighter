import { DeepSeekProvider } from "./model/providers/deepseek-provider.js";
import { Model } from "./model/model.js";
import { Agent } from "./agent/agent.js";
import { UserMessage, SystemMessage, type BaseMessages, AssistantMessage } from "./core/messages.js";
import { Tool } from "./core/tool.js";
import * as z from "zod";

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
    throw new Error("Please set the DEEPSEEK_API_KEY.");
}
const deepseekProvider = new DeepSeekProvider(apiKey, "deepseek-flash");
const model = new Model(deepseekProvider);

// create a simple addition tool.
const additionTool = new Tool({
    name: "addition",
    description: "Adds two numbers together.",
    parametersZodSchema: z.strictObject({
        a: z.number().describe("The first number to add."),
        b: z.number().describe("The second number to add."),
    }),
    func: (args) => {
        return args.a + args.b;
    }
});

// create agent with model and addition tool.
const agent = new Agent({
    model,
    tools: [additionTool],
    systemPrompt: new SystemMessage(`
        You are a primary school math teacher. You are very good at explaining math problems to students in a simple and easy-to-understand way.
        `)
});

const chatMessages: BaseMessages = [
    new UserMessage("What is 2 + 3?"),
];

const { status, messages, error } = await agent.run(chatMessages);
chatMessages.push(...messages);

if (status === "completed") {
    console.log("Agent run completed successfully. Messages:");
} else {
    console.error("Agent run failed with error:", error);
}

const lastMessage = chatMessages.at(-1);
if (lastMessage instanceof AssistantMessage) {
    console.log(lastMessage.content);
}


