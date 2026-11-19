"use client";

// Firebase web SDK, loaded only when someone clicks "Continue with Google".
// The web config is public by design; access is enforced by our server (allowed domains, roles).
import type { FirebaseApp } from "firebase/app";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
};

export const firebaseConfigured = Boolean(config.apiKey && config.authDomain && config.projectId);

let appPromise: Promise<FirebaseApp> | null = null;
function firebaseApp() {
  appPromise ??= import("firebase/app").then(({ getApps, initializeApp }) => getApps()[0] ?? initializeApp(config));
  return appPromise;
}

/**
 * Opens the Google account chooser and returns a fresh Firebase ID token for our server to verify.
 * The Firebase browser session is cleared right after: the app uses its own session cookie.
 */
export async function signInWithGoogle(hostedDomain?: string): Promise<string> {
  // Firebase's Google sign-in needs browser security features (Web Crypto) that only exist on
  // https:// addresses and localhost. Explain that instead of failing with "auth/internal-error".
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw Object.assign(new Error("insecure"), { code: "tmh/insecure-origin" });
  }
  const app = await firebaseApp();
  const { getAuth, GoogleAuthProvider, signInWithPopup, signOut, browserSessionPersistence, setPersistence } = await import("firebase/auth");
  const auth = getAuth(app);
  await setPersistence(auth, browserSessionPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account", ...(hostedDomain ? { hd: hostedDomain } : {}) });
  const result = await signInWithPopup(auth, provider);
  const token = await result.user.getIdToken(true);
  await signOut(auth).catch(() => {});
  return token;
}

// ---------- Email + password (works on plain http:// office addresses too) ----------

async function emailAuth() {
  const app = await firebaseApp();
  const mod = await import("firebase/auth");
  const auth = mod.getAuth(app);
  await mod.setPersistence(auth, mod.browserSessionPersistence);
  return { auth, mod };
}

/** Where the verification / reset email link sends people back to (this same site's login page). */
const returnUrl = (query: string) => `${window.location.origin}/login?${query}`;

/**
 * Creates the Firebase account and emails a verification link. The person can sign in only after
 * clicking it (the server refuses unverified emails), which proves they own the mailbox.
 */
export async function signUpWithEmail(name: string, email: string, password: string) {
  const { auth, mod } = await emailAuth();
  const { user } = await mod.createUserWithEmailAndPassword(auth, email, password);
  if (name.trim()) await mod.updateProfile(user, { displayName: name.trim() }).catch(() => {});
  await mod.sendEmailVerification(user, { url: returnUrl("verified=1") });
  await mod.signOut(auth).catch(() => {});
}

/** Signs in with email + password and returns a fresh ID token for our server. */
export async function signInWithEmail(email: string, password: string): Promise<string> {
  const { auth, mod } = await emailAuth();
  const { user } = await mod.signInWithEmailAndPassword(auth, email, password);
  if (!user.emailVerified) {
    await mod.signOut(auth).catch(() => {});
    throw Object.assign(new Error("not verified"), { code: "tmh/email-not-verified" });
  }
  const token = await user.getIdToken(true);
  await mod.signOut(auth).catch(() => {});
  return token;
}

/** Sends the verification email again (needs the password, because Firebase requires a signed-in user). */
export async function resendVerificationEmail(email: string, password: string) {
  const { auth, mod } = await emailAuth();
  const { user } = await mod.signInWithEmailAndPassword(auth, email, password);
  if (!user.emailVerified) await mod.sendEmailVerification(user, { url: returnUrl("verified=1") });
  await mod.signOut(auth).catch(() => {});
}

export async function sendPasswordReset(email: string) {
  const { auth, mod } = await emailAuth();
  await mod.sendPasswordResetEmail(auth, email, { url: returnUrl("reset=1") });
}

/** Friendly text for email/password errors. */
export function emailErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code ?? "";
  if (code === "auth/email-already-in-use") return "An account with this email already exists. Sign in instead, or use “Forgot password?”.";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") return "Incorrect email or password.";
  if (code === "auth/invalid-email") return "That email address doesn't look right.";
  if (code === "auth/weak-password" || code === "auth/password-does-not-meet-requirements") return "Choose a stronger password (at least 10 characters).";
  if (code === "auth/too-many-requests") return "Too many attempts. Wait a few minutes and try again.";
  if (code === "auth/operation-not-allowed") return "Email sign-in is not enabled in Firebase yet (Authentication → Sign-in method → Email/Password).";
  if (code === "auth/network-request-failed") return "No internet connection. Admins can still use the username sign-in below.";
  if (code === "auth/unauthorized-continue-uri" || code === "auth/invalid-continue-uri") return "This address is not authorised in Firebase (Authentication → Settings → Authorized domains).";
  if (code === "tmh/email-not-verified") return "Please confirm your email first: open the verification link we sent you, then sign in.";
  return error instanceof Error ? error.message : "Something went wrong.";
}

/** Friendly text for common Firebase sign-in errors. */
export function googleErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code ?? "";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "Google sign-in was cancelled.";
  if (code === "auth/popup-blocked") return "Your browser blocked the Google window. Allow pop-ups for this site and try again.";
  if (code === "auth/unauthorized-domain") return "This address is not authorised for Google sign-in yet. An admin must add it in Firebase → Authentication → Settings → Authorized domains.";
  if (code === "auth/operation-not-allowed") return "Google sign-in is not enabled in Firebase yet (Authentication → Sign-in method → Google).";
  if (code === "auth/network-request-failed") return "No internet connection. Use your username and password instead.";
  if (code === "tmh/insecure-origin") return "Google sign-in only works on a secure (https) address or on the Mac itself (localhost). On this computer, use your username and password for now.";
  if (code === "auth/internal-error") return "Google sign-in could not load. A browser extension (ad or privacy blocker), antivirus or VPN may be blocking apis.google.com. Try a private window or another browser, or use your username and password.";
  return error instanceof Error ? error.message : "Google sign-in failed.";
}
