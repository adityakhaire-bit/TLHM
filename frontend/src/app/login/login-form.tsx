"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { api, errorMessage } from "@/lib/client";
import { firebaseConfigured, googleErrorMessage, signInWithGoogle } from "@/lib/firebase-client";

export function LoginForm({ googleDomains }: { googleDomains: string[] }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "password" | "google">("");
  const googleEnabled = firebaseConfigured && googleDomains.length > 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("password"); setError("");
    try {
      await api("/api/auth/login", { method: "POST", json: { username: String(form.get("username") ?? ""), password: String(form.get("password") ?? "") } });
      window.location.href = "/";
    } catch (cause) {
      setError(errorMessage(cause, "Sign-in failed"));
      setBusy("");
    }
  }

  async function google() {
    setBusy("google"); setError("");
    let idToken: string;
    try {
      idToken = await signInWithGoogle(googleDomains.length === 1 ? googleDomains[0] : undefined);
    } catch (cause) {
      setError(googleErrorMessage(cause));
      setBusy("");
      return;
    }
    try {
      await api("/api/auth/google", { method: "POST", json: { idToken } });
      window.location.href = "/";
    } catch (cause) {
      setError(errorMessage(cause, "Google sign-in failed"));
      setBusy("");
    }
  }

  return (
    <div className="mt-6 space-y-4">
      {error && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</p>}
      {googleEnabled && (
        <>
          <button type="button" disabled={Boolean(busy)} onClick={() => void google()}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.6 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
            </svg>
            {busy === "google" ? "Signing in with Google…" : "Continue with Google"}
          </button>
          <p className="text-center text-[11px] text-slate-500">For {googleDomains.map((domain) => `@${domain}`).join(", ")} accounts</p>
          <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-slate-400"><span className="h-px flex-1 bg-slate-200" />or<span className="h-px flex-1 bg-slate-200" /></div>
        </>
      )}
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-medium">Username<input required name="username" autoComplete="username" autoCapitalize="none" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-500" /></label>
        <label className="block text-sm font-medium">Password<input required name="password" type="password" autoComplete="current-password" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-500" /></label>
        <button disabled={Boolean(busy)} className="w-full rounded-lg bg-[#182230] px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">{busy === "password" ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
