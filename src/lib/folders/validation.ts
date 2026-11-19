import { z } from "zod";

export const MAX_FOLDER_DEPTH = 8;

export const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.number().int().positive().nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
});

export const updateFolderSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  parentId: z.number().int().positive().nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

/** Folder names are display names; they never become filesystem paths. */
export function cleanFolderName(value: string) {
  return value.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
}

/** Walks up from `startId` and returns the chain of ancestor ids (nearest first). */
export function ancestorChain(startId: number | null, parentOf: Map<number, number | null>): number[] {
  const chain: number[] = [];
  let current = startId;
  while (current !== null && current !== undefined && chain.length <= MAX_FOLDER_DEPTH + 1) {
    chain.push(current);
    current = parentOf.get(current) ?? null;
  }
  return chain;
}
