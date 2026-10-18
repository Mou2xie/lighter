import type { DeepSeek } from "./providers/DeepseekProvider.js";
import Openai from "openai";
import { SystemMessage, AIMessage, Messages } from "./types/Message.js";

interface modelConfig {
    provider: DeepSeek | Openai;
    modelID?: string;
    systemPrompt?: string | SystemMessage;
}

export class Model {
    provider: DeepSeek | Openai;
    modelID: string;
    instructions: string;

    constructor(config: modelConfig) {
        this.provider = config.provider;
        this.modelID = config.modelID ?? "deepseek-flash";
        this.instructions = (typeof config.systemPrompt === "string" ? config.systemPrompt : config.systemPrompt?.content) ?? "You are a helpful assistant.";
    }

    async invoke(input: string) {
        const response = await this.provider.responses.create({
            model: this.modelID,
            instructions: this.instructions,
            input,
        });
        return new AIMessage(response.output_text);
    }
}
