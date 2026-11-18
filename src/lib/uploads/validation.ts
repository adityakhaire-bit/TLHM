import { z } from "zod";
import { MAX_UPLOAD_BYTES } from "@/lib/r2/client";

const allowedMimeTypes = new Set([
  "video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/mpeg", "video/x-msvideo",
  "audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/x-wav", "audio/ogg", "audio/flac",
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/tiff",
  "application/pdf", "text/plain", "application/zip", "application/x-7z-compressed", "application/vnd.rar",
  "application/octet-stream",
]);

export const initiateUploadSchema = z.object({
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(2000).nullable().optional(),
  filename: z.string().trim().min(1).max(255).refine((name) => !name.includes("/") && !name.includes("\\") && !/[\u0000-\u001f]/.test(name), "Filename must not contain path separators or control characters"),
  mimeType: z.string().trim().toLowerCase().refine((type) => allowedMimeTypes.has(type), "This file type is not supported"),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  folderId: z.string().uuid().nullable().optional(),
  collectionId: z.string().uuid().nullable().optional(),
});

export function classifyMediaType(mimeType: string): "video" | "audio" | "image" | "document" | "archive" | "other" {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/zip" || mimeType === "application/x-7z-compressed" || mimeType === "application/vnd.rar") return "archive";
  if (mimeType === "application/pdf" || mimeType === "text/plain") return "document";
  return "other";
}
