import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readdir, rename, stat, statfs, unlink } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import type { MediaKind } from "@tmh/shared/media-types";
import { SNIFF_BYTES } from "@tmh/shared/media-types";
import type { ByteRange } from "@tmh/shared/http-range";
import {
  StorageError,
  type ReadResult, type ReceivedUpload, type StorageAdapter, type StorageAvailability, type StorageKey, type StorageStatus, type StoredObject,
} from "./storage-adapter";

/** Marker file proving MEDIA_STORAGE_ROOT is the real TMH folder and not an empty mount point. */
export const MARKER_FILE = ".tmh-storage";

/** Folder layout inside the storage root (created on demand; existing content is never touched). */
export const STORAGE_LAYOUT = [
  "originals/videos", "originals/audio", "originals/images",
  "proxies/videos", "proxies/audio",
  "thumbnails", "uploads-temp", "database-backups", "metadata", "logs",
] as const;

const KIND_DIR: Record<MediaKind, string> = { video: "videos", audio: "audio", image: "images" };
const UPLOAD_ID = /^[0-9a-f-]{36}$/;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function driveNameFor(root: string): string {
  const match = root.match(/^\/Volumes\/([^/]+)/);
  return match ? match[1] : "Internal disk";
}

const yearMonth = (date: Date) => [String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, "0")];

export class LocalSsdStorageAdapter implements StorageAdapter {
  readonly provider = "local_ssd" as const;
  readonly root: string;
  private readonly tempDir: string;
  private readonly reserveBytes: number;

  constructor(options: { root: string; tempDir?: string; reserveBytes?: number }) {
    this.root = path.resolve(options.root);
    this.tempDir = path.resolve(options.tempDir ?? path.join(this.root, "uploads-temp"));
    this.reserveBytes = options.reserveBytes ?? 5 * 1024 ** 3;
  }

  // ---------- availability ----------

  async verifyStorageAvailability(): Promise<StorageAvailability> {
    const driveName = driveNameFor(this.root);
    try {
      if (!(await stat(this.root)).isDirectory()) throw new Error("not a directory");
    } catch {
      return { ok: false, driveName, reason: "not_mounted", message: `The media drive "${driveName}" is not connected (storage folder not found).` };
    }
    try {
      await access(path.join(this.root, MARKER_FILE), fsConstants.R_OK);
    } catch {
      return { ok: false, driveName, reason: "marker_missing", message: `The storage folder on "${driveName}" has no ${MARKER_FILE} marker file, so it is not trusted for writes.` };
    }
    try {
      await access(this.root, fsConstants.W_OK);
    } catch {
      return { ok: false, driveName, reason: "not_writable", message: `The media drive "${driveName}" is read-only.` };
    }
    return { ok: true, driveName };
  }

  async getStorageStatus(): Promise<StorageStatus> {
    const availability = await this.verifyStorageAvailability();
    if (!availability.ok) return { ...availability, totalBytes: null, usedBytes: null, freeBytes: null, percentUsed: null };
    const info = await statfs(this.root);
    const total = info.blocks * info.bsize;
    const free = info.bavail * info.bsize;
    return { ...availability, totalBytes: total, usedBytes: total - free, freeBytes: free, percentUsed: total ? Math.round(((total - free) / total) * 1000) / 10 : 0 };
  }

  /** Throws a 503 StorageError unless the drive is usable; makes sure the folder layout exists. */
  private async requireAvailable() {
    const availability = await this.verifyStorageAvailability();
    if (!availability.ok) throw new StorageError(503, availability.message, "storage_unavailable");
    for (const dir of STORAGE_LAYOUT) await mkdir(path.join(this.root, dir), { recursive: true });
    await mkdir(this.tempDir, { recursive: true });
  }

  // ---------- path safety ----------

