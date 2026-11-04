import type { ModelRequest } from "../model/model.js";
import { AssistantMessage } from "../core/messages.js";
import { AgentRequest } from "../agent/agent.js";
import { AgentResponse } from "../agent/agent.js";
import { BaseMessages } from "../core/messages.js";

// BeforeModelHook
// --------------------------------------------------------------------------
type BeforeModelHookFunction = (
    modelRequest: ModelRequest,
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
        const newModelRequest = await this.hookFunction(modelRequest);
        return newModelRequest ?? modelRequest;
    }
}

// AfterModelHook
// --------------------------------------------------------------------------
type AfterModelHookFunction = (
    assistantMessage: AssistantMessage
) => AssistantMessage | void | Promise<AssistantMessage | void>;

export class AfterModelHook {
    readonly hookName: string;
    readonly description?: string;
    private readonly hookFunction: AfterModelHookFunction;

    constructor(config: { hookName: string; description?: string; hookFunction: AfterModelHookFunction }) {
        this.hookName = config.hookName;
        this.description = config.description;
        this.hookFunction = config.hookFunction;
    }

    async execute(assistantMessage: AssistantMessage): Promise<AssistantMessage> {
        const newAssistantMessage = await this.hookFunction(assistantMessage);
        return newAssistantMessage ?? assistantMessage;
    }
}

// BeforeAgentHook
// --------------------------------------------------------------------------
type BeforeAgentHookFunction = (
    agentRequest: AgentRequest
) => Promise<AgentRequest | void> | AgentRequest | void;

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

// AfterAgentHook
// --------------------------------------------------------------------------
type AfterAgentHookFunction = (
    messages: BaseMessages
) => Promise<BaseMessages | void> | BaseMessages | void;

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

    async execute(messages: BaseMessages): Promise<BaseMessages> {
        const newMessages = await this.hookFunction(messages);
        return newMessages ?? messages;
    }
}


