/**
 * End-to-end scan test against a local fixture site with known accessibility
 * problems. Needs Playwright Chromium. Skip with SITERAMP_SKIP_BROWSER_TESTS=1.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { openTestDb, type DB } from "../src/db.js";
import { Repo } from "../src/domain/repo.js";
import { runScan, shutdownScanner } from "../src/scanner/runner.js";
import { buildReportViewModel } from "../src/domain/report.js";
import { renderReportPdf } from "../src/services/pdf.js";
import { loadConfig } from "../src/config.js";

const SKIP = process.env.SITERAMP_SKIP_BROWSER_TESTS === "1";

const BAD_PAGE = `<!doctype html><html><head><meta charset="utf-8"></head>
<body>
  <img src="/x.png">
  <a href="/two"><span></span></a>
  <input type="text">
  <div style="color:#9a9a9a;background:#ffffff;font-size:12px">Low contrast paragraph text here</div>
</body></html>`;

const GOOD_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fine page</title></head>
<body>
  <main>
    <h1>All good here</h1>
    <p><a href="/">Back home with real text</a></p>
  </main>
</body></html>`;

describe.skipIf(SKIP)("full scan against fixture site", () => {
  let server: http.Server;
  let origin: string;
  let db: DB;
  let repo: Repo;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/" || req.url === "") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(BAD_PAGE);
      } else if (req.url === "/two") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(GOOD_PAGE);
      } else if (req.url === "/broken") {
        res.writeHead(500, { "content-type": "text/html" });
        res.end("boom");
      } else {
        res.writeHead(404, { "content-type": "text/html" });
        res.end("nope");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (typeof addr === "object" && addr) origin = `http://127.0.0.1:${addr.port}`;
    db = openTestDb();
    repo = new Repo(db);
  }, 30_000);

  afterAll(async () => {
    await shutdownScanner();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  });

  it("finds real violations, scores, diffs, and renders a PDF", async () => {
    const user = repo.createUser("scan@test.com", "hash", Math.floor(Date.now() / 1000) + 86400);
    repo.updateUserProfile(user.id, "Test Agency", "#336699");
    const siteRow = repo.createSite(user.id, "Fixture", origin, `${origin}/`);
    if ("duplicate" in siteRow) throw new Error("unexpected duplicate");

    // --- first scan ---
    const scan1 = repo.createScan(siteRow.id, "manual");
    await runScan({
      repo,
      scanId: scan1.id,
      siteId: siteRow.id,
      origin,
      startUrl: `${origin}/`,
      maxPages: 10,
      pageTimeoutMs: 20_000,
      totalTimeoutMs: 120_000,
      concurrency: 2,
      allowPrivateTargets: true,
      log: () => undefined,
    });

    const done1 = repo.getScanById(scan1.id)!;
    expect(done1.status).toBe("done");
    expect(done1.pages_crawled).toBeGreaterThanOrEqual(2);
    expect(done1.score).not.toBeNull();
    expect(done1.score!).toBeLessThan(100);

    const issues1 = repo.listIssues(scan1.id);
    const rules = new Set(issues1.map((i) => i.rule_id));
    // The bad page has: missing alt, link without name, unlabeled input, low contrast.
    expect(rules.has("image-alt")).toBe(true);
    expect(rules.has("link-name")).toBe(true);
    expect(rules.has("label")).toBe(true);
    expect(rules.has("color-contrast")).toBe(true);
    expect(done1.new_issue_count).toBeGreaterThan(0);

    // Per-page: the good page should score higher than the bad page.
    const pages1 = repo.listScanPages(scan1.id);
    const bad = pages1.find((p) => p.url === `${origin}/`)!;
    const good = pages1.find((p) => p.url === `${origin}/two`)!;
    expect(bad.status).toBe("ok");
    expect(good.status).toBe("ok");
    expect(good.score!).toBeGreaterThan(bad.score!);

    // --- second scan: unchanged site → no new, no resolved ---
    const scan2 = repo.createScan(siteRow.id, "manual");
    await runScan({
      repo,
      scanId: scan2.id,
      siteId: siteRow.id,
      origin,
      startUrl: `${origin}/`,
      maxPages: 10,
      pageTimeoutMs: 20_000,
      totalTimeoutMs: 120_000,
      concurrency: 2,
      allowPrivateTargets: true,
      log: () => undefined,
    });
    const done2 = repo.getScanById(scan2.id)!;
    expect(done2.status).toBe("done");
    expect(done2.new_issue_count).toBe(0);
    expect(done2.resolved_issue_count).toBe(0);

    // --- report + PDF ---
    const vm = buildReportViewModel({
      user: repo.getUserById(user.id)!,
      site: repo.getSiteById(siteRow.id)!,
      scan: done2,
      pages: repo.listScanPages(scan2.id),
      issues: repo.listIssues(scan2.id),
    });
    expect(vm.topFixes.length).toBeGreaterThan(0);

    const config = loadConfig({
      NODE_ENV: "test",
      DATA_DIR: "./data-test-unused",
      SESSION_SECRET: "x".repeat(40),
    } as NodeJS.ProcessEnv);
    const pdf = await renderReportPdf(vm, { config } as never);
    expect(pdf.length).toBeGreaterThan(10_000);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  }, 180_000);

  it("fails gracefully when every page is unreachable", async () => {
    const user = repo.getUserByEmail("scan@test.com")!;
    const deadOrigin = "http://127.0.0.1:1"; // nothing listens here
    const siteRow = repo.createSite(user.id, "Dead", deadOrigin, `${deadOrigin}/`);
    if ("duplicate" in siteRow) throw new Error("unexpected duplicate");
    const scan = repo.createScan(siteRow.id, "manual");
    await runScan({
      repo,
      scanId: scan.id,
      siteId: siteRow.id,
      origin: deadOrigin,
      startUrl: `${deadOrigin}/`,
      maxPages: 5,
      pageTimeoutMs: 8_000,
      totalTimeoutMs: 60_000,
      concurrency: 1,
      allowPrivateTargets: true,
      log: () => undefined,
    });
    const done = repo.getScanById(scan.id)!;
    expect(done.status).toBe("failed");
    expect(done.error_message).toMatch(/failed to load|couldn't reach|blocking/i);
  }, 120_000);
});
