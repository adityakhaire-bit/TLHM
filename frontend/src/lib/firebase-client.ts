"use client";

// Firebase web SDK, loaded only when someone clicks "Continue with Google".
// (Email + password sign-in does not use the browser SDK: it goes through /api/auth/email/* on our server.)
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
