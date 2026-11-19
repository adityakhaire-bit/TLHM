import { z } from "zod";
import { assertNotThrottled, clearLoginFailures, loginThrottleKey, recordLoginFailure } from "./auth";
import { sessionFromIdToken, assertSameOriginPost } from "./firebase-session";
import {
  firebaseSendPasswordReset, firebaseSendVerification, firebaseSetDisplayName, firebaseSignInWithPassword, firebaseSignUp, loginReturnUrl,
} from "./firebase-rest";
import { allowedDomains, isAllowedEmail } from "./google-auth";
import { ApiError, ok, readJson } from "./http";

const email = z.string().trim().toLowerCase().email().max(255);
const password = z.string().min(1).max(200);

function requireAllowedEmail(value: string) {
  const domains = allowedDomains();
  if (!domains.length) throw new ApiError(503, "Company sign-in is turned off on this server", "firebase_disabled");
  if (!isAllowedEmail(value, domains)) throw new ApiError(403, `Only ${domains.map((d) => `@${d}`).join(", ")} email addresses can use Terence Media Hub.`, "domain_not_allowed");
}

async function parse<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T>> {
  assertSameOriginPost(request);
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, "Please fill in all fields correctly", "invalid_body", z.flattenError(parsed.error).fieldErrors);
  return parsed.data;
}

/** Create a Firebase account and send the confirmation email. No TMH account exists until the email is confirmed. */
export async function emailSignUp(request: Request) {
  const body = await parse(request, z.object({ name: z.string().trim().min(1).max(120), email, password: z.string().min(10, "Use at least 10 characters").max(200) }));
  requireAllowedEmail(body.email);
  const key = loginThrottleKey(request, body.email);
  assertNotThrottled(key);
  recordLoginFailure(key); // counts toward the limit so sign-up cannot be used to spam emails
  const account = await firebaseSignUp(body.email, body.password);
  await firebaseSetDisplayName(account.idToken, body.name).catch(() => {});
  await firebaseSendVerification(account.idToken, loginReturnUrl(request, "verified=1"));
  return ok({ sent: true, email: body.email }, 201);
}

/** Email + password sign-in. Refuses unconfirmed emails (code email_not_verified). */
export async function emailSignIn(request: Request) {
  const body = await parse(request, z.object({ email, password }));
  requireAllowedEmail(body.email);
  const key = loginThrottleKey(request, body.email);
  assertNotThrottled(key);
  let idToken: string;
  try {
    idToken = (await firebaseSignInWithPassword(body.email, body.password)).idToken;
  } catch (error) {
    if (error instanceof ApiError && error.code === "invalid_credentials") recordLoginFailure(key);
    throw error;
  }
  clearLoginFailures(key);
  return sessionFromIdToken(idToken, request);
}

/** Sends the confirmation email again (needs the password to prove it is the account owner). */
export async function emailResendVerification(request: Request) {
  const body = await parse(request, z.object({ email, password }));
  requireAllowedEmail(body.email);
  const key = loginThrottleKey(request, body.email);
  assertNotThrottled(key);
  recordLoginFailure(key);
  const { idToken } = await firebaseSignInWithPassword(body.email, body.password);
  await firebaseSendVerification(idToken, loginReturnUrl(request, "verified=1"));
  return ok({ sent: true });
}

/** Password reset email. Always answers the same way, so it cannot be used to discover which emails have accounts. */
export async function emailPasswordReset(request: Request) {
  const body = await parse(request, z.object({ email }));
  requireAllowedEmail(body.email);
  const key = loginThrottleKey(request, `reset:${body.email}`);
  assertNotThrottled(key);
  recordLoginFailure(key);
  try {
    await firebaseSendPasswordReset(body.email, loginReturnUrl(request, "reset=1"));
  } catch (error) {
    // Hide "no such account"; surface real problems (provider disabled, unreachable, rate limit).
    if (!(error instanceof ApiError) || error.code === "invalid_credentials") return ok({ sent: true });
    throw error;
  }
  return ok({ sent: true });
}
