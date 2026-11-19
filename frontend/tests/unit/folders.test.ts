import { describe, expect, it } from "vitest";
import { ancestorChain, cleanFolderName, createFolderSchema, updateFolderSchema } from "../../src/lib/folders/validation";

describe("folder validation", () => {
  it("cleans folder names without turning them into paths", () => {
    expect(cleanFolderName("  Dance\u0007   Rehearsals ")).toBe("Dance Rehearsals");
    expect(cleanFolderName("../etc")).toBe("../etc"); // display name only; never used on disk
  });

  it("accepts valid folders and rejects blank names", () => {
    expect(createFolderSchema.safeParse({ name: "Dance", parentId: 3 }).success).toBe(true);
    expect(createFolderSchema.safeParse({ name: "  " }).success).toBe(false);
    expect(createFolderSchema.safeParse({ name: "x".repeat(121) }).success).toBe(false);
  });

  it("requires at least one field for an update", () => {
    expect(updateFolderSchema.safeParse({}).success).toBe(false);
    expect(updateFolderSchema.safeParse({ description: "New description" }).success).toBe(true);
  });

  it("walks the ancestor chain for depth and cycle checks", () => {
    const parentOf = new Map<number, number | null>([[1, null], [2, 1], [3, 2]]);
    expect(ancestorChain(3, parentOf)).toEqual([3, 2, 1]);
    expect(ancestorChain(null, parentOf)).toEqual([]);
  });
});
