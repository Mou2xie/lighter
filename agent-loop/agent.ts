import { Model } from "../model/Model.js";
import type { BaseMessages } from "../model/types/BaseMessage.js";
import { SystemMessage, UserMessage, ToolMessage } from "../model/types/BaseMessage.js";
import type { Tool } from "./Tool.js";
import { mdFileLoader } from "../libs/mdFileLoader.js";

export interface AgentConfig {
    model: Model;
    tools?: Tool[];
    systemPrompt?: SystemMessage;
}

export class Agent {
    model: Model;
    tools: Tool[];
    agentMessages: BaseMessages = [];

    constructor(agentConfig: AgentConfig) {
        this.model = agentConfig.model;
        this.tools = agentConfig?.tools ?? [];

        // Initialize system prompt.
        if (agentConfig?.systemPrompt) {
            this.agentMessages.push(agentConfig.systemPrompt);
        } else {
            // Get default system prompt if no system prompt is provided in the agent config.
            const defaultSystemPrompt = new SystemMessage(mdFileLoader(new URL("../assets/default-system-message.md", import.meta.url)));
            this.agentMessages.push(defaultSystemPrompt);
        }
    }

    async run(userMessage: UserMessage): Promise<BaseMessages> {

        // Push the user message to the agent messages.
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


