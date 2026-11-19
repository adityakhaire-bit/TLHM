/** HTTP Range header parsing (single range only), shared by preview streaming and downloads. */
export type ByteRange = { start: number; end: number };

/**
 * Returns the requested byte range, `null` when no/unsupported Range header (send whole file),
 * or "unsatisfiable" when the range is outside the file (respond 416).
 */
export function parseRange(header: string | null, size: number): ByteRange | null | "unsatisfiable" {
  if (!header) return null;
  const match = header.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null; // multi-range or malformed: ignore and send the full file
  const [, startText, endText] = match;
  if (startText === "" && endText === "") return null;
  if (size === 0) return "unsatisfiable";

  let start: number;
  let end: number;
  if (startText === "") {
    const suffix = Number(endText);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText === "" ? size - 1 : Math.min(Number(endText), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return "unsatisfiable";
  return { start, end };
}

/** RFC 6266 / 5987 Content-Disposition with an ASCII fallback and the UTF-8 original name. */
export function contentDisposition(filename: string, type: "attachment" | "inline" = "attachment") {
  const fallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
