import { describe, expect, it } from "vitest";
import { contentDisposition, parseRange } from "../../src/server/range";

describe("HTTP range parsing (video seeking / resumable downloads)", () => {
  it("handles normal, open-ended and suffix ranges", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("returns null (full file) for missing or unsupported headers", () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange("bytes=0-1,5-9", 1000)).toBeNull();
    expect(parseRange("items=0-1", 1000)).toBeNull();
  });

  it("flags unsatisfiable ranges", () => {
    expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=50-10", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 1000)).toBe("unsatisfiable");
  });

  it("builds a download header that keeps the original (unicode) filename", () => {
    const header = contentDisposition('Terence "Live" – Mumbai.mov');
    expect(header).toContain('filename="Terence _Live_ _ Mumbai.mov"');
    expect(header).toContain("filename*=UTF-8''Terence%20%22Live%22%20%E2%80%93%20Mumbai.mov");
  });
});
