import cron from "node-cron";
import type { AppContext } from "./app.js";
import { computeEntitlement } from "./domain/plans.js";
import { now } from "./db.js";
import { scanFinishedEmail } from "./services/mailer.js";

/**
 * Every 15 minutes: enqueue scheduled scans for sites whose interval has
 * elapsed, for accounts that are currently entitled. Also prunes expired
 * sessions daily. All work is idempotent; a missed tick just means the scan
 * starts up to 15 minutes later.
 */
export function startScheduler(ctx: AppContext): { stop: () => void } {
  const tick = cron.schedule("*/15 * * * *", () => {
    try {
      enqueueDueScans(ctx);
    } catch (err) {
      ctx.log(`scheduler tick failed: ${err instanceof Error ? err.stack : String(err)}`);
    }
  });
  const daily = cron.schedule("15 4 * * *", () => {
    try {
      const pruned = ctx.repo.pruneExpiredSessions();
      if (pruned > 0) ctx.log(`pruned ${pruned} expired session(s)`);
    } catch (err) {
      ctx.log(`session prune failed: ${String(err)}`);
    }
  });
  return {
    stop: () => {
      tick.stop();
      daily.stop();
    },
  };
}

export function enqueueDueScans(ctx: AppContext): number {
  const due = ctx.repo.listSitesDueForScheduledScan();
  let enqueued = 0;
  for (const site of due) {
    const user = ctx.repo.getUserById(site.user_id);
    if (!user) continue;
    const ent = computeEntitlement(
      {
        plan: user.plan,
        planStatus: user.plan_status,
        trialEndsAt: user.trial_ends_at,
        currentPeriodEnd: user.current_period_end,
      },
      now(),
    );
    if (!ent.active) continue; // expired accounts: monitoring silently pauses (documented in UI)
    ctx.repo.createScan(site.id, "scheduled");
    enqueued++;
  }
  if (enqueued > 0) {
    ctx.log(`scheduler: enqueued ${enqueued} scheduled scan(s)`);
    ctx.queue.poke();
  }
  return enqueued;
}

/**
 * Notification hook for finished scans: email scheduled-scan results (always
 * for failures and new issues; completion summary otherwise). Manual scans
 * don't email — the user is watching the page.
 */
export function notifyScanFinished(ctx: AppContext, scanId: number): void {
  if (!ctx.mailer.enabled) return;
  const scan = ctx.repo.getScanById(scanId);
  if (!scan || scan.trigger_kind !== "scheduled") return;
  if (scan.status !== "done" && scan.status !== "failed") return;
  const site = ctx.repo.getSiteById(scan.site_id);
  if (!site) return;
  const user = ctx.repo.getUserById(site.user_id);
  if (!user) return;
  const mail = scanFinishedEmail({
    baseUrl: ctx.config.baseUrl,
    siteName: site.name,
    scanId: scan.id,
    score: scan.score,
    grade: scan.grade ?? "—",
    newIssues: scan.new_issue_count,
    resolvedIssues: scan.resolved_issue_count,
    failed: scan.status === "failed",
    errorMessage: scan.error_message,
  });
  void ctx.mailer.send(user.email, mail.subject, mail.text);
}
