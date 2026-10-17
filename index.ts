import {APIKeyloader} from "./model/APIKeyloader.js";
import {DeepseekProvider} from "./model/providers/DeepseekProvider.js";
import {Model} from "./model/Model.js";

const deepseek = new DeepseekProvider(APIKeyloader("deepseek"));
const model = new Model({
    provider: deepseek.provider,
    modelID: "deepseek-flash"
});

const input = "What is the capital of France?";

const response = await model.invoke(input);

process.stdout.write(`Response: ${response}\n`);