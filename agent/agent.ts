import { Model } from "../model/model.js";
import { SystemMessage, AssistantMessage, BaseMessages, ToolMessage } from "../core/messages.js";
import { Tool } from "../core/tool.js";
import { ProviderStreamEvent } from "../model/providers/provider.js";
import { ModelError } from "../model/errors.js";
import { BeforeModelHook, AfterModelHook, BeforeAgentHook, AfterAgentHook } from "../core/hooks.js";

export interface AgentConfig {
    model: Model;
    tools?: Tool[];
    systemPrompt?: SystemMessage;
    hooks?: {
        beforeModel?: BeforeModelHook;
        afterModel?: AfterModelHook;
        beforeAgent?: BeforeAgentHook;
        afterAgent?: AfterAgentHook;
    };
}

export type AgentResult = {
    status: "completed" | "failed";
    messages: BaseMessages;
    error?: unknown;
}

export type AgentStreamEvent = ProviderStreamEvent | AgentResult

export interface AgentRequest {
    messages: BaseMessages;
}

export class Agent {
    private model: Model;
    private tools: Tool[];
    private systemPrompt: SystemMessage;
    private hooks: {
        beforeModel?: BeforeModelHook;
        afterModel?: AfterModelHook;
        beforeAgent?: BeforeAgentHook;
        afterAgent?: AfterAgentHook;
    }

    constructor(config: AgentConfig) {
        this.model = config.model;
        this.tools = config.tools ?? [];
        this.systemPrompt = config.systemPrompt ?? new SystemMessage("You are a helpful assistant.");
        this.hooks = config.hooks ?? {};
    }

    async run(agentRequest: AgentRequest): Promise<AgentResult> {

        if (this.hooks.beforeAgent) {
            try {
                agentRequest = await this.hooks.beforeAgent.execute(agentRequest);
            } catch (error) {
                // If the beforeAgent hook fails, return a failed result with the error.
                return {
                    status: "failed",
                    messages: [],
                    error,
                };
            }
        }

        const inputMessages = agentRequest.messages;

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
                modelResponse = await this.model.invoke({
                    messages: [...loopMessages],
                    toolSpecs: this.tools.map(tool => tool.getSpec()),
                }, {
                    beforeModel: this.hooks.beforeModel,
                    afterModel: this.hooks.afterModel,
                });
            } catch (error) {
                // If the model invocation fails, return a failed result with the error and any messages generated so far.
                return {
                    status: "failed",
                    messages: loopMessages.slice(initialMessageCount),
                    error,
                };
            }

            loopMessages.push(modelResponse); // Append the model response to loop messages.

            if (modelResponse.toolCalls.length === 0) break; // If there are no tool calls, exit the loop.

            toolCallLoop:
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
                    continue toolCallLoop;
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
                    continue toolCallLoop;
                }

                // Execute the tool and push the result to the loop messages.
                const toolResultMessage = await tool.execute(parsedArgs, {
                    callId: toolCall.callId,
                });
                loopMessages.push(toolResultMessage);
            }

        };
        // return new messages generated in this run, excluding the initial messages.
        const newMessages = loopMessages.slice(initialMessageCount);

        if (this.hooks.afterAgent) {
            try {
                return await this.hooks.afterAgent.execute(newMessages);
            } catch (error) {
                return {
                    status: "failed",
                    messages: newMessages,
                    error,
                };
            }
        }

        return {
            status: "completed",
            messages: newMessages
        }
    }

    async *stream(agentRequest: AgentRequest): AsyncGenerator<AgentStreamEvent> {

        if (this.hooks.beforeAgent) {
            try {
                agentRequest = await this.hooks.beforeAgent.execute(agentRequest);
            } catch (error) {
                // If the beforeAgent hook fails, return a failed result with the error.
                yield {
                    status: "failed",
                    messages: [],
                    error,
                };
                return;
            }
        }

        const inputMessages = agentRequest.messages;

        const loopMessages: BaseMessages = [
            this.systemPrompt,
            ...inputMessages
        ];

        const initialMessageCount = loopMessages.length;

        agentLoop:
        while (true) {

            try {
                let modelResponseStream = this.model.stream({
                    messages: [...loopMessages],
                    toolSpecs: this.tools.map(tool => tool.getSpec()),
                }, {
                    beforeModel: this.hooks.beforeModel,
                    afterModel: this.hooks.afterModel,
                });

                let isResponseCompleted = false;

                for await (const chunk of modelResponseStream) {

                    switch (chunk.type) {
                        case "reasoning_delta":
                            yield {
                                type: "reasoning_delta",
                                text: chunk.text
                            }
                            break;

                        case "text_delta":
                            yield {
                                type: "text_delta",
                                text: chunk.text
                            }
                            break;

                        case "message": {
                            loopMessages.push(chunk.message);
                            isResponseCompleted = true;

                            if (chunk.message.toolCalls.length === 0) break agentLoop;

                            toolCallLoop:
                            for (const toolCall of chunk.message.toolCalls) {
                                const tool = this.tools.find(tool => tool.name === toolCall.toolName);
                                if (!tool) {
                                    loopMessages.push(new ToolMessage({
                                        callId: toolCall.callId,
                                        toolName: toolCall.toolName,
                                        toolOutput: `Tool ${toolCall.toolName} not found.`,
                                        isError: true
                                    }));
                                    continue toolCallLoop;
                                }

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
                                    continue toolCallLoop;
                                }

                                const toolResultMessage = await tool.execute(parsedArgs, {
                                    callId: toolCall.callId,
                                });

                                loopMessages.push(toolResultMessage);
                            }

                            break; // This break is for the switch case block.
                        }
                    }
                }

                // If the stream ends without a completed message, throw an error.
                if (!isResponseCompleted) {
                    throw new ModelError("Model streaming response ended without a completed message.", "bad_response");
                }

            } catch (error) {
                yield {
                    status: "failed",
                    messages: loopMessages.slice(initialMessageCount),
                    error,
                }

                return;
            }
        }

        const newMessages = loopMessages.slice(initialMessageCount);

        if (this.hooks.afterAgent) {
            let result: AgentResult;

            try {
                result = await this.hooks.afterAgent.execute(newMessages);
            } catch (error) {
                yield {
                    status: "failed",
                    messages: newMessages,
                    error,
                };
                return;
            }

            yield result;
            return;
        }

        yield {
            status: "completed",
            messages: newMessages
        }
    }
}
