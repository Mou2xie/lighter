import type { ModelRequest } from "../model/model.js";

interface Hook {
    readonly hookName: string;
    readonly description?: string;

    execute(modelRequest: ModelRequest): Promise<ModelRequest>
}

type BeforeModelHookFunction = (
    request: ModelRequest,
) => ModelRequest | void | Promise<ModelRequest | void>;



interface BeforeModelHookConfig {
    hookName: string;
    description?: string;
    hookFunction: BeforeModelHookFunction;
}

export class BeforeModelHook implements Hook {
    readonly hookName: string;
    readonly description?: string;
    private readonly hookFunction: BeforeModelHookFunction;

    constructor(config: BeforeModelHookConfig) {
        this.hookName = config.hookName;
        this.description = config.description;
        this.hookFunction = config.hookFunction;
    }

    async execute(modelRequest: ModelRequest): Promise<ModelRequest> {
        const response = await this.hookFunction(modelRequest);
        return response ?? modelRequest;
    }
}