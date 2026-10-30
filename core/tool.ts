import * as z from "zod";
import { ToolMessage } from "./messages.js";

export interface ToolSpec {
    type: "function";
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema for the tool parameters. Property name is fixed here.
    strict: boolean;
}

interface ToolConfig<ZSchema extends z.ZodObject> {
    name: string;
    description: string;
    parametersZodSchema: ZSchema;
    func(args: z.infer<ZSchema>): unknown | Promise<unknown>;
}

export class Tool<ZSchema extends z.ZodObject = z.ZodObject> {
    readonly name: string;
    readonly description: string;
    readonly parametersZodSchema: ZSchema;
    readonly func: (args: z.infer<ZSchema>) => unknown | Promise<unknown>;

    constructor(config: ToolConfig<ZSchema>) {
        this.name = config.name;
        this.description = config.description;
        this.parametersZodSchema = config.parametersZodSchema;
        this.func = config.func;
    }

    async execute(args: unknown, options: { callId: string }): Promise<ToolMessage> {
        try {
            const validatedArgs = this.parametersZodSchema.parse(args); // Validate the arguments using Zod schema.
            const result = await this.func(validatedArgs);
            return new ToolMessage({
                callId: options.callId,
                toolName: this.name,
                toolOutput: String(result),
                isError: false
            });
        } catch (error) {
            // If the tool execution fails, return a ToolMessage indicating the error.
            return new ToolMessage({
                callId: options.callId,
                toolName: this.name,
                toolOutput: String(error),
                isError: true
            });
        }
    }

    getSpec(): ToolSpec {
        return {
            type: "function",
            name: this.name,
            description: this.description,
            parameters: z.toJSONSchema(this.parametersZodSchema, { io: "input" }), // Convert Zod schema to JSON Schema.
            strict: false,
        }
    }
}