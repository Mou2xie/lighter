import { loadEnvFile } from "node:process";

// Load environment variables from a .env file
loadEnvFile();

type Provider = "deepseek";

export function APIKeyloader(provider: Provider): { apiKey: string | undefined } {
    switch (provider) {
        case "deepseek":
            return {
                apiKey: process.env.DEEPSEEK_API_KEY
            };
        default:
            throw new Error(`Unsupported provider: ${provider}`);
    }
}