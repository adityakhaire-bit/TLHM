import { describe, expect, it } from "vitest";
import { classifyMediaType, initiateUploadSchema } from "../../src/lib/uploads/validation";

describe("upload validation", () => {
  const base = { title: "Dance rehearsal", filename: "rehearsal.mp4", mimeType: "video/mp4", sizeBytes: 1024 };

  it("accepts supported media and archives", () => {
    expect(initiateUploadSchema.safeParse(base).success).toBe(true);
    expect(initiateUploadSchema.safeParse({ ...base, filename: "project.aep", mimeType: "application/octet-stream" }).success).toBe(true);
    expect(classifyMediaType("video/mp4")).toBe("video");
    expect(classifyMediaType("application/zip")).toBe("archive");
  });

  it("rejects path-like filenames, unknown types, and zero-byte uploads", () => {
    expect(initiateUploadSchema.safeParse({ ...base, filename: "../asset.mp4" }).success).toBe(false);
    expect(initiateUploadSchema.safeParse({ ...base, mimeType: "text/html" }).success).toBe(false);
    expect(initiateUploadSchema.safeParse({ ...base, sizeBytes: 0 }).success).toBe(false);
  });
});
