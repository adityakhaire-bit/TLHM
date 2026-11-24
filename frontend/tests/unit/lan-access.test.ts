import { describe, expect, it } from "vitest";
import { isLanAddress, isOfficeNetworkRequest } from "@/server/lan-access";

describe("office network detection", () => {
  it("accepts private LAN addresses only", () => {
    for (const ip of ["192.168.1.90", "::ffff:192.168.1.90", "10.0.0.5", "172.20.1.1", "fe80::e642:862e:f281:65ed%37"]) expect(isLanAddress(ip)).toBe(true);
    for (const ip of ["127.0.0.1", "::1", "100.101.102.103", "8.8.8.8", "172.32.0.1", "2401:4900:1c94::1", "", null]) expect(isLanAddress(ip)).toBe(false);
  });

  const req = (h: Record<string, string>) => new Headers(h);
  it("needs a LAN peer AND a LAN host", () => {
    expect(isOfficeNetworkRequest(req({ host: "192.168.1.144:3000", "x-forwarded-for": "192.168.1.90" }))).toBe(true);
    expect(isOfficeNetworkRequest(req({ host: "mac-mini.local:3000", "x-forwarded-for": "::ffff:192.168.1.90" }))).toBe(true);
    // Through Tailscale / a local proxy: never counts as the office Wi-Fi, even with a forged header.
    expect(isOfficeNetworkRequest(req({ host: "localhost:3000", "x-forwarded-for": "127.0.0.1" }))).toBe(false);
    expect(isOfficeNetworkRequest(req({ host: "box.tail1234.ts.net", "x-forwarded-for": "192.168.1.90" }))).toBe(false);
    expect(isOfficeNetworkRequest(req({ host: "192.168.1.144:3000", "x-forwarded-for": "192.168.1.90, 100.64.0.7" }))).toBe(false);
    expect(isOfficeNetworkRequest(req({ host: "192.168.1.144:3000", "x-forwarded-for": "192.168.1.90", "tailscale-user-login": "x" }))).toBe(false);
  });
});
