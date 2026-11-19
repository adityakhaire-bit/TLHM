"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ExternalLink, Folder, FolderPlus, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { api, errorMessage, type FolderItem } from "@/lib/client";

export function FolderBrowser({ canEdit }: { canEdit: boolean }) {
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [creatingFor, setCreatingFor] = useState<number | null | undefined>(undefined);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setFolders((await api<{ folders: FolderItem[] }>("/api/folders")).folders);
    } catch (cause) {
      setError(errorMessage(cause, "Could not load folders"));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const byId = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return new Set(folders.map((folder) => folder.id));
    const matches = new Set<number>();
    for (const folder of folders) {
      if (!folder.name.toLowerCase().includes(query)) continue;
      let current: FolderItem | undefined = folder;
      while (current) { matches.add(current.id); current = current.parentId ? byId.get(current.parentId) : undefined; }
    }
    return matches;
  }, [folders, search, byId]);

  const children = useMemo(() => {
    const map = new Map<number | null, FolderItem[]>();
    for (const folder of folders) map.set(folder.parentId, [...(map.get(folder.parentId) ?? []), folder]);
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [folders]);

  function depthOf(id: number) {
    let depth = 0;
    let current = byId.get(id);
    while (current?.parentId && depth < 8) { depth++; current = byId.get(current.parentId); }
    return depth;
  }

  async function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newName.trim()) return;
    setBusy(true); setError("");
    try {
      await api("/api/folders", { method: "POST", json: { name: newName.trim(), parentId: creatingFor ?? null } });
      setNewName(""); setCreatingFor(undefined); await load();
    } catch (cause) { setError(errorMessage(cause, "Could not create folder")); }
    finally { setBusy(false); }
  }

  async function patchFolder(id: number, patch: Record<string, unknown>) {
    setError("");
    try {
      await api(`/api/folders/${id}`, { method: "PATCH", json: patch });
      await load();
    } catch (cause) { setError(errorMessage(cause, "Could not update folder")); await load(); }
  }

  async function deleteFolder(folder: FolderItem) {
    if (folder.mediaCount > 0 || folder.childCount > 0) {
      setError(`“${folder.name}” is not empty. Move its media and sub-folders out first; media is never deleted with a folder.`);
      return;
    }
    if (!window.confirm(`Delete the empty folder “${folder.name}”?`)) return;
    setError("");
    try {
      await api(`/api/folders/${folder.id}`, { method: "DELETE" });
      await load();
    } catch (cause) { setError(errorMessage(cause, "Could not delete folder")); }
  }

  function renderRows(parentId: number | null, depth = 0): ReactNode {
    return (children.get(parentId) ?? []).filter((folder) => visible.has(folder.id)).map((folder) => {
      const choices = folders.filter((candidate) => candidate.id !== folder.id);
      return <div key={folder.id}>
        <div className="group flex min-h-[58px] items-center gap-3 border-b border-slate-100 px-4 hover:bg-slate-50" style={{ paddingLeft: 16 + depth * 24 }}>
          <Folder size={17} className="shrink-0 text-[#748092]" />
          <div className="min-w-0 flex-1">
            <a href={`/library?folder=${folder.id}`} className="truncate text-sm font-medium hover:underline">{folder.name}</a>
            {folder.description && <p className="truncate text-xs text-slate-500">{folder.description}</p>}
          </div>
          {canEdit && (
            <select aria-label={`Move ${folder.name}`} value={folder.parentId ?? "root"} onChange={(event) => { const value = event.target.value; void patchFolder(folder.id, { parentId: value === "root" ? null : Number(value) }); }} className="hidden max-w-36 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600 md:block">
              <option value="root">Move to root</option>
              {choices.map((candidate) => <option key={candidate.id} value={candidate.id}>{"· ".repeat(Math.min(depthOf(candidate.id) + 1, 8))}{candidate.name}</option>)}
            </select>
          )}
          <div className="flex items-center gap-1 opacity-60 transition group-hover:opacity-100">
            <a title="Browse media in this folder" href={`/library?folder=${folder.id}`} className="rounded-md p-2 hover:bg-white"><ExternalLink size={14} /></a>
            {canEdit && <>
              <button title="Add subfolder" onClick={() => { setCreatingFor(folder.id); setNewName(""); }} className="rounded-md p-2 hover:bg-white"><FolderPlus size={15} /></button>
              <button title="Rename" onClick={() => { const name = window.prompt("Folder name", folder.name); if (name?.trim() && name.trim() !== folder.name) void patchFolder(folder.id, { name: name.trim() }); }} className="rounded-md p-2 hover:bg-white"><Pencil size={14} /></button>
              <button title={folder.mediaCount || folder.childCount ? "Only empty folders can be deleted" : "Delete empty folder"} onClick={() => void deleteFolder(folder)} className="rounded-md p-2 text-slate-500 hover:bg-white hover:text-red-600"><Trash2 size={14} /></button>
            </>}
          </div>
          <span className="w-14 text-right text-xs text-slate-400" title={`${folder.mediaCount} media, ${folder.childCount} sub-folders`}>{folder.mediaCount}</span>
        </div>
        {creatingFor === folder.id && <form onSubmit={createFolder} className="flex gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3" style={{ paddingLeft: 40 + depth * 24 }}><input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={120} placeholder={`New subfolder in ${folder.name}`} className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm" /><button disabled={busy} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white">Create</button><button type="button" onClick={() => setCreatingFor(undefined)} className="rounded-md border px-3 py-2 text-xs">Cancel</button></form>}
        {renderRows(folder.id, depth + 1)}
      </div>;
    });
  }

  return <section className="rounded-xl border border-[#e8ebef] bg-white">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
      <div className="relative min-w-[220px] flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search folders" className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-slate-400" /></div>
      {canEdit && <button onClick={() => { setCreatingFor(null); setNewName(""); }} className="inline-flex items-center gap-2 rounded-lg bg-[#182230] px-3.5 py-2.5 text-sm font-medium text-white"><Plus size={15} />New folder</button>}
    </div>
    {creatingFor === null && <form onSubmit={createFolder} className="flex gap-2 border-b border-slate-100 bg-slate-50 p-4"><input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={120} placeholder="Folder name" className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm" /><button disabled={busy} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white">Create folder</button><button type="button" onClick={() => setCreatingFor(undefined)} className="rounded-md border bg-white px-3 py-2 text-xs">Cancel</button></form>}
    {error && <p role="alert" className="border-b border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    <div className="flex items-center gap-3 bg-slate-50 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500"><span className="flex-1">Folder</span>{canEdit && <span className="hidden md:block">Move folder</span>}<span className="w-14 text-right">Media</span></div>
    {loading ? <p className="p-8 text-center text-sm text-slate-500">Loading folders…</p> : folders.length === 0 ? <div className="p-12 text-center"><Folder size={22} className="mx-auto text-slate-400" /><p className="mt-3 text-sm font-medium">No folders yet</p><p className="mt-1 text-xs text-slate-500">Create your first folder to start organizing media.</p></div> : renderRows(null)}
  </section>;
}
