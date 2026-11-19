"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, Upload } from "lucide-react";
import { api, type FolderItem, type MediaItem, type MediaPage } from "@/lib/client";
import { MediaCard } from "./media-card";
import { MediaDetail } from "./media-detail";

/** Latest uploads on the dashboard; refreshes automatically, faster while items are processing. */
export function RecentMedia({ role }: { role: "admin" | "editor" | "viewer" }) {
  const [data, setData] = useState<MediaPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<MediaItem | null>(null);
  const [folders, setFolders] = useState<FolderItem[]>([]);

  const load = useCallback(async () => {
    try { setData(await api<MediaPage>("/api/media?pageSize=6")); setFailed(false); } catch { setFailed(true); }
  }, []);

  useEffect(() => { void load(); api<{ folders: FolderItem[] }>("/api/folders").then((r) => setFolders(r.folders)).catch(() => {}); }, [load]);
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) void load(); }, data?.processingCount ? 3000 : 20000);
    return () => clearInterval(timer);
  }, [data?.processingCount, load]);

  if (failed && !data) return <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-8 text-center text-sm text-red-700">Could not load recent media. Check that the database is running.</div>;
  if (!data) return <div className="grid gap-3 md:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <div key={i} className="aspect-[4/3] animate-pulse rounded-xl bg-white" />)}</div>;
  if (data.items.length === 0) {
    return (
      <div className="rounded-xl border border-[#e8ebef] bg-white px-6 py-14 text-center">
        <div className="mx-auto grid size-11 place-items-center rounded-full bg-slate-100 text-slate-500"><Archive size={19} /></div>
        <h3 className="mt-4 text-sm font-semibold">Your library is ready for its first asset</h3>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-500">Uploads are saved to the media drive and appear here automatically.</p>
        {role !== "viewer" && <a href="/uploads" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium"><Upload size={14} />Upload an asset</a>}
      </div>
    );
  }
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">{data.items.map((item) => <MediaCard key={item.id} item={item} onOpen={setOpen} />)}</div>
      {open && <MediaDetail item={open} folders={folders} role={role} onClose={() => setOpen(null)} onChanged={() => void load()} />}
    </>
  );
}
