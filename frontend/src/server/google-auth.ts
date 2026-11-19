import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { getEnv } from "./env";
import { ApiError } from "./http";

/**
 * Google sign-in through Firebase Authentication.
 * The browser signs in with Google (Firebase JS SDK) and sends us the Firebase ID token. We verify the
 * token's signature, audience and expiry against Google's public keys (no service-account key needed
 * for verification), then apply our own rules: verified email, Google provider, allowed domain.
 */
function firebaseAuth() {
  const projectId = getEnv().FIREBASE_PROJECT_ID;
  if (!projectId) throw new ApiError(503, "Google sign-in is not configured (FIREBASE_PROJECT_ID missing)", "google_not_configured");
  const app = getApps().find((existing) => existing.name === "tmh-auth") ?? initializeApp({ projectId }, "tmh-auth");
  return getAuth(app);
}

export function allowedDomains(): string[] {
  return getEnv().ALLOWED_EMAIL_DOMAINS.split(",").map((domain) => domain.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
}

export function isAllowedEmail(email: string, domains = allowedDomains()): boolean {
  const at = email.lastIndexOf("@");
  if (at < 1) return false;
  return domains.includes(email.slice(at + 1).toLowerCase());
}

export type GoogleIdentity = { uid: string; email: string; name: string; picture: string | null };

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  const domains = allowedDomains();
  if (domains.length === 0) throw new ApiError(503, "Google sign-in is turned off on this server", "google_disabled");

  let decoded: DecodedIdToken;
  try {
    decoded = await firebaseAuth().verifyIdToken(idToken);
  } catch {
    throw new ApiError(401, "Google sign-in could not be verified. Please try again.", "invalid_google_token");
  }
  if (decoded.firebase?.sign_in_provider !== "google.com") throw new ApiError(401, "Please use the Google button to sign in", "wrong_provider");
  // Only accept a sign-in that just happened, so an old token cannot be replayed to open a session.
  if (Date.now() / 1000 - decoded.auth_time > 10 * 60) throw new ApiError(401, "That Google sign-in is too old. Please try again.", "stale_google_token");
  const email = decoded.email?.toLowerCase();
  if (!email || decoded.email_verified !== true) throw new ApiError(403, "Your Google account email is not verified", "email_not_verified");
  if (!isAllowedEmail(email, domains)) {
    throw new ApiError(403, `Only ${domains.map((d) => `@${d}`).join(", ")} accounts can sign in to Terence Media Hub.`, "domain_not_allowed");
  }
  return { uid: decoded.uid, email, name: (decoded.name as string | undefined) ?? email.split("@")[0], picture: (decoded.picture as string | undefined) ?? null };
}

/** Turns an email into a valid, readable username (letters, numbers, dot, dash, underscore). */
export function usernameFromEmail(email: string): string {
  const local = email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return (local || "user").slice(0, 56);
}
