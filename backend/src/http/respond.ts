import type { Response } from "express";
import type { ApiFailure, ApiSuccess } from "@tmh/shared/api-types";

/** Error that is safe to show to API clients, with an HTTP status and a stable code. */
export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "error", public details?: unknown) {
    super(message);
  }
}

export function sendOk<T>(res: Response, data: T, status = 200) {
  const body: ApiSuccess<T> = { ok: true, data };
  return res.status(status).json(body);
}

export function sendFail(res: Response, status: number, code: string, message: string, details?: unknown) {
  const body: ApiFailure = { ok: false, error: { code, message, ...(details !== undefined ? { details } : {}) } };
  return res.status(status).json(body);
}
