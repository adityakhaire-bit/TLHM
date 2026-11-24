import type { Prisma } from "@/generated/prisma/client";
import type { JobType, MediaType } from "@/generated/prisma/enums";
import { prisma } from "./db";

export const mediaInclude = {
  folder: { select: { id: true, name: true } },
  tags: { select: { source: true, tag: { select: { id: true, name: true } } } },
  uploadedBy: { select: { id: true, username: true, displayName: true } },
  jobs: {
    select: { id: true, jobType: true, status: true, progress: true, errorMessage: true, startedAt: true, completedAt: true },
    orderBy: { id: "asc" },
  },
} satisfies Prisma.MediaFileInclude;

export type MediaWithRelations = Prisma.MediaFileGetPayload<{ include: typeof mediaInclude }>;

/** Shape sent to the browser. Contains no filesystem paths, only API URLs. */
export function serializeMedia(media: MediaWithRelations) {
  const base = `/api/media/${media.id}`;
  return {
    id: media.id,
    title: media.title,
    originalFilename: media.originalFilename,
    mediaType: media.mediaType,
    mimeType: media.mimeType,
    fileExtension: media.fileExtension,
    fileSize: Number(media.fileSize),
    duration: media.duration,
    width: media.width,
    height: media.height,
    codec: media.codec,
    audioCodec: media.audioCodec,
    frameRate: media.frameRate,
    category: media.category,
    description: media.description,
    folder: media.folder,
    tags: media.tags.filter((entry) => entry.source !== "ai").map((entry) => entry.tag.name).sort(),
    // Added automatically from AI analysis (clothing, colours, poses, actions, setting, keywords).
    aiTags: media.tags.filter((entry) => entry.source === "ai").map((entry) => entry.tag.name),
    uploadedBy: media.uploadedBy ? media.uploadedBy.displayName || media.uploadedBy.username : null,
    processingStatus: media.processingStatus,
    uploadStatus: media.uploadStatus,
    hasPreview: Boolean(media.proxyPath) || media.mediaType === "image",
    hasThumbnail: Boolean(media.thumbnailPath),
    proxySize: media.proxySize === null ? null : Number(media.proxySize),
    jobs: media.jobs,
    createdAt: media.createdAt,
    updatedAt: media.updatedAt,
    urls: {
      thumbnail: media.thumbnailPath ? `${base}/thumbnail` : null,
      preview: media.proxyPath || media.mediaType === "image" ? `${base}/preview` : null,
      downloadOriginal: `${base}/download?variant=original`,
      downloadProxy: media.proxyPath ? `${base}/download?variant=proxy` : null,
    },
  };
}

export type SerializedMedia = ReturnType<typeof serializeMedia>;

/** Jobs each media type needs after the initial probe. */
export function followUpJobs(type: MediaType): JobType[] {
  if (type === "video") return ["thumbnail", "proxy"];
  if (type === "audio") return ["proxy"];
  return ["thumbnail"];
}

/** Recomputes a media item's overall processing status from its jobs. */
export async function refreshProcessingStatus(mediaId: string) {
  // AI analysis is optional extra metadata: it never makes a file "failed" or "processing".
  const jobs = await prisma.processingJob.findMany({ where: { mediaId, jobType: { not: "analyze" } }, select: { status: true } });
  let status: "pending" | "processing" | "ready" | "failed" = "pending";
  if (jobs.some((job) => job.status === "failed")) status = "failed";
  else if (jobs.length > 0 && jobs.every((job) => job.status === "completed")) status = "ready";
  else if (jobs.some((job) => job.status === "running" || job.status === "completed")) status = "processing";
  await prisma.mediaFile.update({ where: { id: mediaId }, data: { processingStatus: status } });
  return status;
}

/** Normalises tag input: trimmed, lower-case, unique, limited length and count. */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 64);
    if (tag) seen.add(tag);
    if (seen.size >= 30) break;
  }
  return [...seen];
}

/** Replaces the tags on a media item, creating tag rows as needed. */
export async function setMediaTags(tx: Prisma.TransactionClient, mediaId: string, tags: string[]) {
  const names = normalizeTags(tags);
  await tx.mediaTag.deleteMany({ where: { mediaId, source: "user" } }); // AI tags are managed by the analysis
  for (const name of names) {
    const tag = await tx.tag.upsert({ where: { name }, create: { name }, update: {} });
    // A tag the AI already added becomes the person's own tag.
    await tx.mediaTag.upsert({ where: { mediaId_tagId: { mediaId, tagId: tag.id } }, create: { mediaId, tagId: tag.id }, update: { source: "user" } });
  }
}
