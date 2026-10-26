import { ToolMessage } from "../model/types/messages.js";
import type { ToolDefinition } from "../model/types/tool-definition.js";

export interface ToolConfig extends ToolDefinition {
    func(args: Record<string, any>): any;
}

export class Tool {
    readonly name: string;
    readonly description: string;
    readonly parameterSchema: Record<string, unknown>;
    readonly func: (args: Record<string, any>) => any;

    constructor(config: ToolConfig) {
        this.name = config.name;
        this.description = config.description;
        this.parameterSchema = config.parameters;
        this.func = config.func;
    }

    execute(args: Record<string, any>, options: { callId: string }): ToolMessage {
        const result = this.func(args);
        return new ToolMessage({
            callId: options.callId,
            toolName: this.name,
            toolOutput: String(result),
            isError: false
        });
    }
}
