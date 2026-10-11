export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationError";
  }
}

export class GenerationConfigError extends GenerationError {
  constructor(message: string) {
    super(message);
    this.name = "GenerationConfigError";
  }
}

export class GenerationValidationError extends GenerationError {
  constructor(message: string) {
    super(message);
    this.name = "GenerationValidationError";
  }
}

export class GenerationUnsupportedAdapterError extends GenerationError {
  constructor(adapterType: string) {
    super(`Unsupported generation adapter: ${adapterType}`);
    this.name = "GenerationUnsupportedAdapterError";
  }
}

/**
 * Request ids of a generation response.
 * `requestId` is the router canonical id (`new_api.request_id` / `X-Request-Id`);
 * `upstreamRequestIds` are the new-api request ids behind it.
 */
export type GenerationRequestIds = {
  requestId?: string;
  upstreamRequestIds: string[];
};

export class GenerationProviderError extends GenerationError {
  readonly status: number | undefined;
  readonly body: string | undefined;
  readonly details: Record<string, unknown> | undefined;
  /** Set by the client from the latest response that carried request ids. */
  requestId: string | undefined;
  upstreamRequestIds: string[];

  constructor(
    message = "Generation provider request failed",
    options?: { status?: number; body?: string; details?: Record<string, unknown> },
  ) {
    super(message);
    this.name = "GenerationProviderError";
    this.status = options?.status;
    this.body = options?.body;
    this.details = options?.details;
    this.requestId = undefined;
    this.upstreamRequestIds = [];
  }
}

export type GenerationTransportErrorDetails = {
  method: string;
  host?: string;
  path: string;
  elapsedMs: number;
  causeName?: string;
  causeCode?: string;
  causeSyscall?: string;
  causeAddress?: string;
  causePort?: string | number;
};

export class GenerationTransportError extends GenerationProviderError {
  declare readonly details: GenerationTransportErrorDetails;

  constructor(details: GenerationTransportErrorDetails, cause: unknown) {
    super(transportErrorMessage(details), { details });
    this.name = "GenerationTransportError";
    this.cause = cause;
  }

  declare cause: unknown;
}

export class GenerationTimeoutError extends GenerationProviderError {
  constructor(message = "Generation request timed out", details?: Record<string, unknown>) {
    super(message, details ? { details } : undefined);
    this.name = "GenerationTimeoutError";
  }
}

function transportErrorMessage(details: GenerationTransportErrorDetails): string {
  return [
    "Generation transport failed",
    `method=${details.method}`,
    details.host ? `host=${details.host}` : undefined,
    `path=${details.path}`,
    `elapsed_ms=${details.elapsedMs}`,
    details.causeCode ? `cause_code=${details.causeCode}` : undefined,
    details.causeName ? `cause_name=${details.causeName}` : undefined,
    details.causeSyscall ? `cause_syscall=${details.causeSyscall}` : undefined,
    details.causeAddress ? `cause_address=${details.causeAddress}` : undefined,
    details.causePort !== undefined ? `cause_port=${details.causePort}` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" ");
}
