"use client";

import { AudioLines, Image as ImageIcon, LoaderCircle, TriangleAlert, Video } from "lucide-react";
import { formatBytes, formatDate, formatDuration, STATUS_LABEL, STATUS_STYLE, type MediaItem } from "@/lib/client";

const TYPE_ICON = { video: Video, audio: AudioLines, image: ImageIcon };

export function MediaCard({ item, onOpen }: { item: MediaItem; onOpen: (item: MediaItem) => void }) {
  const Icon = TYPE_ICON[item.mediaType];
  const busy = item.processingStatus === "pending" || item.processingStatus === "processing";
  const runningJob = item.jobs.find((job) => job.status === "running");
  return (
    <button type="button" onClick={() => onOpen(item)} className="group overflow-hidden rounded-xl border border-[#e8ebef] bg-white text-left transition hover:border-slate-300 hover:shadow-sm">
      <div className="relative aspect-video bg-slate-100">
        {item.urls.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated API image, not a static asset
          <img src={item.urls.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center text-slate-400">
            {busy ? <LoaderCircle size={22} className="animate-spin" /> : item.processingStatus === "failed" ? <TriangleAlert size={22} /> : <Icon size={24} strokeWidth={1.6} />}
          </div>
        )}
        {item.duration !== null && <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">{formatDuration(item.duration)}</span>}
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-medium capitalize text-slate-700"><Icon size={11} />{item.mediaType}</span>
        {item.processingStatus !== "ready" && (
          <span className={`absolute right-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[item.processingStatus]}`}>
            {STATUS_LABEL[item.processingStatus]}{runningJob ? ` · ${runningJob.jobType}${runningJob.progress ? ` ${runningJob.progress}%` : ""}` : ""}
          </span>
        )}
      </div>
      <div className="p-3.5">
        <p className="truncate text-sm font-medium" title={item.originalFilename}>{item.title}</p>
        <p className="mt-1 truncate text-xs text-slate-500" title={item.originalFilename}>{item.originalFilename}</p>
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
          <span>{formatBytes(item.fileSize)}</span>
          <span>{formatDate(item.createdAt)}</span>
        </div>
        {(item.category || item.tags.length > 0) && (
          <div className="mt-2 flex flex-wrap gap-1">
            {item.category && <span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">{item.category}</span>}
            {item.tags.slice(0, 3).map((tag) => <span key={tag} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">#{tag}</span>)}
            {item.tags.length > 3 && <span className="text-[10px] text-slate-400">+{item.tags.length - 3}</span>}
          </div>
        )}
      </div>
    </button>
  );
}
