import { Model } from "../model/model.js";
import { SystemMessage, AssistantMessage, BaseMessages, ToolMessage } from "../core/messages.js";
import { Tool } from "../core/tool.js";
import { ProviderStreamEvent } from "../model/providers/provider.js";

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

export type AgentStreamEvent = ProviderStreamEvent | AgentResult

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

        return {
            status: "completed",
            messages: newMessages
        }
    }

    async *stream(inputMessages: BaseMessages): AsyncGenerator<AgentStreamEvent> {

        const loopMessages: BaseMessages = [
            this.systemPrompt,
            ...inputMessages
        ];

        const initialMessageCount = loopMessages.length;

        agentLoop:
        while (true) {

            try {
                let modelResponseStream = this.model.stream(loopMessages, this.tools.map(tool => tool.getSpec()));

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

                            break; // This break is for the case block.
                        }
                    }
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

        yield {
            status: "completed",
            messages: newMessages
        }
    }
}
