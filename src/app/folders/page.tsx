import { FolderTree } from "lucide-react";
import { FolderBrowser } from "./folder-browser";

export default function FoldersPage() {
  return <main className="min-h-screen bg-[#f7f8fa] lg:pl-[248px]"><header className="sticky top-0 z-10 flex h-[68px] items-center border-b border-[#e8ebef] bg-white px-6 md:px-10"><span className="text-sm text-slate-500">Workspace <span className="mx-2 text-slate-300">/</span><b className="font-medium text-slate-800">Folders</b></span></header><div className="mx-auto max-w-[1200px] px-6 py-9 md:px-10"><div className="mb-7 flex items-start gap-3"><span className="grid size-10 place-items-center rounded-xl bg-white text-slate-700 shadow-sm"><FolderTree size={19}/></span><div><h1 className="text-2xl font-semibold tracking-tight">Folder structure</h1><p className="mt-1 text-sm text-slate-500">Create, nest, move, rename, and archive logical library folders.</p></div></div><FolderBrowser/></div></main>;
}
