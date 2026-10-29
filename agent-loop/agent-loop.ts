import { Model } from "../model/model.js";
import { SystemMessage, BaseMessages, ToolMessage, Tool } from "../core/protocol.js";

export interface AgentLoopConfig {
    model: Model;
    tools?: Tool[];
    systemPrompt?: SystemMessage;
}

export class AgentLoop {
    model: Model;
    tools: Tool[];
    systemPrompt: SystemMessage;

    constructor(agentLoopConfig: AgentLoopConfig) {
        this.model = agentLoopConfig.model;
        this.tools = agentLoopConfig.tools ?? [];
        this.systemPrompt = agentLoopConfig.systemPrompt ?? new SystemMessage("You are a helpful assistant.");
    }

    async run(messages: BaseMessages): Promise<BaseMessages> {

        const messagesForThisRun: BaseMessages = [
            this.systemPrompt,
            ...messages
        ];

        const inputLength = messagesForThisRun.length;

        // Agent core loop
        while (true) {
            const response = await this.model.invoke(messagesForThisRun, this.tools.map(tool => tool.getSpec())); // Invoke the model with the current agent messages and tool spec.

            messagesForThisRun.push(response); // Append the assistant's response to the agent messages.

            // handle tool calls if any.
            if (response.toolCalls && response.toolCalls.length > 0) {

                for (const toolCall of response.toolCalls) {

                    // Find the tool by name. If not found, push an error ToolMessage and continue to the next tool call.
                    const tool = this.tools.find(tool => tool.name === toolCall.toolName);
                    if (!tool) {
                        messagesForThisRun.push(new ToolMessage({
                            callId: toolCall.callId,
                            toolName: toolCall.toolName,
                            toolOutput: `Tool ${toolCall.toolName} not found.`,
                            isError: true
                        }));
                        continue;
                    }

                    // Parse the arguments for the tool call. If fails, push an error ToolMessage and continue to the next tool call.
                    let args: unknown;
                    try {
                        args = JSON.parse(toolCall.arguments);
                    } catch (error) {
                        messagesForThisRun.push(new ToolMessage({
                            callId: toolCall.callId,
                            toolName: toolCall.toolName,
                            toolOutput: `Invalid JSON arguments: ${String(error)}`,
                            isError: true,
                        }));
                        continue;
                    }

                    // Execute the tool and push the result to the agent messages.
                    const toolResult = await tool.execute(args, {
                        callId: toolCall.callId,
                    });
                    messagesForThisRun.push(toolResult);
                }
            } else {
                // No more tool calls means the agent has job done, it's safe to quit loop and return the response. 
                break;
            }
        };

        // return entire agent messages.
        return messagesForThisRun.slice(inputLength);
    }
}
