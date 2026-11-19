import type { Readable } from "node:stream";
import type { MediaKind } from "@tmh/shared/media-types";
import type { ByteRange } from "@tmh/shared/http-range";

/**
 * Provider-independent storage contract. The MVP implements it for the local SSD
 * (LocalSsdStorageAdapter); an S3 / Cloudflare R2 / Firebase Storage adapter can implement the same
 * interface later (for example to keep proxies in the cloud while originals stay on the SSD).
 *
 * Everything outside an adapter works with STORAGE KEYS: relative, logical paths such as
 * "originals/videos/2026/11/<mediaId>.mp4". Keys are what the database stores. Absolute paths never
 * leave the adapter and are never sent to the browser.
 */
export type StorageKey = string;

export type StorageAvailability =
  | { ok: true; driveName: string }
  | { ok: false; driveName: string; reason: "not_mounted" | "marker_missing" | "not_writable"; message: string };

export type StorageStatus = StorageAvailability & {
  totalBytes: number | null;
  usedBytes: number | null;
  freeBytes: number | null;
  percentUsed: number | null;
};

/** A finished upload sitting in temporary storage, not yet part of the library. */
export type ReceivedUpload = {
  uploadId: string;
  sizeBytes: number;
  sha256: string;
  /** First bytes of the file, for content-based type detection. */
  head: Uint8Array;
};

export type StoredObject = { key: StorageKey; sizeBytes: number };

export type ReadResult = {
  stream: Readable;
  totalBytes: number;
  /** The byte range being returned (whole file when no range was requested). */
  start: number;
  end: number;
  lastModified: Date;
};

export interface StorageAdapter {
  readonly provider: "local_ssd";

  /** Is the drive present, trusted (marker file) and writable right now? Never creates the root. */
  verifyStorageAvailability(): Promise<StorageAvailability>;
  /** Availability plus real capacity figures from the filesystem. */
  getStorageStatus(): Promise<StorageStatus>;

  /**
   * Streams an upload into temporary storage on the same drive. Enforces the declared size and the
   * maximum size, computes SHA-256 and captures the first bytes. Removes the partial file on failure.
   */
  receiveUpload(source: AsyncIterable<Uint8Array>, options: { expectedBytes: number; maxBytes: number }): Promise<ReceivedUpload>;
  /** Moves a received upload into permanent original storage. Never overwrites an existing file. */
  saveOriginal(uploadId: string, target: { mediaId: string; kind: MediaKind; extension: string; createdAt: Date }): Promise<StoredObject>;
  /** Deletes a temporary upload that will not be kept (failed validation or duplicate). */
  discardUpload(uploadId: string): Promise<void>;

  getOriginal(key: StorageKey, range?: ByteRange): Promise<ReadResult>;

  /** A local scratch path where FFmpeg can write its output before saveProxy/saveThumbnail. */
  createWorkFile(name: string): Promise<string>;
  /** Stores a generated proxy (replacing an older proxy for the same media, never an original). */
  saveProxy(workFile: string, target: { mediaId: string; kind: "video" | "audio"; createdAt: Date }): Promise<StoredObject>;
  getProxy(key: StorageKey, range?: ByteRange): Promise<ReadResult>;
  saveThumbnail(workFile: string, target: { mediaId: string; createdAt: Date }): Promise<StoredObject>;
  getThumbnail(key: StorageKey, range?: ByteRange): Promise<ReadResult>;

  /**
   * Removes generated files (proxy, thumbnail) for a media item. Originals are only removed when
   * `includeOriginal: true` is passed explicitly; normal library deletion keeps the original.
   */
  deleteMedia(keys: { originalKey?: StorageKey; proxyKey?: StorageKey | null; thumbnailKey?: StorageKey | null }, options?: { includeOriginal?: boolean }): Promise<void>;

  /** Removes temporary uploads older than `maxAgeMs`. Returns how many were removed. */
  cleanupTemp(maxAgeMs: number): Promise<number>;
}

/** Error with an HTTP status that is safe to show to users. */
export class StorageError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
  }
}
