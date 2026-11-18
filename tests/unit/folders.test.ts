import { describe, expect, it } from "vitest";
import { createFolderSchema, slugifyFolderName, updateFolderSchema } from "../../src/lib/folders/validation";

describe("folder validation", () => {
  it("creates a normalized slug from a folder name", () => {
    expect(slugifyFolderName("  Café & Dance  ")).toBe("cafe-dance");
  });

  it("uses a safe fallback when a name has no ASCII slug characters", () => {
    expect(slugifyFolderName("🎬")).toBe("folder");
  });

  it("accepts a valid folder with presentation and permission settings", () => {
    const parsed = createFolderSchema.safeParse({ name: "Dance", color: "#aabbcc", is_private: true, require_approval: true });
    expect(parsed.success).toBe(true);
  });

  it("rejects blank names, invalid colors, and out-of-range ordering", () => {
    expect(createFolderSchema.safeParse({ name: "  " }).success).toBe(false);
    expect(createFolderSchema.safeParse({ name: "Dance", color: "red" }).success).toBe(false);
    expect(createFolderSchema.safeParse({ name: "Dance", sort_order: -1 }).success).toBe(false);
  });

  it("requires at least one field for an update", () => {
    expect(updateFolderSchema.safeParse({}).success).toBe(false);
    expect(updateFolderSchema.safeParse({ description: "New description" }).success).toBe(true);
  });
});
