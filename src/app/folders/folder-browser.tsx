"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Archive, Folder, FolderPlus, Pencil, Plus, Search } from "lucide-react";

type FolderRecord = {
  id: string; name: string; slug: string; parent_id: string | null; collection_id: string | null;
  description: string | null; icon: string | null; color: string | null; sort_order: number;
  is_private: boolean; require_approval: boolean; created_at: string;
};
type ApiError = { error?: string };

export function FolderBrowser() {
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [creatingFor, setCreatingFor] = useState<string | null | undefined>(undefined);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/folders?all=true&limit=200", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error((body as ApiError).error || "Could not load folders");
      setFolders(body.folders as FolderRecord[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load folders");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return new Set(folders.map((folder) => folder.id));
    const matches = new Set<string>();
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    for (const folder of folders) {
      if (!folder.name.toLowerCase().includes(query)) continue;
      let current: FolderRecord | undefined = folder;
      while (current) { matches.add(current.id); current = current.parent_id ? byId.get(current.parent_id) : undefined; }
    }
    return matches;
  }, [folders, search]);

  async function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newName.trim()) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName.trim(), parent_id: creatingFor }) });
      const body = await response.json();
      if (!response.ok) throw new Error((body as ApiError).error || "Could not create folder");
      setNewName(""); setCreatingFor(undefined); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create folder"); }
    finally { setBusy(false); }
  }

  async function patchFolder(id: string, patch: Record<string, unknown>) {
    setError("");
    try {
      const response = await fetch(`/api/folders/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const body = await response.json();
      if (!response.ok) throw new Error((body as ApiError).error || "Could not update folder");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update folder"); }
  }

  async function archiveFolder(folder: FolderRecord) {
    if (!window.confirm(`Archive “${folder.name}”? Its assets will remain stored, but the folder will leave the active library.`)) return;
    setError("");
    try {
      const response = await fetch(`/api/folders/${folder.id}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error((body as ApiError).error || "Could not archive folder");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not archive folder"); }
  }

  const children = useMemo(() => {
    const map = new Map<string | null, FolderRecord[]>();
    for (const folder of folders) {
      const list = map.get(folder.parent_id) ?? [];
      list.push(folder); map.set(folder.parent_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    return map;
  }, [folders]);

  function renderRows(parentId: string | null, depth = 0): ReactNode {
    return (children.get(parentId) ?? []).filter((folder) => visible.has(folder.id)).map((folder) => {
      const siblings = children.get(parentId) ?? [];
      const siblingIndex = siblings.findIndex((item) => item.id === folder.id);
      const choices = folders.filter((candidate) => candidate.id !== folder.id);
      return <div key={folder.id}>
        <div className="group flex min-h-[58px] items-center gap-3 border-b border-slate-100 px-4 hover:bg-slate-50" style={{ paddingLeft: 16 + depth * 24 }}>
          <Folder size={17} className="shrink-0" style={{ color: folder.color ?? "#748092" }}/>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{folder.name}</p>{folder.description && <p className="truncate text-xs text-slate-500">{folder.description}</p>}</div>
          {folder.is_private && <span className="rounded-md bg-violet-50 px-2 py-1 text-[10px] font-medium text-violet-700">Private</span>}
          {folder.require_approval && <span className="rounded-md bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700">Approval required</span>}
          <select aria-label={`Move ${folder.name}`} value={folder.parent_id ?? "root"} onChange={(event) => { const value = event.target.value; void patchFolder(folder.id, { parent_id: value === "root" ? null : value }); }} className="max-w-32 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600">
            <option value="root">Move to root</option>{choices.map((candidate) => <option key={candidate.id} value={candidate.id}>{"· ".repeat(Math.min(depthOf(candidate.id) + 1, 8))}{candidate.name}</option>)}
          </select>
          <div className="flex items-center gap-1 opacity-60 transition group-hover:opacity-100">
            <button title="Add subfolder" onClick={() => { setCreatingFor(folder.id); setNewName(""); }} className="rounded-md p-2 hover:bg-white"><FolderPlus size={15}/></button>
            <button title="Rename" onClick={() => { const name = window.prompt("Folder name", folder.name); if (name?.trim() && name.trim() !== folder.name) void patchFolder(folder.id, { name: name.trim() }); }} className="rounded-md p-2 hover:bg-white"><Pencil size={14}/></button>
            <button title="Archive folder" onClick={() => void archiveFolder(folder)} className="rounded-md p-2 text-slate-500 hover:bg-white hover:text-red-600"><Archive size={14}/></button>
          </div>
          <span className="w-10 text-right text-xs text-slate-400">{(children.get(folder.id) ?? []).length}</span>
        </div>
        {creatingFor === folder.id && <form onSubmit={createFolder} className="flex gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3" style={{ paddingLeft: 40 + depth * 24 }}><input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={`New subfolder in ${folder.name}`} className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"/><button disabled={busy} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white">Create</button><button type="button" onClick={() => setCreatingFor(undefined)} className="rounded-md border px-3 py-2 text-xs">Cancel</button></form>}
        {renderRows(folder.id, depth + 1)}
      </div>;
    });
  }

  function depthOf(id: string) {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    let depth = 0; let current = byId.get(id);
    while (current?.parent_id && depth < 8) { depth++; current = byId.get(current.parent_id); }
    return depth;
  }

  return <section className="rounded-xl border border-[#e8ebef] bg-white">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4"><div className="relative min-w-[220px] flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search folders" className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-slate-400"/></div><button onClick={() => { setCreatingFor(null); setNewName(""); }} className="inline-flex items-center gap-2 rounded-lg bg-[#182230] px-3.5 py-2.5 text-sm font-medium text-white"><Plus size={15}/>New folder</button></div>
    {creatingFor === null && <form onSubmit={createFolder} className="flex gap-2 border-b border-slate-100 bg-slate-50 p-4"><input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Folder name" className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"/><button disabled={busy} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white">Create folder</button><button type="button" onClick={() => setCreatingFor(undefined)} className="rounded-md border bg-white px-3 py-2 text-xs">Cancel</button></form>}
    {error && <p role="alert" className="border-b border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    <div className="flex items-center gap-3 bg-slate-50 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500"><span className="flex-1">Folder</span><span className="hidden md:block">Move folder</span><span className="w-10 text-right">Items</span></div>
    {loading ? <p className="p-8 text-center text-sm text-slate-500">Loading folders…</p> : folders.length === 0 ? <div className="p-12 text-center"><Folder size={22} className="mx-auto text-slate-400"/><p className="mt-3 text-sm font-medium">No folders yet</p><p className="mt-1 text-xs text-slate-500">Create your first folder to start organizing assets.</p></div> : renderRows(null)}
  </section>;
}
