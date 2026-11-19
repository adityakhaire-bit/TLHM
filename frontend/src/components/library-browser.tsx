"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Archive, ChevronLeft, ChevronRight, Search, Upload } from "lucide-react";
import { api, errorMessage, folderOptions, type FolderItem, type MediaItem, type MediaPage } from "@/lib/client";
import { MediaCard } from "./media-card";
import { MediaDetail } from "./media-detail";

const FILTERS = [
  { key: "all", label: "All media", params: {} },
  { key: "video", label: "Videos", params: { type: "video" } },
  { key: "audio", label: "Audio", params: { type: "audio" } },
  { key: "image", label: "Images", params: { type: "image" } },
  { key: "recent", label: "Recently uploaded", params: { recent: "1" } },
  { key: "processing", label: "Processing", params: { status: "processing" } },
  { key: "completed", label: "Completed", params: { status: "completed" } },
  { key: "failed", label: "Failed", params: { status: "failed" } },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

function filterFromParams(params: URLSearchParams): FilterKey {
  if (params.get("type")) return params.get("type") as FilterKey;
  if (params.get("recent")) return "recent";
  const status = params.get("status");
  if (status === "processing" || status === "completed" || status === "failed") return status;
  return "all";
}

/** The media library: search, filters, folder filter, sorting, pagination, live processing updates. */
export function LibraryBrowser({ role, initialQuery }: { role: "admin" | "editor" | "viewer"; initialQuery: Record<string, string> }) {
  const initialParams = new URLSearchParams(initialQuery);
  const [query, setQuery] = useState(initialParams.get("q") ?? "");
  const [submittedQuery, setSubmittedQuery] = useState(initialParams.get("q") ?? "");
  const [filter, setFilter] = useState<FilterKey>(filterFromParams(initialParams));
  const [folder, setFolder] = useState(initialParams.get("folder") ?? "");
  const [sort, setSort] = useState(initialParams.get("sort") ?? "newest");
  const [page, setPage] = useState(Number(initialParams.get("page") ?? 1) || 1);
  const [data, setData] = useState<MediaPage | null>(null);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<MediaItem | null>(null);
  const requestId = useRef(0);

  const searchString = useMemo(() => {
    const params = new URLSearchParams();
    if (submittedQuery.trim()) params.set("q", submittedQuery.trim());
    for (const [key, value] of Object.entries((FILTERS.find((item) => item.key === filter)?.params ?? {}) as Record<string, string>)) params.set(key, value);
    if (folder) params.set("folder", folder);
    if (sort !== "newest") params.set("sort", sort);
    if (page > 1) params.set("page", String(page));
    return params.toString();
  }, [submittedQuery, filter, folder, sort, page]);

  const load = useCallback(async (quiet = false) => {
    const id = ++requestId.current;
    if (!quiet) setLoading(true);
    try {
      const result = await api<MediaPage>(`/api/media?${searchString}${searchString ? "&" : ""}pageSize=24`);
      if (id !== requestId.current) return; // a newer request is in flight
      setData(result); setError("");
    } catch (cause) {
      if (id === requestId.current) setError(errorMessage(cause, "Could not load the library"));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [searchString]);

  useEffect(() => {
    window.history.replaceState(null, "", `/library${searchString ? `?${searchString}` : ""}`);
    void load();
  }, [load, searchString]);

  useEffect(() => { api<{ folders: FolderItem[] }>("/api/folders").then((result) => setFolders(result.folders)).catch(() => {}); }, []);

  // Poll for updates: fast while anything on screen is processing, slower otherwise (picks up new uploads).
  useEffect(() => {
    const interval = data?.processingCount ? 3000 : 15000;
    const timer = setInterval(() => { if (!document.hidden) void load(true); }, interval);
    return () => clearInterval(timer);
  }, [data?.processingCount, load]);

  const onChanged = useCallback((updated: MediaItem | null) => {
    if (!updated) { void load(true); return; }
    setData((current) => current ? { ...current, items: current.items.map((item) => item.id === updated.id ? updated : item) } : current);
  }, [load]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setPage(1); setSubmittedQuery(query);
  }

  const options = folderOptions(folders);

  return (
    <div>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-3 rounded-xl border border-[#e8ebef] bg-white p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, tag, folder, category or date — e.g. “Terence interview June 2026”" aria-label="Search the library" className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-slate-400" />
        </div>
        <select aria-label="Folder" value={folder} onChange={(event) => { setFolder(event.target.value); setPage(1); }} className="max-w-[200px] rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700">
          <option value="">All folders</option>
          {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <select aria-label="Sort" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Name A–Z</option>
          <option value="size">Largest first</option>
          <option value="duration">Longest first</option>
        </select>
        <button className="rounded-lg bg-[#182230] px-4 py-2.5 text-sm font-medium text-white">Search</button>
      </form>

      <div className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button key={item.key} type="button" onClick={() => { setFilter(item.key); setPage(1); }}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${filter === item.key ? "border-[#182230] bg-[#182230] text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between text-xs text-slate-500">
        <span>{data ? `${data.total.toLocaleString()} item${data.total === 1 ? "" : "s"}${submittedQuery ? ` matching “${submittedQuery}”` : ""}` : " "}</span>
        {data && data.processingCount > 0 && <span className="text-blue-700">{data.processingCount} processing — updating automatically</span>}
      </div>

      {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {loading && !data ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="aspect-[4/3] animate-pulse rounded-xl bg-white" />)}</div>
      ) : data && data.items.length === 0 ? (
        <div className="mt-4 rounded-xl border border-[#e8ebef] bg-white px-6 py-14 text-center">
          <div className="mx-auto grid size-11 place-items-center rounded-full bg-slate-100 text-slate-500"><Archive size={19} /></div>
          <h3 className="mt-4 text-sm font-semibold">{submittedQuery || filter !== "all" || folder ? "No media matches these filters" : "Your library is ready for its first asset"}</h3>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-500">{submittedQuery || filter !== "all" || folder ? "Try a different search or clear the filters." : "Uploaded files are saved to the media drive and appear here automatically."}</p>
          {role !== "viewer" && <a href="/uploads" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium"><Upload size={14} />Upload media</a>}
        </div>
      ) : (
        <div className={`mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 ${loading ? "opacity-60" : ""}`}>
          {data?.items.map((item) => <MediaCard key={item.id} item={item} onOpen={setOpen} />)}
        </div>
      )}

      {data && data.totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-3 text-sm">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 disabled:opacity-40"><ChevronLeft size={15} />Previous</button>
          <span className="text-slate-500">Page {data.page} of {data.totalPages}</span>
          <button type="button" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 disabled:opacity-40">Next<ChevronRight size={15} /></button>
        </div>
      )}

      {open && <MediaDetail item={open} folders={folders} role={role} onClose={() => setOpen(null)} onChanged={onChanged} />}
    </div>
  );
}
