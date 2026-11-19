/**
 * End-to-end test against the RUNNING app (web on :3000 and worker), the real MySQL database and the real SSD.
 *   npm run test:e2e -w @tmh/frontend
 *
 * Safety: uses a temporary test user (random password, never printed) and small synthetic media generated
 * with FFmpeg. Everything it creates (users, folders, media records, files on the SSD) is removed at the end.
 * It never reads, modifies or deletes any other media.
 */
import "./load-env";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/passwords";
import { resolveStoragePath, storageRoot } from "@/server/storage";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const FFMPEG = process.env.FFMPEG_PATH ?? "/opt/homebrew/bin/ffmpeg";
const results: { name: string; ok: boolean; detail: string }[] = [];
const created = { users: [] as number[], media: [] as string[], folders: [] as number[] };

function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
async function check(name: string, fn: () => Promise<string | void>) {
  try { record(name, true, (await fn()) ?? ""); } catch (error) { record(name, false, (error as Error).message); }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let cookie = "";
async function call(method: string, url: string, init: { json?: unknown; body?: BodyInit; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(init.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) };
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  return fetch(`${BASE}${url}`, { method, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body, redirect: "manual" });
}
async function json(response: Response) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await response.json()) as any;
}

async function upload(file: string, name: string, extra: Record<string, string> = {}) {
  const data = await readFile(file);
  return call("POST", "/api/upload", { body: data, headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(name), ...extra } });
}

async function waitForProcessing(mediaId: string, timeoutMs = 120_000) {
  const started = Date.now();
  for (;;) {
    const body = await json(await call("GET", `/api/upload/${mediaId}/status`));
    const status = body.data?.processingStatus;
    if (status === "ready" || status === "failed") return body.data;
    if (Date.now() - started > timeoutMs) throw new Error(`still ${status} after ${timeoutMs / 1000}s — is the worker running?`);
    await sleep(1000);
  }
}

