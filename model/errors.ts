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
    readonly httpStatus?: number;
    readonly responseStatus?: string;

    constructor(message: string, code: ModelErrorCode, options?: { httpStatus?: number; responseStatus?: string }) {
        super(message);
        this.code = code;
        this.httpStatus = options?.httpStatus;
        this.responseStatus = options?.responseStatus;
    }
}
