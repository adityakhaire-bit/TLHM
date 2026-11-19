"use client";

import { useState } from "react";

export function SignOutButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className={className}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        window.location.href = "/login";
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
