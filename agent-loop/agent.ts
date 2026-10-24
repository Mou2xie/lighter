import { Model } from "../model/Model.js";
import type { BaseMessages } from "../model/types/BaseMessage.js";
import { SystemMessage, UserMessage, ToolMessage } from "../model/types/BaseMessage.js";

// Default system message for the agent if none is provided. Waiting to be extended.
const defaultSystemMessage = new SystemMessage("You are a helpful assistant.");

export interface AgentConfig {
    model: Model;
    systemMessage?: SystemMessage;
}

export class Agent {
    model: Model;
    systemMessage: SystemMessage
    agentMessages: BaseMessages = [];

    constructor(agentConfig: AgentConfig) {
        this.model = agentConfig.model;
        this.systemMessage = agentConfig?.systemMessage ?? defaultSystemMessage;
    }

    async run(userMessage: UserMessage): Promise<BaseMessages> {

        // Initialize the agent messages with the system message and the first user message.
        this.agentMessages.push(this.systemMessage);
        this.agentMessages.push(userMessage);

        // Agent core loop
        while (true) {
            const response = await this.model.invoke(this.agentMessages);
            this.agentMessages.push(response); // Append the assistant's response to the agent messages.

            // handle tool calls if any.
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

        // return entire agent messages.
        return this.agentMessages;
    }
}


