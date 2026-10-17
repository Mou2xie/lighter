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
        this.systemPrompt = config.systemPrompt;
    }

    async invoke(input: string): Promise<string> {
        const response = await this.provider.responses.create({
            model: this.modelID,
            instructions: this.systemPrompt ?? "You are a helpful assistant.",
            input,
        });
        return response.output_text;

    }

    stream() { }
}
