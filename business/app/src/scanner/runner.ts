import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "playwright";
import { getBrowser, closeBrowser } from "./browser.js";
import { discoverPages, CRAWLER_USER_AGENT } from "./crawler.js";
import { SsrfError } from "../lib/ssrf.js";
import { pageScore, siteScore, grade, issueFingerprint, diffIssues, type Impact } from "../domain/scoring.js";
import type { Repo } from "../domain/repo.js";

export interface ScanJobContext {
  repo: Repo;
  scanId: number;
  siteId: number;
  origin: string;
  startUrl: string;
  maxPages: number;
  pageTimeoutMs: number;
  totalTimeoutMs: number;
  concurrency: number;
  allowPrivateTargets?: boolean;
  log: (msg: string) => void;
}

interface PageViolation {
  ruleId: string;
  impact: Impact;
  selector: string;
  snippet: string;
  helpUrl: string;
  wcagTags: string[];
  description: string;
}

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

/**
 * Execute one site scan end to end: discover pages, render + axe-check each,
 * persist pages/issues, compute score and diff vs the previous completed scan.
 * Never throws for per-page problems; only infrastructure-level failures mark
 * the scan failed.
 */
export async function runScan(ctx: ScanJobContext): Promise<void> {
  const { repo, scanId } = ctx;
  const startedAt = Date.now();
  repo.markScanRunning(scanId);

  let urls: string[] = [];
  try {
    const discovery = await discoverPages({
      startUrl: ctx.startUrl,
      origin: ctx.origin,
      maxPages: ctx.maxPages,
      timeBudgetMs: Math.min(90_000, ctx.totalTimeoutMs / 3),
      allowPrivateTargets: ctx.allowPrivateTargets,
    });
    urls = discovery.urls;
    ctx.log(`scan#${scanId}: discovered ${urls.length} page(s)${discovery.capped ? " (capped by plan)" : ""}`);
  } catch (err) {
    const message =
      err instanceof SsrfError
        ? err.message
        : "We couldn't reach this website to discover its pages. Check that the address is correct and publicly reachable, then try again.";
    repo.markScanFailed(scanId, message);
    return;
  }

  if (urls.length === 0) {
    repo.markScanFailed(
      scanId,
      "No scannable pages were found at this address. If the site requires a login or blocks automated visitors, we can't scan it yet.",
    );
    return;
  }

  const counts: Record<Impact, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const pageScores: number[] = [];
  const fingerprints: string[] = [];
  let pagesOk = 0;
  let pagesFailed = 0;

  let browser;
  try {
    browser = await getBrowser();
  } catch {
    repo.markScanFailed(
      scanId,
      "The scanning engine could not start. This is on our side, not yours — please try again shortly.",
    );
    return;
  }

  const context = await browser.newContext({
    userAgent: CRAWLER_USER_AGENT,
    viewport: { width: 1366, height: 900 },
    ignoreHTTPSErrors: false,
  });
  // Block heavyweight resources; keep CSS/JS/images since axe checks rendered output
  // (images matter for alt-text context; media/fonts don't).
  await context.route("**/*", (route) => {
    const type = route.request().resourceType();
    if (type === "media" || type === "font") return route.abort();
    return route.continue();
  });

  const deadline = startedAt + ctx.totalTimeoutMs;
  const queue = [...urls];
  const workers: Promise<void>[] = [];
  const workerCount = Math.min(ctx.concurrency, queue.length);

  const processOne = async (url: string): Promise<void> => {
    if (Date.now() > deadline) {
      pagesFailed++;
      ctx.repo.insertScanPage(scanId, {
        url,
        status: "failed",
        failReason: "Skipped: the scan reached its time limit before this page.",
      });
      return;
    }
    const page = await context.newPage();
    try {
      const result = await scanSinglePage(page, url, ctx.pageTimeoutMs);
      if (!result.ok) {
        pagesFailed++;
        ctx.repo.insertScanPage(scanId, { url, status: "failed", failReason: result.reason });
        return;
      }
      const violations = result.violations;
      const score = pageScore(violations.map((v) => ({ impact: v.impact, ruleId: v.ruleId })));
      const pageCounts: Record<Impact, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
      for (const v of violations) pageCounts[v.impact]++;
      const pageId = ctx.repo.insertScanPage(scanId, { url, status: "ok", score, counts: pageCounts });
      for (const v of violations) {
        const fp = issueFingerprint(v.ruleId, url, v.selector);
        fingerprints.push(fp);
        counts[v.impact]++;
        ctx.repo.insertIssue({
          scan_id: scanId,
          page_id: pageId,
          fingerprint: fp,
          rule_id: v.ruleId,
          impact: v.impact,
          selector: v.selector.slice(0, 500),
          snippet: v.snippet.slice(0, 1000),
          help_url: v.helpUrl,
          wcag_tags: v.wcagTags.join(","),
          description: v.description.slice(0, 500),
        });
      }
      pageScores.push(score);
      pagesOk++;
    } catch (err) {
      pagesFailed++;
      ctx.repo.insertScanPage(scanId, {
        url,
        status: "failed",
        failReason: friendlyPageError(err),
      });
    } finally {
      await page.close().catch(() => undefined);
    }
  };

  for (let w = 0; w < workerCount; w++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const url = queue.shift();
          if (!url) break;
          await processOne(url);
        }
      })(),
    );
  }
  await Promise.all(workers);
  await context.close().catch(() => undefined);

  if (pagesOk === 0) {
    repo.markScanFailed(
      scanId,
      "Every page failed to load. The site may be blocking automated visitors (common with some bot-protection services), require a login, or be temporarily down. " +
        "Details for each page are listed below.",
    );
    // Keep per-page rows for transparency (already inserted).
    return;
  }

  // Diff against the previous completed scan.
  const previous = repo.latestCompletedScanBefore(ctx.siteId, scanId);
  let newIssueCount = 0;
  let resolvedIssueCount = 0;
  if (previous) {
    const prevFps = repo.listIssueFingerprints(previous.id);
    const diff = diffIssues(prevFps, fingerprints);
    newIssueCount = diff.newFingerprints.size;
    resolvedIssueCount = diff.resolvedFingerprints.size;
  } else {
    newIssueCount = new Set(fingerprints).size;
  }

  const overall = siteScore(pageScores);
  repo.finishScan(scanId, {
    pagesCrawled: pagesOk + pagesFailed,
    pagesFailed,
    score: overall,
    grade: grade(overall),
    counts,
    newIssueCount,
    resolvedIssueCount,
  });
  ctx.log(
    `scan#${scanId}: done. ${pagesOk} ok / ${pagesFailed} failed, score ${overall}, ` +
      `${counts.critical}C ${counts.serious}S ${counts.moderate}M ${counts.minor}m`,
  );
}

