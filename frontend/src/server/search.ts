import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { ApiError } from "./http";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export const searchSchema = z.object({
  q: z.string().trim().max(200).optional(),
  type: z.enum(["video", "audio", "image"]).optional(),
  status: z.enum(["processing", "completed", "failed", "pending"]).optional(),
  recent: z.enum(["1", "true"]).optional(),
  folder: z.coerce.number().int().positive().optional(),
  category: z.string().trim().max(100).optional(),
  tag: z.string().trim().max(64).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  minDuration: z.coerce.number().nonnegative().optional(),
  maxDuration: z.coerce.number().nonnegative().optional(),
  sort: z.enum(["newest", "oldest", "name", "size", "duration"]).default("newest"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});

export type SearchParams = z.infer<typeof searchSchema>;

export function parseSearchParams(url: URL): SearchParams {
  const raw = Object.fromEntries([...url.searchParams.entries()].filter(([, value]) => value !== ""));
  const parsed = searchSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, "Invalid search filters", "invalid_query", z.flattenError(parsed.error).fieldErrors);
  return parsed.data;
}

/**
 * Pulls a date phrase out of free text: "June 2026", "jun 2026", "june" (current year) or a bare year "2026".
 * Returns the remaining words and an optional [from, to) date range.
 */
export function extractDateRange(text: string, now = new Date()): { rest: string; range?: { gte: Date; lt: Date } } {
  const monthYear = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b(?:\s+(\d{4}))?/i);
  if (monthYear) {
    const month = MONTHS.findIndex((name) => name.startsWith(monthYear[1].toLowerCase().slice(0, 3)));
    const year = monthYear[2] ? Number(monthYear[2]) : now.getFullYear();
    return {
      rest: text.replace(monthYear[0], " ").replace(/\s+/g, " ").trim(),
      range: { gte: new Date(year, month, 1), lt: new Date(year, month + 1, 1) },
    };
  }
  const year = text.match(/\b(20\d{2}|19\d{2})\b/);
  if (year) {
    const y = Number(year[1]);
    return { rest: text.replace(year[0], " ").replace(/\s+/g, " ").trim(), range: { gte: new Date(y, 0, 1), lt: new Date(y + 1, 0, 1) } };
  }
  return { rest: text.trim() };
}

/** Builds the Prisma filter for the media library. Every word must match at least one searchable field. */
export function buildMediaWhere(params: SearchParams): Prisma.MediaFileWhereInput {
  const and: Prisma.MediaFileWhereInput[] = [{ deletedAt: null }];

  if (params.q) {
    const { rest, range } = extractDateRange(params.q);
    // A date-only query ("June 2026") filters by date; a query that is also a word is kept as text too.
    if (range) and.push({ createdAt: range });
    const words = rest.split(/\s+/).filter((word) => word.length > 0).slice(0, 8);
    for (const word of words) {
      and.push({
        OR: [
          { title: { contains: word } },
          { originalFilename: { contains: word } },
          { category: { contains: word } },
          { description: { contains: word } },
          { folder: { name: { contains: word } } },
          { tags: { some: { tag: { name: { contains: word } } } } },
        ],
      });
    }
  }
  if (params.type) and.push({ mediaType: params.type });
  if (params.status === "completed") and.push({ processingStatus: "ready" });
  if (params.status === "failed") and.push({ processingStatus: "failed" });
  if (params.status === "processing") and.push({ processingStatus: { in: ["pending", "processing"] } });
  if (params.status === "pending") and.push({ processingStatus: "pending" });
  if (params.recent) and.push({ createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } });
  if (params.folder) and.push({ folderId: params.folder });
  if (params.category) and.push({ category: params.category });
  if (params.tag) and.push({ tags: { some: { tag: { name: params.tag.toLowerCase() } } } });
  if (params.from) and.push({ createdAt: { gte: new Date(`${params.from}T00:00:00`) } });
  if (params.to) and.push({ createdAt: { lt: new Date(new Date(`${params.to}T00:00:00`).getTime() + 24 * 3600 * 1000) } });
  if (params.minDuration !== undefined) and.push({ duration: { gte: params.minDuration } });
  if (params.maxDuration !== undefined) and.push({ duration: { lte: params.maxDuration } });

  return { AND: and };
}

export function buildMediaOrder(sort: SearchParams["sort"]): Prisma.MediaFileOrderByWithRelationInput[] {
  switch (sort) {
    case "oldest": return [{ createdAt: "asc" }];
    case "name": return [{ title: "asc" }, { createdAt: "desc" }];
    case "size": return [{ fileSize: "desc" }];
    case "duration": return [{ duration: "desc" }];
    default: return [{ createdAt: "desc" }];
  }
}
