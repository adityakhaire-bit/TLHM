import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { prisma } from "./db";
import { getEnv } from "./env";
import { ApiError } from "./http";
import { mediaInclude, setMediaTags } from "./media";
import { detectFileType, sanitizeDisplayFilename, SNIFF_BYTES, titleFromFilename } from "./media-types";
import { assertFreeSpace, formatBytes, moveNoOverwrite, removeQuietly, requireStorage } from "./storage";

export type UploadInput = {
  body: ReadableStream<Uint8Array>;
  declaredSize: number;
  filename: string;
  folderId: number | null;
  category: string | null;
  tags: string[];
  userId: number;
  signal?: AbortSignal;
};

export type UploadResult =
  | { status: "created"; media: Awaited<ReturnType<typeof loadMedia>> }
  | { status: "duplicate"; media: Awaited<ReturnType<typeof loadMedia>> }
  | { status: "restored"; media: Awaited<ReturnType<typeof loadMedia>> };

const loadMedia = (id: string) => prisma.mediaFile.findUniqueOrThrow({ where: { id }, include: mediaInclude });

/**
 * Upload workflow: validate -> check SSD -> stream to uploads-temp -> verify size/type/checksum
 * -> duplicate check -> move into originals (never overwriting) -> create DB record -> queue processing.
 * The temporary file is always removed if anything fails, and nothing is reported as saved unless it is on the SSD.
 */
export async function handleUpload(input: UploadInput): Promise<UploadResult> {
  const env = getEnv();
  if (!Number.isSafeInteger(input.declaredSize) || input.declaredSize <= 0) {
    throw new ApiError(411, "The upload must include its file size (Content-Length)", "length_required");
  }
  if (input.declaredSize > env.MAX_UPLOAD_BYTES) {
    throw new ApiError(413, `File is too large. The limit is ${formatBytes(env.MAX_UPLOAD_BYTES)}.`, "file_too_large");
  }
  if (input.folderId !== null) {
    const folder = await prisma.folder.findUnique({ where: { id: input.folderId }, select: { id: true } });
    if (!folder) throw new ApiError(404, "The selected folder no longer exists", "folder_not_found");
  }

  const root = await requireStorage();
  await assertFreeSpace(input.declaredSize, root);

  const id = randomUUID();
  const tempPath = path.join(root, "uploads-temp", `${id}.part`);
  const hash = createHash("sha256");
  const head: Uint8Array[] = [];
  let headLength = 0;
  let received = 0;

  const out = createWriteStream(tempPath, { flags: "wx" }); // wx: fail rather than overwrite
  const reader = input.body.getReader();
  try {
    for (;;) {
      if (input.signal?.aborted) throw new ApiError(499, "Upload was cancelled", "upload_cancelled");
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > input.declaredSize || received > env.MAX_UPLOAD_BYTES) {
        throw new ApiError(413, "More data was sent than the declared file size", "size_mismatch");
      }
      if (headLength < SNIFF_BYTES) {
        head.push(value.subarray(0, SNIFF_BYTES - headLength));
        headLength += Math.min(value.byteLength, SNIFF_BYTES - headLength);
      }
      hash.update(value);
      if (!out.write(value)) await once(out, "drain");
    }
    out.end();
    await once(out, "finish");
  } catch (error) {
    out.destroy();
    await reader.cancel().catch(() => {});
    await removeQuietly(tempPath);
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "The upload was interrupted before it finished. Please try again.", "upload_interrupted");
  }

  try {
    if (received !== input.declaredSize) {
      throw new ApiError(400, `Upload incomplete: received ${formatBytes(received)} of ${formatBytes(input.declaredSize)}`, "upload_incomplete");
    }
    const detected = detectFileType(Buffer.concat(head));
    if (!detected) {
      throw new ApiError(415, "This file type is not supported. Upload MP4, MOV, MKV, AVI, WebM, MP3, WAV, M4A, JPG or PNG files.", "unsupported_type");
    }
    const checksum = hash.digest("hex");

    // Duplicate check by content, never by filename.
    const existing = await prisma.mediaFile.findUnique({ where: { checksum }, select: { id: true, deletedAt: true } });
    if (existing) {
      await removeQuietly(tempPath);
      if (existing.deletedAt) {
        await prisma.mediaFile.update({ where: { id: existing.id }, data: { deletedAt: null } });
        return { status: "restored", media: await loadMedia(existing.id) };
      }
      return { status: "duplicate", media: await loadMedia(existing.id) };
    }

    const now = new Date();
    const storedFilename = `${id}.${detected.ext}`;
    const kindDir = detected.kind === "video" ? "videos" : detected.kind === "audio" ? "audio" : "images";
    const relativeOriginal = path.posix.join("originals", kindDir, String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"), storedFilename);
    await moveNoOverwrite(tempPath, path.join(root, relativeOriginal));

    const displayName = sanitizeDisplayFilename(input.filename);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.mediaFile.create({
          data: {
            id,
            title: titleFromFilename(displayName),
            originalFilename: displayName,
            storedFilename,
            mimeType: detected.mime,
            fileExtension: detected.ext,
            mediaType: detected.kind,
            fileSize: BigInt(received),
            category: input.category,
            folderId: input.folderId,
            originalPath: relativeOriginal,
            checksum,
            processingStatus: "pending",
            uploadStatus: "complete",
            uploadedById: input.userId,
            storageLocations: { create: { kind: "original", storageType: "local_ssd", storagePath: relativeOriginal, verifiedAt: now } },
            jobs: { create: { jobType: "probe" } },
          },
        });
        if (input.tags.length) await setMediaTags(tx, id, input.tags);
      });
    } catch (error) {
      // Same file uploaded twice at the same moment: the other upload won. Our copy is byte-identical
      // to an existing original and unreferenced, so remove only our copy and report the duplicate.
      if ((error as { code?: string })?.code === "P2002") {
        const winner = await prisma.mediaFile.findUnique({ where: { checksum }, select: { id: true } });
        if (winner) {
          await removeQuietly(path.join(root, relativeOriginal));
          return { status: "duplicate", media: await loadMedia(winner.id) };
        }
      }
      // The file is safely on the SSD but has no record. Leave it in place (never delete originals) and report it.
      console.error(`[upload] Saved ${relativeOriginal} but could not create its database record:`, error);
      throw new ApiError(500, "The file was saved to the media drive, but its library record could not be created. An administrator can re-import it.", "record_failed");
    }
    return { status: "created", media: await loadMedia(id) };
  } catch (error) {
    await removeQuietly(tempPath); // no-op once the file has been moved into originals
    throw error;
  }
}