async function main() {
  const work = await mkdtemp(path.join(os.tmpdir(), "tmh-e2e-"));
  const tag = `e2e${randomBytes(3).toString("hex")}`;
  const video = path.join(work, `${tag}_Terence_Interview.mp4`);
  const image = path.join(work, `${tag}_still.png`);
  const corrupt = path.join(work, `${tag}_broken.mp4`);
  const password = randomBytes(18).toString("base64url");
  const username = `${tag}-tester`;

  try {
    // ---------- setup ----------
    execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=8", "-f", "lavfi", "-i", "sine=frequency=440:duration=8", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", video]);
    execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720", "-frames:v", "1", image]);
    // Valid MP4 signature but garbage content: passes the type check, must fail processing safely.
    await writeFile(corrupt, Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), randomBytes(200_000)]));
    const user = await prisma.user.create({ data: { username, displayName: "E2E Tester", role: "admin", passwordHash: await hashPassword(password) } });
    created.users.push(user.id);

    // ---------- 1-3: health, database, SSD ----------
    await check("1. Database connectivity + 2. SSD mount + 3. SSD writable (/api/health)", async () => {
      const response = await fetch(`${BASE}/api/health`);
      const body = await json(response);
      assert(response.status === 200, `HTTP ${response.status}: ${JSON.stringify(body.data)}`);
      assert(body.data.database === "up" && body.data.storage === "up", JSON.stringify(body.data));
      return "database up, storage up";
    });

    await check("Sign-in rejects a wrong password and protects the API", async () => {
      const bad = await call("POST", "/api/auth/login", { json: { username, password: "definitely-wrong-password" } });
      assert(bad.status === 401, `wrong password gave ${bad.status}`);
      const anon = await call("GET", "/api/media");
      assert(anon.status === 401, `unauthenticated API call gave ${anon.status}`);
      const login = await call("POST", "/api/auth/login", { json: { username, password } });
      assert(login.status === 200, `login gave ${login.status}`);
      cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
      assert(cookie.startsWith("tmh_session="), "no session cookie");
      return "401 for wrong password and anonymous access; session cookie set";
    });

    let folderId = 0;
    await check("Create a folder", async () => {
      const response = await call("POST", "/api/folders", { json: { name: `${tag} Dance Rehearsals` } });
      const body = await json(response);
      assert(response.status === 201, `HTTP ${response.status} ${body.error?.message ?? ""}`);
      folderId = body.data.folder.id;
      created.folders.push(folderId);
    });

    // ---------- 4-8: upload, original on SSD, DB record, proxy, thumbnail ----------
    let mediaId = "";
    await check("4. Upload a sample video", async () => {
      const response = await upload(video, path.basename(video), { "X-Folder-Id": String(folderId), "X-Category": "Interview", "X-Tags": encodeURIComponent("terence, e2e") });
      const body = await json(response);
      assert(response.status === 201, `HTTP ${response.status} ${body.error?.message ?? ""}`);
      mediaId = body.data.media.id;
      created.media.push(mediaId);
      return `media ${mediaId}`;
    });

    await check("5. Original exists on the SSD (unique name, same bytes)", async () => {
      const media = await prisma.mediaFile.findUniqueOrThrow({ where: { id: mediaId } });
      const onDisk = resolveStoragePath(media.originalPath);
      assert(onDisk.startsWith(storageRoot()), "original is not under MEDIA_STORAGE_ROOT");
      assert(media.storedFilename === `${mediaId}.mp4`, `stored as ${media.storedFilename}`);
      const [disk, source] = await Promise.all([stat(onDisk), stat(video)]);
      assert(disk.size === source.size, `size ${disk.size} != ${source.size}`);
      return media.originalPath;
    });

    await check("6. Database record exists with metadata", async () => {
      const media = await prisma.mediaFile.findUniqueOrThrow({ where: { id: mediaId }, include: { tags: { include: { tag: true } } } });
      assert(media.originalFilename === path.basename(video), "original filename not kept");
      assert(media.folderId === folderId && media.category === "Interview", "folder/category not saved");
      assert(media.tags.map((t) => t.tag.name).sort().join(",") === "e2e,terence", "tags not saved");
      return `checksum ${media.checksum.slice(0, 12)}…`;
    });

    await check("7. Proxy and 8. thumbnail generated by the worker", async () => {
      const status = await waitForProcessing(mediaId);
      assert(status.processingStatus === "ready", `processing ${status.processingStatus}: ${JSON.stringify(status.jobs)}`);
      const media = await prisma.mediaFile.findUniqueOrThrow({ where: { id: mediaId } });
      assert(media.proxyPath && media.thumbnailPath, "missing proxy or thumbnail path");
      const probe = JSON.parse(execFileSync(process.env.FFPROBE_PATH ?? "/opt/homebrew/bin/ffprobe", ["-v", "error", "-show_streams", "-of", "json", resolveStoragePath(media.proxyPath)]).toString());
      const v = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video");
      assert(v.codec_name === "h264" && v.height === 720, `proxy is ${v.codec_name} ${v.width}x${v.height}`);
      assert(media.width === 1920 && media.height === 1080 && Math.round(media.duration ?? 0) === 8, "metadata not extracted");
      return `proxy ${v.width}x${v.height} h264 (${Math.round(Number(media.proxySize) / 1024)} KB), thumbnail ${Math.round(Number(media.thumbnailSize) / 1024)} KB`;
    });

    // ---------- 9-12: preview, seeking, downloads ----------
    await check("9. Preview streams from the proxy (not the original)", async () => {
      const response = await call("GET", `/api/media/${mediaId}/preview`);
      assert(response.status === 200 && response.headers.get("content-type") === "video/mp4", `HTTP ${response.status}`);
      const media = await prisma.mediaFile.findUniqueOrThrow({ where: { id: mediaId } });
      // Next.js 15 strips Content-Length from route-handler responses, so compare the bytes actually served.
      const served = Buffer.from(await response.arrayBuffer());
      const proxy = await readFile(resolveStoragePath(media.proxyPath!));
      const original = await stat(resolveStoragePath(media.originalPath));
      assert(served.equals(proxy), `served ${served.length} bytes, proxy is ${proxy.length}`);
      assert(served.length !== original.size, "served the original instead of the proxy");
      assert(response.headers.get("accept-ranges") === "bytes", "Accept-Ranges missing");
      return `${served.length} bytes = proxy (original is ${original.size} bytes)`;
    });

    await check("10. Seeking works (HTTP Range → 206)", async () => {
      const response = await call("GET", `/api/media/${mediaId}/preview`, { headers: { Range: "bytes=1000-1999" } });
      const bytes = (await response.arrayBuffer()).byteLength;
      assert(response.status === 206 && bytes === 1000, `HTTP ${response.status}, ${bytes} bytes`);
      assert(response.headers.get("content-range")?.startsWith("bytes 1000-1999/"), "bad Content-Range");
      const outOfRange = await call("GET", `/api/media/${mediaId}/preview`, { headers: { Range: "bytes=999999999-" } });
      assert(outOfRange.status === 416, `out-of-range gave ${outOfRange.status}`);
      return response.headers.get("content-range") ?? "";
    });

    await check("11. Original download (original filename, identical bytes)", async () => {
      const response = await call("GET", `/api/media/${mediaId}/download?variant=original`);
      const data = Buffer.from(await response.arrayBuffer());
      assert(response.status === 200, `HTTP ${response.status}`);
      assert(response.headers.get("content-disposition")?.includes(encodeURIComponent(path.basename(video))), "filename missing");
      assert(data.equals(await readFile(video)), "downloaded bytes differ from the uploaded file");
      return `${data.length} bytes, byte-identical`;
    });

    await check("12. Proxy download", async () => {
      const response = await call("GET", `/api/media/${mediaId}/download?variant=proxy`);
      const data = await response.arrayBuffer();
      assert(response.status === 200 && data.byteLength > 0, `HTTP ${response.status}`);
      assert(response.headers.get("content-disposition")?.includes("(proxy).mp4"), "proxy filename missing");
      return `${data.byteLength} bytes`;
    });

    await check("Thumbnail endpoint", async () => {
      const response = await call("GET", `/api/media/${mediaId}/thumbnail`);
      assert(response.status === 200 && response.headers.get("content-type") === "image/jpeg", `HTTP ${response.status}`);
      await response.arrayBuffer();
    });

    // ---------- 13-14: search and folder filter ----------
    await check("13. Search by filename word, tag, category and month", async () => {
      const month = new Date().toLocaleString("en-US", { month: "long" }) + " " + new Date().getFullYear();
      for (const q of [`${tag} interview`, "terence e2e", `Interview ${tag}`, `${tag} ${month}`]) {
        const body = await json(await call("GET", `/api/media?q=${encodeURIComponent(q)}`));
        assert(body.data.items.some((m: { id: string }) => m.id === mediaId), `no match for "${q}"`);
      }
      const none = await json(await call("GET", `/api/media?q=${encodeURIComponent(`${tag} nonexistentword`)}`));
      assert(none.data.total === 0, "unrelated query matched");
      return "4 queries matched, unrelated query returned 0";
    });

    await check("14. Folder filter", async () => {
      const inFolder = await json(await call("GET", `/api/media?folder=${folderId}`));
      assert(inFolder.data.items.length === 1 && inFolder.data.items[0].id === mediaId, "folder filter wrong");
      const del = await call("DELETE", `/api/folders/${folderId}`);
      assert(del.status === 409, `deleting a non-empty folder gave ${del.status}`);
      return "1 item in folder; non-empty folder delete refused (409)";
    });

    // ---------- 15: storage dashboard ----------
    await check("15. Storage dashboard shows real disk values", async () => {
      const body = await json(await call("GET", "/api/storage/status"));
      const real = execFileSync("df", ["-k", storageRoot()]).toString().trim().split("\n")[1].split(/\s+/);
      const dfFreeBytes = Number(real[3]) * 1024;
      assert(body.data.drive.mounted === true, "drive not mounted");
      const diff = Math.abs(body.data.drive.freeBytes - dfFreeBytes) / dfFreeBytes;
      assert(diff < 0.02, `free ${body.data.drive.freeBytes} vs df ${dfFreeBytes}`);
      assert(body.data.database.connected && body.data.database.mediaCount >= 1, "database counts missing");
      return `${body.data.drive.name}: ${(body.data.drive.freeBytes / 1e9).toFixed(1)} GB free (matches df)`;
    });

    // ---------- 16: missing SSD ----------
    await check("16. Missing SSD produces a clear error (simulated via the storage check)", async () => {
      const { checkStorage } = await import("@/server/storage");
      const result = await checkStorage("/Volumes/TMH E2E Not Connected/TMH-Media");
      assert(!result.ok && result.reason === "not_mounted" && result.message.includes("not connected"), JSON.stringify(result));
      return `"${result.ok ? "" : result.message}" (the real drive was not unplugged)`;
    });

    // ---------- 17: failed processing keeps the original ----------
    await check("17. Failed proxy job does not delete the original", async () => {
      const response = await upload(corrupt, path.basename(corrupt));
      const body = await json(response);
      assert(response.status === 201, `upload gave ${response.status} ${body.error?.message ?? ""}`);
      const badId = body.data.media.id;
      created.media.push(badId);
      const status = await waitForProcessing(badId);
      assert(status.processingStatus === "failed", `expected failed, got ${status.processingStatus}`);
      const media = await prisma.mediaFile.findUniqueOrThrow({ where: { id: badId } });
      const disk = await stat(resolveStoragePath(media.originalPath));
      assert(disk.size === (await stat(corrupt)).size, "original changed or missing");
      const download = await call("GET", `/api/media/${badId}/download?variant=original`);
      assert(download.status === 200, "original not downloadable after failure");
      await download.arrayBuffer();
      return `job failed as expected; original intact (${disk.size} bytes) and downloadable`;
    });

    // ---------- 18: duplicates ----------
    await check("18. Duplicate upload does not overwrite or copy", async () => {
      const before = await prisma.mediaFile.count();
      const response = await upload(video, `renamed copy of ${tag}.mp4`);
      const body = await json(response);
      assert(response.status === 409 && body.data.status === "duplicate" && body.data.media.id === mediaId, `HTTP ${response.status} ${JSON.stringify(body.data ?? body.error)}`);
      assert((await prisma.mediaFile.count()) === before, "a new record was created");
      const original = await prisma.mediaFile.findUniqueOrThrow({ where: { id: mediaId } });
      assert(original.originalFilename === path.basename(video), "existing record was modified");
      return "409 duplicate, pointed at the existing item";
    });

    await check("Rejects a disguised file (HTML named .mp4)", async () => {
      const fake = path.join(work, `${tag}_fake.mp4`);
      await writeFile(fake, "<!DOCTYPE html><html><body>not a video</body></html>".padEnd(600, " "));
      const response = await upload(fake, "fake.mp4");
      assert(response.status === 415, `HTTP ${response.status}`);
      const leftovers = execFileSync("find", [path.join(storageRoot(), "uploads-temp"), "-name", "*.part", "-mmin", "-5"]).toString().trim();
      assert(!leftovers, `temporary files left behind: ${leftovers}`);
      return "415 unsupported_type; no temp file left";
    });
  } finally {
    // ---------- cleanup: only what this test created ----------
    cookie = "";
    for (const id of created.media) {
      const media = await prisma.mediaFile.findUnique({ where: { id } });
      if (!media) continue;
      for (const rel of [media.originalPath, media.proxyPath, media.thumbnailPath]) {
        if (!rel) continue;
        const file = resolveStoragePath(rel);
        await rm(file, { force: true });
        await rm(path.join(path.dirname(file), `._${path.basename(file)}`), { force: true });
      }
      await prisma.mediaFile.delete({ where: { id } });
    }
    await prisma.mediaFile.updateMany({ where: { folderId: { in: created.folders } }, data: { folderId: null } });
    if (created.folders.length) await prisma.folder.deleteMany({ where: { id: { in: created.folders } } });
    if (created.users.length) await prisma.user.deleteMany({ where: { id: { in: created.users } } });
    await prisma.tag.deleteMany({ where: { name: "e2e", media: { none: {} } } });
    await rm(work, { recursive: true, force: true });
    await prisma.$disconnect();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Test data removed.`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => {
  console.error("E2E run crashed:", error);
  process.exitCode = 1;
});
