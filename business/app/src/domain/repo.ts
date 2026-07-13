import type { DB } from "../db.js";
import { now } from "../db.js";
import type { Impact } from "./scoring.js";
import type { PlanId, PlanStatus } from "./plans.js";

/** Typed row shapes (mirror db.ts schema). */
export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  agency_name: string;
  accent_color: string;
  logo_path: string | null;
  plan: PlanId;
  plan_status: PlanStatus;
  trial_ends_at: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: number | null;
  created_at: number;
}

export interface SiteRow {
  id: number;
  user_id: number;
  name: string;
  origin: string;
  start_url: string;
  schedule: "off" | "weekly" | "monthly";
  robots_override: number;
  created_at: number;
}

export interface ScanRow {
  id: number;
  site_id: number;
  status: "queued" | "running" | "done" | "failed";
  trigger_kind: "manual" | "scheduled";
  started_at: number | null;
  finished_at: number | null;
  pages_crawled: number;
  pages_failed: number;
  score: number | null;
  grade: string | null;
  critical_count: number;
  serious_count: number;
  moderate_count: number;
  minor_count: number;
  new_issue_count: number;
  resolved_issue_count: number;
  error_message: string | null;
  created_at: number;
}

export interface ScanPageRow {
  id: number;
  scan_id: number;
  url: string;
  status: "ok" | "failed";
  fail_reason: string | null;
  score: number | null;
  critical_count: number;
  serious_count: number;
  moderate_count: number;
  minor_count: number;
}

export interface IssueRow {
  id: number;
  scan_id: number;
  page_id: number;
  fingerprint: string;
  rule_id: string;
  impact: Impact;
  selector: string;
  snippet: string;
  help_url: string;
  wcag_tags: string;
  description: string;
}

export class Repo {
  constructor(private readonly db: DB) {}

