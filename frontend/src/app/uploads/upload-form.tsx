"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { CheckCircle2, CloudUpload, Copy, FileUp, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { api, API_BASE_URL, apiUrl, folderOptions, formatBytes, type FolderItem, type MediaItem } from "@/lib/client";
import { ACCEPTED_EXTENSIONS, extensionOf } from "@tmh/shared/media-types";

type Phase = "waiting" | "uploading" | "processing" | "ready" | "duplicate" | "failed" | "cancelled";

type Entry = {
  key: string;
  file: File;
  phase: Phase;
  progress: number; // upload percentage
  message: string;
  mediaId?: string;
  jobLabel?: string;
};

const PHASE_STYLE: Record<Phase, string> = {
  waiting: "text-slate-500",
  uploading: "text-blue-700",
  processing: "text-blue-700",
  ready: "text-emerald-700",
  duplicate: "text-amber-700",
  failed: "text-red-700",
  cancelled: "text-slate-500",
};

const MAX_PARALLEL = 2;

/** Multi-file upload with per-file progress, processing status and errors. Files stream to the SSD via /api/upload. */
export function UploadForm({ maxUploadBytes }: { maxUploadBytes: number }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [folderId, setFolderId] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [dragging, setDragging] = useState(false);
  const requests = useRef(new Map<string, XMLHttpRequest>());
  const settings = useRef({ folderId, category, tags });
  settings.current = { folderId, category, tags };

  useEffect(() => { api<{ folders: FolderItem[] }>("/api/folders").then((result) => setFolders(result.folders)).catch(() => {}); }, []);

  const update = useCallback((key: string, patch: Partial<Entry>) => {
    setEntries((current) => current.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)));
  }, []);

  function addFiles(list: FileList | File[]) {
    const added: Entry[] = [];
    for (const file of Array.from(list)) {
      const key = `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`;
      const ext = extensionOf(file.name);
      let phase: Phase = "waiting";
      let message = "Waiting to upload";
      if (!ACCEPTED_EXTENSIONS.includes(ext)) { phase = "failed"; message = `.${ext || "?"} files are not supported`; }
      else if (file.size === 0) { phase = "failed"; message = "The file is empty"; }
      else if (file.size > maxUploadBytes) { phase = "failed"; message = `Larger than the ${formatBytes(maxUploadBytes)} limit`; }
      added.push({ key, file, phase, progress: 0, message });
    }
    setEntries((current) => [...current, ...added]);
  }

  // Start waiting uploads, at most MAX_PARALLEL at a time.
  useEffect(() => {
    const active = entries.filter((entry) => entry.phase === "uploading").length;
    const next = entries.filter((entry) => entry.phase === "waiting").slice(0, Math.max(0, MAX_PARALLEL - active));
    for (const entry of next) startUpload(entry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  function startUpload(entry: Entry) {
    update(entry.key, { phase: "uploading", message: "Uploading…", progress: 0 });
    const xhr = new XMLHttpRequest();
    requests.current.set(entry.key, xhr);
    xhr.open("POST", apiUrl("/api/upload"));
    xhr.withCredentials = Boolean(API_BASE_URL);
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(entry.file.name));
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    const { folderId: folder, category: cat, tags: tagText } = settings.current;
    if (folder) xhr.setRequestHeader("X-Folder-Id", folder);
    if (cat.trim()) xhr.setRequestHeader("X-Category", encodeURIComponent(cat.trim()));
    if (tagText.trim()) xhr.setRequestHeader("X-Tags", encodeURIComponent(tagText));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) update(entry.key, { progress: Math.round((event.loaded / event.total) * 100), message: `Uploading… ${formatBytes(event.loaded)} of ${formatBytes(event.total)}` });
    };
    xhr.onload = () => {
      requests.current.delete(entry.key);
      let body: { ok?: boolean; data?: { status: string; message?: string; media: MediaItem }; error?: { message?: string } } = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status === 401) { window.location.href = "/login"; return; }
      if (xhr.status === 409 && body.data?.status === "duplicate") {
        update(entry.key, { phase: "duplicate", progress: 100, mediaId: body.data.media.id, message: body.data.message ?? "Already in the library" });
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.data) {
        const media = body.data.media;
        update(entry.key, { phase: media.processingStatus === "ready" ? "ready" : "processing", progress: 100, mediaId: media.id, message: body.data.status === "restored" ? "Restored to the library" : "Saved to the media drive. Processing…" });
        return;
      }
      update(entry.key, { phase: "failed", message: body.error?.message ?? `Upload failed (HTTP ${xhr.status})` });
    };
    xhr.onerror = () => { requests.current.delete(entry.key); update(entry.key, { phase: "failed", message: "Network error: the media server could not be reached" }); };
    xhr.onabort = () => { requests.current.delete(entry.key); update(entry.key, { phase: "cancelled", message: "Cancelled. Nothing was saved." }); };
    xhr.send(entry.file);
  }

  // Poll processing status for uploaded files until they are ready or failed.
  useEffect(() => {
    const processing = entries.filter((entry) => entry.phase === "processing" && entry.mediaId);
    if (processing.length === 0) return;
    const timer = setInterval(async () => {
      for (const entry of processing) {
        try {
          const status = await api<{ processingStatus: MediaItem["processingStatus"]; jobs: MediaItem["jobs"] }>(`/api/upload/${entry.mediaId}/status`);
          const running = status.jobs.find((job) => job.status === "running");
          const failed = status.jobs.find((job) => job.status === "failed");
          if (status.processingStatus === "ready") update(entry.key, { phase: "ready", message: "Ready: preview and thumbnail generated", jobLabel: undefined });
          else if (status.processingStatus === "failed") update(entry.key, { phase: "failed", message: `Saved, but processing failed (${failed?.jobType}): ${failed?.errorMessage ?? "unknown error"}. The original is safe.` });
          else update(entry.key, { jobLabel: running ? `${running.jobType === "proxy" ? "Creating preview" : running.jobType === "thumbnail" ? "Creating thumbnail" : "Reading metadata"}${running.progress ? ` ${running.progress}%` : ""}` : "Queued for processing" });
        } catch { /* keep polling */ }
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [entries, update]);

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
  }

  const uploading = entries.some((entry) => entry.phase === "uploading" || entry.phase === "waiting");
  const options = folderOptions(folders);

  return (
    <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
      <section className="rounded-xl border border-[#e8ebef] bg-white p-6">
        <h2 className="text-base font-semibold">Choose files</h2>
        <p className="mt-1 text-sm text-slate-500">Files are saved straight to the media drive. Previews and thumbnails are generated automatically in the background.</p>
        <label
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`mt-5 flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-5 text-center transition ${dragging ? "border-slate-600 bg-slate-100" : "border-slate-300 bg-slate-50 hover:border-slate-400"}`}
        >
          <input type="file" multiple accept={ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(",")} onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} className="sr-only" />
          <CloudUpload size={27} className="text-slate-500" />
          <span className="mt-3 text-sm font-medium">Drag and drop files here, or click to choose</span>
          <span className="mt-1 text-xs text-slate-500">MP4, MOV, MKV, AVI, WebM, MP3, WAV, M4A, JPG, PNG · up to {formatBytes(maxUploadBytes)} each</span>
        </label>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <label className="text-sm font-medium">Folder
            <select value={folderId} onChange={(event) => setFolderId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal">
              <option value="">Library root</option>
              {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">Category
            <input value={category} onChange={(event) => setCategory(event.target.value)} maxLength={100} placeholder="e.g. Dance, Fitness, Podcast" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-slate-400" />
          </label>
          <label className="text-sm font-medium">Tags
            <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="comma separated" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-slate-400" />
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-500">Folder, category and tags apply to files added from now on. You can edit each file later in the library.</p>

        {entries.length > 0 && (
          <div className="mt-6 divide-y divide-slate-100 rounded-xl border border-slate-100">
            {entries.map((entry) => (
              <div key={entry.key} className="flex items-start gap-3 px-4 py-3">
                <span className={`mt-0.5 ${PHASE_STYLE[entry.phase]}`}>
                  {entry.phase === "ready" ? <CheckCircle2 size={17} /> : entry.phase === "failed" ? <TriangleAlert size={17} /> : entry.phase === "duplicate" ? <Copy size={17} /> : entry.phase === "uploading" || entry.phase === "processing" ? <LoaderCircle size={17} className="animate-spin" /> : <FileUp size={17} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-medium" title={entry.file.name}>{entry.file.name}</p>
                    <span className="shrink-0 text-xs text-slate-500">{formatBytes(entry.file.size)}</span>
                  </div>
                  <p className={`mt-0.5 text-xs ${PHASE_STYLE[entry.phase]}`}>{entry.message}{entry.phase === "processing" && entry.jobLabel ? ` · ${entry.jobLabel}` : ""}</p>
                  {entry.phase === "uploading" && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-800 transition-all" style={{ width: `${entry.progress}%` }} /></div>}
                  {(entry.phase === "ready" || entry.phase === "duplicate") && entry.mediaId && <a href={`/library`} className="mt-1 inline-block text-xs font-medium text-slate-700 underline">Open library</a>}
                </div>
                {(entry.phase === "uploading" || entry.phase === "waiting") && (
                  <button type="button" title="Cancel" onClick={() => { const xhr = requests.current.get(entry.key); if (xhr) xhr.abort(); else update(entry.key, { phase: "cancelled", message: "Cancelled" }); }} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={15} /></button>
                )}
              </div>
            ))}
          </div>
        )}
        {entries.length > 0 && !uploading && (
          <button type="button" onClick={() => setEntries((current) => current.filter((entry) => entry.phase === "processing"))} className="mt-3 text-xs text-slate-500 hover:text-slate-800">Clear finished</button>
        )}
      </section>

      <aside className="h-fit rounded-xl border border-[#e8ebef] bg-white p-5">
        <h2 className="text-sm font-semibold">Upload safeguards</h2>
        <ul className="mt-4 space-y-3 text-xs leading-5 text-slate-600">
          <li>• Files are written to the external media drive. If the drive is disconnected or full, the upload is refused and nothing is reported as saved.</li>
          <li>• The server checks each file&apos;s real type from its contents, not its name.</li>
          <li>• Every file gets a unique internal ID; the original filename is kept as metadata. Existing files are never overwritten.</li>
          <li>• Uploading the same file twice is detected by checksum and does not create a copy.</li>
          <li>• A 720p preview and a thumbnail are generated in the background. If that fails, the original stays safe.</li>
          <li>• Keep this tab open until uploads finish. Processing continues even if you leave.</li>
        </ul>
      </aside>
    </div>
  );
}
