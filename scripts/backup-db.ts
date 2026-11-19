/**
 * Database backup to TMH-Media/database-backups on the SSD.
 *   npm run backup                       manual backup
 *   tsx scripts/backup-db.ts --trigger pre-migration --no-record   (used by `npm run db:migrate`)
 */
import "./load-env";
import { createDatabaseBackup, type BackupTrigger } from "@/server/backup";
import { prisma } from "@/server/db";

async function main() {
  const index = process.argv.indexOf("--trigger");
  const trigger = (index > -1 ? process.argv[index + 1] : "manual") as BackupTrigger;
  if (!["manual", "daily", "pre-migration"].includes(trigger)) throw new Error("--trigger must be manual, daily or pre-migration");
  // Before the very first migration the `backups` table does not exist yet, so the run cannot be recorded.
  let recordInDb = !process.argv.includes("--no-record");
  if (recordInDb) {
    const exists = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'backups'`;
    recordInDb = Number(exists[0]?.n ?? 0) > 0;
  }
  const result = await createDatabaseBackup(trigger, { recordInDb });
  console.log(`Backup saved: database-backups/${result.filename} (${Math.round(result.sizeBytes / 1024)} KB)`);
}

main()
  .catch((error) => { console.error((error as Error).message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
