"use client";

import { useState } from "react";
import { Check, Copy, Mail, MessageCircle, Wifi } from "lucide-react";
import { api, errorMessage } from "@/lib/client";

type Link = { url: string; kind: "ip" | "name" };

export function SharePanel({ links, guestEnabled, isAdmin }: { links: Link[]; guestEnabled: boolean; isAdmin: boolean }) {
  const [copied, setCopied] = useState("");
  const [enabled, setEnabled] = useState(guestEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const main = links.find((link) => link.kind === "ip")?.url ?? links[0]?.url ?? "";
  const message = `Terence Media Hub, our footage library. Open it on the office Wi-Fi: ${main}`;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API needs https or localhost; fall back to a hidden text field on plain http LAN addresses.
      const field = document.createElement("textarea");
      field.value = text;
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    setCopied(text);
    setTimeout(() => setCopied(""), 2000);
  }

  async function toggle(next: boolean) {
    setBusy(true); setError("");
    try { await api("/api/settings/lan-access", { method: "POST", json: { enabled: next } }); setEnabled(next); }
    catch (cause) { setError(errorMessage(cause, "Could not change the setting")); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold">Links for the office Wi-Fi</h2>
        <p className="mt-1 text-xs text-slate-500">Send one of these to a teammate. Their computer or phone must be on the same Wi-Fi/network as the media hub Mac.</p>
        <ul className="mt-4 space-y-2">
          {links.map((link) => (
            <li key={link.url} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
              <div className="min-w-0">
                <a href={link.url} className="break-all font-mono text-sm font-medium text-slate-900 hover:underline">{link.url}</a>
                <p className="text-[11px] text-slate-500">{link.kind === "ip" ? "Works on every computer and phone" : "Name of this Mac: keeps working if the IP address changes (Windows 10+, Mac, iPhone)"}</p>
              </div>
              <button type="button" onClick={() => void copy(link.url)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-300">
                {copied === link.url ? <><Check size={13} className="text-emerald-600" />Copied</> : <><Copy size={13} />Copy</>}
              </button>
            </li>
          ))}
          {links.length === 0 && <li className="text-sm text-amber-800">This Mac is not connected to a local network right now.</li>}
        </ul>
      </section>

      {main && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold">Invite teammates</h2>
          <p className="mt-1 text-xs text-slate-500">Opens your own WhatsApp or email app with the link filled in. Nothing is sent until you press send there.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" style={{ color: "#fff" }} className="inline-flex items-center gap-2 rounded-lg bg-[#182230] px-3.5 py-2 text-sm font-medium text-white"><MessageCircle size={15} />Share on WhatsApp</a>
            <a href={`mailto:?subject=${encodeURIComponent("Terence Media Hub link")}&body=${encodeURIComponent(message)}`} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-700"><Mail size={15} />Share by email</a>
            <button type="button" onClick={() => void copy(message)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-700">
              {copied === message ? <><Check size={15} className="text-emerald-600" />Copied</> : <><Copy size={15} />Copy invite message</>}
            </button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-[560px]">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold"><Wifi size={15} />Open access on the office Wi-Fi</h2>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              {enabled
                ? "On: anyone on the office network can browse, play and download footage without signing in (view only, no upload, edit or delete). People outside the office still have to sign in."
                : "Off: everyone has to sign in with their work email, even on the office Wi-Fi."}
            </p>
            {enabled && <p className="mt-1 text-xs text-amber-700">Guests on the same Wi-Fi can see the library too. Switch this off if visitors use the office Wi-Fi.</p>}
          </div>
          {isAdmin ? (
            <button type="button" role="switch" aria-checked={enabled} disabled={busy} onClick={() => void toggle(!enabled)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition ${enabled ? "bg-emerald-600" : "bg-slate-300"} disabled:opacity-50`}>
              <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${enabled ? "left-[22px]" : "left-0.5"}`} />
              <span className="sr-only">Open access on the office Wi-Fi</span>
            </button>
          ) : <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${enabled ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{enabled ? "On" : "Off"}</span>}
        </div>
        {error && <p role="alert" className="mt-3 text-xs text-red-700">{error}</p>}
      </section>
    </div>
  );
}
