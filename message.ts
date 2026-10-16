interface BaseMessage {
    role: string;
    content: string;
}

export class SystemMessage implements BaseMessage {
    readonly role = "system";
    content: string;

    constructor(content: string) {
        this.content = content;
    }
}

export class UserMessage implements BaseMessage {
    readonly role = "user";
    content: string;

    constructor(content: string) {
        this.content = content;
    }
}

export class AssistantMessage implements BaseMessage {
    readonly role = "assistant";
    content: string;

    constructor(content: string) {
        this.content = content;
    }
}  