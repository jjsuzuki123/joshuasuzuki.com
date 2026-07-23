import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, type AppConfig } from "../src/config.js";
import { openTestDb, type DB } from "../src/db.js";
import { Repo } from "../src/domain/repo.js";
import { AuthService } from "../src/services/auth.js";
import { Billing } from "../src/services/billing.js";
import { Mailer } from "../src/services/mailer.js";
import { ScanQueue } from "../src/scanner/queue.js";
import { RateLimiter } from "../src/lib/ratelimit.js";
import { buildApp, type AppContext } from "../src/app.js";
import type { FastifyInstance } from "fastify";

export interface TestWorld {
  ctx: AppContext;
  app: FastifyInstance;
  db: DB;
  repo: Repo;
  config: AppConfig;
  cleanup: () => Promise<void>;
  logs: string[];
}

export async function makeTestWorld(overrides: Record<string, string> = {}): Promise<TestWorld> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "siteramp-test-"));
  const config = loadConfig({
    NODE_ENV: "test",
    DATA_DIR: dataDir,
    SESSION_SECRET: "test-secret-test-secret-test-secret-42",
    BILLING_MODE: "disabled",
    ...overrides,
  } as NodeJS.ProcessEnv);
  const db = openTestDb();
  const repo = new Repo(db);
  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);
  const mailer = new Mailer(config, log);
  const billing = new Billing(config, repo, log);
  const auth = new AuthService(repo);
  const ctx: AppContext = {
    config,
    db,
    repo,
    auth,
    billing,
    mailer,
    queue: null as unknown as ScanQueue,
    log,
    limiters: {
      login: new RateLimiter(1000, 60_000),
      signup: new RateLimiter(1000, 60_000),
      forgot: new RateLimiter(1000, 60_000),
      scan: new RateLimiter(1000, 60_000),
      share: new RateLimiter(1000, 60_000),
    },
  };
  // Queue with a no-op runner (HTTP tests never execute real scans).
  ctx.queue = new ScanQueue({
    repo,
    config,
    log,
    runScanImpl: async ({ repo: r, scanId }) => {
      r.markScanRunning(scanId);
      r.finishScan(scanId, {
        pagesCrawled: 1,
        pagesFailed: 0,
        score: 100,
        grade: "A",
        counts: { critical: 0, serious: 0, moderate: 0, minor: 0 },
        newIssueCount: 0,
        resolvedIssueCount: 0,
      });
    },
  });
  const app = await buildApp(ctx);
  return {
    ctx,
    app,
    db,
    repo,
    config,
    logs,
    cleanup: async () => {
      await app.close();
      db.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Extract a cookie value from set-cookie headers. */
export function cookieValue(setCookie: string | string[] | undefined, name: string): string | null {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const c of list) {
    const m = c.match(new RegExp(`^${name}=([^;]+)`));
    if (m) return m[1]!;
  }
  return null;
}

export interface Agent {
  cookies: Map<string, string>;
  csrf: () => string;
  header: () => string;
  absorb: (setCookie: string | string[] | undefined) => void;
}

/** Minimal cookie-jar agent for fastify.inject flows. */
export function makeAgent(): Agent {
  const cookies = new Map<string, string>();
  return {
    cookies,
    csrf: () => cookies.get("siteramp_csrf") ?? "",
    header: () =>
      [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    absorb: (setCookie) => {
      const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
      for (const c of list) {
        const m = c.match(/^([^=]+)=([^;]*)/);
        if (m) {
          if (m[2] === "" || /Max-Age=0|Expires=Thu, 01 Jan 1970/.test(c)) cookies.delete(m[1]!);
          else cookies.set(m[1]!, m[2]!);
        }
      }
    },
  };
}

/** GET a page (absorbing cookies) so the agent has a CSRF token. */
export async function prime(app: FastifyInstance, agent: Agent, url = "/login"): Promise<void> {
  const res = await app.inject({ method: "GET", url, headers: { cookie: agent.header() } });
  agent.absorb(res.headers["set-cookie"]);
}

export async function signupAgent(
  app: FastifyInstance,
  agent: Agent,
  email = "user@example.com",
  password = "a-long-password-1",
): Promise<void> {
  await prime(app, agent, "/signup");
  const res = await app.inject({
    method: "POST",
    url: "/signup",
    headers: { cookie: agent.header(), "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({ email, password, _csrf: agent.csrf() }).toString(),
  });
  agent.absorb(res.headers["set-cookie"]);
  if (res.statusCode !== 302) throw new Error(`signup failed: ${res.statusCode} ${res.body}`);
}
