import { Model } from "./model/Model.js";
import { DeepseekProvider } from "./model/providers/DeepseekProvider.js";
import { APIKeyloader } from "./model/APIKeyloader.js";
import type { BaseMessages } from "./model/modelTypes/BaseMessage.js";
import { SystemMessage, UserMessage, } from "./model/modelTypes/BaseMessage.js";

const apiKey = APIKeyloader("deepseek");

const provider = new DeepseekProvider(apiKey, "deepseek-flash");

const model = new Model(provider);

const baseMessages: BaseMessages = [
    new SystemMessage("You are a helpful assistant."),
    new UserMessage("What is the capital of France?"),
];

const response = await model.invoke(baseMessages);

process.stdout.write(`Assistant: ${response.content}\n`);