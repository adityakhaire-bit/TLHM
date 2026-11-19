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

export type FirebaseProvider = "google.com" | "password";
const PROVIDERS: FirebaseProvider[] = ["google.com", "password"];

/**
 * Verifies a Firebase ID token from either "Continue with Google" or email + password sign-in.
 * Rules for both: fresh sign-in, VERIFIED email (for email/password this means the person clicked the
 * link Firebase emailed them, proving they own the mailbox), and an allowed email domain.
 */
export async function verifyFirebaseIdToken(idToken: string): Promise<GoogleIdentity & { provider: FirebaseProvider }> {
  const domains = allowedDomains();
  if (domains.length === 0) throw new ApiError(503, "Company sign-in is turned off on this server", "firebase_disabled");

  let decoded: DecodedIdToken;
  try {
    decoded = await firebaseAuth().verifyIdToken(idToken);
  } catch {
    throw new ApiError(401, "Sign-in could not be verified. Please try again.", "invalid_firebase_token");
  }
  const provider = decoded.firebase?.sign_in_provider as FirebaseProvider;
  if (!PROVIDERS.includes(provider)) throw new ApiError(401, "Unsupported sign-in method", "wrong_provider");
  // Only accept a sign-in that just happened, so an old token cannot be replayed to open a session.
  if (Date.now() / 1000 - decoded.auth_time > 10 * 60) throw new ApiError(401, "That sign-in is too old. Please try again.", "stale_firebase_token");
  const email = decoded.email?.toLowerCase();
  if (!email) throw new ApiError(403, "Your account has no email address", "email_missing");
  if (!isAllowedEmail(email, domains)) {
    throw new ApiError(403, `Only ${domains.map((d) => `@${d}`).join(", ")} accounts can sign in to Terence Media Hub.`, "domain_not_allowed");
  }
  if (decoded.email_verified !== true) {
    throw new ApiError(403, provider === "password"
      ? "Please confirm your email first: open the verification link we sent you, then sign in again."
      : "Your Google account email is not verified", "email_not_verified");
  }
  return { uid: decoded.uid, email, name: (decoded.name as string | undefined) ?? email.split("@")[0], picture: (decoded.picture as string | undefined) ?? null, provider };
}

/** Google-only variant kept for the /api/auth/google route. */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  const identity = await verifyFirebaseIdToken(idToken);
  if (identity.provider !== "google.com") throw new ApiError(401, "Please use the Google button to sign in", "wrong_provider");
  return identity;
}

/** Turns an email into a valid, readable username (letters, numbers, dot, dash, underscore). */
export function usernameFromEmail(email: string): string {
  const local = email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return (local || "user").slice(0, 56);
}
