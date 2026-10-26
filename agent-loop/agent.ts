import { Model } from "../model/model.js";
import { SystemMessage, UserMessage, BaseMessages, Tool } from "../core/protocol.js";

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

        // If system prompt is provided, push it into the agent messages, otherwise use default system prompt.
        agentConfig.systemPrompt ? this.agentMessages.push(agentConfig.systemPrompt) : this.agentMessages.push(new SystemMessage("You are a helpful assistant."));
    }

    async run(userMessage: UserMessage): Promise<BaseMessages> {

        // Push the user message to the agent messages.
        this.agentMessages.push(userMessage);

        // Agent core loop
        while (true) {
            const response = await this.model.invoke(this.agentMessages, this.tools.map(tool => tool.getSpec())); // Invoke the model with the current agent messages and tool spec.

            this.agentMessages.push(response); // Append the assistant's response to the agent messages.

            // handle tool calls if any.
            if (response.toolCalls && response.toolCalls.length > 0) {
                for (const toolCall of response.toolCalls) {
                    // Handle tool calls
                    const tool = this.tools.find(tool => tool.name === toolCall.toolName);
                    if (!tool) {
                        throw new Error(`Tool ${toolCall.toolName} not found.`);
                    }
                    const toolResult = await tool.execute(JSON.parse(toolCall.arguments), { callId: toolCall.callId });
                    this.agentMessages.push(toolResult);
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
