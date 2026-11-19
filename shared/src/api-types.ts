/**
 * TMH API contract shared by the frontend and the Express backend.
 * This is the TARGET contract for the Firebase/Firestore backend (Phase 2): all IDs are Firestore
 * document IDs (strings), all timestamps are ISO-8601 strings. See docs/API.md.
 * Pure types only: no runtime imports, safe for browser and Node.
 */

/** Every JSON response uses this envelope. */
export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = { ok: false; error: { code: string; message: string; details?: unknown } };
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type Role = "admin" | "editor" | "viewer";
export type MediaType = "video" | "audio" | "image";
export type ProcessingStatus = "pending" | "processing" | "ready" | "failed";
export type JobType = "probe" | "thumbnail" | "proxy";
export type JobStatus = "queued" | "running" | "completed" | "failed";

export type UserDto = {
  uid: string;
  displayName: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

export type JobDto = {
  jobId: string;
  mediaId: string;
  jobType: JobType;
  status: JobStatus;
  progress: number; // 0-100, measured from FFmpeg output, never simulated
  attempts: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type MediaDto = {
  mediaId: string;
  title: string;
  originalFileName: string;
  mediaType: MediaType;
  mimeType: string;
  fileExtension: string;
  fileSize: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  codec: string | null;
  audioCodec: string | null;
  category: string | null;
  description: string | null;
  folderId: string | null;
  folderName: string | null;
  tags: string[];
  processingStatus: ProcessingStatus;
  uploadedBy: { uid: string; displayName: string } | null;
  proxyAvailable: boolean;
  thumbnailAvailable: boolean;
  proxySize: number | null;
  jobs: JobDto[];
  createdAt: string;
  updatedAt: string;
  /**
   * Short-lived signed URLs (they work in <video>, <img> and download links, which cannot send
   * Authorization headers). Never filesystem paths.
   */
  urls: { thumbnail: string | null; preview: string | null; downloadOriginal: string; downloadProxy: string | null };
};

export type MediaPageDto = {
  items: MediaDto[];
  /** Opaque cursor for the next page (Firestore query cursor), or null at the end. */
  nextCursor: string | null;
  processingCount: number;
};

export type FolderDto = {
  folderId: string;
  name: string;
  parentFolderId: string | null;
  description: string | null;
  childCount: number;
  mediaCount: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StorageStatusDto = {
  checkedAt: string;
  drive: {
    name: string;
    mounted: boolean;
    status: "ok" | "not_mounted" | "marker_missing" | "not_writable";
    message: string | null;
    totalBytes: number | null;
    usedBytes: number | null;
    freeBytes: number | null;
    percentUsed: number | null;
  };
  library: { mediaCount: number; folderCount: number; tagCount: number; originalBytes: number; proxyBytes: number; thumbnailBytes: number };
  jobs: Record<JobStatus, number>;
  lastBackup: { fileName: string; at: string; sizeBytes: number } | null;
};

export type HealthDto = {
  server: "up";
  storage: "up" | "down";
  firestore: "up" | "down" | "not_configured";
  time: string;
};

/** Query parameters for GET /api/media and GET /api/search. */
export type MediaQuery = {
  q?: string;
  type?: MediaType;
  status?: "processing" | "completed" | "failed";
  folderId?: string;
  tag?: string;
  category?: string;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  minDuration?: number;
  maxDuration?: number;
  sort?: "newest" | "oldest" | "name" | "size" | "duration";
  cursor?: string;
  limit?: number;
};
