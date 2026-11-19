"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, formatDate } from "@/lib/client";

type UserRow = {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  role: "admin" | "editor" | "viewer";
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  avatarUrl: string | null;
  signInMethods: ("password" | "google")[];
};

const ROLE_HELP = {
  viewer: "Browse, preview, download",
  editor: "+ upload, edit, folders",
  admin: "+ users, delete, backups",
};

export function UsersTable({ currentUserId, allowedDomains }: { currentUserId: number; allowedDomains: string[] }) {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try { setUsers((await api<{ users: UserRow[] }>("/api/users")).users); setError(""); }
    catch (cause) { setError(errorMessage(cause, "Could not load users")); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function update(user: UserRow, changes: Partial<Pick<UserRow, "role" | "isActive" | "email">>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusyId(user.id); setError("");
    try { await api(`/api/users/${user.id}`, { method: "PATCH", json: changes }); await load(); }
    catch (cause) { setError(errorMessage(cause, "Could not update user")); }
    finally { setBusyId(null); }
  }

  return (
    <section className="rounded-xl border border-[#e8ebef] bg-white">
      <div className="border-b border-slate-100 px-5 py-3.5 text-xs leading-5 text-slate-500">
        {allowedDomains.length ? <>People with a Google account at <b>{allowedDomains.map((d) => `@${d}`).join(", ")}</b> can sign in with Google and start as <b>viewer</b>.</> : <>Google sign-in is turned off (no allowed email domain configured).</>}
        Change their role here. Changing a role or deactivating signs that person out immediately.
      </div>
      {error && <p role="alert" className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">{error}</p>}
      {!users ? <p className="p-8 text-center text-sm text-slate-500">Loading users…</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr><th className="px-5 py-2.5 font-semibold">Person</th><th className="px-3 py-2.5 font-semibold">Sign-in</th><th className="px-3 py-2.5 font-semibold">Role</th><th className="px-3 py-2.5 font-semibold">Last sign-in</th><th className="px-5 py-2.5 font-semibold text-right">Access</th></tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className={`border-t border-slate-100 ${user.isActive ? "" : "opacity-60"}`}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      {user.avatarUrl
                        // eslint-disable-next-line @next/next/no-img-element -- external Google avatar
                        ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-8 rounded-full" />
                        : <span className="grid size-8 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{(user.displayName || user.username).slice(0, 2).toUpperCase()}</span>}
                      <div className="min-w-0">
                        <p className="truncate font-medium">{user.displayName || user.username}{user.id === currentUserId && <span className="ml-2 text-[10px] font-normal text-slate-400">(you)</span>}</p>
                        <p className="truncate text-xs text-slate-500">{user.email ?? `@${user.username}`}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-600">{user.signInMethods.map((method) => method === "google" ? "Google" : "Password").join(" + ") || "—"}</td>
                  <td className="px-3 py-3">
                    <select aria-label={`Role for ${user.username}`} disabled={busyId === user.id} value={user.role}
                      onChange={(event) => void update(user, { role: event.target.value as UserRow["role"] })}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs">
                      {(["viewer", "editor", "admin"] as const).map((role) => <option key={role} value={role}>{role} — {ROLE_HELP[role]}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-500">{user.lastLoginAt ? formatDate(user.lastLoginAt, true) : "Never"}</td>
                  <td className="px-5 py-3 text-right">
                    {user.isActive
                      ? <button type="button" disabled={busyId === user.id || user.id === currentUserId} onClick={() => void update(user, { isActive: false }, `Deactivate ${user.displayName || user.username}? They will be signed out and cannot sign in until reactivated.`)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:border-red-200 hover:text-red-700 disabled:opacity-40">Deactivate</button>
                      : <button type="button" disabled={busyId === user.id} onClick={() => void update(user, { isActive: true })} className="rounded-md bg-[#182230] px-2.5 py-1.5 text-xs font-medium text-white">Reactivate</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
