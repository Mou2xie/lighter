interface BaseMessage {
    role: "user" | "ai" | "system" | "tool";
    timestamp: number;
}

export class SystemMessage implements BaseMessage {
    readonly role: "system" = "system";
    readonly content: string;
    readonly timestamp: number;

    constructor(content: string) {
        this.content = content;
        this.timestamp = Date.now();
    }
}

export class UserMessage implements BaseMessage {
    readonly role: "user" = "user";
    readonly content: string;
    readonly timestamp: number;

    constructor(content: string) {
        this.content = content;
        this.timestamp = Date.now();
    }
}

export class AIMessage implements BaseMessage {
    readonly role: "ai" = "ai";
    readonly content: string;
    readonly timestamp: number;

    constructor(content: string) {
        this.content = content;
        this.timestamp = Date.now();
    }
}

export class ToolMessage implements BaseMessage {
    readonly role: "tool" = "tool";
    readonly timestamp: number;
    readonly toolID: string;
    readonly toolOutput: string;

    constructor(toolID: string, toolOutput: string) {
        this.toolID = toolID;
        this.toolOutput = toolOutput;
        this.timestamp = Date.now();
    }
}

export type Messages = (SystemMessage | UserMessage | AIMessage | ToolMessage)[];
