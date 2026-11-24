import { constants as fsConstants } from "node:fs";
import { access, mkdir, rename, stat, statfs, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "./http";
import { getEnv } from "./env";

/** Marker file that proves MEDIA_STORAGE_ROOT is the real SSD folder and not an empty mount point. */
export const MARKER_FILE = ".tmh-storage";

export const STORAGE_DIRS = [
  "originals/videos", "originals/audio", "originals/images",
  "proxies/videos", "proxies/audio",
  "thumbnails", "uploads-temp", "analysis-temp", "database-backups", "metadata", "logs",
] as const;

export function storageRoot(): string {
  return path.resolve(getEnv().MEDIA_STORAGE_ROOT);
}

/** Volume name for display, e.g. "Extreme SSD" for /Volumes/Extreme SSD/TMH-Media. */
export function driveName(root = storageRoot()): string {
  const match = root.match(/^\/Volumes\/([^/]+)/);
  return match ? match[1] : "Internal disk";
}

export type StorageCheck =
  | { ok: true; root: string; drive: string }
  | { ok: false; root: string; drive: string; reason: "not_mounted" | "marker_missing" | "not_writable"; message: string };

/**
 * Verifies the SSD folder is present, is the real TMH storage folder (marker file) and is writable.
 * Never creates the root folder itself: if the drive is unplugged we must fail, not write to the internal disk.
 */
export async function checkStorage(root = storageRoot()): Promise<StorageCheck> {
  const drive = driveName(root);
  try {
    const info = await stat(root);
    if (!info.isDirectory()) throw new Error("not a directory");
  } catch {
    return { ok: false, root, drive, reason: "not_mounted", message: `The media drive "${drive}" is not connected (storage folder not found).` };
  }
  try {
    await access(path.join(root, MARKER_FILE), fsConstants.R_OK);
  } catch {
    return { ok: false, root, drive, reason: "marker_missing", message: `The storage folder on "${drive}" is missing its ${MARKER_FILE} marker file, so it is not trusted for writes.` };
  }
  try {
    await access(root, fsConstants.W_OK);
  } catch {
    return { ok: false, root, drive, reason: "not_writable", message: `The media drive "${drive}" is read-only or not writable.` };
  }
  return { ok: true, root, drive };
}

/** Throws a 503 ApiError when storage is unavailable, otherwise returns the root and makes sure sub-folders exist. */
export async function requireStorage(): Promise<string> {
  const check = await checkStorage();
  if (!check.ok) throw new ApiError(503, check.message, "storage_unavailable");
  await ensureStorageDirs(check.root);
  return check.root;
}

export async function ensureStorageDirs(root: string) {
  for (const dir of STORAGE_DIRS) await mkdir(path.join(root, dir), { recursive: true });
}

export async function diskUsage(root = storageRoot()) {
  const info = await statfs(root);
  const total = info.blocks * info.bsize;
  const free = info.bavail * info.bsize;
  return { totalBytes: total, freeBytes: free, usedBytes: total - free, percentUsed: total ? Math.round(((total - free) / total) * 1000) / 10 : 0 };
}

/** Fails with 507 when accepting `bytes` would eat into the reserved free space. */
export async function assertFreeSpace(bytes: number, root = storageRoot()) {
  const { freeBytes } = await diskUsage(root);
  const reserve = getEnv().STORAGE_RESERVE_BYTES;
  if (freeBytes - bytes < reserve) {
    throw new ApiError(507, `Not enough free space on the media drive for this file (${formatBytes(bytes)} needed, ${formatBytes(Math.max(0, freeBytes - reserve))} available).`, "insufficient_storage");
  }
}

/**
 * Resolves a stored relative path to an absolute path inside the storage root.
 * Rejects anything that would escape the root (directory traversal) or point at hidden files.
 */
export function resolveStoragePath(relativePath: string, root = storageRoot()): string {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("\0")) throw new ApiError(400, "Invalid storage path", "invalid_path");
  const resolved = path.resolve(root, relativePath);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel) || rel.split(path.sep).some((part) => part.startsWith("."))) {
    throw new ApiError(400, "Invalid storage path", "invalid_path");
  }
  return resolved;
}

/** Moves a file within the SSD without ever replacing an existing file. */
export async function moveNoOverwrite(from: string, to: string) {
  try {
    await access(to);
    throw new ApiError(409, "A file already exists at the destination; refusing to overwrite it", "file_exists");
  } catch (error) {
    if (error instanceof ApiError) throw error;
  }
  await mkdir(path.dirname(to), { recursive: true });
  await rename(from, to);
}

export async function removeQuietly(file: string) {
  try { await unlink(file); } catch { /* already gone */ }
}

/** Writes a small text file atomically (used for logs/metadata), never touching originals. */
export async function writeTextAtomic(file: string, contents: string) {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, contents);
  await rename(temp, file);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(1)} ${units[unit]}`;
}
