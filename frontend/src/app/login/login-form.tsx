"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { api, errorMessage } from "@/lib/client";

export function LoginForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      await api("/api/auth/login", { method: "POST", json: { username: String(form.get("username") ?? ""), password: String(form.get("password") ?? "") } });
      window.location.href = "/";
    } catch (cause) {
      setError(errorMessage(cause, "Sign-in failed"));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      {error && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</p>}
      <label className="block text-sm font-medium">Username<input required name="username" autoComplete="username" autoCapitalize="none" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-500" /></label>
      <label className="block text-sm font-medium">Password<input required name="password" type="password" autoComplete="current-password" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-500" /></label>
      <button disabled={busy} className="w-full rounded-lg bg-[#182230] px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
