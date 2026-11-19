import { ApiError } from "./http";

/**
 * Firebase Authentication (email + password) called FROM THE SERVER through the Identity Toolkit REST API.
 * Browsers only talk to the Mac mini, so sign-in works even on computers whose network, antivirus or
 * extensions block Google's APIs. Uses the project's public web API key; no secrets involved.
 */
const BASE = "https://identitytoolkit.googleapis.com/v1";

function apiKey() {
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!key) throw new ApiError(503, "Email sign-in is not configured on this server", "firebase_not_configured");
  return key;
}

/** Firebase error codes → messages people understand. */
function translate(code: string): ApiError {
  const base = code.split(" ")[0].split(":")[0];
  switch (base) {
    case "EMAIL_EXISTS": return new ApiError(409, "An account with this email already exists. Sign in instead, or use “Forgot password?”.", "email_exists");
    case "INVALID_LOGIN_CREDENTIALS":
    case "INVALID_PASSWORD":
    case "EMAIL_NOT_FOUND": return new ApiError(401, "Incorrect email or password.", "invalid_credentials");
    case "USER_DISABLED": return new ApiError(403, "This account has been disabled. Ask an administrator.", "account_disabled");
    case "WEAK_PASSWORD": return new ApiError(400, "Choose a stronger password (at least 10 characters).", "weak_password");
    case "INVALID_EMAIL": return new ApiError(400, "That email address doesn't look right.", "invalid_email");
    case "TOO_MANY_ATTEMPTS_TRY_LATER": return new ApiError(429, "Too many attempts. Wait a few minutes and try again.", "too_many_attempts");
    case "OPERATION_NOT_ALLOWED": return new ApiError(503, "Email sign-in is not enabled in Firebase yet (Authentication → Sign-in method → Email/Password).", "email_provider_disabled");
    case "INVALID_CONTINUE_URI":
    case "UNAUTHORIZED_DOMAIN": return new ApiError(400, "This address is not authorised in Firebase (Authentication → Settings → Authorized domains).", "unauthorized_domain");
    default: return new ApiError(502, "The sign-in service returned an error. Please try again.", "firebase_error");
  }
}

async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/${path}?key=${encodeURIComponent(apiKey())}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(503, "The media server can't reach the sign-in service (no internet on the Mac mini?). Admins can use the username sign-in.", "firebase_unreachable");
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) throw translate(data.error?.message ?? "");
  return data;
}

type TokenResponse = { idToken: string; localId: string; email: string };

export async function firebaseSignUp(email: string, password: string) {
  return call<TokenResponse>("accounts:signUp", { email, password, returnSecureToken: true });
}

export async function firebaseSignInWithPassword(email: string, password: string) {
  return call<TokenResponse>("accounts:signInWithPassword", { email, password, returnSecureToken: true });
}

export async function firebaseSetDisplayName(idToken: string, displayName: string) {
  await call("accounts:update", { idToken, displayName, returnSecureToken: false });
}

/** Sends Firebase's "confirm your email" message. continueUrl must be on an authorised domain. */
export async function firebaseSendVerification(idToken: string, continueUrl?: string) {
  await call("accounts:sendOobCode", { requestType: "VERIFY_EMAIL", idToken, ...(continueUrl ? { continueUrl } : {}) });
}

export async function firebaseSendPasswordReset(email: string, continueUrl?: string) {
  await call("accounts:sendOobCode", { requestType: "PASSWORD_RESET", email, ...(continueUrl ? { continueUrl } : {}) });
}

/** The address people should return to after clicking an email link: this site's own login page. */
export function loginReturnUrl(request: Request, query: string): string | undefined {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return undefined;
  const proto = request.headers.get("x-forwarded-proto") ?? (host.endsWith(".ts.net") ? "https" : "http");
  return `${proto}://${host}/login?${query}`;
}
