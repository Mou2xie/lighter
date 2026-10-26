
export interface ToolDefinition {
    type: "function";
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict: false,
}