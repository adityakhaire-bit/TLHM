import type { BackendConfig } from "../config/env";
import { LocalSsdStorageAdapter } from "./local-ssd-adapter";
import type { StorageAdapter } from "./storage-adapter";

/**
 * Chooses the storage adapter from configuration. Only the local SSD adapter exists in the MVP;
 * CLOUD_STORAGE_ENABLED=true is rejected until a cloud adapter is implemented, rather than
 * silently storing media somewhere unexpected.
 */
export function createStorage(config: BackendConfig): StorageAdapter {
  if (config.CLOUD_STORAGE_ENABLED === "true") {
    throw new Error("CLOUD_STORAGE_ENABLED=true, but no cloud storage adapter is implemented yet. Set it to false.");
  }
  return new LocalSsdStorageAdapter({ root: config.MEDIA_STORAGE_ROOT, tempDir: config.uploadTempDir, reserveBytes: config.STORAGE_RESERVE_BYTES });
}

export type { StorageAdapter } from "./storage-adapter";
export { StorageError } from "./storage-adapter";
