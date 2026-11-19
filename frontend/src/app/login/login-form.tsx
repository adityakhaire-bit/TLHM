"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, errorMessage } from "@/lib/client";
import {
  emailErrorMessage, firebaseConfigured, googleErrorMessage, resendVerificationEmail, sendPasswordReset,
  signInWithEmail, signInWithGoogle, signUpWithEmail,
} from "@/lib/firebase-client";

type Mode = "signin" | "signup" | "reset";
type Notice = { kind: "error" | "info" | "success"; text: string } | null;
const NOTICE_STYLE = {
  error: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-slate-200 bg-slate-50 text-slate-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
};
const inputClass = "mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-slate-500";

export function LoginForm({ googleDomains }: { googleDomains: string[] }) {
  const companySignIn = firebaseConfigured && googleDomains.length > 0;
  const [mode, setMode] = useState<Mode>("signin");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [unverified, setUnverified] = useState(false);
  const [showLegacy, setShowLegacy] = useState(!companySignIn);
  const domainText = googleDomains.map((domain) => `@${domain}`).join(", ");

  // Messages after returning from the links in verification / reset emails.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("verified")) setNotice({ kind: "success", text: "Email confirmed. You can sign in now." });
    if (params.get("reset")) setNotice({ kind: "success", text: "Password changed. Sign in with your new password." });
  }, []);

  const allowed = (value: string) => googleDomains.some((domain) => value.trim().toLowerCase().endsWith(`@${domain}`));
  function switchMode(next: Mode) { setMode(next); setNotice(null); setUnverified(false); }

  async function finishWithToken(idToken: string) {
    await api("/api/auth/firebase", { method: "POST", json: { idToken } });
    window.location.href = "/";
  }

  async function emailSignIn(event: FormEvent) {
    event.preventDefault();
    if (!allowed(email)) { setNotice({ kind: "error", text: `Use your ${domainText} email address.` }); return; }
    setBusy("email"); setNotice(null); setUnverified(false);
    try {
      await finishWithToken(await signInWithEmail(email.trim(), password));
    } catch (cause) {
      const code = (cause as { code?: string })?.code ?? "";
      setUnverified(code === "tmh/email-not-verified");
      setNotice({ kind: "error", text: code.startsWith("auth/") || code.startsWith("tmh/") ? emailErrorMessage(cause) : errorMessage(cause, "Sign-in failed") });
      setBusy("");
    }
  }

  async function emailSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    if (!allowed(email)) { setNotice({ kind: "error", text: `Only ${domainText} email addresses can create an account.` }); return; }
    if (password.length < 10) { setNotice({ kind: "error", text: "Use at least 10 characters for your password." }); return; }
    if (password !== confirm) { setNotice({ kind: "error", text: "The two passwords don't match." }); return; }
    setBusy("signup"); setNotice(null);
    try {
      await signUpWithEmail(name, email.trim(), password);
      setMode("signin");
      setPassword("");
      setNotice({ kind: "success", text: `Account created. We sent a confirmation link to ${email.trim()}. Open it (check spam too), then sign in here.` });
    } catch (cause) {
      setNotice({ kind: "error", text: emailErrorMessage(cause) });
    } finally { setBusy(""); }
  }

  async function resend() {
    setBusy("resend");
    try {
      await resendVerificationEmail(email.trim(), password);
      setNotice({ kind: "info", text: `Sent a new confirmation link to ${email.trim()}. Check spam too.` });
    } catch (cause) { setNotice({ kind: "error", text: emailErrorMessage(cause) }); }
    finally { setBusy(""); }
  }

  async function reset(event: FormEvent) {
    event.preventDefault();
    if (!allowed(email)) { setNotice({ kind: "error", text: `Enter your ${domainText} email address.` }); return; }
    setBusy("reset"); setNotice(null);
    try {
      await sendPasswordReset(email.trim());
    } catch (cause) {
      const code = (cause as { code?: string })?.code ?? "";
      if (code !== "auth/user-not-found") { setNotice({ kind: "error", text: emailErrorMessage(cause) }); setBusy(""); return; }
    }
    // Same message whether or not the account exists, so the form cannot be used to probe for accounts.
    setNotice({ kind: "success", text: `If an account exists for ${email.trim()}, a password reset link is on its way. Check spam too.` });
    setBusy("");
  }

  async function google() {
    setBusy("google"); setNotice(null);
    let idToken: string;
    try {
      idToken = await signInWithGoogle(googleDomains.length === 1 ? googleDomains[0] : undefined);
    } catch (cause) { setNotice({ kind: "error", text: googleErrorMessage(cause) }); setBusy(""); return; }
    try { await finishWithToken(idToken); } catch (cause) { setNotice({ kind: "error", text: errorMessage(cause, "Google sign-in failed") }); setBusy(""); }
  }

  async function legacySignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("legacy"); setNotice(null);
    try {
      await api("/api/auth/login", { method: "POST", json: { username: String(form.get("username") ?? ""), password: String(form.get("password") ?? "") } });
      window.location.href = "/";
    } catch (cause) { setNotice({ kind: "error", text: errorMessage(cause, "Sign-in failed") }); setBusy(""); }
  }

  return (
    <div className="mt-6 space-y-4">
      {notice && (
        <div role={notice.kind === "error" ? "alert" : "status"} className={`rounded-lg border px-3 py-2 text-sm ${NOTICE_STYLE[notice.kind]}`}>
          {notice.text}
          {unverified && <button type="button" disabled={Boolean(busy)} onClick={() => void resend()} className="mt-1 block font-medium underline">{busy === "resend" ? "Sending…" : "Send the confirmation link again"}</button>}
        </div>
      )}

      {companySignIn && (
        <>
          {mode !== "reset" && (
            <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-sm">
              {(["signin", "signup"] as const).map((tab) => (
                <button key={tab} type="button" onClick={() => switchMode(tab)}
                  className={`rounded-md py-2 font-medium ${mode === tab ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>
                  {tab === "signin" ? "Sign in" : "Create account"}
                </button>
              ))}
            </div>
          )}

          {mode === "signin" && (
            <form onSubmit={emailSignIn} className="space-y-4">
              <label className="block text-sm font-medium">Work email<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`name${googleDomains[0] ? `@${googleDomains[0]}` : ""}`} className={inputClass} /></label>
              <label className="block text-sm font-medium">
                <span className="flex items-center justify-between">Password<button type="button" onClick={() => switchMode("reset")} className="text-xs font-normal text-slate-500 hover:text-slate-800">Forgot password?</button></span>
                <input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
              </label>
              <button disabled={Boolean(busy)} className="w-full rounded-lg bg-[#182230] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{busy === "email" ? "Signing in…" : "Sign in"}</button>
            </form>
          )}

          {mode === "signup" && (
            <form onSubmit={emailSignUp} className="space-y-4">
              <label className="block text-sm font-medium">Your name<input name="name" required maxLength={120} autoComplete="name" className={inputClass} /></label>
              <label className="block text-sm font-medium">Work email<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`name${googleDomains[0] ? `@${googleDomains[0]}` : ""}`} className={inputClass} /></label>
              <label className="block text-sm font-medium">Password <span className="font-normal text-slate-400">(min 10 characters)</span><input required type="password" minLength={10} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} /></label>
              <label className="block text-sm font-medium">Repeat password<input name="confirm" required type="password" minLength={10} autoComplete="new-password" className={inputClass} /></label>
              <button disabled={Boolean(busy)} className="w-full rounded-lg bg-[#182230] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{busy === "signup" ? "Creating account…" : "Create account"}</button>
              <p className="text-xs leading-5 text-slate-500">We&apos;ll email you a confirmation link. New accounts can browse, preview and download; an admin can give upload rights.</p>
            </form>
          )}

          {mode === "reset" && (
            <form onSubmit={reset} className="space-y-4">
              <p className="text-sm text-slate-600">Enter your work email and we&apos;ll send a link to choose a new password.</p>
              <label className="block text-sm font-medium">Work email<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} /></label>
              <button disabled={Boolean(busy)} className="w-full rounded-lg bg-[#182230] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{busy === "reset" ? "Sending…" : "Send reset link"}</button>
              <button type="button" onClick={() => switchMode("signin")} className="w-full text-center text-xs text-slate-500 hover:text-slate-800">Back to sign in</button>
            </form>
          )}

          {mode !== "reset" && (
            <>
              <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-slate-400"><span className="h-px flex-1 bg-slate-200" />or<span className="h-px flex-1 bg-slate-200" /></div>
              <button type="button" disabled={Boolean(busy)} onClick={() => void google()}
                className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50">
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
                  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.6 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                  <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                  <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
                </svg>
                {busy === "google" ? "Signing in with Google…" : "Continue with Google"}
              </button>
              <p className="text-center text-[11px] text-slate-500">For {domainText} accounts</p>
            </>
          )}
        </>
      )}

      {companySignIn && (
        <button type="button" onClick={() => setShowLegacy(!showLegacy)} className="w-full pt-1 text-center text-xs text-slate-400 hover:text-slate-700">
          {showLegacy ? "Hide administrator sign-in" : "Administrator sign-in (username)"}
        </button>
      )}
      {showLegacy && (
        <form onSubmit={legacySignIn} className="space-y-3 rounded-lg border border-slate-200 p-4">
          <label className="block text-sm font-medium">Username<input required name="username" autoComplete="username" autoCapitalize="none" className={inputClass} /></label>
          <label className="block text-sm font-medium">Password<input required name="password" type="password" autoComplete="current-password" className={inputClass} /></label>
          <button disabled={Boolean(busy)} className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 disabled:opacity-50">{busy === "legacy" ? "Signing in…" : "Sign in with username"}</button>
        </form>
      )}
    </div>
  );
}
