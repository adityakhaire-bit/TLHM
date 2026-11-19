"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, HardDrive, LoaderCircle, TriangleAlert, Workflow } from "lucide-react";
import { api, errorMessage, formatBytes, formatDate } from "@/lib/client";

type Status = {
  checkedAt: string;
  drive: { name: string; mounted: boolean; status: string; message: string | null; totalBytes: number | null; usedBytes: number | null; freeBytes: number | null; percentUsed: number | null };
  database: {
    connected: boolean; mediaCount: number; folderCount: number; tagCount: number;
    originalBytes: number; proxyBytes: number; thumbnailBytes: number; byType: Record<string, number>;
    lastBackup: { filename: string; at: string; sizeBytes: number | null } | null;
    lastBackupFailure: { at: string; error: string | null } | null;
    jobs: { queued: number; running: number; completed: number; failed: number };
    error?: string;
  };
};

/** Live storage / database / processing cards. Polls /api/storage/status every 15 seconds. */
export function StoragePanel({ isAdmin, layout = "stack" }: { isAdmin: boolean; layout?: "stack" | "grid" }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [backingUp, setBackingUp] = useState(false);
  const [backupMessage, setBackupMessage] = useState("");

  const load = useCallback(async () => {
    try { setStatus(await api<Status>("/api/storage/status")); setError(""); }
    catch (cause) { setError(errorMessage(cause, "Could not load storage status")); }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 15000);
    return () => clearInterval(timer);
  }, [load]);

  async function backupNow() {
    setBackingUp(true); setBackupMessage("");
    try {
      const result = await api<{ backup: { filename: string; sizeBytes: number } }>("/api/backups", { method: "POST" });
      setBackupMessage(`Saved ${result.backup.filename} (${formatBytes(result.backup.sizeBytes)})`);
      await load();
    } catch (cause) { setBackupMessage(errorMessage(cause, "Backup failed")); }
    finally { setBackingUp(false); }
  }

  if (!status) {
    return <section className="rounded-xl border border-[#e8ebef] bg-white p-5 text-sm text-slate-500">{error ? <span className="text-red-700">{error}</span> : <span className="inline-flex items-center gap-2"><LoaderCircle size={14} className="animate-spin" />Checking storage…</span>}</section>;
  }

  const { drive, database } = status;
  const percent = drive.percentUsed ?? 0;
  const barColor = percent >= 90 ? "bg-red-500" : percent >= 80 ? "bg-amber-500" : "bg-slate-800";

  return (
    <div className={layout === "grid" ? "grid gap-5 lg:grid-cols-3" : "space-y-5"}>
      <section id="storage" className={`rounded-xl border bg-white p-5 ${drive.mounted ? "border-[#e8ebef]" : "border-red-300"}`}>
        <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-semibold"><HardDrive size={15} />Primary media drive</h2>
          <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${drive.mounted ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{drive.mounted ? "Connected" : "Not available"}</span></div>
        <p className="mt-1 text-xs text-slate-500">{drive.name}</p>
        {!drive.mounted ? (
          <div className="mt-4 flex gap-2 rounded-lg bg-red-50 p-3 text-xs leading-5 text-red-800"><TriangleAlert size={15} className="mt-0.5 shrink-0" /><p><b>Uploads and downloads are paused.</b> {drive.message} Reconnect the drive to the Mac mini; processing resumes automatically.</p></div>
        ) : (
          <>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, percent)}%` }} /></div>
            <p className="mt-2 text-xs text-slate-600">{formatBytes(drive.usedBytes)} used of {formatBytes(drive.totalBytes)} · <b>{formatBytes(drive.freeBytes)} free</b> ({percent}% used)</p>
            {percent >= 85 && <p className="mt-2 text-xs text-amber-700">The drive is getting full. Free up space or add storage before large uploads.</p>}
          </>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-y-2 text-xs">
          <dt className="text-slate-500">Original files</dt><dd className="text-right font-medium">{database.mediaCount.toLocaleString()} · {formatBytes(database.originalBytes)}</dd>
          <dt className="text-slate-500">Previews (proxies)</dt><dd className="text-right font-medium">{formatBytes(database.proxyBytes)}</dd>
          <dt className="text-slate-500">Thumbnails</dt><dd className="text-right font-medium">{formatBytes(database.thumbnailBytes)}</dd>
        </dl>
      </section>

      <section className={`rounded-xl border bg-white p-5 ${database.connected ? "border-[#e8ebef]" : "border-red-300"}`}>
        <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-semibold"><Database size={15} />Database</h2>
          <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${database.connected ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{database.connected ? "Connected" : "Disconnected"}</span></div>
        {!database.connected && <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-800">{database.error}. Check that MySQL is running on the Mac mini.</p>}
        <dl className="mt-4 grid grid-cols-2 gap-y-2 text-xs">
          <dt className="text-slate-500">Media records</dt><dd className="text-right font-medium">{database.mediaCount.toLocaleString()}</dd>
          <dt className="text-slate-500">Folders</dt><dd className="text-right font-medium">{database.folderCount.toLocaleString()}</dd>
          <dt className="text-slate-500">Tags</dt><dd className="text-right font-medium">{database.tagCount.toLocaleString()}</dd>
          <dt className="text-slate-500">Last backup</dt><dd className="text-right font-medium">{database.lastBackup ? formatDate(database.lastBackup.at, true) : "Never"}</dd>
        </dl>
        {database.lastBackupFailure && <p className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs text-red-800">Last backup attempt failed ({formatDate(database.lastBackupFailure.at, true)}): {database.lastBackupFailure.error}</p>}
        {isAdmin && database.connected && (
          <div className="mt-4">
            <button type="button" disabled={backingUp || !drive.mounted} onClick={() => void backupNow()} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 disabled:opacity-50">{backingUp ? "Backing up…" : "Back up database now"}</button>
            {backupMessage && <p className="mt-2 text-xs text-slate-600">{backupMessage}</p>}
          </div>
        )}
        <p className="mt-3 text-[11px] leading-4 text-slate-400">Backups are saved on the media drive. That protects against database problems, not drive failure. Keep a second copy on another drive.</p>
      </section>

      <section className="rounded-xl border border-[#e8ebef] bg-white p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Workflow size={15} />Processing</h2>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {([["Queued", database.jobs.queued, "text-slate-700"], ["Processing", database.jobs.running, "text-blue-700"], ["Completed", database.jobs.completed, "text-emerald-700"], ["Failed", database.jobs.failed, "text-red-700"]] as const).map(([label, value, color]) => (
            <div key={label} className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] text-slate-500">{label}</p><p className={`mt-1 text-xl font-semibold ${color}`}>{value.toLocaleString()}</p></div>
          ))}
        </div>
        {database.jobs.failed > 0 && <a href="/library?status=failed" className="mt-3 inline-block text-xs font-medium text-red-700 underline">Review failed items</a>}
        <p className="mt-3 text-[11px] text-slate-400">Updated {formatDate(status.checkedAt, true)}</p>
      </section>
    </div>
  );
}
