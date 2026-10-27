import { DeepSeekProvider } from "./model/providers/deepseek-provider.js";
import { Model } from "./model/model.js";
import { Agent } from "./agent/agent.js";
import { Tool, UserMessage } from "./core/protocol.js";
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
