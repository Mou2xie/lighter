import { Model } from "../model/model.js";
import { SystemMessage, UserMessage, BaseMessages, ToolMessage, Tool } from "../core/protocol.js";

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
                    // Find the tool by name.
                    const tool = this.tools.find(tool => tool.name === toolCall.toolName);
                    // If tool is not found, push a ToolMessage indicating the error and continue to the next tool call.
                    if (!tool) {
                        this.agentMessages.push(new ToolMessage({
                            callId: toolCall.callId,
                            toolName: toolCall.toolName,
                            toolOutput: `Tool ${toolCall.toolName} not found.`,
                            isError: true
                        }));

                        continue;
                    }

                    let args: unknown;

                    try {
                        args = JSON.parse(toolCall.arguments);
                    } catch (error) {
                        this.agentMessages.push(new ToolMessage({
                            callId: toolCall.callId,
                            toolName: toolCall.toolName,
                            toolOutput: `Invalid JSON arguments: ${String(error)}`,
                            isError: true,
                        }));

                        continue;
                    }

                    const toolResult = await tool.execute(args, {
                        callId: toolCall.callId,
                    });
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
