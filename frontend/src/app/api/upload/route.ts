import { requireUser } from "@/server/auth";
import { ApiError, ok, route } from "@/server/http";
import { serializeMedia } from "@/server/media";
import { handleUpload } from "@/server/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function header(request: Request, name: string) {
  const value = request.headers.get(name);
  if (!value) return null;
  try { return decodeURIComponent(value); } catch { throw new ApiError(400, `Invalid ${name} header`, "invalid_header"); }
}

/**
 * Streams one file per request. The raw file is the request body; metadata travels in headers:
 *   X-File-Name (URI-encoded), X-Folder-Id, X-Category (URI-encoded), X-Tags (URI-encoded, comma separated)
 * The browser sends one request per file so each file has its own progress bar and error.
 */
export const POST = route(async (request) => {
  const user = await requireUser(request, "editor");
  if (!request.body) throw new ApiError(400, "No file was sent", "empty_body");

  const filename = header(request, "x-file-name");
  if (!filename) throw new ApiError(400, "Missing file name", "missing_filename");
  const folderHeader = request.headers.get("x-folder-id");
  const folderId = folderHeader ? Number(folderHeader) : null;
  if (folderId !== null && (!Number.isInteger(folderId) || folderId <= 0)) throw new ApiError(400, "Invalid folder", "invalid_folder");
  const category = header(request, "x-category")?.trim().slice(0, 100) || null;
  const tags = (header(request, "x-tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);

  const result = await handleUpload({
    body: request.body,
    declaredSize: Number(request.headers.get("content-length")),
    filename, folderId, category, tags,
    userId: user.id,
    signal: request.signal,
  });

  const media = serializeMedia(result.media);
  if (result.status === "duplicate") {
    return ok({ status: "duplicate", message: `This file is already in the library as “${media.originalFilename}”. Nothing was overwritten.`, media }, 409);
  }
  if (result.status === "restored") {
    return ok({ status: "restored", message: "This file had been deleted from the library and has been restored.", media }, 200);
  }
  return ok({ status: "created", media }, 201);
});
