import { z } from "zod";
import { prisma } from "@/server/db";
import {
  assertNotThrottled, clearLoginFailures, createSession, loginThrottleKey, recordLoginFailure,
  SESSION_COOKIE, sessionCookieOptions,
} from "@/server/auth";
import { ApiError, ok, readJson, route } from "@/server/http";
import { verifyPassword } from "@/server/passwords";

export const runtime = "nodejs";

const bodySchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
});

// Used to keep response time similar for unknown usernames (prevents username probing by timing).
const DUMMY_HASH = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export const POST = route(async (request) => {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) throw new ApiError(403, "Cross-site request blocked", "bad_origin");

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, "Enter your username and password", "invalid_credentials_format");
  const { username, password } = parsed.data;

  const key = loginThrottleKey(request, username);
  assertNotThrottled(key);

  const user = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid || !user.isActive) {
    recordLoginFailure(key);
    throw new ApiError(401, "Incorrect username or password", "invalid_credentials");
  }
  clearLoginFailures(key);

  const { token, expiresAt } = await createSession(user.id, request);
  const response = ok({ user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  return response;
});
