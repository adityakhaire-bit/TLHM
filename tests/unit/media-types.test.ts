import { describe, expect, it } from "vitest";
import { detectFileType, sanitizeDisplayFilename, titleFromFilename } from "../../src/server/media-types";

const bytes = (...parts: (string | number[])[]) => {
  const out: number[] = [];
  for (const part of parts) out.push(...(typeof part === "string" ? [...part].map((c) => c.charCodeAt(0)) : part));
  while (out.length < 32) out.push(0);
  return new Uint8Array(out);
};

describe("file type detection from content", () => {
  it("detects video containers", () => {
    expect(detectFileType(bytes([0, 0, 0, 0x20], "ftypisom"))?.ext).toBe("mp4");
    expect(detectFileType(bytes([0, 0, 0, 0x14], "ftypqt  "))?.ext).toBe("mov");
    expect(detectFileType(bytes([0x1a, 0x45, 0xdf, 0xa3], "....webm"))?.ext).toBe("webm");
    expect(detectFileType(bytes([0x1a, 0x45, 0xdf, 0xa3], "matroska"))?.ext).toBe("mkv");
    expect(detectFileType(bytes("RIFF", [0, 0, 0, 0], "AVI LIST"))?.ext).toBe("avi");
  });

  it("detects audio and images", () => {
    expect(detectFileType(bytes("RIFF", [0, 0, 0, 0], "WAVEfmt "))?.kind).toBe("audio");
    expect(detectFileType(bytes("ID3", [4, 0]))?.ext).toBe("mp3");
    expect(detectFileType(bytes([0xff, 0xfb, 0x90, 0x64]))?.ext).toBe("mp3");
    expect(detectFileType(bytes([0xff, 0xd8, 0xff, 0xe0]))?.ext).toBe("jpg");
    expect(detectFileType(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]))?.ext).toBe("png");
  });

  it("rejects unsupported or disguised files regardless of their name", () => {
    expect(detectFileType(bytes("<!DOCTYPE html><html>"))).toBeNull();
    expect(detectFileType(bytes("#!/bin/bash\nrm -rf"))).toBeNull();
    expect(detectFileType(bytes([0x50, 0x4b, 0x03, 0x04]))).toBeNull(); // zip
    expect(detectFileType(new Uint8Array(4))).toBeNull();
  });

  it("keeps client filenames as metadata only", () => {
    expect(sanitizeDisplayFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeDisplayFilename("C:\\Users\\me\\Dance\u0000 Take 1.mov")).toBe("Dance Take 1.mov");
    expect(sanitizeDisplayFilename("")).toBe("untitled");
    expect(titleFromFilename("Life_fundas_ep3.mp4")).toBe("Life fundas ep3");
  });
});
