import { DeepSeekProvider } from "./model/providers/deepseek-provider.js";
import { Model } from "./model/model.js";
import { Agent } from "./agent-loop/agent.js";
import { Tool, UserMessage } from "./core/protocol.js";

// Load DEEPSEEK_API_KEY from environment variable.
const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
    throw new Error("Please set the DEEPSEEK_API_KEY.");
}
// create deepseek provider, set modelID to "deepseek-flash".
const deepseekProvider = new DeepSeekProvider(apiKey, "deepseek-flash");
// create model with deepseek provider.
const model = new Model(deepseekProvider);

// create a simple addition tool.
const additionTool = new Tool({
    name: "addition",
    description: "Adds two numbers together.",
    parameters: {
        type: "object",
        properties: { a: { type: "number" }, b: { type: "number" } },
        required: ["a", "b"],
        additionalProperties: false,
    },
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


const userMessage = new UserMessage("What is the result of 11 + 7?");
const response = await agent.run(userMessage);

console.dir(response);
