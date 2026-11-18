import { z } from "zod";

export const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parent_id: z.string().uuid().nullable().optional(),
  collection_id: z.string().uuid().nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  icon: z.string().trim().max(64).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  sort_order: z.number().int().min(0).max(100000).optional(),
  is_private: z.boolean().optional(),
  require_approval: z.boolean().optional(),
});

export const updateFolderSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  parent_id: z.string().uuid().nullable().optional(),
  collection_id: z.string().uuid().nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  icon: z.string().trim().max(64).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  sort_order: z.number().int().min(0).max(100000).optional(),
  is_private: z.boolean().optional(),
  require_approval: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

export function slugifyFolderName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "folder";
}