  // ---- users ----
  createUser(email: string, passwordHash: string, trialEndsAt: number): UserRow {
    const info = this.db
      .prepare(
        "INSERT INTO users (email, password_hash, trial_ends_at, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(email, passwordHash, trialEndsAt, now());
    return this.getUserById(Number(info.lastInsertRowid))!;
  }

  getUserById(id: number): UserRow | undefined {
    return this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  }

  getUserByEmail(email: string): UserRow | undefined {
    return this.db.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
  }

  getUserByStripeCustomer(customerId: string): UserRow | undefined {
    return this.db.prepare("SELECT * FROM users WHERE stripe_customer_id = ?").get(customerId) as
      | UserRow
      | undefined;
  }

  updateUserProfile(id: number, agencyName: string, accentColor: string): void {
    this.db
      .prepare("UPDATE users SET agency_name = ?, accent_color = ? WHERE id = ?")
      .run(agencyName, accentColor, id);
  }

  updateUserLogo(id: number, logoPath: string | null): void {
    this.db.prepare("UPDATE users SET logo_path = ? WHERE id = ?").run(logoPath, id);
  }

  updateUserPassword(id: number, passwordHash: string): void {
    this.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
  }

  setStripeCustomer(id: number, customerId: string): void {
    this.db.prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?").run(customerId, id);
  }

  applySubscription(
    userId: number,
    fields: {
      plan: PlanId;
      planStatus: PlanStatus;
      subscriptionId: string | null;
      currentPeriodEnd: number | null;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE users SET plan = ?, plan_status = ?, stripe_subscription_id = ?, current_period_end = ?
         WHERE id = ?`,
      )
      .run(fields.plan, fields.planStatus, fields.subscriptionId, fields.currentPeriodEnd, userId);
  }

  deleteUser(id: number): void {
    this.db.prepare("DELETE FROM users WHERE id = ?").run(id);
  }

  // ---- sessions ----
  createSession(userId: number, tokenHash: string, expiresAt: number): void {
    this.db
      .prepare("INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(userId, tokenHash, expiresAt, now());
  }

  getSessionUser(tokenHash: string): { user: UserRow; sessionId: number; expiresAt: number } | undefined {
    const row = this.db
      .prepare(
        `SELECT s.id AS session_id, s.expires_at, u.*
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get(tokenHash, now()) as (UserRow & { session_id: number; expires_at: number }) | undefined;
    if (!row) return undefined;
    const { session_id, expires_at, ...user } = row;
    return { user: user as UserRow, sessionId: session_id, expiresAt: expires_at };
  }

  touchSession(sessionId: number, newExpiresAt: number): void {
    this.db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(newExpiresAt, sessionId);
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  deleteSessionsForUser(userId: number): void {
    this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }

  pruneExpiredSessions(): number {
    return this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now()).changes;
  }

  // ---- password resets ----
  createPasswordReset(userId: number, tokenHash: string, expiresAt: number): void {
    this.db
      .prepare("INSERT INTO password_resets (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(userId, tokenHash, expiresAt, now());
  }

  usePasswordReset(tokenHash: string): { userId: number } | undefined {
    const row = this.db
      .prepare("SELECT id, user_id FROM password_resets WHERE token_hash = ? AND expires_at > ? AND used_at IS NULL")
      .get(tokenHash, now()) as { id: number; user_id: number } | undefined;
    if (!row) return undefined;
    this.db.prepare("UPDATE password_resets SET used_at = ? WHERE id = ?").run(now(), row.id);
    return { userId: row.user_id };
  }

  // ---- sites ----
  countSites(userId: number): number {
    const row = this.db.prepare("SELECT COUNT(*) AS c FROM sites WHERE user_id = ?").get(userId) as { c: number };
    return row.c;
  }

  listSites(userId: number): SiteRow[] {
    return this.db.prepare("SELECT * FROM sites WHERE user_id = ? ORDER BY created_at DESC").all(userId) as SiteRow[];
  }

  getSite(userId: number, siteId: number): SiteRow | undefined {
    return this.db.prepare("SELECT * FROM sites WHERE id = ? AND user_id = ?").get(siteId, userId) as
      | SiteRow
      | undefined;
  }

  getSiteById(siteId: number): SiteRow | undefined {
    return this.db.prepare("SELECT * FROM sites WHERE id = ?").get(siteId) as SiteRow | undefined;
  }

  createSite(userId: number, name: string, origin: string, startUrl: string): SiteRow | { duplicate: true } {
    try {
      const info = this.db
        .prepare("INSERT INTO sites (user_id, name, origin, start_url, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(userId, name, origin, startUrl, now());
      return this.getSiteById(Number(info.lastInsertRowid))!;
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("UNIQUE")) return { duplicate: true };
      throw err;
    }
  }

  updateSite(siteId: number, fields: { name: string; schedule: SiteRow["schedule"] }): void {
    this.db.prepare("UPDATE sites SET name = ?, schedule = ? WHERE id = ?").run(fields.name, fields.schedule, siteId);
  }

  setRobotsOverride(siteId: number, value: boolean): void {
    this.db.prepare("UPDATE sites SET robots_override = ? WHERE id = ?").run(value ? 1 : 0, siteId);
  }

  deleteSite(siteId: number): void {
    this.db.prepare("DELETE FROM sites WHERE id = ?").run(siteId);
  }

  // ---- scans ----
  createScan(siteId: number, trigger: "manual" | "scheduled"): ScanRow {
    const info = this.db
      .prepare("INSERT INTO scans (site_id, trigger_kind, created_at) VALUES (?, ?, ?)")
      .run(siteId, trigger, now());
    return this.getScanById(Number(info.lastInsertRowid))!;
  }

  getScanById(scanId: number): ScanRow | undefined {
    return this.db.prepare("SELECT * FROM scans WHERE id = ?").get(scanId) as ScanRow | undefined;
  }

  /** Scan joined through site to enforce ownership. */
  getScanForUser(userId: number, scanId: number): (ScanRow & { site_name: string; origin: string }) | undefined {
    return this.db
      .prepare(
        `SELECT sc.*, s.name AS site_name, s.origin
         FROM scans sc JOIN sites s ON s.id = sc.site_id
         WHERE sc.id = ? AND s.user_id = ?`,
      )
      .get(scanId, userId) as (ScanRow & { site_name: string; origin: string }) | undefined;
  }

  listScansForSite(siteId: number, limit = 20): ScanRow[] {
    return this.db
      .prepare("SELECT * FROM scans WHERE site_id = ? ORDER BY created_at DESC, id DESC LIMIT ?")
      .all(siteId, limit) as ScanRow[];
  }

  latestScanForSite(siteId: number): ScanRow | undefined {
    return this.db
      .prepare("SELECT * FROM scans WHERE site_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
      .get(siteId) as ScanRow | undefined;
  }

  latestCompletedScanBefore(siteId: number, scanId: number): ScanRow | undefined {
    return this.db
      .prepare(
        "SELECT * FROM scans WHERE site_id = ? AND status = 'done' AND id < ? ORDER BY id DESC LIMIT 1",
      )
      .get(siteId, scanId) as ScanRow | undefined;
  }

  hasActiveScan(siteId: number): boolean {
    const row = this.db
      .prepare("SELECT COUNT(*) AS c FROM scans WHERE site_id = ? AND status IN ('queued','running')")
      .get(siteId) as { c: number };
    return row.c > 0;
  }

  listQueuedScans(): ScanRow[] {
    return this.db.prepare("SELECT * FROM scans WHERE status = 'queued' ORDER BY id ASC").all() as ScanRow[];
  }

  markScanRunning(scanId: number): void {
    this.db.prepare("UPDATE scans SET status = 'running', started_at = ? WHERE id = ?").run(now(), scanId);
  }

  markScanFailed(scanId: number, message: string): void {
    this.db
      .prepare("UPDATE scans SET status = 'failed', finished_at = ?, error_message = ? WHERE id = ?")
      .run(now(), message, scanId);
  }

  /** On boot: any scan left 'queued'/'running' by a previous process is failed with an explanation. */
  failOrphanedScans(): number {
    return this.db
      .prepare(
        `UPDATE scans SET status = 'failed', finished_at = ?,
         error_message = 'The scan was interrupted by a server restart. Please run it again.'
         WHERE status IN ('queued','running')`,
      )
      .run(now()).changes;
  }

  finishScan(
    scanId: number,
    fields: {
      pagesCrawled: number;
      pagesFailed: number;
      score: number | null;
      grade: string;
      counts: Record<Impact, number>;
      newIssueCount: number;
      resolvedIssueCount: number;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE scans SET status = 'done', finished_at = ?, pages_crawled = ?, pages_failed = ?,
         score = ?, grade = ?, critical_count = ?, serious_count = ?, moderate_count = ?, minor_count = ?,
         new_issue_count = ?, resolved_issue_count = ?
         WHERE id = ?`,
      )
      .run(
        now(),
        fields.pagesCrawled,
        fields.pagesFailed,
        fields.score,
        fields.grade,
        fields.counts.critical,
        fields.counts.serious,
        fields.counts.moderate,
        fields.counts.minor,
        fields.newIssueCount,
        fields.resolvedIssueCount,
        scanId,
      );
  }

  insertScanPage(
    scanId: number,
    page: {
      url: string;
      status: "ok" | "failed";
      failReason?: string;
      score?: number | null;
      counts?: Record<Impact, number>;
    },
  ): number {
    const info = this.db
      .prepare(
        `INSERT INTO scan_pages (scan_id, url, status, fail_reason, score,
          critical_count, serious_count, moderate_count, minor_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        scanId,
        page.url,
        page.status,
        page.failReason ?? null,
        page.score ?? null,
        page.counts?.critical ?? 0,
        page.counts?.serious ?? 0,
        page.counts?.moderate ?? 0,
        page.counts?.minor ?? 0,
      );
    return Number(info.lastInsertRowid);
  }

  listScanPages(scanId: number): ScanPageRow[] {
    return this.db.prepare("SELECT * FROM scan_pages WHERE scan_id = ? ORDER BY url ASC").all(scanId) as ScanPageRow[];
  }

  insertIssue(issue: Omit<IssueRow, "id">): void {
    this.db
      .prepare(
        `INSERT INTO issues (scan_id, page_id, fingerprint, rule_id, impact, selector, snippet, help_url, wcag_tags, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        issue.scan_id,
        issue.page_id,
        issue.fingerprint,
        issue.rule_id,
        issue.impact,
        issue.selector,
        issue.snippet,
        issue.help_url,
        issue.wcag_tags,
        issue.description,
      );
  }

  listIssues(scanId: number): IssueRow[] {
    return this.db
      .prepare(
        `SELECT * FROM issues WHERE scan_id = ?
         ORDER BY CASE impact WHEN 'critical' THEN 0 WHEN 'serious' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END, rule_id ASC, id ASC`,
      )
      .all(scanId) as IssueRow[];
  }

  listIssueFingerprints(scanId: number): string[] {
    return (this.db.prepare("SELECT fingerprint FROM issues WHERE scan_id = ?").all(scanId) as {
      fingerprint: string;
    }[]).map((r) => r.fingerprint);
  }

  // ---- share links ----
  createShareLink(scanId: number, tokenHash: string): void {
    this.db
      .prepare("INSERT INTO share_links (scan_id, token_hash, created_at) VALUES (?, ?, ?)")
      .run(scanId, tokenHash, now());
  }

  getShareLink(tokenHash: string): { scan_id: number } | undefined {
    return this.db
      .prepare("SELECT scan_id FROM share_links WHERE token_hash = ? AND revoked_at IS NULL")
      .get(tokenHash) as { scan_id: number } | undefined;
  }

  revokeShareLinks(scanId: number): void {
    this.db.prepare("UPDATE share_links SET revoked_at = ? WHERE scan_id = ? AND revoked_at IS NULL").run(now(), scanId);
  }

  countActiveShareLinks(scanId: number): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS c FROM share_links WHERE scan_id = ? AND revoked_at IS NULL")
      .get(scanId) as { c: number };
    return row.c;
  }

  // ---- scheduling ----
  /**
   * Sites due for a scheduled scan: schedule enabled, no active scan, and the
   * most recent scan (any status) is older than the schedule interval.
   */
  listSitesDueForScheduledScan(): SiteRow[] {
    const nowSec = now();
    const week = 7 * 24 * 3600;
    const month = 30 * 24 * 3600;
    return this.db
      .prepare(
        `SELECT s.* FROM sites s
         WHERE s.schedule != 'off'
           AND NOT EXISTS (SELECT 1 FROM scans sc WHERE sc.site_id = s.id AND sc.status IN ('queued','running'))
           AND COALESCE((SELECT MAX(sc2.created_at) FROM scans sc2 WHERE sc2.site_id = s.id), 0)
               <= CASE s.schedule WHEN 'weekly' THEN ? - ${week} ELSE ? - ${month} END`,
      )
      .all(nowSec, nowSec) as SiteRow[];
  }

  // ---- webhook idempotency ----
  /** Returns true the first time an event id is seen. */
  recordWebhookEvent(eventId: string): boolean {
    try {
      this.db.prepare("INSERT INTO webhook_events (id, received_at) VALUES (?, ?)").run(eventId, now());
      return true;
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("UNIQUE")) return false;
      throw err;
    }
  }
}
