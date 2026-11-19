/**
 * End-to-end test of AI video analysis against the RUNNING app + worker, real MySQL, real SSD and real Gemini.
 *   npm run test:e2e:ai -w @tmh/frontend
 *
 * Uses a synthetic clip only (coloured scenes + speech generated with macOS `say`), a temporary admin user,
 * and removes everything it created at the end. It sends nothing but that synthetic clip to Google.
 */
import "./load-env";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/passwords";
import { resolveStoragePath } from "@/server/storage";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const FFMPEG = process.env.FFMPEG_PATH ?? "/opt/homebrew/bin/ffmpeg";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let cookie = "";
let failures = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function check(name: string, fn: () => Promise<string | void>) {
  try { console.log(`PASS  ${name}  ${(await fn()) ?? ""}`); } catch (error) { failures++; console.log(`FAIL  ${name}  (${(error as Error).message})`); }
}
async function call(method: string, url: string, init: { json?: unknown; body?: BodyInit; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(init.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) };
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${BASE}${url}`, { method, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
}

async function main() {
  const work = await mkdtemp(path.join(os.tmpdir(), "tmh-e2e-ai-"));
  const tag = `e2eai${randomBytes(3).toString("hex")}`;
  const speech = path.join(work, "speech.aiff");
  const video = path.join(work, `${tag}_studio_talk.mp4`);
  const password = randomBytes(18).toString("base64url");
  let userId = 0;
  let mediaId = "";

  try {
    execFileSync("say", ["-o", speech, "Welcome to the studio. Today we talk about fitness, warm up exercises and dance practice."]);
    execFileSync(FFMPEG, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=red:size=1280x720:rate=25:duration=5",
      "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=25:duration=5",
      "-i", speech,
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v];[2:a]apad[a]", "-map", "[v]", "-map", "[a]",
      "-t", "10", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", video,
    ]);
    const user = await prisma.user.create({ data: { username: `${tag}-tester`, displayName: "AI E2E", role: "admin", passwordHash: await hashPassword(password) } });
    userId = user.id;
    const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: user.username, password }) });
    cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    assert(cookie.startsWith("tmh_session="), `login failed (${login.status})`);

    await check("Upload synthetic clip", async () => {
      const response = await call("POST", "/api/upload", { body: await readFile(video), headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(path.basename(video)), "X-Category": "Test" } });
      assert(response.status === 201, `HTTP ${response.status} ${response.body.error?.message ?? ""}`);
      mediaId = response.body.data.media.id;
      return mediaId;
    });

    await check("Preview made, then AI analysis queued automatically and completed", async () => {
      const started = Date.now();
      for (;;) {
        const state = await call("GET", `/api/media/${mediaId}/analysis`);
        const job = state.body.data?.job;
        if (job?.status === "failed") throw new Error(`analysis failed: ${job.errorMessage}`);
        if (state.body.data?.analysis) return `${Math.round((Date.now() - started) / 1000)}s`;
        if (Date.now() - started > 8 * 60_000) throw new Error(`timed out (job ${job?.status ?? "not queued"}: ${job?.errorMessage ?? ""})`);
        await sleep(3000);
      }
    });

    await check("Analysis has summary, timed segments, attributes and a transcript", async () => {
      const { body } = await call("GET", `/api/media/${mediaId}/analysis`);
      const analysis = body.data.analysis;
      assert(analysis.summary.length > 10, "empty summary");
      assert(analysis.segments.length >= 1, "no segments");
      assert(analysis.segments.every((segment: { startMs: number; endMs: number }) => segment.endMs > segment.startMs && segment.endMs <= 10_500), "segment times out of range");
      const transcript = analysis.transcript.map((line: { text: string }) => line.text).join(" ").toLowerCase();
      assert(/fitness|studio|dance/.test(transcript), `transcript missing the spoken words: "${transcript.slice(0, 120)}"`);
      return `${analysis.segments.length} segments, ${analysis.segments.reduce((n: number, s: { attributes: unknown[] }) => n + s.attributes.length, 0)} attributes, ${analysis.transcript.length} lines, ${analysis.inputTokens}+${analysis.outputTokens} tokens, model ${analysis.model}`;
    });

    await check("Moment search finds the spoken topic with a timestamp", async () => {
      const { status, body } = await call("GET", `/api/search/moments?q=${encodeURIComponent("talking about fitness")}`);
      assert(status === 200, `HTTP ${status}`);
      const hit = body.data.moments.find((moment: { mediaId: string }) => moment.mediaId === mediaId);
      assert(hit, `no moment found (ignored: ${body.data.ignored.join(", ")})`);
      return `at ${hit.startMs} ms: ${hit.description.slice(0, 80)}`;
    });

    await check("Library search also matches AI metadata", async () => {
      const { body } = await call("GET", `/api/media?q=${encodeURIComponent("fitness")}&pageSize=100`);
      assert(body.data.items.some((item: { id: string }) => item.id === mediaId), "not found by library search");
    });

    await check("Admin can re-queue analysis (202)", async () => {
      const again = await call("POST", `/api/media/${mediaId}/analysis`);
      assert(again.status === 202, `HTTP ${again.status}`);
      await prisma.processingJob.updateMany({ where: { mediaId, jobType: "analyze", status: "queued" }, data: { status: "completed" } }); // do not spend a second analysis
      return "202 queued";
    });
  } finally {
    cookie = "";
    if (mediaId) {
      const media = await prisma.mediaFile.findUnique({ where: { id: mediaId } });
      for (const rel of [media?.originalPath, media?.proxyPath, media?.thumbnailPath]) {
        if (!rel) continue;
        const file = resolveStoragePath(rel);
        await rm(file, { force: true });
        await rm(path.join(path.dirname(file), `._${path.basename(file)}`), { force: true });
      }
      if (media) await prisma.mediaFile.delete({ where: { id: mediaId } }); // cascades to jobs and AI metadata
    }
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await rm(work, { recursive: true, force: true });
    await prisma.$disconnect();
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll AI checks passed");
  process.exitCode = failures ? 1 : 0;
}

void main();
