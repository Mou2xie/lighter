import { DeepSeekProvider } from "./model/providers/deepseek-provider.js";
import { MockProvider } from "./model/providers/mock-provider.js";
import { Model } from "./model/model.js";
import { Agent } from "./agent/agent.js";
import { Tool, UserMessage, AssistantMessage } from "./core/protocol.js";
import * as z from "zod";


const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
    throw new Error("Please set the DEEPSEEK_API_KEY.");
}
const deepseekProvider = new DeepSeekProvider(apiKey, "deepseek-flash");
const model = new Model(deepseekProvider);

// const mockProvider = new MockProvider([
//     new AssistantMessage("I need to run a tool.", { toolCalls: [{ callId: "1", toolName: "addition", arguments: JSON.stringify({ a: 1, b: 2 }) }] }),
//     new AssistantMessage("The result is 3.", { toolCalls: [] })
// ]);
// const model = new Model(mockProvider);


// create a simple addition tool.
const additionTool = new Tool({
    name: "addition",
    description: "Adds two numbers together.",
    parameters: z.strictObject({
        a: z.number().describe("The first number to add."),
        b: z.number().describe("The second number to add."),
    }),
    func: (args) => {
        console.log(`Tool 'addition' called with arguments: ${JSON.stringify(args)}`);
        return args.a + args.b;
    }
});
// create agent with model and addition tool.
const agent = new Agent({
    model,
    tools: [additionTool],
});


const userMessage = new UserMessage("What is the result of 31 + 17?");
const response = await agent.run(userMessage);

console.dir(response);
