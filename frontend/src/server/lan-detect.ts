/** Pure office-network checks (no Node or database imports, so middleware can use them too). See lan-access.ts. */

/** IPv4 private ranges, IPv4-mapped IPv6, IPv6 link-local and unique-local. Loopback and Tailscale (100.64/10) excluded. */
export function isLanAddress(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let ip = raw.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  }
  return /^fe[89ab][0-9a-f]:/.test(ip) || /^f[cd][0-9a-f]{2}:/.test(ip);
}

function hostOnly(host: string | null): string {
  if (!host) return "";
  const value = host.trim().toLowerCase();
  if (value.startsWith("[")) return value.slice(1, value.indexOf("]"));
  return value.replace(/:\d+$/, "");
}

/** True when the request comes straight from a computer on the office network. */
export function isOfficeNetworkRequest(headers: Headers): boolean {
  if ([...headers.keys()].some((name) => name.startsWith("tailscale-"))) return false;
  const forwarded = headers.get("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean) ?? [];
  const peer = forwarded.at(-1);
  const host = hostOnly(headers.get("host"));
  return isLanAddress(peer) && (isLanAddress(host) || host.endsWith(".local"));
}
