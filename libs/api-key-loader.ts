// Load api keys for specific providers from .env file
// Used for development and testing purposes.
import { loadEnvFile } from "node:process";
loadEnvFile();

type ModelProvider = "deepseek";

const modelKeyMap: Record<ModelProvider, string> = {
    deepseek: "DEEPSEEK_API_KEY",
}

export const loadApiKey = (modelProvider: ModelProvider): string => {
    const apiKey = process.env[modelKeyMap[modelProvider]];
    if (!apiKey) {
        throw new Error(`${modelProvider} API key is not set.`);
    }
    return apiKey;
}
