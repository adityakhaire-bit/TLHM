import { Activity, Archive, ArrowUpRight, AudioLines, Boxes, FolderPlus, FolderTree, Search, Upload, Video } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signOut } from "./login/actions";
import type { LucideIcon } from "lucide-react";

const shortcuts = [
  { label: "All assets", detail: "Browse the complete library", icon: Archive, href: "#assets" },
  { label: "Terence Lewis", detail: "Videos, podcasts and interviews", icon: Video, href: "#terence" },
  { label: "Creative resources", detail: "Audio, templates and design", icon: Boxes, href: "#resources" },
];
const workspaceLinks: { label: string; icon: LucideIcon; href: string }[] = [
  { label: "Overview", icon: Activity, href: "#home" },
  { label: "All assets", icon: Archive, href: "#all-assets" },
  { label: "Terence Lewis", icon: Video, href: "#terence" },
  { label: "Creative resources", icon: Boxes, href: "#resources" },
  { label: "Audio library", icon: AudioLines, href: "#audio" },
  { label: "Folders", icon: FolderTree, href: "/folders" },
  { label: "Upload centre", icon: Upload, href: "/uploads" },
];
const manageLinks: { label: string; icon: LucideIcon }[] = [
  { label: "Collections", icon: Boxes },
];

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  if (supabase) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return <main className="grid min-h-screen place-items-center text-sm text-slate-500">Redirecting to sign in…</main>;
  }
  let counts = { assets: 0, videos: 0, audio: 0, folders: 0 };
  let databaseReady = Boolean(supabase);
  if (supabase) {
    const [assets, videos, audio, folders] = await Promise.all([
      supabase.from("assets").select("id", { count: "exact", head: true }).is("deleted_at", null),
      supabase.from("assets").select("id", { count: "exact", head: true }).eq("media_type", "video").is("deleted_at", null),
      supabase.from("assets").select("id", { count: "exact", head: true }).eq("media_type", "audio").is("deleted_at", null),
      supabase.from("folders").select("id", { count: "exact", head: true }).eq("is_archived", false),
    ]);
    databaseReady = !assets.error && !videos.error && !audio.error && !folders.error;
    counts = { assets: assets.count ?? 0, videos: videos.count ?? 0, audio: audio.count ?? 0, folders: folders.count ?? 0 };
  }
  const metrics = [
    { label: "Total assets", value: counts.assets, icon: Archive },
    { label: "Videos", value: counts.videos, icon: Video },
    { label: "Audio files", value: counts.audio, icon: AudioLines },
    { label: "Folders", value: counts.folders, icon: Boxes },
  ];

  return <main className="min-h-screen bg-[#f7f8fa]">
    <aside className="fixed inset-y-0 left-0 hidden w-[248px] border-r border-[#e8ebef] bg-white px-5 py-6 lg:block">
      <a href="#home" className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-[#182230] text-sm font-bold text-white">TM</span><span><b className="block text-sm">Terence Media Hub</b><small className="text-xs text-slate-500">Creative library</small></span></a>
      <div className="mt-10"><p className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-[.12em] text-slate-400">Workspace</p><nav className="space-y-1">{workspaceLinks.map(({label, icon: Icon, href}, i) => <a key={label} href={href} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${i === 0 ? "bg-slate-100 font-medium text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}><Icon size={17} strokeWidth={1.8}/>{label}</a>)}</nav></div>
      <div className="mt-9"><p className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-[.12em] text-slate-400">Manage</p><nav className="space-y-1">{manageLinks.map(({label, icon: Icon}) => <a key={label} href="#manage" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50"><Icon size={17} strokeWidth={1.8}/>{label}</a>)}</nav></div>
      <div className="absolute inset-x-5 bottom-6 rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-semibold">Set up your workspace</p><p className="mt-1 text-xs leading-5 text-slate-500">Connect Supabase to activate live asset records and authentication.</p><a className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-slate-800" href="#setup">Setup guide <ArrowUpRight size={13}/></a></div>
    </aside>
    <section className="lg:pl-[248px]"><header className="sticky top-0 z-10 flex h-[68px] items-center justify-between border-b border-[#e8ebef] bg-white/95 px-6 backdrop-blur md:px-10"><div className="text-sm text-slate-500">Workspace <span className="mx-2 text-slate-300">/</span><span className="font-medium text-slate-800">Overview</span></div><div className="flex items-center gap-3"><button className="hidden items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 sm:flex"><Search size={15}/>Search assets <kbd className="ml-5 rounded border px-1.5 py-0.5 text-[10px]">⌘ K</kbd></button><a href="/uploads" className="flex items-center gap-2 rounded-lg bg-[#182230] px-3.5 py-2 text-sm font-medium text-white"><Upload size={15}/>Upload assets</a>{supabase && <form action={signOut}><button className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600">Sign out</button></form>}</div></header>
      <div className="mx-auto max-w-[1440px] px-6 py-9 md:px-10"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-[.12em] text-slate-500">Tuesday, November 18, 2026</p><h1 className="mt-2 text-[28px] font-semibold tracking-[-.03em]">Good afternoon</h1><p className="mt-1 text-sm text-slate-500">Your creative library at a glance.</p></div><a href="/folders" className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700"><FolderPlus size={16}/>New folder</a></div>
      {!databaseReady && <div className="mt-7 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{supabase ? "Supabase is connected, but the database is not ready yet. Apply the migration in supabase/migrations to load live statistics." : "Connect Supabase to load live workspace data. No sample statistics are shown."}</div>}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(({ label, value, icon: Icon })=><article key={label} className="rounded-xl border border-[#e8ebef] bg-white p-5"><div className="flex items-center justify-between"><span className="text-sm text-slate-500">{label}</span><Icon size={17} className="text-slate-400" strokeWidth={1.8}/></div><div className="mt-4 text-[30px] font-semibold tracking-tight">{databaseReady ? value.toLocaleString() : "—"}</div><div className="mt-1 text-xs text-slate-400">{databaseReady ? "Live from your library" : "Awaiting connection"}</div></article>)}</div>
      <div className="mt-9 grid gap-6 xl:grid-cols-[1.65fr_1fr]"><section><div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">Explore your library</h2><a href="#assets" className="text-sm text-slate-500 hover:text-slate-800">View all <span aria-hidden>→</span></a></div><div className="grid gap-3 md:grid-cols-3">{shortcuts.map(({label,detail,icon:Icon,href})=><a key={label} href={href} className="group rounded-xl border border-[#e8ebef] bg-white p-5 transition hover:border-slate-300"><div className="grid size-9 place-items-center rounded-lg bg-slate-100 text-slate-700"><Icon size={17}/></div><h3 className="mt-4 text-sm font-semibold">{label}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p><span className="mt-4 block text-sm text-slate-400 group-hover:text-slate-700">Open library →</span></a>)}</div>
      <div className="mt-8 mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">Recent assets</h2><a href="#assets" className="text-sm text-slate-500">See library →</a></div><div className="rounded-xl border border-[#e8ebef] bg-white px-6 py-14 text-center"><div className="mx-auto grid size-11 place-items-center rounded-full bg-slate-100 text-slate-500"><Archive size={19}/></div><h3 className="mt-4 text-sm font-semibold">Your library is ready for its first asset</h3><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-500">Uploads will appear here after storage is connected and your first asset is added.</p><a href="/uploads" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium"><Upload size={14}/>Upload an asset</a></div></section>
      <aside className="space-y-5"><section className="rounded-xl border border-[#e8ebef] bg-white p-5"><h2 className="text-sm font-semibold">Workspace activity</h2><div className="mt-8 text-center"><div className="mx-auto grid size-10 place-items-center rounded-full bg-slate-100 text-slate-500"><Activity size={17}/></div><p className="mt-3 text-xs font-medium">No activity yet</p><p className="mt-1 text-xs text-slate-500">Uploads and changes will show here.</p></div></section><section className="rounded-xl border border-[#e8ebef] bg-white p-5"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Storage</h2><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-600">Not connected</span></div><div className="mt-6 h-1.5 rounded-full bg-slate-100"/><p className="mt-3 text-xs text-slate-500">Connect Cloudflare R2 to track storage usage.</p></section><section className="rounded-xl border border-[#e8ebef] bg-white p-5"><h2 className="text-sm font-semibold">AI processing</h2><div className="mt-4 flex items-center gap-3 rounded-lg bg-slate-50 p-3"><span className="size-2 rounded-full bg-slate-300"/><div><p className="text-xs font-medium">Awaiting configuration</p><p className="mt-0.5 text-[11px] text-slate-500">Analysis starts after Gemini is connected.</p></div></div></section></aside></div>
      </div></section>
  </main>;
}
