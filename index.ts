// import { DeepSeekProvider } from "./model/providers/deepseek-provider.js";
import { MockProvider } from "./model/providers/mock-provider.js";
import { Model } from "./model/model.js";
import { Agent } from "./agent/agent.js";
import { Tool, UserMessage, AssistantMessage } from "./core/protocol.js";


// const apiKey = process.env.DEEPSEEK_API_KEY;
// if (!apiKey) {
//     throw new Error("Please set the DEEPSEEK_API_KEY.");
// }
// const deepseekProvider = new DeepSeekProvider(apiKey, "deepseek-flash");

const mockProvider = new MockProvider([
    new AssistantMessage("This is a mock response.", { toolCalls: [] }),
    new AssistantMessage("This is another mock response.", { toolCalls: [] })
]);
const model = new Model(mockProvider);

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
