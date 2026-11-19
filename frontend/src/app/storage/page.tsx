import { HardDrive } from "lucide-react";
import { AppShell, PageHeading } from "@/components/app-shell";
import { StoragePanel } from "@/components/storage-panel";
import { requirePageUser } from "@/server/auth";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

const fmtBytes = (bytes: bigint | null) => (bytes === null ? "—" : `${(Number(bytes) / 1024).toFixed(0)} KB`);
const fmtDate = (date: Date) => date.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function StoragePage() {
  const user = await requirePageUser();
  const [backups, jobs] = await Promise.all([
    prisma.backup.findMany({ orderBy: { createdAt: "desc" }, take: 15 }).catch(() => null),
    prisma.processingJob.findMany({ orderBy: { id: "desc" }, take: 15, include: { media: { select: { title: true } } } }).catch(() => null),
  ]);
  return (
    <AppShell user={user} active="storage" crumb="Storage & backups">
      <div className="mx-auto max-w-[1440px] px-4 py-9 md:px-10">
        <PageHeading icon={HardDrive} title="Storage & backups" subtitle="Live status of the media drive, database, processing queue and database backups." />
        <StoragePanel isAdmin={user.role === "admin"} layout="grid" />
        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <section className="rounded-xl border border-[#e8ebef] bg-white">
            <h2 className="border-b border-slate-100 px-5 py-3.5 text-sm font-semibold">Database backups</h2>
            {!backups ? <p className="p-5 text-sm text-red-700">Database unavailable.</p> : backups.length === 0 ? <p className="p-5 text-sm text-slate-500">No backups yet. The worker makes one automatically every day.</p> : (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-2 font-medium">When</th><th className="px-2 py-2 font-medium">Type</th><th className="px-2 py-2 font-medium">Size</th><th className="px-5 py-2 font-medium">Result</th></tr></thead>
                <tbody>{backups.map((backup) => (
                  <tr key={backup.id} className="border-t border-slate-100">
                    <td className="px-5 py-2.5">{fmtDate(backup.createdAt)}</td><td className="px-2 py-2.5 capitalize">{backup.trigger}</td><td className="px-2 py-2.5">{fmtBytes(backup.sizeBytes)}</td>
                    <td className="px-5 py-2.5">{backup.status === "succeeded" ? <span className="text-emerald-700">Saved</span> : backup.status === "failed" ? <span className="text-red-700" title={backup.errorMessage ?? ""}>Failed</span> : "Running"}</td>
                  </tr>))}</tbody>
              </table>
            )}
          </section>
          <section className="rounded-xl border border-[#e8ebef] bg-white">
            <h2 className="border-b border-slate-100 px-5 py-3.5 text-sm font-semibold">Recent processing jobs</h2>
            {!jobs ? <p className="p-5 text-sm text-red-700">Database unavailable.</p> : jobs.length === 0 ? <p className="p-5 text-sm text-slate-500">No processing jobs yet.</p> : (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-2 font-medium">Media</th><th className="px-2 py-2 font-medium">Job</th><th className="px-5 py-2 font-medium">Status</th></tr></thead>
                <tbody>{jobs.map((job) => (
                  <tr key={job.id} className="border-t border-slate-100">
                    <td className="max-w-[220px] truncate px-5 py-2.5">{job.media.title}</td><td className="px-2 py-2.5 capitalize">{job.jobType}</td>
                    <td className="px-5 py-2.5"><span className={job.status === "failed" ? "text-red-700" : job.status === "completed" ? "text-emerald-700" : "text-blue-700"} title={job.errorMessage ?? ""}>{job.status}{job.status === "running" && job.progress ? ` ${job.progress}%` : ""}</span></td>
                  </tr>))}</tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
