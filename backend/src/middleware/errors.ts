import type { ErrorRequestHandler, RequestHandler } from "express";
import { HttpError, sendFail } from "../http/respond";
import { StorageError } from "../storage";

export const notFound: RequestHandler = (req, res) => {
  sendFail(res, 404, "not_found", `No API endpoint for ${req.method} ${req.path}`);
};

/**
 * Central error handler. Known errors become clean JSON; anything unexpected is logged on the server
 * (without request bodies, tokens or headers) and returned as a generic 500.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (res.headersSent) return;
  if (error instanceof HttpError || error instanceof StorageError) {
    sendFail(res, error.status, error.code, error.message, error instanceof HttpError ? error.details : undefined);
    return;
  }
  const status = (error as { status?: number; statusCode?: number }).status ?? (error as { statusCode?: number }).statusCode;
  if (status === 413) { sendFail(res, 413, "payload_too_large", "Request body is too large"); return; }
  if (status === 400 && (error as { type?: string }).type === "entity.parse.failed") { sendFail(res, 400, "invalid_json", "Request body must be valid JSON"); return; }
  console.error(`[api] ${req.method} ${req.path} failed:`, (error as Error)?.stack ?? error);
  sendFail(res, 500, "internal_error", "Something went wrong on the server");
};
