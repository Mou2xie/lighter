import { Model } from "../model/Model.js";
import type { BaseMessages } from "../model/modelTypes/BaseMessage.js";
import { SystemMessage, UserMessage, ToolMessage } from "../model/modelTypes/BaseMessage.js";

const defaultSystemMessage = new SystemMessage("You are a helpful assistant.");

export class Agent {
    model: Model;
    systemMessage: SystemMessage
    agentMessages: BaseMessages = [];

    constructor(model: Model, systemMessage?: SystemMessage) {
        this.model = model;
        this.systemMessage = systemMessage ?? defaultSystemMessage;
    }

    async run(userMessage: UserMessage): Promise<BaseMessages> {

        this.agentMessages.push(this.systemMessage);
        this.agentMessages.push(userMessage);

        // Agent core loop
        while (true) {
            const response = await this.model.invoke(this.agentMessages);
            this.agentMessages.push(response);

            if (response.toolCalls && response.toolCalls.length > 0) {
                for (const toolCall of response.toolCalls) {
                    // Handle tool calls waiting to be implemented.
                    const toolMessage = new ToolMessage({
                        callId: toolCall.callId,
                        toolName: toolCall.toolName,
                        toolOutput: `Tool ${toolCall.toolName} called with arguments: ${toolCall.arguments}`,
                        isError: false
                    });
                    this.agentMessages.push(toolMessage);
                }
            } else {
                // No more tool calls means the agent has job done, it's safe to quit loop and return the response. 
                break;
            }
        };

        return this.agentMessages;
    }
}


