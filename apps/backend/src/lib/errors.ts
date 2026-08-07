/**
 * Typed application error classes.
 *
 * These are thrown from service/repository layers and caught by the
 * centralized error handler middleware. Each error carries an HTTP
 * status code so the error handler doesn't need to inspect error types
 * with if/else chains.
 */

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    // Preserve proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 400 — malformed request, missing required fields, invalid input. */
export class BadRequestError extends AppError {
  constructor(message = "Bad request") {
    super(message, 400);
  }
}

/** 401 — no valid session or token. */
export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, 401);
  }
}

/** 403 — authenticated but not permitted for this action. */
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super(message, 403);
  }
}

/** 404 — resource doesn't exist or doesn't belong to the current tenant. */
export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, 404);
  }
}

/** 409 — conflicting state (e.g., user already a member). */
export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super(message, 409);
  }
}

/** 410 — resource has expired (e.g., invite token). */
export class GoneError extends AppError {
  constructor(message = "Resource has expired") {
    super(message, 410);
  }
}
