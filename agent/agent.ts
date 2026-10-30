import { Model } from "../model/model.js";
import { SystemMessage, AssistantMessage, BaseMessages, ToolMessage } from "../core/messages.js";
import { Tool } from "../core/tool.js";

export interface AgentConfig {
    model: Model;
    tools?: Tool[];
    systemPrompt?: SystemMessage;
}

export type AgentResult = {
    status: "completed" | "failed";
    messages: BaseMessages;
    error?: unknown;
}

export class Agent {
    private model: Model;
    private tools: Tool[];
    private systemPrompt: SystemMessage;

    constructor(config: AgentConfig) {
        this.model = config.model;
        this.tools = config.tools ?? [];
        this.systemPrompt = config.systemPrompt ?? new SystemMessage("You are a helpful assistant.");
    }

    async run(inputMessages: BaseMessages): Promise<AgentResult> {

        // Merge system prompt and input messages to form the context for this run.
        const loopMessages: BaseMessages = [
            this.systemPrompt,
            ...inputMessages
        ];

        // Store the initial message count for slicing the new messages generated in this run later.
        const initialMessageCount = loopMessages.length;

        // Agent core loop
        while (true) {

            let modelResponse: AssistantMessage;

            try {
                modelResponse = await this.model.invoke(loopMessages, this.tools.map(tool => tool.getSpec()));
            } catch (error) {
                // If the model invocation fails, return a failed result with the error and any messages generated so far.
                return {
                    status: "failed",
                    messages: loopMessages.slice(initialMessageCount),
                    error,
                };
            }

            loopMessages.push(modelResponse); // Append the model response to loop messages.

            // handle tool calls if any.
            if (modelResponse.toolCalls && modelResponse.toolCalls.length > 0) {

                for (const toolCall of modelResponse.toolCalls) {

                    // Find the tool by name. If not found, push an error ToolMessage and continue to the next tool call.
                    const tool = this.tools.find(tool => tool.name === toolCall.toolName);
                    if (!tool) {
                        loopMessages.push(new ToolMessage({
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
                        loopMessages.push(new ToolMessage({
                            callId: toolCall.callId,
                            toolName: toolCall.toolName,
                            toolOutput: `Invalid JSON arguments: ${String(error)}`,
                            isError: true,
                        }));
                        continue;
                    }

                    // Execute the tool and push the result to the loop messages.
                    const toolResultMessage = await tool.execute(parsedArgs, {
                        callId: toolCall.callId,
                    });
                    loopMessages.push(toolResultMessage);
                }
            } else {
                // No more tool calls means the agent has job done, it's safe to quit loop and return the response. 
                break;
            }
        };
        // return new messages generated in this run, excluding the initial messages.
        const newMessages = loopMessages.slice(initialMessageCount);

        return {
            status: "completed",
            messages: newMessages
        }
    }
}
