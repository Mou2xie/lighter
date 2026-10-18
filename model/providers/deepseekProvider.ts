import type { BaseProvider } from "./BaseProvider.js";
import Openai from "openai";

export class DeepseekProvider implements BaseProvider {
    readonly name: string = "deepseek";
    readonly provider: Openai;

    constructor(apiKey: string) {
        this.provider = new Openai({
            baseURL: 'https://api.deepseek.com',
            apiKey,
        });
    }
}
