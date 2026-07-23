import type { Repo } from "../domain/repo.js";
import type { AppConfig } from "../config.js";
import { runScan } from "./runner.js";
import { closeBrowser } from "./browser.js";

export interface QueueDeps {
  repo: Repo;
  config: AppConfig;
  log: (msg: string) => void;
  /** called after a scan finishes so notifications can fire */
  onScanFinished?: (scanId: number) => void;
  /** injectable for tests */
  runScanImpl?: typeof runScan;
}

/**
 * In-process scan queue. One site scan at a time (page-level concurrency lives
 * inside the runner). Jobs are persisted as 'queued' scans in SQLite, so the
 * queue state survives restarts (orphans are failed on boot with an explanation
 * and users can simply re-run).
 */
export class ScanQueue {
  private running = false;
  private stopped = false;

  constructor(private readonly deps: QueueDeps) {}

  /** Enqueue is just "a queued scan row exists"; poke the worker. */
  poke(): void {
    if (this.running || this.stopped) return;
    void this.drain();
  }

  queuePosition(scanId: number): number {
    const queued = this.deps.repo.listQueuedScans();
    const idx = queued.findIndex((s) => s.id === scanId);
    return idx === -1 ? 0 : idx + 1;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await closeBrowser();
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      for (;;) {
        if (this.stopped) return;
        const next = this.deps.repo.listQueuedScans()[0];
        if (!next) return;
        const site = this.deps.repo.getSiteById(next.site_id);
        if (!site) {
          this.deps.repo.markScanFailed(next.id, "The site for this scan no longer exists.");
          continue;
        }
        const user = this.deps.repo.getUserById(site.user_id);
        if (!user) {
          this.deps.repo.markScanFailed(next.id, "The account for this scan no longer exists.");
          continue;
        }
        const { computeEntitlement } = await import("../domain/plans.js");
        const ent = computeEntitlement(
          {
            plan: user.plan,
            planStatus: user.plan_status,
            trialEndsAt: user.trial_ends_at,
            currentPeriodEnd: user.current_period_end,
          },
          Math.floor(Date.now() / 1000),
        );
        if (!ent.active) {
          this.deps.repo.markScanFailed(
            next.id,
            ent.reason === "trial_expired"
              ? "Your free trial has ended, so this scan was not run. Choose a plan to continue scanning."
              : "Your subscription is inactive, so this scan was not run.",
          );
          continue;
        }

        const impl = this.deps.runScanImpl ?? runScan;
        try {
          await impl({
            repo: this.deps.repo,
            scanId: next.id,
            siteId: site.id,
            origin: site.origin,
            startUrl: site.start_url,
            maxPages: ent.limits.maxPagesPerScan,
            pageTimeoutMs: this.deps.config.scan.pageTimeoutMs,
            totalTimeoutMs: this.deps.config.scan.totalTimeoutMs,
            concurrency: this.deps.config.scan.concurrency,
            allowPrivateTargets: this.deps.config.scan.allowPrivateTargets,
            log: this.deps.log,
          });
        } catch (err) {
          // Defensive: runScan handles its own failures; this catches bugs.
          this.deps.log(`scan#${next.id}: unexpected error: ${err instanceof Error ? err.stack : String(err)}`);
          this.deps.repo.markScanFailed(
            next.id,
            "An unexpected error interrupted this scan. Please try again — if it keeps happening, contact support.",
          );
        } finally {
          try {
            this.deps.onScanFinished?.(next.id);
          } catch (err) {
            this.deps.log(`onScanFinished hook failed: ${String(err)}`);
          }
        }
        // Restart the browser between site scans to bound memory growth.
        await closeBrowser();
      }
    } finally {
      this.running = false;
      // If new work arrived while we were finishing, pick it up.
      if (!this.stopped && this.deps.repo.listQueuedScans().length > 0) void this.drain();
    }
  }
}
