export type ModelErrorCode =
    "network_error"
    | "auth_error"
    | "rate_limit"
    | "invalid_request"
    | "server_error"
    | "bad_response"
    | "aborted"
    | "unknown";

export class ModelError extends Error {
    readonly name = "ModelError" as const;
    readonly code: ModelErrorCode;
    readonly status?: number;
    readonly responseStatus?: string;

    constructor(message: string, code: ModelErrorCode, options?: { status?: number; responseStatus?: string }) {
        super(message);
        this.code = code;
        this.status = options?.status;
        this.responseStatus = options?.responseStatus;
    }
}
