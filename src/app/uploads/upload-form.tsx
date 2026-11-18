"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { CheckCircle2, CloudUpload, FileUp, LoaderCircle, X } from "lucide-react";

type Folder = { id: string; name: string; parent_id: string | null };
type UploadSession = { assetId: string; partSizeBytes: number; partCount: number };

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024; let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function UploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [folderId, setFolderId] = useState("");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [progress, setProgress] = useState(0);
  const [completedParts, setCompletedParts] = useState(0);
  const [partCount, setPartCount] = useState(0);
  const [pendingSession, setPendingSession] = useState<UploadSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/folders?all=true&limit=200", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json();
      setFolders(body.folders as Folder[]);
    }).catch(() => {});
  }, []);

  async function finishSession(session: UploadSession) {
    const completeResponse = await fetch(`/api/uploads/${session.assetId}/complete`, { method: "POST" });
    const result = await completeResponse.json();
    if (!completeResponse.ok) throw new Error(result.error || "Could not finish upload");
    setSuccess(result.status === "pending_review" ? "Upload complete and sent for approval." : "Upload complete. The asset is queued for processing.");
    setPendingSession(null); setFile(null); setTitle(""); setDescription(""); setFolderId("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) { setError("Choose a file to upload."); return; }
    setBusy(true); setError(""); setSuccess(""); setProgress(0); setCompletedParts(0);
    const abortController = new AbortController();
    controller.current = abortController;
    const { signal } = abortController;
    let session: UploadSession | undefined;
    let allPartsUploaded = false;
    try {
      const startResponse = await fetch("/api/uploads", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal,
        body: JSON.stringify({ title: title.trim() || file.name, description: description.trim() || null, filename: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, folderId: folderId || null }),
      });
      const start = await startResponse.json();
      if (!startResponse.ok) throw new Error(start.error || "Could not start upload");
      session = start as UploadSession;
      setPartCount(session.partCount);

      for (let partNumber = 1; partNumber <= session.partCount; partNumber++) {
        const begin = (partNumber - 1) * session.partSizeBytes;
        const end = Math.min(begin + session.partSizeBytes, file.size);
        const partResponse = await fetch(`/api/uploads/${session.assetId}/parts`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partNumber }), signal,
        });
        const part = await partResponse.json();
        if (!partResponse.ok) throw new Error(part.error || `Could not prepare part ${partNumber}`);
        const putResponse = await fetch(part.url as string, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: file.slice(begin, end), signal });
        if (!putResponse.ok) throw new Error(`Upload failed on part ${partNumber} (HTTP ${putResponse.status})`);
        setCompletedParts(partNumber);
        setProgress(Math.round((end / file.size) * 100));
      }
      allPartsUploaded = true;
      setPendingSession(session);
      await finishSession(session);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Upload failed";
      setError(allPartsUploaded ? `${message}. All parts are stored; use “Retry completion” to finalize safely.` : signal.aborted ? "Upload cancelled." : message);
      if (session && !allPartsUploaded) await fetch(`/api/uploads/${session.assetId}/abort`, { method: "POST" }).catch(() => {});
    } finally { controller.current = null; setBusy(false); }
  }

  async function retryCompletion() {
    if (!pendingSession) return;
    setBusy(true); setError("");
    try { await finishSession(pendingSession); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not complete the upload"); }
    finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
    <section className="rounded-xl border border-[#e8ebef] bg-white p-6">
      <h2 className="text-base font-semibold">Choose an asset</h2>
      <p className="mt-1 text-sm text-slate-500">Files upload directly to private Cloudflare R2 storage using short-lived links.</p>
      <label className="mt-5 flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 text-center hover:border-slate-400">
        <input type="file" disabled={busy} onChange={(event) => { const selected = event.target.files?.[0] ?? null; setFile(selected); if (selected && !title) setTitle(selected.name.replace(/\.[^.]+$/, "")); setError(""); }} className="sr-only" />
        {file ? <><FileUp size={25} className="text-slate-600"/><span className="mt-3 max-w-full truncate text-sm font-medium">{file.name}</span><span className="mt-1 text-xs text-slate-500">{formatBytes(file.size)} · {file.type || "Unknown type"}</span><span className="mt-3 text-xs text-slate-500">Choose a different file</span></> : <><CloudUpload size={27} className="text-slate-500"/><span className="mt-3 text-sm font-medium">Choose a file from your computer</span><span className="mt-1 text-xs text-slate-500">Up to 9 GB per workspace budget · video, audio, image, PDF and archive files</span></>}
      </label>
      <div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Asset title<input disabled={busy} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={180} required className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-slate-400" placeholder="Give this asset a title"/></label><label className="text-sm font-medium">Destination folder<select disabled={busy} value={folderId} onChange={(e) => setFolderId(e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal"><option value="">Workspace root</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.parent_id ? "↳ " : ""}{folder.name}</option>)}</select></label></div>
      <label className="mt-4 block text-sm font-medium">Description <span className="font-normal text-slate-400">(optional)</span><textarea disabled={busy} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3} className="mt-1.5 w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-slate-400" placeholder="Add context to help your team find this asset"/></label>
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}
      {success && <p role="status" className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800"><CheckCircle2 size={16}/>{success}</p>}
      {busy && <div className="mt-5"><div className="flex justify-between text-xs text-slate-500"><span>Uploading · {completedParts} of {partCount} parts</span><span>{progress}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-800 transition-all" style={{ width: `${progress}%` }}/></div></div>}
      <div className="mt-6 flex items-center justify-between gap-3"><p className="text-xs text-slate-500">Large files upload in 64 MiB parts. Unfinished sessions expire after 24 hours.</p><button disabled={busy || !file || Boolean(pendingSession)} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[#182230] px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? <><LoaderCircle size={15} className="animate-spin"/>Uploading</> : <><CloudUpload size={15}/>Upload asset</>}</button></div>
      {busy && completedParts < partCount && <button type="button" onClick={() => controller.current?.abort()} className="mt-3 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"><X size={13}/>Cancel upload</button>}
      {pendingSession && !busy && <button type="button" onClick={() => void retryCompletion()} className="mt-3 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700">Retry completion</button>}
    </section>
    <aside className="h-fit rounded-xl border border-[#e8ebef] bg-white p-5"><h2 className="text-sm font-semibold">Upload safeguards</h2><ul className="mt-4 space-y-3 text-xs leading-5 text-slate-600"><li>• Files remain private in R2; this form does not create public links.</li><li>• The server checks your role, folder permissions, file type, and workspace storage budget.</li><li>• Storage has a 9 GB default cap to leave about 1 GB of headroom under R2’s published 10 GB-month free allowance.</li><li>• Approval-required folders keep new assets hidden from other members until review.</li></ul><p className="mt-4 border-t border-slate-100 pt-4 text-[11px] leading-5 text-slate-500">R2 credentials and bucket CORS must be configured before uploads can start. See the setup guide for the CORS rule.</p></aside>
  </form>;
}
