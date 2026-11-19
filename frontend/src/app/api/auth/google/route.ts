import { z } from "zod";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/server/auth";
import { prisma } from "@/server/db";
import { usernameFromEmail, verifyGoogleIdToken } from "@/server/google-auth";
import { ApiError, ok, readJson, route } from "@/server/http";

export const runtime = "nodejs";

const bodySchema = z.object({ idToken: z.string().min(100).max(8192) });

/**
 * Exchanges a Firebase (Google) ID token for a TMH session.
 * - Allowed-domain accounts that are new get an account automatically with the viewer role.
 * - An existing account with the same email (for example one an admin prepared) is linked.
 * - Deactivated accounts are refused.
 */
export const POST = route(async (request) => {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) throw new ApiError(403, "Cross-site request blocked", "bad_origin");

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, "Missing Google sign-in token", "invalid_body");
  const identity = await verifyGoogleIdToken(parsed.data.idToken);

  let user = await prisma.user.findFirst({ where: { OR: [{ firebaseUid: identity.uid }, { email: identity.email }] } });
  if (user) {
    if (user.firebaseUid && user.firebaseUid !== identity.uid) throw new ApiError(409, "This email is linked to a different Google account", "account_conflict");
    user = await prisma.user.update({
      where: { id: user.id },
      data: { firebaseUid: identity.uid, email: identity.email, avatarUrl: identity.picture, ...(user.displayName ? {} : { displayName: identity.name }) },
    });
  } else {
    const base = usernameFromEmail(identity.email);
    let username = base;
    for (let n = 2; await prisma.user.findUnique({ where: { username } }); n++) username = `${base}-${n}`;
    user = await prisma.user.create({
      data: { username, displayName: identity.name.slice(0, 120), email: identity.email, firebaseUid: identity.uid, avatarUrl: identity.picture, role: "viewer", passwordHash: null },
    });
  }
  if (!user.isActive) throw new ApiError(403, "Your account has been deactivated. Ask an administrator.", "account_inactive");

  const { token, expiresAt } = await createSession(user.id, request);
  const response = ok({ user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  return response;
});
