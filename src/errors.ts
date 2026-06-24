export class ShopiError extends Error {
  readonly exitCode: number;
  readonly details?: unknown;

  constructor(message: string, exitCode = 1, details?: unknown) {
    super(message);
    this.name = "ShopiError";
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function isShopiError(error: unknown): error is ShopiError {
  return error instanceof ShopiError;
}

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
