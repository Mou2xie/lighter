import { ToolMessage } from "../model/types/BaseMessage.js";

export interface ToolConfig {
    name: string;
    description: string;
    parameterSchema: Record<string, { type: string }>;
    function(args: Record<string, any>): any;
}

export class Tool {
    readonly name: string;
    readonly description: string;
    readonly parameterSchema: Record<string, { type: string }>;
    readonly function: (args: Record<string, any>) => any;

    constructor(config: ToolConfig) {
        this.name = config.name;
        this.description = config.description;
        this.parameterSchema = config.parameterSchema;
        this.function = config.function;
    }

    execute(args: Record<string, any>, options: { callId: string }): ToolMessage {
        const result = this.function(args);
        return new ToolMessage({
            callId: options.callId,
            toolName: this.name,
            toolOutput: String(result),
            isError: false
        });
    }
}
