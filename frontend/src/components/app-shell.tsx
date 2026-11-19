import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Activity, Archive, AudioLines, FolderTree, HardDrive, Image as ImageIcon, Search, Upload, Video } from "lucide-react";
import type { SessionUser } from "@/server/auth";
import { SignOutButton } from "./sign-out-button";

type NavKey = "overview" | "all" | "video" | "audio" | "image" | "folders" | "uploads" | "storage";

const workspaceLinks: { key: NavKey; label: string; icon: LucideIcon; href: string }[] = [
  { key: "overview", label: "Overview", icon: Activity, href: "/" },
  { key: "all", label: "All media", icon: Archive, href: "/library" },
  { key: "video", label: "Videos", icon: Video, href: "/library?type=video" },
  { key: "audio", label: "Audio library", icon: AudioLines, href: "/library?type=audio" },
  { key: "image", label: "Images", icon: ImageIcon, href: "/library?type=image" },
  { key: "folders", label: "Folders", icon: FolderTree, href: "/folders" },
  { key: "uploads", label: "Upload centre", icon: Upload, href: "/uploads" },
];
const manageLinks: { key: NavKey; label: string; icon: LucideIcon; href: string }[] = [
  { key: "storage", label: "Storage & backups", icon: HardDrive, href: "/storage" },
];

/** Shared sidebar + header used by every signed-in page (same visual design as the original dashboard). */
export function AppShell({ user, active, crumb, query, children }: { user: SessionUser; active: NavKey; crumb: string; query?: string; children: ReactNode }) {
  const link = (item: (typeof workspaceLinks)[number]) => (
    <Link key={item.key} href={item.href} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${item.key === active ? "bg-slate-100 font-medium text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}>
      <item.icon size={17} strokeWidth={1.8} />{item.label}
    </Link>
  );
  return (
    <main className="min-h-screen bg-[#f7f8fa]">
      <aside className="fixed inset-y-0 left-0 hidden w-[248px] border-r border-[#e8ebef] bg-white px-5 py-6 lg:block">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-[#182230] text-sm font-bold text-white">TM</span>
          <span><b className="block text-sm">Terence Media Hub</b><small className="text-xs text-slate-500">Creative library</small></span>
        </Link>
        <div className="mt-10"><p className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-[.12em] text-slate-400">Workspace</p><nav className="space-y-1">{workspaceLinks.map(link)}</nav></div>
        <div className="mt-9"><p className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-[.12em] text-slate-400">Manage</p><nav className="space-y-1">{manageLinks.map(link)}</nav></div>
        <div className="absolute inset-x-5 bottom-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="truncate text-xs font-semibold">{user.displayName || user.username}</p>
          <p className="mt-0.5 text-xs capitalize text-slate-500">{user.role}</p>
          <SignOutButton className="mt-3 text-xs font-medium text-slate-700 hover:text-slate-950" />
        </div>
      </aside>
      <section className="lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between gap-3 border-b border-[#e8ebef] bg-white/95 px-4 backdrop-blur md:px-10">
          <div className="min-w-0 truncate text-sm text-slate-500">Workspace <span className="mx-2 text-slate-300">/</span><span className="font-medium text-slate-800">{crumb}</span></div>
          <div className="flex items-center gap-2 sm:gap-3">
            <form action="/library" className="relative hidden sm:block">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input name="q" defaultValue={query} placeholder="Search media, tags, folders…" aria-label="Search the library" className="w-56 rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-400 xl:w-72" />
            </form>
            {user.role !== "viewer" && <a href="/uploads" className="flex items-center gap-2 rounded-lg bg-[#182230] px-3.5 py-2 text-sm font-medium text-white"><Upload size={15} /><span className="hidden sm:inline">Upload assets</span></a>}
            <SignOutButton className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 lg:hidden" />
          </div>
        </header>
        {/* Compact navigation for phones and tablets (the sidebar is desktop-only). */}
        <nav className="flex gap-1 overflow-x-auto border-b border-[#e8ebef] bg-white px-3 py-2 lg:hidden">
          {[...workspaceLinks, ...manageLinks].map((item) => (
            <Link key={item.key} href={item.href} className={`shrink-0 rounded-md px-3 py-1.5 text-xs ${item.key === active ? "bg-slate-100 font-medium text-slate-900" : "text-slate-600"}`}>{item.label}</Link>
          ))}
        </nav>
        {children}
      </section>
    </main>
  );
}

export function PageHeading({ icon: Icon, title, subtitle, action }: { icon: LucideIcon; title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-white text-slate-700 shadow-sm"><Icon size={19} /></span>
        <div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-1 text-sm text-slate-500">{subtitle}</p></div>
      </div>
      {action}
    </div>
  );
}
