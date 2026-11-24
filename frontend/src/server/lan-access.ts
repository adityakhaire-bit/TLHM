import { hostname, networkInterfaces } from "node:os";
import { prisma } from "./db";
import { getEnv } from "./env";
import { isLanAddress, isOfficeNetworkRequest } from "./lan-detect";

/**
 * Office Wi-Fi guest access: people whose computer is on the same local network as the Mac mini
 * (192.168.x.x, 10.x.x.x, 172.16-31.x.x) can browse the library view-only without signing in.
 * Nothing needs to be added to Firebase for this; it never involves Google.
 *
 * Both of these must hold, so requests through Tailscale or other proxies never count as "office Wi-Fi":
 *  - the connecting address (last X-Forwarded-For entry, which Next.js fills from the socket) is a LAN address;
 *  - the address typed in the browser (Host) is a LAN IP or a Bonjour ".local" name.
 */
const SETTING_KEY = "lan_guest_access";

export { isLanAddress, isOfficeNetworkRequest };

let cache: { value: boolean; at: number } | null = null;

/** Whether office Wi-Fi guest access is switched on (admin setting; default from LAN_GUEST_ACCESS in .env). */
export async function lanGuestEnabled(): Promise<boolean> {
  if (cache && Date.now() - cache.at < 10_000) return cache.value;
  const row = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } }).catch(() => null);
  const value = row ? row.value === "true" : getEnv().LAN_GUEST_ACCESS === "true";
  cache = { value, at: Date.now() };
  return value;
}

export async function setLanGuestEnabled(enabled: boolean) {
  const value = String(enabled);
  await prisma.appSetting.upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, value }, update: { value } });
  cache = { value: enabled, at: Date.now() };
}

/** Addresses teammates can type to reach this Mac, e.g. http://192.168.1.144:3000 and http://mac-mini.local:3000. */
export function shareLinks(requestHost: string | null): { url: string; kind: "ip" | "name" }[] {
  const port = requestHost?.match(/:(\d+)$/)?.[1] ?? process.env.PORT ?? "3000";
  const suffix = port === "80" ? "" : `:${port}`;
  const links: { url: string; kind: "ip" | "name" }[] = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal && isLanAddress(address.address)) links.push({ url: `http://${address.address}${suffix}`, kind: "ip" });
    }
  }
  const name = hostname().replace(/\.local$/i, "").toLowerCase();
  if (/^[a-z0-9-]+$/.test(name)) links.push({ url: `http://${name}.local${suffix}`, kind: "name" });
  return [...new Map(links.map((link) => [link.url, link])).values()];
}
