/**
 * URL handling for the crawler and site registration.
 * Everything here is pure and unit-tested.
 */

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "ref",
]);

export interface ParsedTarget {
  /** e.g. https://example.com (no trailing slash, default port stripped) */
  origin: string;
  /** normalized start URL within the origin */
  startUrl: string;
}

/**
 * Parse and validate a user-supplied website URL.
 * Returns a friendly error string instead of throwing on bad input.
 */
export function parseTargetUrl(raw: string): { ok: true; value: ParsedTarget } | { ok: false; error: string } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, error: "Please enter a website address." };
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, error: "That doesn't look like a valid website address. Example: https://example.com" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Only http:// and https:// websites can be scanned." };
  }
  const host = url.hostname;
  const isIpLiteral = /^[\d.]+$/.test(host) || host.startsWith("[");
  if (!isIpLiteral) {
    const labels = host.split(".");
    const labelRe = /^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?$/i;
    if (labels.length < 2 || labels.some((l) => l.length === 0 || !labelRe.test(l))) {
      return { ok: false, error: "Please enter a full domain name, like example.com." };
    }
  }
  if (url.username || url.password) {
    return { ok: false, error: "Website addresses with embedded credentials are not supported." };
  }
  const normalized = normalizeUrl(url.href, url.origin);
  if (!normalized) return { ok: false, error: "That address could not be processed. Try the site's homepage URL." };
  return { ok: true, value: { origin: normalizeOrigin(url), startUrl: normalized } };
}

function normalizeOrigin(url: URL): string {
  // URL.origin already strips default ports (:443/:80) and lowercases the host.
  return url.origin;
}

/**
 * Normalize a URL for crawl de-duplication:
 * - resolve against base, force same document without fragment
 * - lowercase host, strip default port
 * - strip tracking params, sort remaining params
 * - collapse trailing slash (except root)
 * Returns null for unusable/foreign-scheme URLs.
 */
export function normalizeUrl(href: string, baseOrigin: string): string | null {
  let url: URL;
  try {
    url = new URL(href, baseOrigin + "/");
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  url.username = "";
  url.password = "";

  const params = [...url.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()));
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = "";
  for (const [k, v] of params) url.searchParams.append(k, v);

  let pathname = url.pathname.replace(/\/{2,}/g, "/");
  if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
  url.pathname = pathname;

  return url.href;
}

/** True if `href` (resolved against the origin) stays on the same origin. */
export function isSameOrigin(href: string, baseOrigin: string): boolean {
  try {
    return new URL(href, baseOrigin + "/").origin === new URL(baseOrigin).origin;
  } catch {
    return false;
  }
}

/** File extensions the crawler should never enqueue as pages. */
const SKIP_EXTENSIONS =
  /\.(pdf|zip|gz|tar|rar|7z|dmg|exe|msi|png|jpe?g|gif|webp|avif|svg|ico|mp3|mp4|mov|avi|webm|wav|ogg|css|js|mjs|json|xml|rss|atom|txt|csv|docx?|xlsx?|pptx?|woff2?|ttf|eot)$/i;

export function looksLikeHtmlPage(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return !SKIP_EXTENSIONS.test(pathname);
  } catch {
    return false;
  }
}

/** Extract candidate links from raw HTML without a DOM (crawler fast path). */
export function extractLinks(html: string, pageUrl: string, baseOrigin: string): string[] {
  const out = new Set<string>();
  const re = /<a\b[^>]*?\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = (m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (!raw || raw.startsWith("#")) continue;
    if (/^(mailto:|tel:|javascript:|data:)/i.test(raw)) continue;
    let resolved: string | null;
    try {
      resolved = normalizeUrl(new URL(raw, pageUrl).href, baseOrigin);
    } catch {
      resolved = null;
    }
    if (!resolved) continue;
    if (!isSameOrigin(resolved, baseOrigin)) continue;
    if (!looksLikeHtmlPage(resolved)) continue;
    out.add(resolved);
  }
  return [...out];
}

/**
 * Extract <loc> URLs from a sitemap XML document (same-origin only). Includes
 * child-sitemap .xml URLs — the crawler decides whether to follow or scan them.
 */
export function extractSitemapLocs(xml: string, baseOrigin: string): string[] {
  const out = new Set<string>();
  const re = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const normalized = normalizeUrl(m[1]!, baseOrigin);
    if (normalized && isSameOrigin(normalized, baseOrigin)) {
      out.add(normalized);
    }
  }
  return [...out];
}

/**
 * Minimal robots.txt evaluation for our user agent: returns true if the root
 * path is broadly disallowed for `*` or `SiteRampBot`. We deliberately keep
 * this conservative and simple — used to prompt for explicit owner override,
 * not to enforce per-path rules.
 */
export function robotsDisallowsAll(robotsTxt: string, agent = "siterampbot"): boolean {
  const lines = robotsTxt.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());
  let applies = false;
  let sawAgentLine = false;
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    if (!rawKey || rest.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      const ua = value.toLowerCase();
      applies = ua === "*" || ua === agent;
      sawAgentLine = true;
    } else if (key === "disallow" && applies) {
      if (value === "/") return true;
    } else if (key === "allow" && applies && value === "/") {
      return false;
    } else if (line === "" && sawAgentLine) {
      applies = false;
    }
  }
  return false;
}
