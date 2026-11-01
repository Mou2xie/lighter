
export class SystemMessage {
    readonly role = "system" as const;
    constructor(readonly content: string) { }
}

export class UserMessage {
    readonly role = "user" as const;
    constructor(readonly content: string) { }
}

export interface ToolCall {
    readonly callId: string;
    readonly toolName: string;
    readonly arguments: string;
}

export class AssistantMessage {
    readonly role = "assistant" as const;
    readonly content: string;
    readonly toolCalls: ToolCall[];
    readonly reasoning?: string; // For the assistant's thought process display.

    constructor(
        content: string,
        options?: {
            reasoning?: string;
            toolCalls?: ToolCall[]
        }
    ) {
        this.content = content;
        this.reasoning = options?.reasoning;
        this.toolCalls = options?.toolCalls ?? [];
    }
}

export class ToolMessage {
    readonly role = "tool" as const;
    readonly callId: string;
    readonly toolName: string;
    readonly toolOutput: string;
    readonly isError: boolean;

    constructor(config: {
        callId: string;
        toolName: string;
        toolOutput: string;
        isError?: boolean;
    }) {
        this.callId = config.callId;
        this.toolName = config.toolName;
        this.toolOutput = config.toolOutput;
        this.isError = config.isError ?? false;
    }
}

export type BaseMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

export type BaseMessages = BaseMessage[];