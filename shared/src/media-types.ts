/**
 * File type detection from the first bytes of the file ("magic numbers").
 * The client's filename and Content-Type are never trusted for deciding what a file is.
 * Pure functions with no Node/DB imports so they can be unit tested and used by the browser.
 */

export type MediaKind = "video" | "audio" | "image";

export type DetectedType = { ext: string; mime: string; kind: MediaKind };

const TYPES = {
  mp4: { ext: "mp4", mime: "video/mp4", kind: "video" },
  mov: { ext: "mov", mime: "video/quicktime", kind: "video" },
  m4v: { ext: "m4v", mime: "video/x-m4v", kind: "video" },
  m4a: { ext: "m4a", mime: "audio/mp4", kind: "audio" },
  mkv: { ext: "mkv", mime: "video/x-matroska", kind: "video" },
  webm: { ext: "webm", mime: "video/webm", kind: "video" },
  avi: { ext: "avi", mime: "video/x-msvideo", kind: "video" },
  mp3: { ext: "mp3", mime: "audio/mpeg", kind: "audio" },
  wav: { ext: "wav", mime: "audio/wav", kind: "audio" },
  jpg: { ext: "jpg", mime: "image/jpeg", kind: "image" },
  png: { ext: "png", mime: "image/png", kind: "image" },
} as const satisfies Record<string, DetectedType>;

/** Extensions accepted in the upload picker (checked again on the server by content). */
export const ACCEPTED_EXTENSIONS = ["mp4", "mov", "m4v", "mkv", "avi", "webm", "mp3", "wav", "m4a", "jpg", "jpeg", "png"];

/** Minimum number of leading bytes needed for detection. */
export const SNIFF_BYTES = 4096;

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

export function detectFileType(bytes: Uint8Array): DetectedType | null {
  if (bytes.length < 12) return null;

  // ISO base media (MP4 / MOV / M4A): "ftyp" box at offset 4.
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (brand === "qt  ") return TYPES.mov;
    if (brand === "M4A " || brand === "M4B ") return TYPES.m4a;
    if (brand === "M4V " || brand === "M4VH" || brand === "M4VP") return TYPES.m4v;
    return TYPES.mp4;
  }
  // Older QuickTime files can start with other atoms.
  if (["moov", "mdat", "wide", "free", "skip"].includes(ascii(bytes, 4, 4)) && bytes.length >= 16) return TYPES.mov;

  // Matroska / WebM: EBML header; the DocType says which.
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return ascii(bytes, 0, Math.min(bytes.length, SNIFF_BYTES)).includes("webm") ? TYPES.webm : TYPES.mkv;
  }

  // RIFF containers: AVI and WAV.
  if (ascii(bytes, 0, 4) === "RIFF") {
    const form = ascii(bytes, 8, 4);
    if (form === "AVI ") return TYPES.avi;
    if (form === "WAVE") return TYPES.wav;
    return null;
  }

  // Images.
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return TYPES.jpg;
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a) return TYPES.png;

  // MP3: ID3 tag or an MPEG audio frame sync.
  if (ascii(bytes, 0, 3) === "ID3") return TYPES.mp3;
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0) return TYPES.mp3;

  return null;
}

/** Cleans a client-supplied filename for display/metadata only (it is never used as a path). */
export function sanitizeDisplayFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").normalize("NFC").trim();
  return (cleaned || "untitled").slice(0, 255);
}

export function titleFromFilename(name: string): string {
  return sanitizeDisplayFilename(name).replace(/\.[^.]{1,8}$/, "").replace(/[_]+/g, " ").trim().slice(0, 255) || "Untitled";
}

export function extensionOf(name: string): string {
  const match = name.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return match ? match[1] : "";
}
