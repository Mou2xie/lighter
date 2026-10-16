import { loadEnvFile } from "node:process";
import Openai from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

// Load environment variables from a .env file
loadEnvFile();
const apiKey = process.env.DEEPSEEK_API_KEY;

const openai = new Openai({
    baseURL: 'https://api.deepseek.com',
    apiKey: apiKey,
});

class Model {
    constructor() { }
    stream(){}
}

