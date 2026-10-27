import * as z from "zod";

// Messages
// ---------------------------------------------------------------------------------

export class SystemMessage {
    readonly role = "system" as const;
    constructor(readonly content: string) { }
}

export class UserMessage {
    readonly role = "user" as const;
    constructor(readonly content: string) { }
}

export interface ToolCall {
    readonly callId: string;
    readonly toolName: string;
    readonly arguments: string;
}

export class AssistantMessage {
    readonly role = "assistant" as const;
    readonly content: string;
    readonly toolCalls: ToolCall[];
    readonly reasoning?: string; // For the assistant's thought process display.

    constructor(
        content: string,
        options?: {
            reasoning?: string;
            toolCalls?: ToolCall[]
        }
    ) {
        this.content = content;
        this.reasoning = options?.reasoning;
        this.toolCalls = options?.toolCalls ?? [];
    }
}

export class ToolMessage {
    readonly role = "tool" as const;
    readonly callId: string;
    readonly toolName: string;
    readonly toolOutput: string;
    readonly isError: boolean;

    constructor(config: {
        callId: string;
        toolName: string;
        toolOutput: string;
        isError?: boolean;
    }) {
        this.callId = config.callId;
        this.toolName = config.toolName;
        this.toolOutput = config.toolOutput;
        this.isError = config.isError ?? false;
    }
}

export type BaseMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

export type BaseMessages = BaseMessage[];


// Tool
// ---------------------------------------------------------------------------------
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