import { Model } from "../model/model.js";
import { loadMarkdown } from "../libs/markdown-loader.js";
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

        // Initialize system prompt.
        if (agentConfig?.systemPrompt) {
            this.agentMessages.push(agentConfig.systemPrompt);
        } else {
            // Get default system prompt if no system prompt is provided in the agent config.
            const defaultSystemPrompt = new SystemMessage(loadMarkdown(new URL("./assets/default-system-prompt.md", import.meta.url)));
            this.agentMessages.push(defaultSystemPrompt);
        }
    }

    async run(userMessage: UserMessage): Promise<BaseMessages> {

        // Push the user message to the agent messages.
        this.agentMessages.push(userMessage);

        // Agent core loop
        while (true) {
            const response = await this.model.invoke(this.agentMessages,this.tools.map(item=>({
                type: "function",
                name: item.name,
                description: item.description,
                parameters: item.parameters,
                strict: false,
            }))); // Invoke the model with the current agent messages and tools.
            this.agentMessages.push(response); // Append the assistant's response to the agent messages.

            // handle tool calls if any.
            if (response.toolCalls && response.toolCalls.length > 0) {
                for (const toolCall of response.toolCalls) {
                    // Handle tool calls
                    const tool = this.tools.find(t => t.name === toolCall.toolName);
                    if (!tool) {
                        throw new Error(`Tool ${toolCall.toolName} not found.`);
                    }
                    const toolResult = tool.execute(JSON.parse(toolCall.arguments), { callId: toolCall.callId });
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
