import { DeepSeekProvider } from "./model/providers/deepseek-provider.js";
import { Model } from "./model/model.js";
import { AgentLoop } from "./agent-loop/agent-loop.js";
import { Tool, UserMessage, SystemMessage, type BaseMessages } from "./core/protocol.js";
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
const agentLoop = new AgentLoop({
    model,
    tools: [additionTool],
    systemPrompt: new SystemMessage(`
        You are a primary school math teacher. You are very good at explaining math problems to students in a simple and easy-to-understand way.
        `)
});

const session: {
    sessionID: string;
    conversationHistory: BaseMessages;
} = {
    sessionID: "session-1",
    conversationHistory: [],
};

const userMessage = new UserMessage("What is 14+24? Please explain the steps to solve it.");

session.conversationHistory.push(userMessage);

const agentLoopResult = await agentLoop.runLoop(session.conversationHistory);

session.conversationHistory.push(...agentLoopResult.addedMessages);

if (agentLoopResult.status === "completed") {
    console.log("Agent loop completed successfully.");
} else {
    console.error("Agent loop failed:", agentLoopResult.error);
}



