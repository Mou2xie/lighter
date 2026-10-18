import { APIKeyloader } from "./model/APIKeyloader.js";
import { DeepseekProvider } from "./model/providers/DeepseekProvider.js";
import { Model } from "./model/Model.js";
import { SystemMessage } from "./model/types/Message.js";

const deepseek = new DeepseekProvider(APIKeyloader("deepseek"));
const model = new Model({
    provider: deepseek.provider,
    modelID: "deepseek-flash",
    systemPrompt: new SystemMessage("You are a helpful assistant."),
});;

const response = await model.invoke("What is the capital of China?");

console.dir(response, { depth: null });