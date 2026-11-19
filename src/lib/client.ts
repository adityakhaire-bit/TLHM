// Browser-side helpers: API calls, formatting and shared types. No server imports here.

export type MediaItem = {
  id: string;
  title: string;
  originalFilename: string;
  mediaType: "video" | "audio" | "image";
  mimeType: string;
  fileExtension: string;
  fileSize: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  audioCodec: string | null;
  frameRate: number | null;
  category: string | null;
  description: string | null;
  folder: { id: number; name: string } | null;
  tags: string[];
  uploadedBy: string | null;
  processingStatus: "pending" | "processing" | "ready" | "failed";
  uploadStatus: string;
  hasPreview: boolean;
  hasThumbnail: boolean;
  proxySize: number | null;
  jobs: { id: number; jobType: string; status: string; progress: number; errorMessage: string | null }[];
  createdAt: string;
  updatedAt: string;
  urls: { thumbnail: string | null; preview: string | null; downloadOriginal: string; downloadProxy: string | null };
};

export type FolderItem = {
  id: number;
  name: string;
  parentId: number | null;
  description: string | null;
  childCount: number;
  mediaCount: number;
};

export type MediaPage = { items: MediaItem[]; page: number; pageSize: number; total: number; totalPages: number; processingCount: number };

export class ApiRequestError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/** fetch wrapper for our JSON API: returns `data` or throws ApiRequestError with the server's message. */
export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const response = await fetch(url, {
    cache: "no-store",
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  let payload: { ok?: boolean; data?: T; error?: { message?: string; code?: string } } = {};
  try { payload = await response.json(); } catch { /* non-JSON error page */ }
  if (response.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth/login")) {
    window.location.href = "/login";
  }
  if (!response.ok || payload.ok === false) {
    throw new ApiRequestError(response.status, payload.error?.message ?? `Request failed (HTTP ${response.status})`, payload.error?.code);
  }
  return payload.data as T;
}

export const errorMessage = (error: unknown, fallback = "Something went wrong") =>
  error instanceof Error ? error.message : fallback;

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDate(value: string | Date, withTime = false): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });
}

export const STATUS_LABEL: Record<MediaItem["processingStatus"], string> = {
  pending: "Queued",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};

export const STATUS_STYLE: Record<MediaItem["processingStatus"], string> = {
  pending: "bg-slate-100 text-slate-600",
  processing: "bg-blue-50 text-blue-700",
  ready: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
};

/** Folder options indented by depth, for <select> menus. */
export function folderOptions(folders: FolderItem[]): { id: number; label: string; depth: number }[] {
  const children = new Map<number | null, FolderItem[]>();
  for (const folder of folders) children.set(folder.parentId, [...(children.get(folder.parentId) ?? []), folder]);
  const out: { id: number; label: string; depth: number }[] = [];
  const walk = (parent: number | null, depth: number) => {
    for (const folder of (children.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ id: folder.id, label: `${"   ".repeat(depth)}${depth ? "↳ " : ""}${folder.name}`, depth });
      if (depth < 8) walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
