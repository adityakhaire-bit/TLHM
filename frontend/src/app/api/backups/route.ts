import { requireUser } from "@/server/auth";
import { createDatabaseBackup } from "@/server/backup";
import { prisma } from "@/server/db";
import { ApiError, ok, route } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Backup history (newest first). */
export const GET = route(async (request) => {
  await requireUser(request);
  const backups = await prisma.backup.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  return ok({ backups: backups.map((backup) => ({ ...backup, sizeBytes: backup.sizeBytes === null ? null : Number(backup.sizeBytes) })) });
});

/** Run a database backup now (admin). Saved to TMH-Media/database-backups on the SSD. */
export const POST = route(async (request) => {
  await requireUser(request, "admin");
  const running = await prisma.backup.findFirst({ where: { status: "running", createdAt: { gte: new Date(Date.now() - 30 * 60_000) } } });
  if (running) throw new ApiError(409, "A backup is already running", "backup_running");
  try {
    return ok({ backup: await createDatabaseBackup("manual") }, 201);
  } catch (error) {
    throw new ApiError(500, (error as Error).message, "backup_failed");
  }
});
