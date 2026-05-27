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

export class GenerationProviderError extends GenerationError {
  readonly status: number | undefined;
  readonly body: string | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    message = "Generation provider request failed",
    options?: { status?: number; body?: string; details?: Record<string, unknown> },
  ) {
    super(message);
    this.name = "GenerationProviderError";
    this.status = options?.status;
    this.body = options?.body;
    this.details = options?.details;
  }
}

export class GenerationTimeoutError extends GenerationProviderError {
  constructor(message = "Generation request timed out", details?: Record<string, unknown>) {
    super(message, details ? { details } : undefined);
    this.name = "GenerationTimeoutError";
  }
}
