import type { DeepSeek } from "./providers/DeepseekProvider.js";
import Openai from "openai";

interface modelConfig {
    provider: DeepSeek | Openai;
    modelID?: string;
    systemPrompt?: string;
}

export class Model {
    provider: DeepSeek | Openai;
    modelID: string;
    systemPrompt?: string;

    constructor(config: modelConfig) {
        this.provider = config.provider;
        this.modelID = config.modelID ?? "deepseek-flash";
        this.systemPrompt = config.systemPrompt ?? "You are a helpful assistant.";
    }

    async invoke(input: string) {
        const response = await this.provider.responses.create({
            model: this.modelID,
            instructions: this.systemPrompt,
            input,
        });
        return response;
    }

    stream() { }
}
