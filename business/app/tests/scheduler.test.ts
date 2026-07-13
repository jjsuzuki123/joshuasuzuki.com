import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTestWorld, type TestWorld } from "./helpers.js";
import { enqueueDueScans } from "../src/scheduler.js";
import { now } from "../src/db.js";

let world: TestWorld;
beforeEach(async () => {
  world = await makeTestWorld();
});
afterEach(async () => {
  await world.cleanup();
});

function makeUserWithSite(schedule: "off" | "weekly" | "monthly", email = "sched@x.com") {
  const user = world.repo.createUser(email, "hash", now() + 7 * 86400);
  const site = world.repo.createSite(user.id, "S", `https://${email.split("@")[0]}.com`, `https://${email.split("@")[0]}.com/`);
  if ("duplicate" in site) throw new Error("dup");
  world.repo.updateSite(site.id, { name: "S", schedule });
  return { user, site };
}

describe("scheduled scan enqueueing", () => {
  it("enqueues a weekly site whose last scan is older than a week", () => {
    const { site } = makeUserWithSite("weekly");
    // Fake an old scan 8 days ago.
    const old = world.repo.createScan(site.id, "manual");
    world.db
      .prepare("UPDATE scans SET status='done', created_at = ?, finished_at = ? WHERE id = ?")
      .run(now() - 8 * 86400, now() - 8 * 86400, old.id);

    const enqueued = enqueueDueScans(world.ctx);
    expect(enqueued).toBe(1);
  });

  it("does not enqueue when the last scan is recent, schedule is off, or a scan is active", () => {
    const a = makeUserWithSite("weekly", "recent@x.com");
    const recentScan = world.repo.createScan(a.site.id, "manual");
    world.db.prepare("UPDATE scans SET status='done' WHERE id = ?").run(recentScan.id);

    makeUserWithSite("off", "offsched@x.com"); // never scanned but schedule off

    const c = makeUserWithSite("weekly", "active@x.com");
    const oldActive = world.repo.createScan(c.site.id, "manual"); // still queued = active
    world.db.prepare("UPDATE scans SET created_at = ? WHERE id = ?").run(now() - 9 * 86400, oldActive.id);

    expect(enqueueDueScans(world.ctx)).toBe(0);
  });

  it("enqueues never-scanned scheduled sites immediately", () => {
    makeUserWithSite("monthly", "never@x.com");
    expect(enqueueDueScans(world.ctx)).toBe(1);
  });

  it("skips accounts whose trial expired", () => {
    const { user } = makeUserWithSite("weekly", "expired@x.com");
    world.db.prepare("UPDATE users SET trial_ends_at = 1 WHERE id = ?").run(user.id);
    expect(enqueueDueScans(world.ctx)).toBe(0);
  });
});

describe("orphaned scan recovery", () => {
  it("fails queued/running scans on boot with a clear message", () => {
    const { site } = makeUserWithSite("off", "orphan@x.com");
    const s1 = world.repo.createScan(site.id, "manual");
    const s2 = world.repo.createScan(site.id, "manual");
    world.repo.markScanRunning(s2.id);
    const changed = world.repo.failOrphanedScans();
    expect(changed).toBe(2);
    expect(world.repo.getScanById(s1.id)!.status).toBe("failed");
    expect(world.repo.getScanById(s2.id)!.error_message).toMatch(/server restart/i);
  });
});
