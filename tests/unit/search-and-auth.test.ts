import { describe, expect, it } from "vitest";
import { hashPassword, validatePasswordStrength, verifyPassword } from "../../src/server/passwords";
import { buildMediaWhere, extractDateRange, searchSchema } from "../../src/server/search";

describe("search", () => {
  it("understands month/year phrases", () => {
    const { rest, range } = extractDateRange("Terence interview June 2026");
    expect(rest).toBe("Terence interview");
    expect(range?.gte).toEqual(new Date(2026, 5, 1));
    expect(range?.lt).toEqual(new Date(2026, 6, 1));
  });

  it("does not treat ordinary words as months", () => {
    expect(extractDateRange("marathon workout").range).toBeUndefined();
    expect(extractDateRange("deck review").range).toBeUndefined();
  });

  it("requires every word to match some field and always hides removed media", () => {
    const where = buildMediaWhere(searchSchema.parse({ q: "life fundas", type: "video" }));
    const and = where.AND as object[];
    expect(and[0]).toEqual({ deletedAt: null });
    expect(and.filter((clause) => "OR" in clause)).toHaveLength(2);
    expect(and).toContainEqual({ mediaType: "video" });
  });
});

describe("passwords", () => {
  it("hashes with a random salt and verifies correctly", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", a)).toBe(true);
    expect(await verifyPassword("wrong password!!", a)).toBe(false);
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
  });

  it("enforces a minimum length", () => {
    expect(validatePasswordStrength("short")).not.toBeNull();
    expect(validatePasswordStrength("long enough pw")).toBeNull();
  });
});
