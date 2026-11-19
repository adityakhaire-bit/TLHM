import { describe, expect, it } from "vitest";
import { isAllowedEmail, usernameFromEmail } from "../../src/server/google-auth";

describe("Google sign-in domain rule", () => {
  const domains = ["example-studio.in"];

  it("accepts only the exact allowed domain", () => {
    expect(isAllowedEmail("anita@example-studio.in", domains)).toBe(true);
    expect(isAllowedEmail("ANITA@Example-Studio.IN", domains)).toBe(true);
  });

  it("rejects look-alike and other domains", () => {
    expect(isAllowedEmail("anita@gmail.com", domains)).toBe(false);
    expect(isAllowedEmail("anita@example-studio.in.evil.com", domains)).toBe(false);
    expect(isAllowedEmail("anita@sub.example-studio.in", domains)).toBe(false);
    expect(isAllowedEmail("anita@notexample-studio.in", domains)).toBe(false);
    expect(isAllowedEmail("example-studio.in", domains)).toBe(false);
    expect(isAllowedEmail("@example-studio.in", domains)).toBe(false);
  });

  it("allows nobody when no domain is configured", () => {
    expect(isAllowedEmail("anita@example-studio.in", [])).toBe(false);
  });

  it("makes safe usernames from emails", () => {
    expect(usernameFromEmail("Aditya.Khaire@example-studio.in")).toBe("aditya.khaire");
    expect(usernameFromEmail("a+media@example-studio.in")).toBe("a-media");
    expect(usernameFromEmail("..@example-studio.in")).toBe("user");
  });
});