async function scanSinglePage(
  page: Page,
  url: string,
  timeoutMs: number,
): Promise<{ ok: true; violations: PageViolation[] } | { ok: false; reason: string }> {
  let response;
  try {
    response = await page.goto(url, { timeout: timeoutMs, waitUntil: "domcontentloaded" });
  } catch (err) {
    return { ok: false, reason: friendlyPageError(err) };
  }
  if (!response) {
    return { ok: false, reason: "The page did not return a response." };
  }
  const status = response.status();
  if (status >= 400) {
    return {
      ok: false,
      reason:
        status === 403 || status === 429
          ? `The site refused our request (HTTP ${status}). It may be behind bot protection.`
          : `The page returned HTTP ${status}.`,
    };
  }
  // Give client-side rendering a moment, without hanging on busy sites.
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);

  try {
    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    const violations: PageViolation[] = [];
    for (const v of results.violations) {
      const impact = normalizeImpact(v.impact);
      for (const node of v.nodes) {
        violations.push({
          ruleId: v.id,
          impact,
          selector: Array.isArray(node.target) ? node.target.join(" ") : String(node.target ?? ""),
          snippet: node.html ?? "",
          helpUrl: v.helpUrl ?? "",
          wcagTags: (v.tags ?? []).filter((t) => t.startsWith("wcag")),
          description: v.help ?? v.description ?? v.id,
        });
      }
    }
    return { ok: true, violations };
  } catch {
    return {
      ok: false,
      reason: "The accessibility checks could not run on this page (it may use an unsupported document type).",
    };
  }
}

function normalizeImpact(impact: string | null | undefined): Impact {
  switch (impact) {
    case "critical":
    case "serious":
    case "moderate":
    case "minor":
      return impact;
    default:
      return "minor";
  }
}

export function friendlyPageError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/timeout/i.test(raw)) {
    return "The page took too long to load (over the per-page time limit).";
  }
  if (/net::ERR_NAME_NOT_RESOLVED/i.test(raw)) {
    return "The domain could not be found (DNS error).";
  }
  if (/net::ERR_CONNECTION_REFUSED|net::ERR_CONNECTION_RESET/i.test(raw)) {
    return "The server refused the connection.";
  }
  if (/net::ERR_CERT|SSL/i.test(raw)) {
    return "The site's HTTPS certificate is invalid, so the page could not be loaded safely.";
  }
  if (/net::ERR_ABORTED/i.test(raw)) {
    return "The page load was interrupted (the site may block automated visitors).";
  }
  return "The page could not be loaded.";
}

/** Close shared browser (used on shutdown and between heavy workloads). */
export async function shutdownScanner(): Promise<void> {
  await closeBrowser();
}
