import { stat } from "node:fs/promises";
import path from "node:path";
import type { ProcessingJob } from "@/generated/prisma/client";
import { prisma } from "./db";
import { analyzeMedia, queueAnalysis } from "./ai-analysis";
import { getEnv } from "./env";
import { GeminiError, geminiConfigured } from "./gemini";
import { makeAudioProxy, makeThumbnail, makeVideoProxy, probe } from "./ffmpeg";
import { followUpJobs, refreshProcessingStatus } from "./media";
import { checkStorage, ensureStorageDirs, moveNoOverwrite, removeQuietly, resolveStoragePath } from "./storage";

const MAX_ATTEMPTS = 2;
const MAX_AI_ATTEMPTS = 5;

/** Two worker lanes: fast local FFmpeg work, and slow AI analysis (network bound, runs in parallel). */
export type JobLane = "media" | "ai";

/**
 * Claims the next queued job. The conditional update (status still "queued") guarantees that two
 * workers can never run the same job, even though only one worker is normally running.
 */
export async function claimNextJob(lane: JobLane = "media"): Promise<ProcessingJob | null> {
  const jobType = lane === "ai" ? { equals: "analyze" as const } : { not: "analyze" as const };
  for (let tries = 0; tries < 5; tries++) {
    const next = await prisma.processingJob.findFirst({
      where: { status: "queued", runAfter: { lte: new Date() }, jobType },
      orderBy: [{ jobType: "asc" }, { id: "asc" }], // probe first, then proxy, then thumbnail (enum order)
    });
    if (!next) return null;
    const claimed = await prisma.processingJob.updateMany({
      where: { id: next.id, status: "queued" },
      data: { status: "running", startedAt: new Date(), attempts: { increment: 1 }, progress: 0, errorMessage: null },
    });
    if (claimed.count === 1) return prisma.processingJob.findUnique({ where: { id: next.id } });
  }
  return null;
}

/** Jobs left "running" by a crashed or stopped worker go back to the queue on startup. */
export async function requeueInterruptedJobs() {
  const result = await prisma.processingJob.updateMany({ where: { status: "running" }, data: { status: "queued", progress: 0 } });
  return result.count;
}

function outputPath(kind: "proxy-video" | "proxy-audio" | "thumbnail", mediaId: string, createdAt: Date) {
  const year = String(createdAt.getFullYear());
  const month = String(createdAt.getMonth() + 1).padStart(2, "0");
  if (kind === "proxy-video") return path.posix.join("proxies", "videos", year, month, `${mediaId}.mp4`);
  if (kind === "proxy-audio") return path.posix.join("proxies", "audio", year, month, `${mediaId}.m4a`);
  return path.posix.join("thumbnails", year, month, `${mediaId}.jpg`);
}

