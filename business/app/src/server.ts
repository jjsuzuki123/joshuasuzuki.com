import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { Repo } from "./domain/repo.js";
import { AuthService } from "./services/auth.js";
import { Billing } from "./services/billing.js";
import { Mailer } from "./services/mailer.js";
import { ScanQueue } from "./scanner/queue.js";
import { RateLimiter } from "./lib/ratelimit.js";
import { buildApp, type AppContext } from "./app.js";
import { startScheduler, notifyScanFinished } from "./scheduler.js";

const log = (msg: string) => {
  console.log(`[${new Date().toISOString()}] ${msg}`);
};

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDb(config.dataDir);
  const repo = new Repo(db);

  const orphaned = repo.failOrphanedScans();
  if (orphaned > 0) log(`marked ${orphaned} orphaned scan(s) as failed after restart`);

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
    queue: null as unknown as ScanQueue, // set just below (queue needs ctx.log)
    log,
    limiters: {
      login: new RateLimiter(10, 15 * 60_000),
      signup: new RateLimiter(5, 60 * 60_000),
      forgot: new RateLimiter(5, 60 * 60_000),
      scan: new RateLimiter(10, 10 * 60_000),
      share: new RateLimiter(20, 60 * 60_000),
    },
  };
  ctx.queue = new ScanQueue({
    repo,
    config,
    log,
    onScanFinished: (scanId) => notifyScanFinished(ctx, scanId),
  });

  const app = await buildApp(ctx);
  const scheduler = startScheduler(ctx);

  // Pick up any scans that were queued when the process stopped... none exist
  // (orphans were failed), but a poke is harmless and starts a clean worker.
  ctx.queue.poke();

  const shutdown = async (signal: string) => {
    log(`${signal} received; shutting down…`);
    scheduler.stop();
    await ctx.queue.stop();
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ host: config.host, port: config.port });
  log(`SiteRamp listening on http://${config.host}:${config.port} (${config.env})`);
  if (config.billing.mode === "disabled") log("billing: DISABLED (dev mode — all accounts run as unbilled trials)");
  if (!mailer.enabled) log("email: DISABLED (no SMTP configured — resets/alerts degrade gracefully)");
}

main().catch((err) => {
  console.error("Fatal startup error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
