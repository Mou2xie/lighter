import Openai from "openai";
import { APIKeyloader } from "../APIKeyloader.js";

export class DeepseekProvider {
    readonly deepseek: any;
    constructor() {
        try {
            const { apiKey } = APIKeyloader("deepseek");
            this.deepseek = new Openai({
                baseURL: 'https://api.deepseek.com',
                apiKey,
            });
        }
        catch (error) {
            throw new Error(`Failed to initialize DeepseekProvider: ${error}`);
        }
    }
}