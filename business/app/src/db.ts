import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type DB = Database.Database;

/**
 * Versioned, append-only migrations. Never edit an existing entry after it has
 * shipped — add a new one. Applied inside a transaction per migration.
 */
const MIGRATIONS: string[] = [
  // 1 — initial schema
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    agency_name TEXT NOT NULL DEFAULT '',
    accent_color TEXT NOT NULL DEFAULT '#1d4ed8',
    logo_path TEXT,
    plan TEXT NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial','solo','studio')),
    plan_status TEXT NOT NULL DEFAULT 'trialing'
      CHECK (plan_status IN ('trialing','active','past_due','canceled')),
    trial_ends_at INTEGER NOT NULL,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    current_period_end INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE password_resets (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE sites (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    origin TEXT NOT NULL,
    start_url TEXT NOT NULL,
    schedule TEXT NOT NULL DEFAULT 'off' CHECK (schedule IN ('off','weekly','monthly')),
    robots_override INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, origin)
  );

  CREATE TABLE scans (
    id INTEGER PRIMARY KEY,
    site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
    trigger_kind TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_kind IN ('manual','scheduled')),
    started_at INTEGER,
    finished_at INTEGER,
    pages_crawled INTEGER NOT NULL DEFAULT 0,
    pages_failed INTEGER NOT NULL DEFAULT 0,
    score INTEGER,
    grade TEXT,
    critical_count INTEGER NOT NULL DEFAULT 0,
    serious_count INTEGER NOT NULL DEFAULT 0,
    moderate_count INTEGER NOT NULL DEFAULT 0,
    minor_count INTEGER NOT NULL DEFAULT 0,
    new_issue_count INTEGER NOT NULL DEFAULT 0,
    resolved_issue_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_scans_site ON scans(site_id, created_at DESC);

  CREATE TABLE scan_pages (
    id INTEGER PRIMARY KEY,
    scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ok','failed')),
    fail_reason TEXT,
    score INTEGER,
    critical_count INTEGER NOT NULL DEFAULT 0,
    serious_count INTEGER NOT NULL DEFAULT 0,
    moderate_count INTEGER NOT NULL DEFAULT 0,
    minor_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_scan_pages_scan ON scan_pages(scan_id);

  CREATE TABLE issues (
    id INTEGER PRIMARY KEY,
    scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    page_id INTEGER NOT NULL REFERENCES scan_pages(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    impact TEXT NOT NULL CHECK (impact IN ('critical','serious','moderate','minor')),
    selector TEXT NOT NULL DEFAULT '',
    snippet TEXT NOT NULL DEFAULT '',
    help_url TEXT NOT NULL DEFAULT '',
    wcag_tags TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_issues_scan ON issues(scan_id);
  CREATE INDEX idx_issues_fingerprint ON issues(scan_id, fingerprint);

  CREATE TABLE share_links (
    id INTEGER PRIMARY KEY,
    scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
  );

  CREATE TABLE webhook_events (
    id TEXT PRIMARY KEY,
    received_at INTEGER NOT NULL
  );
  `,
];

export function openDb(dataDir: string, fileName = "siteramp.db"): DB {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, fileName));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

/** In-memory database for tests. */
export function openTestDb(): DB {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  db.exec("CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const appliedRow = db.prepare("SELECT MAX(version) AS v FROM migrations").get() as { v: number | null };
  const applied = appliedRow.v ?? 0;
  for (let version = applied + 1; version <= MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version - 1]!;
    const run = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO migrations (version, applied_at) VALUES (?, ?)").run(version, now());
    });
    run();
  }
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}
