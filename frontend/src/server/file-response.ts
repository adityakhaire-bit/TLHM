import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { ApiError } from "./http";
import { contentDisposition, parseRange } from "@tmh/shared/http-range";
import { requireStorage, resolveStoragePath } from "./storage";

type Options = {
  relativePath: string;
  mimeType: string;
  request: Request;
  downloadName?: string; // set to force a download with this filename
  cacheSeconds?: number;
};

/**
 * Streams a file from the SSD with HTTP Range support (seeking in video players, resumable downloads).
 * The file is streamed in chunks and never loaded fully into memory. Absolute paths are never exposed.
 */
export async function fileResponse({ relativePath, mimeType, request, downloadName, cacheSeconds = 0 }: Options): Promise<Response> {
  const root = await requireStorage();
  const absolute = resolveStoragePath(relativePath, root);
  let size: number;
  let modified: Date;
  try {
    const info = await stat(absolute);
    if (!info.isFile()) throw new Error("not a file");
    size = info.size;
    modified = info.mtime;
  } catch {
    throw new ApiError(404, "The file is missing from the media drive. It may have been moved or deleted outside the app.", "file_missing");
  }

  const headers = new Headers({
    "Content-Type": mimeType,
    "Accept-Ranges": "bytes",
    "Last-Modified": modified.toUTCString(),
    "Cache-Control": cacheSeconds > 0 ? `private, max-age=${cacheSeconds}` : "private, no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  if (downloadName) headers.set("Content-Disposition", contentDisposition(downloadName));

  const range = parseRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : size - 1;
  headers.set("Content-Length", String(size === 0 ? 0 : end - start + 1));
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${size}`);

  if (request.method === "HEAD" || size === 0) return new Response(null, { status: range ? 206 : 200, headers });

  const nodeStream = createReadStream(absolute, { start, end, highWaterMark: 1024 * 1024 });
  // If the browser stops reading (seek, tab closed), the stream is cancelled and the file handle closed.
  request.signal?.addEventListener("abort", () => nodeStream.destroy(), { once: true });
  const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  return new Response(body, { status: range ? 206 : 200, headers });
}
