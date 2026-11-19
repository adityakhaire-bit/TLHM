import { z } from "zod";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "./auth";
import { prisma } from "./db";
import { usernameFromEmail, verifyFirebaseIdToken } from "./google-auth";
import { ApiError, ok, readJson } from "./http";

const bodySchema = z.object({ idToken: z.string().min(100).max(8192) });

/**
 * Exchanges a verified Firebase ID token (Google or email + password) for a TMH session.
 * - New people from an allowed domain get an account automatically with the viewer role.
 * - An existing account with the same verified email is linked (for example one an admin prepared).
 * - Deactivated accounts are refused.
 */
export function assertSameOriginPost(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) throw new ApiError(403, "Cross-site request blocked", "bad_origin");
}

export async function firebaseSignIn(request: Request) {
  assertSameOriginPost(request);
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, "Missing sign-in token", "invalid_body");
  return sessionFromIdToken(parsed.data.idToken, request);
}

/** Verifies a Firebase ID token (verified email, allowed domain) and opens a TMH session for it. */
export async function sessionFromIdToken(idToken: string, request: Request) {
  const identity = await verifyFirebaseIdToken(idToken);

  let user = await prisma.user.findFirst({ where: { OR: [{ firebaseUid: identity.uid }, { email: identity.email }] } });
  if (user) {
    if (user.firebaseUid && user.firebaseUid !== identity.uid) {
      throw new ApiError(409, "This email is already linked to a different sign-in. Ask an administrator.", "account_conflict");
    }
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        firebaseUid: identity.uid,
        email: identity.email,
        ...(identity.picture ? { avatarUrl: identity.picture } : {}),
        ...(user.displayName ? {} : { displayName: identity.name.slice(0, 120) }),
      },
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
  const response = ok({ user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role }, provider: identity.provider });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  return response;
}
