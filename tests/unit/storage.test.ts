import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkStorage, driveName, MARKER_FILE, moveNoOverwrite, resolveStoragePath } from "../../src/server/storage";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "tmh-storage-test-"));
  process.env.DATABASE_URL ??= "mysql://test:test@127.0.0.1:3306/test";
  process.env.MEDIA_STORAGE_ROOT = root;
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("storage safety", () => {
  it("reports a disconnected drive instead of writing to the internal disk", async () => {
    const result = await checkStorage("/Volumes/Definitely Not Connected/TMH-Media");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_mounted");
      expect(result.message).toContain("Definitely Not Connected");
    }
  });

  it("refuses a folder without the marker file, then accepts it once the marker exists", async () => {
    const before = await checkStorage(root);
    expect(before.ok).toBe(false);
    if (!before.ok) expect(before.reason).toBe("marker_missing");
    await writeFile(path.join(root, MARKER_FILE), "test");
    expect((await checkStorage(root)).ok).toBe(true);
  });

  it("blocks directory traversal and absolute paths", () => {
    expect(resolveStoragePath("originals/videos/2026/11/abc.mp4", root)).toBe(path.join(root, "originals/videos/2026/11/abc.mp4"));
    expect(() => resolveStoragePath("../../etc/passwd", root)).toThrow();
    expect(() => resolveStoragePath("/etc/passwd", root)).toThrow();
    expect(() => resolveStoragePath("originals/../../secret", root)).toThrow();
    expect(() => resolveStoragePath(".tmh-storage", root)).toThrow();
    expect(() => resolveStoragePath("originals/a\0b", root)).toThrow();
  });

  it("never overwrites an existing file when moving", async () => {
    const a = path.join(root, "a.bin");
    const b = path.join(root, "b.bin");
    await writeFile(a, "new");
    await writeFile(b, "original");
    await expect(moveNoOverwrite(a, b)).rejects.toThrow(/refusing to overwrite/);
  });

  it("names the drive from the mount path", () => {
    expect(driveName("/Volumes/Extreme SSD/TMH-Media")).toBe("Extreme SSD");
    expect(driveName("/Users/Shared/tmh")).toBe("Internal disk");
  });
});
