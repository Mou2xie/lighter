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

    constructor(config: AgentLoopConfig) {
        this.model = config.model;
        this.tools = config.tools ?? [];
        this.systemPrompt = config.systemPrompt ?? new SystemMessage("You are a helpful assistant.");
    }

    async runLoop(inputMessages: BaseMessages): Promise<BaseMessages> {

        // Merge system prompt and input messages to form the context for this run.
        const contextMessages: BaseMessages = [
            this.systemPrompt,
            ...inputMessages
        ];

        // Store the initial message count for slicing the new messages generated in this run later.
        const initialMessageCount = contextMessages.length;

        // Agent core loop
        while (true) {
            const assistantMessage = await this.model.invoke(contextMessages, this.tools.map(tool => tool.getSpec())); // Invoke the model with the current agent messages and tool spec.

            contextMessages.push(assistantMessage); // Append the model response to the context messages.

            // handle tool calls if any.
            if (assistantMessage.toolCalls && assistantMessage.toolCalls.length > 0) {

                for (const toolCall of assistantMessage.toolCalls) {

                    // Find the tool by name. If not found, push an error ToolMessage and continue to the next tool call.
                    const tool = this.tools.find(tool => tool.name === toolCall.toolName);
                    if (!tool) {
                        contextMessages.push(new ToolMessage({
                            callId: toolCall.callId,
                            toolName: toolCall.toolName,
                            toolOutput: `Tool ${toolCall.toolName} not found.`,
                            isError: true
                        }));
                        continue;
                    }

                    // Parse the arguments for the tool call. If fails, push an error ToolMessage and continue to the next tool call.
                    let parsedArgs: unknown;
                    try {
                        parsedArgs = JSON.parse(toolCall.arguments);
                    } catch (error) {
                        contextMessages.push(new ToolMessage({
                            callId: toolCall.callId,
                            toolName: toolCall.toolName,
                            toolOutput: `Invalid JSON arguments: ${String(error)}`,
                            isError: true,
                        }));
                        continue;
                    }

                    // Execute the tool and push the result to the context messages.
                    const toolResultMessage = await tool.execute(parsedArgs, {
                        callId: toolCall.callId,
                    });
                    contextMessages.push(toolResultMessage);
                }
            } else {
                // No more tool calls means the agent has job done, it's safe to quit loop and return the response. 
                break;
            }
        };
        // return new messages generated in this run, excluding the initial messages.
        const addedMessages = contextMessages.slice(initialMessageCount);
        return addedMessages;
    }
}
