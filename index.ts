import { loadApiKey } from "./libs/api-key-loader.js";
import { DeepSeekProvider } from "./model/providers/deepseek-provider.js";
import { Model } from "./model/model.js";
import { Agent } from "./agent-loop/agent.js";
import { Tool, UserMessage } from "./core/protocol.js";


// get deepseek api key from environment variable, this is just for development convenience.
const apiKey = loadApiKey("deepseek");
// create deepseek provider, set modelID to "deepseek-flash".
const deepseekProvider = new DeepSeekProvider(apiKey, "deepseek-flash");
// create model with deepseek provider.
const model = new Model(deepseekProvider);

const additionTool = new Tool({
    name: "addition",
    description: "Adds two numbers together.",
    parameters: {
        type: "object",
        a: { type: "number" },
        b: { type: "number" },
        required: ["a", "b"],
    },
    func: (args) => {
        console.log(`Tool 'addition' called with arguments: ${JSON.stringify(args)}`);
        return args.a + args.b;
    }
});
// create agent with model.
const agent = new Agent({
    model,
    tools: [additionTool],
});


const userMessage = new UserMessage("What is the result of 2 + 7?");
const response = await agent.run(userMessage);

console.dir(response);
