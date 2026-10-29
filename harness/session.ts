import { BaseMessages, BaseMessage } from "../core/protocol.js";

export class Session {
    readonly sessionId: string;
    private readonly conversationHistory: BaseMessages = [];

    constructor() {
        this.sessionId = crypto.randomUUID();
    }

    addMessage(message: BaseMessage | BaseMessages): void {
        if (Array.isArray(message)) {
            this.conversationHistory.push(...structuredClone(message));
        } else {
            this.conversationHistory.push(structuredClone(message));
        }
    }

    getConversationHistory(): BaseMessages {
        return structuredClone(this.conversationHistory);
    }

    clearSession(): void {
        this.conversationHistory.length = 0;
    }
}