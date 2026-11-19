import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalSsdStorageAdapter, MARKER_FILE } from "../src/storage/local-ssd-adapter";

let root: string;
let adapter: LocalSsdStorageAdapter;

async function* chunks(...parts: string[]) {
  for (const part of parts) yield new TextEncoder().encode(part);
}
const readAll = async (stream: NodeJS.ReadableStream) => {
  let text = "";
  for await (const chunk of stream) text += chunk.toString();
  return text;
};

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "tmh-adapter-test-"));
  await writeFile(path.join(root, MARKER_FILE), "test");
  adapter = new LocalSsdStorageAdapter({ root, reserveBytes: 0 });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("availability", () => {
  it("reports a disconnected drive and never creates the root", async () => {
    const missing = new LocalSsdStorageAdapter({ root: "/Volumes/Not Connected Test Drive/TMH-Media" });
    const result = await missing.verifyStorageAvailability();
    expect(result).toMatchObject({ ok: false, reason: "not_mounted", driveName: "Not Connected Test Drive" });
    await expect(missing.receiveUpload(chunks("x"), { expectedBytes: 1, maxBytes: 10 })).rejects.toMatchObject({ status: 503 });
    await expect(stat("/Volumes/Not Connected Test Drive")).rejects.toThrow();
  });

  it("refuses a folder without the marker file", async () => {
    await rm(path.join(root, MARKER_FILE));
    expect(await adapter.verifyStorageAvailability()).toMatchObject({ ok: false, reason: "marker_missing" });
  });

  it("reports real capacity figures", async () => {
    const status = await adapter.getStorageStatus();
    expect(status.ok).toBe(true);
    expect(status.totalBytes).toBeGreaterThan(0);
    expect(status.freeBytes).toBeGreaterThan(0);
  });
});

describe("uploads and originals", () => {
  it("streams to temp, hashes, then stores the original under a generated key", async () => {
    const upload = await adapter.receiveUpload(chunks("hello ", "world"), { expectedBytes: 11, maxBytes: 100 });
    expect(upload.sizeBytes).toBe(11);
    expect(upload.sha256).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
    expect(new TextDecoder().decode(upload.head)).toBe("hello world");
    const stored = await adapter.saveOriginal(upload.uploadId, { mediaId: "abc123", kind: "video", extension: "mp4", createdAt: new Date(2026, 10, 19) });
    expect(stored.key).toBe("originals/videos/2026/11/abc123.mp4");
    expect(await readFile(path.join(root, stored.key), "utf8")).toBe("hello world");
  });

  it("rejects size mismatches and removes the partial file", async () => {
    await expect(adapter.receiveUpload(chunks("too much data"), { expectedBytes: 3, maxBytes: 100 })).rejects.toMatchObject({ status: 413 });
    await expect(adapter.receiveUpload(chunks("ab"), { expectedBytes: 5, maxBytes: 100 })).rejects.toMatchObject({ code: "upload_incomplete" });
    await expect(adapter.receiveUpload(chunks("x"), { expectedBytes: 500, maxBytes: 100 })).rejects.toMatchObject({ status: 413 });
    expect(await adapter.cleanupTemp(0)).toBe(0); // nothing left behind
  });

  it("never overwrites an existing original", async () => {
    const target = { mediaId: "same", kind: "audio" as const, extension: "wav", createdAt: new Date(2026, 0, 1) };
    const first = await adapter.receiveUpload(chunks("first"), { expectedBytes: 5, maxBytes: 100 });
    await adapter.saveOriginal(first.uploadId, target);
    const second = await adapter.receiveUpload(chunks("other"), { expectedBytes: 5, maxBytes: 100 });
    await expect(adapter.saveOriginal(second.uploadId, target)).rejects.toMatchObject({ status: 409 });
    expect(await readFile(path.join(root, "originals/audio/2026/01/same.wav"), "utf8")).toBe("first");
  });

  it("serves byte ranges for seeking", async () => {
    const upload = await adapter.receiveUpload(chunks("0123456789"), { expectedBytes: 10, maxBytes: 100 });
    const { key } = await adapter.saveOriginal(upload.uploadId, { mediaId: "r1", kind: "video", extension: "mov", createdAt: new Date() });
    const part = await adapter.getOriginal(key, { start: 2, end: 5 });
    expect(part.totalBytes).toBe(10);
    expect(await readAll(part.stream)).toBe("2345");
    await expect(adapter.getOriginal(key, { start: 20, end: 25 })).rejects.toMatchObject({ status: 416 });
  });
});

describe("generated files and deletion", () => {
  it("stores proxies/thumbnails from work files and only deletes originals when explicitly asked", async () => {
    const upload = await adapter.receiveUpload(chunks("original"), { expectedBytes: 8, maxBytes: 100 });
    const original = await adapter.saveOriginal(upload.uploadId, { mediaId: "m1", kind: "video", extension: "mp4", createdAt: new Date(2026, 10, 1) });

    const work = await adapter.createWorkFile("m1-proxy.mp4");
    await writeFile(work, "proxy");
    const proxy = await adapter.saveProxy(work, { mediaId: "m1", kind: "video", createdAt: new Date(2026, 10, 1) });
    expect(proxy.key).toBe("proxies/videos/2026/11/m1.mp4");
    const thumbWork = await adapter.createWorkFile("m1-thumb.jpg");
    await writeFile(thumbWork, "jpg");
    const thumb = await adapter.saveThumbnail(thumbWork, { mediaId: "m1", createdAt: new Date(2026, 10, 1) });

    await adapter.deleteMedia({ originalKey: original.key, proxyKey: proxy.key, thumbnailKey: thumb.key });
    await expect(stat(path.join(root, proxy.key))).rejects.toThrow();
    expect((await stat(path.join(root, original.key))).isFile()).toBe(true); // original kept

    await adapter.deleteMedia({ originalKey: original.key }, { includeOriginal: true });
    await expect(stat(path.join(root, original.key))).rejects.toThrow();
  });

  it("will not accept arbitrary files as generated output", async () => {
    const outside = path.join(root, "outside.mp4");
    await writeFile(outside, "x");
    await expect(adapter.saveProxy(outside, { mediaId: "m2", kind: "video", createdAt: new Date() })).rejects.toMatchObject({ code: "invalid_work_file" });
  });

  it("blocks directory traversal and wrong-kind keys", async () => {
    for (const key of ["../../etc/passwd", "/etc/passwd", "originals/../../x", ".tmh-storage", "a\\b"]) {
      expect(() => adapter.resolveKey(key)).toThrow();
    }
    await expect(adapter.getProxy("originals/videos/2026/11/x.mp4")).rejects.toMatchObject({ code: "invalid_key" });
    await expect(adapter.getThumbnail("../secret.jpg")).rejects.toMatchObject({ code: "invalid_key" });
  });
});
