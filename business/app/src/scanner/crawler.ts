import { extractLinks, extractSitemapLocs, looksLikeHtmlPage, normalizeUrl } from "../lib/urls.js";
import { assertPublicHost, SsrfError } from "../lib/ssrf.js";

export interface CrawlOptions {
  startUrl: string;
  origin: string;
  maxPages: number;
  fetchImpl?: typeof fetch;
  /** total time budget for URL discovery */
  timeBudgetMs?: number;
  userAgent?: string;
  /** local-demo/test escape hatch; forced off in production config */
  allowPrivateTargets?: boolean;
}

export interface CrawlResult {
  urls: string[];
  /** true if we hit the page cap (site larger than plan allows) */
  capped: boolean;
  notes: string[];
}

export const CRAWLER_USER_AGENT =
  "Mozilla/5.0 (compatible; SiteRampBot/1.0; +https://siteramp.example/bot)";

/**
 * Discover same-origin pages: seed from sitemap.xml when available, then BFS
 * over <a href> links found in fetched HTML. Pure fetch-based (no browser) so
 * it is fast and cheap; the browser only visits the final page list.
 */
export async function discoverPages(opts: CrawlOptions): Promise<CrawlResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const deadline = Date.now() + (opts.timeBudgetMs ?? 60_000);
  const notes: string[] = [];

  const startNormalized = normalizeUrl(opts.startUrl, opts.origin);
  if (!startNormalized) throw new Error("Invalid start URL");

  // SSRF re-check at crawl time (DNS may have changed since registration).
  await assertPublicHost(new URL(opts.origin).hostname, opts.allowPrivateTargets ?? false);

  const found = new Set<string>([startNormalized]);
  const queue: string[] = [startNormalized];
  let capped = false;

  const allowPrivate = opts.allowPrivateTargets ?? false;

  // Seed from sitemap.xml (best effort).
  try {
    const sitemapUrl = `${opts.origin}/sitemap.xml`;
    const res = await fetchWithLimits(fetchImpl, sitemapUrl, deadline, opts.userAgent, allowPrivate);
    if (res && res.ok) {
      const xml = await res.text();
      const locs = extractSitemapLocs(xml, opts.origin);
      // Sitemap indexes point at child sitemaps; follow one level.
      const childSitemaps = locs.filter((u) => /\.xml$/i.test(new URL(u).pathname));
      const pageLocs = locs.filter((u) => !childSitemaps.includes(u) && looksLikeHtmlPage(u));
      for (const child of childSitemaps.slice(0, 5)) {
        const childRes = await fetchWithLimits(fetchImpl, child, deadline, opts.userAgent, allowPrivate);
        if (childRes && childRes.ok) {
          for (const loc of extractSitemapLocs(await childRes.text(), opts.origin)) {
            if (looksLikeHtmlPage(loc)) pageLocs.push(loc);
          }
        }
      }
      for (const loc of pageLocs) {
        if (found.size >= opts.maxPages) {
          capped = true;
          break;
        }
        if (!found.has(loc)) {
          found.add(loc);
          queue.push(loc);
        }
      }
      if (pageLocs.length > 0) notes.push(`Found ${pageLocs.length} URL(s) in sitemap.xml.`);
    }
  } catch {
    notes.push("sitemap.xml could not be read; discovered pages by following links instead.");
  }

  // BFS over links. We fetch HTML with plain fetch (fast); JS-rendered links
  // will still be found later if they appear in fetched HTML of other pages.
  const visitedForLinks = new Set<string>();
  while (queue.length > 0 && Date.now() < deadline) {
    if (found.size >= opts.maxPages && queue.every((u) => visitedForLinks.has(u))) break;
    const url = queue.shift()!;
    if (visitedForLinks.has(url)) continue;
    visitedForLinks.add(url);

    let res: Response | null = null;
    try {
      res = await fetchWithLimits(fetchImpl, url, deadline, opts.userAgent, allowPrivate);
    } catch {
      continue; // discovery failures are non-fatal; the page may still get scanned
    }
    if (!res || !res.ok) continue;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("text/html")) continue;
    let html: string;
    try {
      html = await res.text();
    } catch {
      continue;
    }
    for (const link of extractLinks(html, url, opts.origin)) {
      if (found.size >= opts.maxPages) {
        capped = true;
        break;
      }
      if (!found.has(link) && looksLikeHtmlPage(link)) {
        found.add(link);
        queue.push(link);
      }
    }
  }

  if (found.size >= opts.maxPages) capped = true;
  return { urls: [...found].slice(0, opts.maxPages), capped, notes };
}

/**
 * fetch with: redirect following capped by fetch defaults, per-request timeout,
 * response size cap (2 MB), and SSRF re-validation of redirect targets by
 * checking the final response URL's host.
 */
async function fetchWithLimits(
  fetchImpl: typeof fetch,
  url: string,
  deadlineMs: number,
  userAgent = CRAWLER_USER_AGENT,
  allowPrivate = false,
): Promise<Response | null> {
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(remaining, 15_000));
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": userAgent, accept: "text/html,application/xhtml+xml,application/xml" },
    });
    const finalUrl = res.url || url;
    const finalHost = new URL(finalUrl).hostname;
    const originalHost = new URL(url).hostname;
    if (finalHost !== originalHost) {
      // Redirected off-host: re-validate the new host before trusting the body.
      try {
        await assertPublicHost(finalHost, allowPrivate);
      } catch (err) {
        if (err instanceof SsrfError) return null;
        throw err;
      }
    }
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > 2_000_000) return null;
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch robots.txt (best effort). Returns null when unavailable. */
export async function fetchRobotsTxt(
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetchImpl(`${origin}/robots.txt`, {
      signal: controller.signal,
      headers: { "user-agent": CRAWLER_USER_AGENT },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("text")) return null;
    return await res.text();
  } catch {
    return null;
  }
}
