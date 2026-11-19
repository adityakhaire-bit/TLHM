import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@/generated/prisma/client";
import { prisma } from "./db";
import { getEnv } from "./env";
import { ApiError } from "./http";

export const SESSION_COOKIE = "tmh_session";
const ROLE_RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3 };

export type SessionUser = { id: number; username: string; displayName: string; role: Role };

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function hasRole(user: SessionUser, minimum: Role) {
  return ROLE_RANK[user.role] >= ROLE_RANK[minimum];
}

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: getEnv().APP_ORIGIN.startsWith("https://"),
    path: "/",
    expires,
  };
}

export async function createSession(userId: number, request: Request) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + getEnv().SESSION_TTL_HOURS * 3600 * 1000);
  await prisma.session.create({
    data: {
      id: hashToken(token),
      userId,
      expiresAt,
      ipAddress: clientIp(request)?.slice(0, 64) ?? null,
      userAgent: request.headers.get("user-agent")?.slice(0, 255) ?? null,
    },
  });
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  return { token, expiresAt };
}

export async function destroySession(token: string | undefined) {
  if (token) await prisma.session.deleteMany({ where: { id: hashToken(token) } });
}

async function userFromToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const session = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: { select: { id: true, username: true, displayName: true, role: true, isActive: true } } },
  });
  if (!session || session.expiresAt.getTime() < Date.now() || !session.user.isActive) return null;
  // Touch at most every 5 minutes to avoid a database write on every request.
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  const { id, username, displayName, role } = session.user;
  return { id, username, displayName, role };
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return undefined;
}

export function sessionTokenFrom(request: Request) {
  return readCookie(request, SESSION_COOKIE);
}

export function clientIp(request: Request): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
}

/**
 * Cross-site request protection for state-changing requests: when a browser sends an Origin
 * header it must match the host the request was sent to. Same-origin only; no CORS is offered.
 */
function assertSameOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (!origin) return; // non-browser clients (curl, scripts) send no Origin; they still need a valid session
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError(403, "Cross-site request blocked", "bad_origin");
  }
  if (!host || originHost !== host) throw new ApiError(403, "Cross-site request blocked", "bad_origin");
}

/** For API routes: returns the signed-in user or throws 401/403. */
export async function requireUser(request: Request, minimum: Role = "viewer"): Promise<SessionUser> {
  assertSameOrigin(request);
  const user = await userFromToken(sessionTokenFrom(request));
  if (!user) throw new ApiError(401, "Please sign in to continue", "unauthenticated");
  if (!hasRole(user, minimum)) throw new ApiError(403, `This action needs the ${minimum} role`, "forbidden");
  return user;
}

/** For server-rendered pages: returns the signed-in user or redirects to /login. */
export async function requirePageUser(): Promise<SessionUser> {
  const store = await cookies();
  const user = await userFromToken(store.get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login");
  return user;
}

export async function optionalPageUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return userFromToken(store.get(SESSION_COOKIE)?.value).catch(() => null);
}

// Simple in-memory brute-force protection for sign-in (single server process on one machine).
const failures = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

export function loginThrottleKey(request: Request, username: string) {
  return `${clientIp(request) ?? "local"}|${username.toLowerCase()}`;
}

export function assertNotThrottled(key: string) {
  const entry = failures.get(key);
  if (entry && Date.now() - entry.first < WINDOW_MS && entry.count >= MAX_FAILURES) {
    throw new ApiError(429, "Too many failed sign-in attempts. Wait 15 minutes and try again.", "too_many_attempts");
  }
}

export function recordLoginFailure(key: string) {
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) failures.set(key, { count: 1, first: Date.now() });
  else entry.count++;
}

export function clearLoginFailures(key: string) {
  failures.delete(key);
}
