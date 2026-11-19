import { prisma } from "./db";
import { lastSuccessfulBackup } from "./backup";
import { checkStorage, diskUsage, driveName, storageRoot } from "./storage";

/** Everything the storage dashboard shows. All values come from the real drive and database. */
export async function getStorageStatus() {
  const root = storageRoot();
  const check = await checkStorage(root);
  let disk: Awaited<ReturnType<typeof diskUsage>> | null = null;
  if (check.ok) disk = await diskUsage(root).catch(() => null);

  let database: {
    connected: boolean;
    mediaCount: number; folderCount: number; tagCount: number;
    originalBytes: number; proxyBytes: number; thumbnailBytes: number;
    byType: Record<string, number>;
    lastBackup: { filename: string; at: Date; sizeBytes: number | null } | null;
    lastBackupFailure: { at: Date; error: string | null } | null;
    jobs: { queued: number; running: number; completed: number; failed: number };
    error?: string;
  };
  try {
    const live = { deletedAt: null };
    const [mediaCount, folderCount, tagCount, sums, byType, jobGroups, backup, failedBackup] = await Promise.all([
      prisma.mediaFile.count({ where: live }),
      prisma.folder.count(),
      prisma.tag.count(),
      // Soft-deleted media still occupy the drive, so sizes include them.
      prisma.mediaFile.aggregate({ _sum: { fileSize: true, proxySize: true, thumbnailSize: true } }),
      prisma.mediaFile.groupBy({ by: ["mediaType"], where: live, _count: { _all: true } }),
      prisma.processingJob.groupBy({ by: ["status"], _count: { _all: true } }),
      lastSuccessfulBackup(),
      prisma.backup.findFirst({ where: { status: "failed" }, orderBy: { createdAt: "desc" } }),
    ]);
    const jobs = { queued: 0, running: 0, completed: 0, failed: 0 };
    for (const group of jobGroups) jobs[group.status] = group._count._all;
    database = {
      connected: true,
      mediaCount, folderCount, tagCount,
      originalBytes: Number(sums._sum.fileSize ?? 0),
      proxyBytes: Number(sums._sum.proxySize ?? 0),
      thumbnailBytes: Number(sums._sum.thumbnailSize ?? 0),
      byType: Object.fromEntries(byType.map((group) => [group.mediaType, group._count._all])),
      lastBackup: backup ? { filename: backup.filename, at: backup.createdAt, sizeBytes: backup.sizeBytes === null ? null : Number(backup.sizeBytes) } : null,
      lastBackupFailure: failedBackup && (!backup || failedBackup.createdAt > backup.createdAt) ? { at: failedBackup.createdAt, error: failedBackup.errorMessage } : null,
      jobs,
    };
  } catch (error) {
    console.error("[stats] database query failed:", error);
    database = {
      connected: false, mediaCount: 0, folderCount: 0, tagCount: 0, originalBytes: 0, proxyBytes: 0, thumbnailBytes: 0,
      byType: {}, lastBackup: null, lastBackupFailure: null, jobs: { queued: 0, running: 0, completed: 0, failed: 0 },
      error: "The database is not reachable",
    };
  }

  return {
    checkedAt: new Date(),
    drive: {
      name: driveName(root),
      mounted: check.ok,
      status: check.ok ? "ok" : check.reason,
      message: check.ok ? null : check.message,
      ...(disk ?? { totalBytes: null, usedBytes: null, freeBytes: null, percentUsed: null }),
    },
    database,
  };
}
