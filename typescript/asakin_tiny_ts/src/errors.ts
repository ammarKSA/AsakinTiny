export class IntegrationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "IntegrationError";
  }
}

export class IntegrationNetworkError extends IntegrationError {
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(message, { cause: options?.cause });
    this.name = "IntegrationNetworkError";
    this.details = options?.details;
  }
}

export class AppNotFoundError extends IntegrationError {
  public readonly appCode: string;

  constructor(appCode: string) {
    super(`App '${appCode}' not found in the Asakin Registry.`);
    this.name = "AppNotFoundError";
    this.appCode = appCode;
  }
}

export class AppInactiveError extends IntegrationError {
  public readonly appCode: string;

  constructor(appCode: string) {
    super(`App '${appCode}' is registered but not active.`);
    this.name = "AppInactiveError";
    this.appCode = appCode;
  }
}
