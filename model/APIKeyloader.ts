// Load api keys for specific providers from .env file
import { loadEnvFile } from "node:process";
loadEnvFile();

type ModelProvider = "deepseek";

const modelKeyMap: Record<ModelProvider, string> = {
    deepseek: "DEEPSEEK_API_KEY",
}

export const APIKeyloader = (modelProvider: ModelProvider): string | undefined => {
    return process.env[modelKeyMap[modelProvider]];
}