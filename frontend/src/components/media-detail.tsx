"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Download, LoaderCircle, RotateCcw, Trash2, X } from "lucide-react";
import {
  api, errorMessage, folderOptions, formatBytes, formatDate, formatDuration, STATUS_LABEL, STATUS_STYLE,
  type FolderItem, type MediaItem,
} from "@/lib/client";
import { MediaAiPanel } from "./media-ai-panel";

type Props = {
  item: MediaItem;
  folders: FolderItem[];
  role: "admin" | "editor" | "viewer";
  onClose: () => void;
  onChanged: (item: MediaItem | null) => void;
  /** Start playback at this position (from a search result moment). */
  startAtMs?: number;
};

/** Media detail modal: proxy preview player, metadata, editing, downloads. */
export function MediaDetail({ item: initial, folders, role, onClose, onChanged, startAtMs }: Props) {
  const [item, setItem] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [category, setCategory] = useState(initial.category ?? "");
  const [tags, setTags] = useState(initial.tags.join(", "));
  const [folderId, setFolderId] = useState(initial.folder?.id ? String(initial.folder.id) : "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const canEdit = role !== "viewer";
  const videoRef = useRef<HTMLVideoElement>(null);

  const seek = useCallback((ms: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = ms / 1000;
    void video.play().catch(() => {});
    video.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // Keep the modal live while processing so the player appears as soon as the proxy is ready.
  useEffect(() => {
    if (item.processingStatus === "ready" || item.processingStatus === "failed") return;
    const timer = setInterval(async () => {
      try {
        const data = await api<{ media: MediaItem }>(`/api/media/${item.id}`);
        setItem(data.media);
        onChanged(data.media);
      } catch { /* keep the last known state */ }
    }, 3000);
    return () => clearInterval(timer);
  }, [item.id, item.processingStatus, onChanged]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setMessage(null);
    try {
      const data = await api<{ media: MediaItem }>(`/api/media/${item.id}`, {
        method: "PATCH",
        json: {
          title: title.trim() || item.title,
          category: category.trim() || null,
          description: description.trim() || null,
          folderId: folderId ? Number(folderId) : null,
          tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        },
      });
      setItem(data.media); onChanged(data.media);
      setMessage({ kind: "ok", text: "Saved." });
    } catch (error) { setMessage({ kind: "error", text: errorMessage(error) }); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (!window.confirm(`Remove “${item.title}” from the library?\n\nThe original file stays on the media drive and is not deleted.`)) return;
    try {
      await api(`/api/media/${item.id}`, { method: "DELETE" });
      onChanged(null); onClose();
    } catch (error) { setMessage({ kind: "error", text: errorMessage(error) }); }
  }

  async function retry(jobId: number) {
    try {
      await api(`/api/jobs/${jobId}/retry`, { method: "POST" });
      const data = await api<{ media: MediaItem }>(`/api/media/${item.id}`);
      setItem(data.media); onChanged(data.media);
    } catch (error) { setMessage({ kind: "error", text: errorMessage(error) }); }
  }

  const failedJobs = item.jobs.filter((job) => job.status === "failed");
  const resolution = item.width && item.height ? `${item.width} × ${item.height}` : "—";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-3 sm:p-8" onClick={onClose} role="dialog" aria-modal="true" aria-label={item.title}>
      <div className="w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <div className="min-w-0"><h2 className="truncate text-base font-semibold">{item.title}</h2><p className="truncate text-xs text-slate-500">{item.originalFilename}</p></div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="grid gap-0 lg:grid-cols-[1.6fr_1fr]">
          <div className="bg-slate-950">
            <div className="grid aspect-video place-items-center">
              {item.mediaType === "video" && item.urls.preview ? (
                <video ref={videoRef} key={item.urls.preview} src={startAtMs ? `${item.urls.preview}#t=${(startAtMs / 1000).toFixed(1)}` : item.urls.preview} poster={item.urls.thumbnail ?? undefined} controls preload="metadata" className="h-full w-full" />
              ) : item.mediaType === "audio" && item.urls.preview ? (
                <audio key={item.urls.preview} src={item.urls.preview} controls preload="metadata" className="w-4/5" />
              ) : item.mediaType === "image" && item.urls.preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- authenticated API image
                <img src={item.urls.preview} alt={item.title} className="max-h-full max-w-full object-contain" />
              ) : (
                <div className="px-6 text-center text-sm text-slate-300">
                  {item.processingStatus === "failed" ? "The preview could not be generated. The original file is safe and can still be downloaded." : <span className="inline-flex items-center gap-2"><LoaderCircle size={16} className="animate-spin" />Preparing preview…</span>}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-md px-2 py-1 text-[11px] font-medium ${STATUS_STYLE[item.processingStatus]}`}>{STATUS_LABEL[item.processingStatus]}</span>
              <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] capitalize text-slate-600">{item.mediaType} · {item.fileExtension.toUpperCase()}</span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
              <Field label="Duration" value={formatDuration(item.duration)} />
              <Field label="Resolution" value={resolution} />
              <Field label="File size" value={formatBytes(item.fileSize)} />
              <Field label="Preview size" value={formatBytes(item.proxySize)} />
              <Field label="Codec" value={[item.codec, item.audioCodec].filter(Boolean).join(" / ") || "—"} />
              <Field label="Frame rate" value={item.frameRate ? `${item.frameRate} fps` : "—"} />
              <Field label="Folder" value={item.folder?.name ?? "Library root"} />
              <Field label="Uploaded" value={`${formatDate(item.createdAt, true)}${item.uploadedBy ? ` by ${item.uploadedBy}` : ""}`} />
            </dl>

            <div className="flex flex-wrap gap-2">
              <a href={item.urls.downloadOriginal} className="inline-flex items-center gap-2 rounded-lg bg-[#182230] px-3 py-2 text-xs font-medium text-white"><Download size={14} />Download original</a>
              {item.urls.downloadProxy
                ? <a href={item.urls.downloadProxy} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700"><Download size={14} />Download proxy</a>
                : item.mediaType !== "image" && <span className="inline-flex items-center rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">Proxy not ready</span>}
            </div>

            {failedJobs.length > 0 && (
              <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-800">
                {failedJobs.map((job) => (
                  <div key={job.id} className="flex items-start justify-between gap-2">
                    <p><b className="capitalize">{job.jobType}</b> failed: {job.errorMessage ?? "unknown error"}</p>
                    {canEdit && <button type="button" onClick={() => void retry(job.id)} className="inline-flex shrink-0 items-center gap-1 font-medium underline"><RotateCcw size={12} />Retry</button>}
                  </div>
                ))}
              </div>
            )}

            {canEdit ? (
              <form onSubmit={save} className="space-y-3 border-t border-slate-100 pt-4">
                <Input label="Title" value={title} onChange={setTitle} maxLength={255} />
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Category" value={category} onChange={setCategory} maxLength={100} placeholder="e.g. Dance" />
                  <label className="text-xs font-medium text-slate-700">Folder
                    <select value={folderId} onChange={(event) => setFolderId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-normal">
                      <option value="">Library root</option>
                      {folderOptions(folders).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                </div>
                <Input label="Tags (comma separated)" value={tags} onChange={setTags} placeholder="workout, terence, interview" />
                <label className="block text-xs font-medium text-slate-700">Description
                  <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} maxLength={5000} className="mt-1 w-full resize-y rounded-lg border border-slate-200 px-2.5 py-2 text-sm font-normal outline-none focus:border-slate-400" />
                </label>
                {message && <p role={message.kind === "error" ? "alert" : "status"} className={`text-xs ${message.kind === "error" ? "text-red-700" : "text-emerald-700"}`}>{message.text}</p>}
                <div className="flex items-center justify-between gap-2">
                  <button disabled={saving} className="rounded-lg bg-[#182230] px-3.5 py-2 text-xs font-medium text-white disabled:opacity-50">{saving ? "Saving…" : "Save changes"}</button>
                  {role === "admin" && <button type="button" onClick={() => void remove()} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-600"><Trash2 size={13} />Remove from library</button>}
                </div>
              </form>
            ) : (
              <div className="space-y-2 border-t border-slate-100 pt-4 text-xs text-slate-600">
                {item.category && <p>Category: <b>{item.category}</b></p>}
                {item.tags.length > 0 && <p>Tags: {item.tags.map((tag) => `#${tag}`).join(" ")}</p>}
                {item.description && <p className="whitespace-pre-wrap">{item.description}</p>}
              </div>
            )}
          </div>
        </div>
        {item.mediaType === "video" && <MediaAiPanel mediaId={item.id} canEdit={canEdit} onSeek={seek} />}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-slate-400">{label}</dt><dd className="mt-0.5 truncate font-medium text-slate-800" title={value}>{value}</dd></div>;
}

function Input({ label, value, onChange, maxLength, placeholder }: { label: string; value: string; onChange: (value: string) => void; maxLength?: number; placeholder?: string }) {
  return (
    <label className="block text-xs font-medium text-slate-700">{label}
      <input value={value} onChange={(event) => onChange(event.target.value)} maxLength={maxLength} placeholder={placeholder} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm font-normal outline-none focus:border-slate-400" />
    </label>
  );
}