  /** Resolves a storage key to an absolute path inside the root; rejects traversal, absolute and hidden paths. */
  resolveKey(key: StorageKey): string {
    if (typeof key !== "string" || !key || path.isAbsolute(key) || key.includes("\0") || key.includes("\\")) {
      throw new StorageError(400, "Invalid storage key", "invalid_key");
    }
    const resolved = path.resolve(this.root, key);
    const relative = path.relative(this.root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative) || relative.split(path.sep).some((part) => part.startsWith("."))) {
      throw new StorageError(400, "Invalid storage key", "invalid_key");
    }
    return resolved;
  }

  // ---------- uploads / originals ----------

  async receiveUpload(source: AsyncIterable<Uint8Array>, { expectedBytes, maxBytes }: { expectedBytes: number; maxBytes: number }): Promise<ReceivedUpload> {
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) throw new StorageError(411, "The upload must declare its size", "length_required");
    if (expectedBytes > maxBytes) throw new StorageError(413, "The file is larger than the upload limit", "file_too_large");
    await this.requireAvailable();
    const { bavail, bsize } = await statfs(this.root);
    if (bavail * bsize - expectedBytes < this.reserveBytes) {
      throw new StorageError(507, "Not enough free space on the media drive for this file", "insufficient_storage");
    }

    const uploadId = randomUUID();
    const tempPath = path.join(this.tempDir, `${uploadId}.part`);
    const out = createWriteStream(tempPath, { flags: "wx" }); // never overwrite
    const hash = createHash("sha256");
    const head = Buffer.alloc(SNIFF_BYTES);
    let headLength = 0;
    let received = 0;
    try {
      for await (const chunk of source) {
        received += chunk.byteLength;
        if (received > expectedBytes || received > maxBytes) throw new StorageError(413, "More data was sent than the declared file size", "size_mismatch");
        if (headLength < SNIFF_BYTES) {
          const take = Math.min(chunk.byteLength, SNIFF_BYTES - headLength);
          head.set(chunk.subarray(0, take), headLength);
          headLength += take;
        }
        hash.update(chunk);
        if (!out.write(chunk)) await once(out, "drain");
      }
      out.end();
      await once(out, "finish");
      if (received !== expectedBytes) throw new StorageError(400, "The upload ended before the whole file arrived", "upload_incomplete");
    } catch (error) {
      // Wait until the stream has really closed: if the file was still being opened, deleting it
      // first would let it be created afterwards and leave an orphaned .part file behind.
      const closed = once(out, "close").catch(() => {});
      out.destroy();
      await closed;
      await unlink(tempPath).catch(() => {});
      if (error instanceof StorageError) throw error;
      throw new StorageError(400, "The upload was interrupted. Please try again.", "upload_interrupted");
    }
    return { uploadId, sizeBytes: received, sha256: hash.digest("hex"), head: head.subarray(0, headLength) };
  }

  async saveOriginal(uploadId: string, target: { mediaId: string; kind: MediaKind; extension: string; createdAt: Date }): Promise<StoredObject> {
    if (!UPLOAD_ID.test(uploadId)) throw new StorageError(400, "Invalid upload id", "invalid_upload");
    if (!SAFE_NAME.test(`${target.mediaId}.${target.extension}`)) throw new StorageError(400, "Invalid media id or extension", "invalid_name");
    await this.requireAvailable();
    const key = path.posix.join("originals", KIND_DIR[target.kind], ...yearMonth(target.createdAt), `${target.mediaId}.${target.extension}`);
    const from = path.join(this.tempDir, `${uploadId}.part`);
    const to = this.resolveKey(key);
    await this.moveNoOverwrite(from, to);
    return { key, sizeBytes: (await stat(to)).size };
  }

  async discardUpload(uploadId: string) {
    if (!UPLOAD_ID.test(uploadId)) return;
    await unlink(path.join(this.tempDir, `${uploadId}.part`)).catch(() => {});
  }

  getOriginal(key: StorageKey, range?: ByteRange) { return this.read(key, range); }

  // ---------- generated files ----------

  async createWorkFile(name: string): Promise<string> {
    if (!SAFE_NAME.test(name)) throw new StorageError(400, "Invalid work file name", "invalid_name");
    await this.requireAvailable();
    const file = path.join(this.tempDir, `work-${name}`);
    await unlink(file).catch(() => {});
    return file;
  }

  async saveProxy(workFile: string, target: { mediaId: string; kind: "video" | "audio"; createdAt: Date }): Promise<StoredObject> {
    const extension = target.kind === "video" ? "mp4" : "m4a";
    const key = path.posix.join("proxies", target.kind === "video" ? "videos" : "audio", ...yearMonth(target.createdAt), `${target.mediaId}.${extension}`);
    return this.storeGenerated(workFile, key);
  }

  getProxy(key: StorageKey, range?: ByteRange) { return this.read(key, range, "proxies/"); }

  async saveThumbnail(workFile: string, target: { mediaId: string; createdAt: Date }): Promise<StoredObject> {
    const key = path.posix.join("thumbnails", ...yearMonth(target.createdAt), `${target.mediaId}.jpg`);
    return this.storeGenerated(workFile, key);
  }

  getThumbnail(key: StorageKey, range?: ByteRange) { return this.read(key, range, "thumbnails/"); }

  async deleteMedia(keys: { originalKey?: StorageKey; proxyKey?: StorageKey | null; thumbnailKey?: StorageKey | null }, options: { includeOriginal?: boolean } = {}) {
    await this.requireAvailable();
    for (const key of [keys.proxyKey, keys.thumbnailKey]) {
      if (key) await unlink(this.resolveKey(key)).catch(() => {});
    }
    if (options.includeOriginal === true && keys.originalKey) {
      if (!keys.originalKey.startsWith("originals/")) throw new StorageError(400, "Not an original", "invalid_key");
      await unlink(this.resolveKey(keys.originalKey)).catch(() => {});
    }
  }

  async cleanupTemp(maxAgeMs: number): Promise<number> {
    const availability = await this.verifyStorageAvailability();
    if (!availability.ok) return 0;
    let removed = 0;
    for (const name of await readdir(this.tempDir).catch(() => [] as string[])) {
      if (!name.endsWith(".part") && !name.startsWith("work-")) continue; // only files this adapter creates
      const file = path.join(this.tempDir, name);
      const info = await stat(file).catch(() => null);
      if (info?.isFile() && Date.now() - info.mtimeMs > maxAgeMs) {
        await unlink(file).catch(() => {});
        await unlink(path.join(this.tempDir, `._${name}`)).catch(() => {}); // exFAT metadata twin
        removed++;
      }
    }
    return removed;
  }

  // ---------- internals ----------

  private async storeGenerated(workFile: string, key: StorageKey): Promise<StoredObject> {
    await this.requireAvailable();
    const source = path.resolve(workFile);
    if (path.dirname(source) !== this.tempDir || !path.basename(source).startsWith("work-")) {
      throw new StorageError(400, "Generated files must come from createWorkFile()", "invalid_work_file");
    }
    const target = this.resolveKey(key);
    await mkdir(path.dirname(target), { recursive: true });
    await unlink(target).catch(() => {}); // replaces an older generated file for the same media only
    await rename(source, target);
    return { key, sizeBytes: (await stat(target)).size };
  }

  private async moveNoOverwrite(from: string, to: string) {
    const exists = await access(to).then(() => true, () => false);
    if (exists) throw new StorageError(409, "A file already exists at the destination; refusing to overwrite it", "file_exists");
    await mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
  }

  private async read(key: StorageKey, range?: ByteRange, requiredPrefix?: string): Promise<ReadResult> {
    if (requiredPrefix && !key.startsWith(requiredPrefix)) throw new StorageError(400, "Invalid storage key", "invalid_key");
    const availability = await this.verifyStorageAvailability();
    if (!availability.ok) throw new StorageError(503, availability.message, "storage_unavailable");
    const file = this.resolveKey(key);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) throw new StorageError(404, "The file is missing from the media drive", "file_missing");
    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(0, info.size - 1);
    if (info.size > 0 && (start > end || end >= info.size)) throw new StorageError(416, "Requested range is outside the file", "range_not_satisfiable");
    const stream = createReadStream(file, info.size === 0 ? {} : { start, end, highWaterMark: 1024 * 1024 });
    return { stream, totalBytes: info.size, start, end, lastModified: info.mtime };
  }
}
