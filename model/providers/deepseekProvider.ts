import Openai from "openai";
import { APIKeyloader } from "../APIKeyloader.js";

export class DeepseekProvider {
    readonly name: string = "deepseek";
    readonly model: Openai;

    constructor() {
        const apiKey = APIKeyloader("deepseek");
        if (!apiKey) {
            throw new Error("Deepseek API key is not set.");
        }

        this.model = new Openai({
            baseURL: 'https://api.deepseek.com',
            apiKey,
        });
    }
}
