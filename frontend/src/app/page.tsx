import { Archive, AudioLines, Boxes, FolderPlus, Image as ImageIcon, Video } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { RecentMedia } from "@/components/recent-media";
import { StoragePanel } from "@/components/storage-panel";
import { requirePageUser } from "@/server/auth";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

const shortcuts = [
  { label: "All media", detail: "Browse the complete library", icon: Archive, href: "/library" },
  { label: "Terence Lewis", detail: "Videos, podcasts and interviews", icon: Video, href: "/library?q=Terence" },
  { label: "Creative resources", detail: "Audio, images and design assets", icon: Boxes, href: "/library?type=audio" },
];

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

async function loadCounts() {
  try {
    const live = { deletedAt: null };
    const [assets, videos, audio, images, folders] = await Promise.all([
      prisma.mediaFile.count({ where: live }),
      prisma.mediaFile.count({ where: { ...live, mediaType: "video" } }),
      prisma.mediaFile.count({ where: { ...live, mediaType: "audio" } }),
      prisma.mediaFile.count({ where: { ...live, mediaType: "image" } }),
      prisma.folder.count(),
    ]);
    return { assets, videos, audio, images, folders };
  } catch (error) {
    console.error("[dashboard] could not load counts:", error);
    return null;
  }
}

export default async function Home() {
  const user = await requirePageUser();
  const counts = await loadCounts();
  const now = new Date();
  const metrics = [
    { label: "Total assets", value: counts?.assets, icon: Archive, href: "/library" },
    { label: "Videos", value: counts?.videos, icon: Video, href: "/library?type=video" },
    { label: "Audio files", value: counts?.audio, icon: AudioLines, href: "/library?type=audio" },
    { label: "Images", value: counts?.images, icon: ImageIcon, href: "/library?type=image" },
  ];

  return (
    <AppShell user={user} active="overview" crumb="Overview">
      <div className="mx-auto max-w-[1440px] px-4 py-9 md:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[.12em] text-slate-500">{now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
            <h1 className="mt-2 text-[28px] font-semibold tracking-[-.03em]">{greeting(now.getHours())}, {user.displayName || user.username}</h1>
            <p className="mt-1 text-sm text-slate-500">Your creative library at a glance.</p>
          </div>
          {user.role !== "viewer" && <a href="/folders" className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700"><FolderPlus size={16} />New folder</a>}
        </div>

        {!counts && <div className="mt-7 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">The database is not reachable, so live statistics cannot be shown. Check that MySQL is running on the Mac mini.</div>}

        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map(({ label, value, icon: Icon, href }) => (
            <a key={label} href={href} className="rounded-xl border border-[#e8ebef] bg-white p-5 transition hover:border-slate-300">
              <div className="flex items-center justify-between"><span className="text-sm text-slate-500">{label}</span><Icon size={17} className="text-slate-400" strokeWidth={1.8} /></div>
              <div className="mt-4 text-[30px] font-semibold tracking-tight">{value === undefined ? "—" : value.toLocaleString()}</div>
              <div className="mt-1 text-xs text-slate-400">{value === undefined ? "Database unavailable" : "Live from your library"}</div>
            </a>
          ))}
        </div>

        <div className="mt-9 grid gap-6 xl:grid-cols-[1.65fr_1fr]">
          <section>
            <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">Explore your library</h2><a href="/library" className="text-sm text-slate-500 hover:text-slate-800">View all <span aria-hidden>→</span></a></div>
            <div className="grid gap-3 md:grid-cols-3">
              {shortcuts.map(({ label, detail, icon: Icon, href }) => (
                <a key={label} href={href} className="group rounded-xl border border-[#e8ebef] bg-white p-5 transition hover:border-slate-300">
                  <div className="grid size-9 place-items-center rounded-lg bg-slate-100 text-slate-700"><Icon size={17} /></div>
                  <h3 className="mt-4 text-sm font-semibold">{label}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
                  <span className="mt-4 block text-sm text-slate-400 group-hover:text-slate-700">Open library →</span>
                </a>
              ))}
            </div>
            <div className="mb-3 mt-8 flex items-center justify-between"><h2 className="text-base font-semibold">Recent assets</h2><a href="/library?recent=1" className="text-sm text-slate-500">See library →</a></div>
            <RecentMedia role={user.role} />
          </section>
          <aside><StoragePanel isAdmin={user.role === "admin"} /></aside>
        </div>
      </div>
    </AppShell>
  );
}
