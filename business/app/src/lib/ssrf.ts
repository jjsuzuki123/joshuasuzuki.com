import dns from "node:dns/promises";
import net from "node:net";

/**
 * SSRF guard: scan targets must resolve to publicly routable addresses.
 * Blocks loopback, RFC1918, link-local, CGNAT, cloud-metadata, multicast,
 * reserved and IPv6 local ranges — including IPv4-mapped IPv6 forms.
 */

export function isPrivateIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateIpv4(ip);
  if (kind === 6) return isPrivateIpv6(ip);
  return true; // not an IP literal — treat as unsafe until resolved
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24 doc
  if (a === 192 && b === 88) return true; // 6to4 relay 192.88.99/24
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51) return true; // 198.51.100/24 doc
  if (a === 203 && b === 0) return true; // 203.0.113/24 doc
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // IPv4-mapped/compat (::ffff:1.2.3.4 and similar) — delegate to IPv4 logic.
  const v4match = lower.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4match) return isPrivateIpv4(v4match[1]!);
  if (lower === "::" || lower === "::1") return true; // unspecified / loopback
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
    return true; // link-local fe80::/10
  }
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local fc00::/7
  if (lower.startsWith("ff")) return true; // multicast
  if (lower.startsWith("2001:db8")) return true; // documentation
  if (lower.startsWith("64:ff9b")) return true; // NAT64 — could map to private v4
  return false;
}

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

/**
 * Resolve a hostname and throw SsrfError if ANY resolved address is
 * non-public. Empty resolution also throws.
 * `allowPrivate` skips the check entirely — local demos/tests only; the
 * config layer forces it off in production.
 */
export async function assertPublicHost(hostname: string, allowPrivate = false): Promise<void> {
  if (allowPrivate) return;
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new SsrfError("This address points to a private or internal network and cannot be scanned.");
    }
    return;
  }
  let addrs: { address: string }[] = [];
  try {
    addrs = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SsrfError(
      "We couldn't find this domain (DNS lookup failed). Check the spelling, or try again in a minute.",
    );
  }
  if (addrs.length === 0) {
    throw new SsrfError("This domain has no reachable address (no DNS records found).");
  }
  for (const { address } of addrs) {
    if (isPrivateIp(address)) {
      throw new SsrfError("This domain resolves to a private or internal network and cannot be scanned.");
    }
  }
}
