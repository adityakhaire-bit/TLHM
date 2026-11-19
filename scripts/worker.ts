/**
 * Media processing worker. Run alongside the web app: `npm run worker`.
 * - Processes jobs one at a time (probe -> thumbnail -> proxy) so the Mac mini is never overloaded.
 * - Re-queues jobs that were interrupted by a crash or restart.
 * - Removes abandoned temporary uploads older than 24 hours (uploads-temp only).
 * - Makes the automatic daily database backup onto the SSD.
 */
import "./load-env";
import { appendFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createDatabaseBackup } from "@/server/backup";
import { prisma } from "@/server/db";
import { getEnv } from "@/server/env";
import { claimNextJob, requeueInterruptedJobs, runJob } from "@/server/jobs";
import { checkStorage, removeQuietly } from "@/server/storage";

const IDLE_MS = 2000;
const TEMP_MAX_AGE_MS = 24 * 3600 * 1000;
let stopping = false;
let lastTempCleanup = 0;
let lastBackupCheck = 0;
let storageWarned = false;

async function log(message: string) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  const storage = await checkStorage().catch(() => null);
  if (storage?.ok) {
    const month = new Date().toISOString().slice(0, 7);
    await appendFile(path.join(storage.root, "logs", `worker-${month}.log`), `${line}\n`).catch(() => {});
  }
}

async function cleanupTempUploads() {
  const storage = await checkStorage();
  if (!storage.ok) return;
  const dir = path.join(storage.root, "uploads-temp");
  let removed = 0;
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!name.endsWith(".part")) continue; // only our own temporary files
    const file = path.join(dir, name);
    const info = await stat(file).catch(() => null);
    if (info && Date.now() - info.mtimeMs > TEMP_MAX_AGE_MS) {
      await removeQuietly(file);
      await removeQuietly(path.join(dir, `._${name}`));
      removed++;
    }
  }
  if (removed) await log(`cleanup: removed ${removed} abandoned temporary upload(s)`);
}

async function dailyBackupIfDue() {
  const last = await prisma.backup.findFirst({ where: { status: "succeeded", trigger: "daily" }, orderBy: { createdAt: "desc" } });
  if (last && Date.now() - last.createdAt.getTime() < 23.5 * 3600 * 1000) return;
  const recentFailure = await prisma.backup.findFirst({ where: { status: "failed", trigger: "daily", createdAt: { gte: new Date(Date.now() - 3600 * 1000) } } });
  if (recentFailure) return; // retry at most hourly
  try {
    const result = await createDatabaseBackup("daily");
    await log(`backup: daily database backup saved as ${result.filename} (${Math.round(result.sizeBytes / 1024)} KB)`);
  } catch (error) {
    await log(`backup: DAILY BACKUP FAILED: ${(error as Error).message}`);
  }
}

async function main() {
  getEnv(); // fail fast on bad configuration
  await prisma.$queryRaw`SELECT 1`;
  const requeued = await requeueInterruptedJobs();
  const storage = await checkStorage();
  await log(`worker started (pid ${process.pid}); storage: ${storage.ok ? `ok on "${storage.drive}"` : storage.message}${requeued ? `; re-queued ${requeued} interrupted job(s)` : ""}`);

  while (!stopping) {
    try {
      if (Date.now() - lastTempCleanup > 3600 * 1000) { lastTempCleanup = Date.now(); await cleanupTempUploads(); }
      if (Date.now() - lastBackupCheck > 15 * 60 * 1000) { lastBackupCheck = Date.now(); await dailyBackupIfDue(); }

      const check = await checkStorage();
      if (!check.ok) {
        if (!storageWarned) { await log(`STORAGE UNAVAILABLE: ${check.message} Processing paused until the drive is back.`); storageWarned = true; }
        await sleep(10_000);
        continue;
      }
      if (storageWarned) { await log("storage is back; resuming processing"); storageWarned = false; }

      const job = await claimNextJob();
      if (!job) { await sleep(IDLE_MS); continue; }
      await runJob(job, (message) => void log(message));
    } catch (error) {
      await log(`worker loop error: ${(error as Error).message}`);
      await sleep(5000);
    }
  }
  await prisma.$disconnect();
  await log("worker stopped");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log(`${signal} received: finishing the current step and stopping (press again to force).`);
    // Interrupted jobs are re-queued automatically on the next start.
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

main().catch(async (error) => {
  console.error("worker failed to start:", error);
  process.exit(1);
});