export async function runJob(job: ProcessingJob, log: (message: string) => void = console.log) {
  const storage = await checkStorage();
  if (!storage.ok) {
    // Drive missing: put the job back and retry in a minute; do not count it as a failure.
    await prisma.processingJob.update({ where: { id: job.id }, data: { status: "queued", attempts: { decrement: 1 }, runAfter: new Date(Date.now() + 60_000), errorMessage: storage.message } });
    log(`job ${job.id}: storage unavailable, will retry (${storage.message})`);
    return;
  }
  const root = storage.root;
  await ensureStorageDirs(root);

  const media = await prisma.mediaFile.findUnique({ where: { id: job.mediaId } });
  if (!media) {
    await prisma.processingJob.update({ where: { id: job.id }, data: { status: "failed", errorMessage: "Media record no longer exists", completedAt: new Date() } });
    return;
  }
  await refreshProcessingStatus(media.id);
  const original = resolveStoragePath(media.originalPath, root);
  let lastProgressWrite = 0;
  const setProgress = (percent: number) => {
    if (Date.now() - lastProgressWrite < 2000) return;
    lastProgressWrite = Date.now();
    prisma.processingJob.update({ where: { id: job.id }, data: { progress: percent } }).catch(() => {});
  };

  try {
    await stat(original).catch(() => { throw new Error("The original file is missing from the media drive"); });

    if (job.jobType === "probe") {
      const info = await probe(original);
      if (media.mediaType === "video" && !info.hasVideo) throw new Error("No video stream found; the file may be damaged");
      if (media.mediaType === "audio" && !info.hasAudio) throw new Error("No audio stream found; the file may be damaged");
      await prisma.mediaFile.update({
        where: { id: media.id },
        data: {
          duration: media.mediaType === "image" ? null : info.duration,
          width: info.width, height: info.height,
          codec: info.videoCodec, audioCodec: info.audioCodec,
          frameRate: media.mediaType === "image" ? null : info.frameRate,
          bitRate: info.bitRate && info.bitRate < 2 ** 31 ? info.bitRate : null,
          probeData: info.raw as object,
        },
      });
      const followUps = followUpJobs(media.mediaType);
      await prisma.processingJob.createMany({ data: followUps.map((jobType) => ({ mediaId: media.id, jobType })) });
      log(`job ${job.id}: probed ${media.id} (${info.width ?? "-"}x${info.height ?? "-"}, ${info.duration ?? 0}s); queued ${followUps.join(", ")}`);
    }

    if (job.jobType === "thumbnail") {
      const relative = outputPath("thumbnail", media.id, media.createdAt);
      const final = resolveStoragePath(relative, root);
      const temp = `${final}.tmp.jpg`;
      await ensureParent(final);
      await removeQuietly(temp);
      await makeThumbnail(original, temp, media.duration, media.mediaType === "image");
      await removeQuietly(final); // regenerating a thumbnail replaces only the old thumbnail
      await moveNoOverwrite(temp, final);
      const size = (await stat(final)).size;
      await prisma.$transaction([
        prisma.mediaFile.update({ where: { id: media.id }, data: { thumbnailPath: relative, thumbnailSize: BigInt(size) } }),
        prisma.storageLocation.upsert({
          where: { mediaId_kind_storageType: { mediaId: media.id, kind: "thumbnail", storageType: "local_ssd" } },
          create: { mediaId: media.id, kind: "thumbnail", storageType: "local_ssd", storagePath: relative, verifiedAt: new Date() },
          update: { storagePath: relative, status: "available", verifiedAt: new Date() },
        }),
      ]);
      log(`job ${job.id}: thumbnail for ${media.id}`);
    }

    if (job.jobType === "proxy") {
      const isVideo = media.mediaType === "video";
      const relative = outputPath(isVideo ? "proxy-video" : "proxy-audio", media.id, media.createdAt);
      const final = resolveStoragePath(relative, root);
      const temp = `${final}.tmp`;
      await ensureParent(final);
      await removeQuietly(temp);
      const started = Date.now();
      let encoder = "aac";
      if (isVideo) encoder = await makeVideoProxy(original, temp, media.duration, Boolean(media.audioCodec), setProgress);
      else await makeAudioProxy(original, temp, media.duration, setProgress);
      await removeQuietly(final);
      await moveNoOverwrite(temp, final);
      const size = (await stat(final)).size;
      await prisma.$transaction([
        prisma.mediaFile.update({ where: { id: media.id }, data: { proxyPath: relative, proxySize: BigInt(size) } }),
        prisma.storageLocation.upsert({
          where: { mediaId_kind_storageType: { mediaId: media.id, kind: "proxy", storageType: "local_ssd" } },
          create: { mediaId: media.id, kind: "proxy", storageType: "local_ssd", storagePath: relative, verifiedAt: new Date() },
          update: { storagePath: relative, status: "available", verifiedAt: new Date() },
        }),
      ]);
      log(`job ${job.id}: proxy for ${media.id} with ${encoder} in ${Math.round((Date.now() - started) / 1000)}s`);
      if (isVideo && getEnv().AI_AUTO_ANALYZE === "true" && geminiConfigured()) {
        await queueAnalysis(media.id);
        log(`job ${job.id}: queued AI analysis for ${media.id}`);
      }
    }

    if (job.jobType === "analyze") {
      await analyzeMedia(media.id, (message) => log(`job ${job.id}: ${message}`));
    }

    await prisma.processingJob.update({ where: { id: job.id }, data: { status: "completed", progress: 100, completedAt: new Date(), errorMessage: null } });
  } catch (error) {
    const message = (error as Error).message?.slice(0, 2000) || "Processing failed";
    const isAi = job.jobType === "analyze";
    const retry = isAi
      ? job.attempts < MAX_AI_ATTEMPTS && (!(error instanceof GeminiError) || error.retryable)
      : job.attempts < MAX_ATTEMPTS && !/missing|damaged|No (video|audio) stream/.test(message);
    // AI: back off 1, 2, 4, 8 minutes so an overloaded or rate-limited API can recover.
    const delay = isAi ? 60_000 * 2 ** Math.max(0, job.attempts - 1) : 30_000;
    await prisma.processingJob.update({
      where: { id: job.id },
      data: retry
        ? { status: "queued", runAfter: new Date(Date.now() + delay), errorMessage: message }
        : { status: "failed", completedAt: new Date(), errorMessage: message },
    });
    // The original is never touched on failure. Only leftover temporary outputs are removed.
    log(`job ${job.id} (${job.jobType}) for ${media.id} ${retry ? "will retry" : "FAILED"}: ${message}`);
  } finally {
    await refreshProcessingStatus(media.id);
  }
}

async function ensureParent(file: string) {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.dirname(file), { recursive: true });
}

/** Retry a failed job (manual action from the UI). */
export async function retryJob(jobId: number) {
  const job = await prisma.processingJob.update({ where: { id: jobId }, data: { status: "queued", attempts: 0, runAfter: new Date(), errorMessage: null, progress: 0, completedAt: null } });
  await refreshProcessingStatus(job.mediaId);
  return job;
}
