import Openai from "openai";

export type DeepSeek = Openai;

export class DeepseekProvider {
    readonly name: string = "deepseek";
    readonly provider: DeepSeek;

    constructor(apiKey: string) {
        this.provider = new Openai({
            baseURL: 'https://api.deepseek.com',
            apiKey,
        });
    }
}
