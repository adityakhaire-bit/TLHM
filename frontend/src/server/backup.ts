import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { prisma } from "./db";
import { getEnv } from "./env";
import { checkStorage, removeQuietly } from "./storage";

export type BackupTrigger = "manual" | "daily" | "pre-migration";

/** MySQL connection details from DATABASE_URL, written to a private temp file so the password never appears in `ps`. */
async function withMysqlDefaultsFile<T>(fn: (defaultsFile: string, database: string) => Promise<T>): Promise<T> {
  const url = new URL(getEnv().DATABASE_URL);
  const dir = await mkdtemp(path.join(os.tmpdir(), "tmh-mysql-"));
  const file = path.join(dir, "client.cnf");
  const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  await writeFile(file, [
    "[client]",
    `user="${escape(decodeURIComponent(url.username))}"`,
    `password="${escape(decodeURIComponent(url.password))}"`,
    `host="${url.hostname}"`,
    `port=${url.port || 3306}`,
    "",
  ].join("\n"), { mode: 0o600 });
  try {
    return await fn(file, url.pathname.replace(/^\//, ""));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function timestamp(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * Creates a consistent, compressed database backup on the SSD:
 *   TMH-Media/database-backups/tmh-db-YYYYMMDD-HHMMSS-<trigger>.sql.gz
 * Never overwrites an existing backup. Records success or failure in the `backups` table when possible.
 * `recordInDb: false` is used before the very first migration, when the table does not exist yet.
 */
export async function createDatabaseBackup(trigger: BackupTrigger, { recordInDb = true } = {}) {
  const storage = await checkStorage();
  if (!storage.ok) throw new Error(`Backup failed: ${storage.message}`);
  const dir = path.join(storage.root, "database-backups");
  const filename = `tmh-db-${timestamp()}-${trigger}.sql.gz`;
  const final = path.join(dir, filename);
  const temp = `${final}.partial`;

  const record = recordInDb ? await prisma.backup.create({ data: { filename, trigger, status: "running" } }) : null;
  try {
    await withMysqlDefaultsFile(async (defaultsFile, database) => {
      const dump = spawn(getEnv().MYSQLDUMP_PATH, [
        `--defaults-extra-file=${defaultsFile}`,
        "--single-transaction", "--quick", "--routines", "--triggers", "--events",
        "--no-tablespaces", "--set-gtid-purged=OFF", "--default-character-set=utf8mb4",
        "--databases", database,
      ], { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      dump.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000); });
      const exited = new Promise<void>((resolve, reject) => {
        dump.on("error", reject);
        dump.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim().split("\n").filter((l) => !/Using a password/.test(l)).pop() || `mysqldump exited with code ${code}`))));
      });
      await Promise.all([pipeline(dump.stdout, createGzip({ level: 6 }), createWriteStream(temp, { flags: "wx" })), exited]);
    });
    const size = (await stat(temp)).size;
    if (size < 200) throw new Error("Backup file is unexpectedly small");
    await rename(temp, final);
    if (record) await prisma.backup.update({ where: { id: record.id }, data: { status: "succeeded", sizeBytes: BigInt(size), completedAt: new Date() } });
    await pruneOldBackups(dir);
    return { filename, sizeBytes: size };
  } catch (error) {
    await removeQuietly(temp);
    const message = (error as Error).message.slice(0, 2000);
    if (record) await prisma.backup.update({ where: { id: record.id }, data: { status: "failed", errorMessage: message, completedAt: new Date() } }).catch(() => {});
    throw new Error(`Database backup failed: ${message}`);
  }
}

/** Keeps the newest BACKUP_KEEP backups. Never deletes when that would leave fewer than 2. */
async function pruneOldBackups(dir: string) {
  const keep = Math.max(2, getEnv().BACKUP_KEEP);
  const files = (await readdir(dir)).filter((name) => /^tmh-db-\d{8}-\d{6}-[a-z-]+\.sql\.gz$/.test(name)).sort();
  const excess = files.slice(0, Math.max(0, files.length - keep));
  for (const name of excess) await removeQuietly(path.join(dir, name));
}

export async function lastSuccessfulBackup() {
  return prisma.backup.findFirst({ where: { status: "succeeded" }, orderBy: { createdAt: "desc" } });
}
