export type AppErrorOptions = {
  details?: Record<string, unknown>;
  fieldErrors?: Record<string, string[]>;
};

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(statusCode: number, code: string, message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
    this.fieldErrors = options.fieldErrors;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
