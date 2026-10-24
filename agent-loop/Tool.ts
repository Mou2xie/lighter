import type { ToolMessage } from "../model/types/BaseMessage.js";

export interface ToolConfig {
    name: string;
    description: string;
    parameterSchema: Record<string, any>;
    function: (args: Record<string, any>) => any;
}

export class Tool {
    readonly name: string;
    readonly description: string
    parameterSchema: Record<string, any>;
    function: (args: Record<string, any>) => any;

    constructor(config: ToolConfig) {
        this.name = config.name;
        this.description = config.description;
        this.parameterSchema = config.parameterSchema;
        this.function = config.function;
    }

    runTool(): ToolMessage {
        const result = this.function({});
        return new ToolMessage({
            callId: "tool-call-id",
            toolName: this.name,
            toolOutput: result,
            isError: false
        });
    }


}