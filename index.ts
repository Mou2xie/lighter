import { APIKeyloader } from "./model/APIKeyloader.js";
import { DeepseekProvider } from "./model/providers/DeepseekProvider.js";
import { Model } from "./model/Model.js";
import { Agent } from "./agent-loop/Agent.js";
import { Tool } from "./agent-loop/Tool.js";
import type { AssistantMessage } from "./model/types/BaseMessage.js";
import { UserMessage } from "./model/types/BaseMessage.js";

// get deepseek api key from environment variable, this is just for development convenience.
const apiKey = APIKeyloader("deepseek");
// create deepseek provider, set modelID to "deepseek-flash".
const deepseekProvider = new DeepseekProvider(apiKey, "deepseek-flash");
// create model with deepseek provider.
const model = new Model(deepseekProvider);

const additionTool = new Tool({
    name: "addition",
    description: "Adds two numbers together.",
    parameterSchema: {
        a: { type: "number" },
        b: { type: "number" }
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


const userMessage = new UserMessage("What is the result of 2 + 2?");
const response = await agent.run(userMessage);

const lastMessage = response.at(-1) as AssistantMessage;

process.stdout.write(lastMessage.content);