import type { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors.js";

/**
 * Centralized error handler middleware.
 *
 * Catches all errors thrown/passed via next(error) and returns
 * a consistent JSON error response. Operational errors (AppError
 * subclasses) return their specific status code and message.
 * Unexpected errors return 500 with a generic message.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Operational errors — expected, safe to expose to the client.
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        message: err.message,
        statusCode: err.statusCode,
      },
    });
    return;
  }

  // Unexpected errors — log and return generic 500.
  console.error("Unhandled error:", err);

  res.status(500).json({
    error: {
      message: "Internal server error",
      statusCode: 500,
    },
  });
}
