import type { ToolSpec, Tool } from "../core/protocol.js";

// create tool spec from tool.
export const createToolSpec = (tool: Tool): ToolSpec => {
    return {
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        strict: false,
    }
}