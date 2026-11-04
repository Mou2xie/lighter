import type { ModelRequest } from "../model/model.js";
import { AssistantMessage } from "../core/messages.js";
import { AgentRequest } from "../agent/agent.js";
import { AgentResult } from "../agent/agent.js";
import { BaseMessages } from "../core/messages.js";

type BeforeModelHookFunction = (
    request: ModelRequest,
) => ModelRequest | void | Promise<ModelRequest | void>;

export class BeforeModelHook {
    readonly hookName: string;
    readonly description?: string;
    private readonly hookFunction: BeforeModelHookFunction;

    constructor(config: {
        hookName: string;
        description?: string;
        hookFunction: BeforeModelHookFunction;
    }) {
        this.hookName = config.hookName;
        this.description = config.description;
        this.hookFunction = config.hookFunction;
    }

    async execute(modelRequest: ModelRequest): Promise<ModelRequest> {
        const response = await this.hookFunction(modelRequest);
        return response ?? modelRequest;
    }
}

type AfterModelHookFunction = (message: AssistantMessage) => AssistantMessage | void | Promise<AssistantMessage | void>;

export class AfterModelHook {
    readonly hookName: string;
    readonly description?: string;
    private readonly hookFunction: AfterModelHookFunction;

    constructor(config: { hookName: string; description?: string; hookFunction: AfterModelHookFunction }) {
        this.hookName = config.hookName;
        this.description = config.description;
        this.hookFunction = config.hookFunction;
    }

    async execute(message: AssistantMessage): Promise<AssistantMessage> {
        const response = await this.hookFunction(message);
        return response ?? message;
    }
}

type BeforeAgentHookFunction = (agentRequest: AgentRequest) => Promise<AgentRequest | void> | AgentRequest | void;

export class BeforeAgentHook {
    readonly hookName: string;
    readonly description?: string;
    private readonly hookFunction: BeforeAgentHookFunction;

    constructor(config: {
        hookName: string;
        description?: string;
        hookFunction: BeforeAgentHookFunction;
    }) {
        this.hookName = config.hookName;
        this.description = config.description;
        this.hookFunction = config.hookFunction;
    }

    async execute(agentRequest: AgentRequest): Promise<AgentRequest> {
        const response = await this.hookFunction(agentRequest);
        return response ?? agentRequest;
    }
}

type AfterAgentHookFunction = (messages: BaseMessages) => Promise<AgentResult | void> | AgentResult | void;

export class AfterAgentHook {
    readonly hookName: string;
    readonly description?: string;
    private readonly hookFunction: AfterAgentHookFunction

    constructor(config: {
        hookName: string;
        description?: string;
        hookFunction: AfterAgentHookFunction
    }) {
        this.hookName = config.hookName;
        this.description = config.description;
        this.hookFunction = config.hookFunction;
    }

    async execute(messages: BaseMessages): Promise<AgentResult> {
        const response = await this.hookFunction(messages);
        return response ?? { status: "completed", messages };
    }
}


