import { NextResponse } from "next/server";

/** An error that is safe to show to the user, with an HTTP status. */
export class ApiError extends Error {
  constructor(public status: number, message: string, public code = "error", public details?: unknown) {
    super(message);
  }
}

export function ok<T>(data: T, init?: number | ResponseInit) {
  const responseInit = typeof init === "number" ? { status: init } : init;
  return NextResponse.json({ ok: true, data }, responseInit);
}

export function fail(status: number, message: string, code = "error", details?: unknown) {
  return NextResponse.json({ ok: false, error: { code, message, ...(details ? { details } : {}) } }, { status });
}

type Handler<C> = (request: Request, context: C) => Promise<Response>;

/** Central error handling: known ApiErrors become clean JSON; anything else is logged and hidden. */
export function route<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof ApiError) return fail(error.status, error.message, error.code, error.details);
      const prismaCode = (error as { code?: string })?.code;
      if (prismaCode === "P2025") return fail(404, "Not found", "not_found");
      if (prismaCode === "P1001" || prismaCode === "ECONNREFUSED") return fail(503, "The database is not reachable", "database_unavailable");
      console.error(`[api] ${request.method} ${new URL(request.url).pathname} failed:`, error);
      return fail(500, "Something went wrong on the server", "internal_error");
    }
  };
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "Request body must be valid JSON", "invalid_json");
  }
}

export function parseId(value: string, label = "id"): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `Invalid ${label}`, "invalid_id");
  return id;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseUuid(value: string, label = "id"): string {
  if (!UUID_RE.test(value)) throw new ApiError(400, `Invalid ${label}`, "invalid_id");
  return value.toLowerCase();
}
