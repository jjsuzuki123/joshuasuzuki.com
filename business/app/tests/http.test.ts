import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeAgent, makeTestWorld, prime, signupAgent, type TestWorld, type Agent } from "./helpers.js";

// HTTP tests use fictional domains; resolve them all to a public address so
// the SSRF check exercises its classification logic without real DNS.
// (IP-literal targets never hit DNS, so private-IP rejection stays testable.)
vi.mock("node:dns/promises", () => ({
  default: { lookup: async () => [{ address: "93.184.216.34", family: 4 }] },
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

let world: TestWorld;
beforeEach(async () => {
  world = await makeTestWorld();
});
afterEach(async () => {
  await world.cleanup();
});

async function post(agent: Agent, url: string, fields: Record<string, string> = {}) {
  const res = await world.app.inject({
    method: "POST",
    url,
    headers: { cookie: agent.header(), "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({ ...fields, _csrf: agent.csrf() }).toString(),
  });
  agent.absorb(res.headers["set-cookie"]);
  return res;
}

describe("auth flow", () => {
  it("signs up, reaches the dashboard, logs out", async () => {
    const agent = makeAgent();
    await signupAgent(world.app, agent, "a@b.com");
    const dash = await world.app.inject({ method: "GET", url: "/dashboard", headers: { cookie: agent.header() } });
    expect(dash.statusCode).toBe(200);
    expect(dash.body).toContain("Your sites");

    const out = await post(agent, "/logout");
    expect(out.statusCode).toBe(302);
    const dash2 = await world.app.inject({ method: "GET", url: "/dashboard", headers: { cookie: agent.header() } });
    expect(dash2.statusCode).toBe(302);
    expect(dash2.headers.location).toContain("/login");
  });

  it("rejects weak passwords with a friendly message", async () => {
    const agent = makeAgent();
    await prime(world.app, agent, "/signup");
    const res = await post(agent, "/signup", { email: "a@b.com", password: "short" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("at least 10 characters");
  });

  it("rejects duplicate emails", async () => {
    const a1 = makeAgent();
    await signupAgent(world.app, a1, "dup@b.com");
    const a2 = makeAgent();
    await prime(world.app, a2, "/signup");
    const res = await post(a2, "/signup", { email: "dup@b.com", password: "a-long-password-1" });
    expect(res.body).toContain("already exists");
  });

  it("login with wrong password fails generically; right password works", async () => {
    const agent = makeAgent();
    await signupAgent(world.app, agent, "c@d.com", "correct-horse-battery");
    await post(agent, "/logout");

    await prime(world.app, agent, "/login");
    const bad = await post(agent, "/login", { email: "c@d.com", password: "wrong-password-1" });
    expect(bad.body).toContain("match our records");
    const good = await post(agent, "/login", { email: "c@d.com", password: "correct-horse-battery" });
    expect(good.statusCode).toBe(302);
    expect(good.headers.location).toBe("/dashboard");
  });

  it("login page never reveals whether an email exists", async () => {
    const agent = makeAgent();
    await prime(world.app, agent, "/login");
    const res = await post(agent, "/login", { email: "ghost@b.com", password: "whatever-long-1" });
    expect(res.body).toContain("match our records");
    expect(res.body).not.toMatch(/no account|not found|unknown user/i);
  });
});

describe("CSRF protection", () => {
  it("rejects POSTs without a token", async () => {
    const agent = makeAgent();
    await signupAgent(world.app, agent);
    const res = await world.app.inject({
      method: "POST",
      url: "/sites",
      headers: { cookie: agent.header(), "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ url: "https://example.com" }).toString(),
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects POSTs with a mismatched token", async () => {
    const agent = makeAgent();
    await signupAgent(world.app, agent);
    const res = await world.app.inject({
      method: "POST",
      url: "/sites",
      headers: { cookie: agent.header(), "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ url: "https://example.com", _csrf: "A".repeat(43) }).toString(),
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects cross-origin form posts", async () => {
    const agent = makeAgent();
    await signupAgent(world.app, agent);
    const res = await world.app.inject({
      method: "POST",
      url: "/sites",
      headers: {
        cookie: agent.header(),
        origin: "https://evil.example",
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: new URLSearchParams({ url: "https://example.com", _csrf: agent.csrf() }).toString(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("sites", () => {
  it("adds a valid site and shows it", async () => {
    const agent = makeAgent();
    await signupAgent(world.app, agent);
    const res = await post(agent, "/sites", { url: "example.com", name: "Example" });
    expect(res.statusCode).toBe(302);
    const dash = await world.app.inject({ method: "GET", url: "/dashboard", headers: { cookie: agent.header() } });
    expect(dash.body).toContain("Example");
  });

  it("rejects invalid and private URLs with friendly flashes", async () => {
    const agent = makeAgent();
    await signupAgent(world.app, agent);
    for (const url of ["not a url", "javascript:alert(1)", "http://127.0.0.1", "http://10.0.0.5/x", "http://.com", "http://0x7f000001"]) {
      const res = await post(agent, "/sites", { url });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("/dashboard");
    }
    expect(world.repo.countSites(1)).toBe(0);
  });

  it("handles absurdly long URLs without a 500", async () => {
    const agent = makeAgent();
    await signupAgent(world.app, agent);
    const res = await post(agent, "/sites", { url: "https://a.com/" + "x".repeat(3000) });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/dashboard");
    expect(world.repo.countSites(1)).toBe(0);
  });

  it("escapes hostile site names in HTML output", async () => {
    const agent = makeAgent();
    await signupAgent(world.app, agent);
    await post(agent, "/sites", { url: "https://example.com", name: "<script>alert(1)</script>" });
    const dash = await world.app.inject({ method: "GET", url: "/dashboard", headers: { cookie: agent.header() } });
    expect(dash.body).not.toContain("<script>alert(1)</script>");
    expect(dash.body).toContain("&lt;script&gt;");
  });

  it("rejects duplicates per user", async () => {
    const agent = makeAgent();
    await signupAgent(world.app, agent);
    await post(agent, "/sites", { url: "https://example.com" });
    await post(agent, "/sites", { url: "example.com/" }); // same origin, different spelling
    expect(world.repo.countSites(1)).toBe(1);
  });

  it("enforces the plan's site limit", async () => {
    const agent = makeAgent();
    await signupAgent(world.app, agent);
    for (let i = 0; i < 12; i++) {
      await post(agent, "/sites", { url: `https://example-${i}.com` });
    }
    expect(world.repo.countSites(1)).toBe(10); // trial cap
  });

  it("blocks access to other users' sites", async () => {
    const a = makeAgent();
    await signupAgent(world.app, a, "a@a.com");
    await post(a, "/sites", { url: "https://example.com" });
    const b = makeAgent();
    await signupAgent(world.app, b, "b@b.com");
    const site = world.repo.listSites(1)[0]!;
    const res = await world.app.inject({
      method: "GET",
      url: `/sites/${site.id}`,
      headers: { cookie: b.header() },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("scans and entitlements", () => {
  it("runs a scan through the queue stub and shows a report", async () => {
    const agent = makeAgent();
    await signupAgent(world.app, agent);
    await post(agent, "/sites", { url: "https://example.com" });
    const site = world.repo.listSites(1)[0]!;
    const res = await post(agent, `/sites/${site.id}/scan`);
    expect(res.statusCode).toBe(302);
    // queue is synchronous-ish; wait a tick for the stub runner
    await new Promise((r) => setTimeout(r, 50));
    const scan = world.repo.latestScanForSite(site.id)!;
    expect(scan.status).toBe("done");
    const report = await world.app.inject({
      method: "GET",
      url: `/scans/${scan.id}`,
      headers: { cookie: agent.header() },
    });
    expect(report.statusCode).toBe(200);
    expect(report.body).toContain("accessibility report");
  });

  it("blocks scans for expired trials with a helpful redirect", async () => {
    const agent = makeAgent();
    await signupAgent(world.app, agent);
    await post(agent, "/sites", { url: "https://example.com" });
    const site = world.repo.listSites(1)[0]!;
    // Expire the trial.
    world.db.prepare("UPDATE users SET trial_ends_at = 1 WHERE id = 1").run();
    const res = await post(agent, `/sites/${site.id}/scan`);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/billing");
    expect(world.repo.latestScanForSite(site.id)).toBeUndefined();
  });

  it("prevents double-queueing a scan", async () => {
    const agent = makeAgent();
    await signupAgent(world.app, agent);
    await post(agent, "/sites", { url: "https://example.com" });
    const site = world.repo.listSites(1)[0]!;
    // Insert a queued scan directly (bypassing the auto-running stub).
    world.repo.createScan(site.id, "manual");
    const res = await post(agent, `/sites/${site.id}/scan`);
    expect(res.statusCode).toBe(302);
    const scans = world.repo.listScansForSite(site.id);
    expect(scans.length).toBe(1);
  });
});

describe("share links", () => {
  async function makeDoneScan(agent: Agent): Promise<number> {
    await post(agent, "/sites", { url: "https://example.com" });
    const site = world.repo.listSites(1)[0]!;
    await post(agent, `/sites/${site.id}/scan`);
    await new Promise((r) => setTimeout(r, 50));
    return world.repo.latestScanForSite(site.id)!.id;
  }

  it("creates a working share link and revokes it", async () => {
    const agent = makeAgent();
    await signupAgent(world.app, agent);
    const scanId = await makeDoneScan(agent);

    const res = await post(agent, `/scans/${scanId}/share`);
    expect(res.statusCode).toBe(302);
    const token = String(res.headers.location).split("share=")[1]!;
    expect(token.length).toBeGreaterThan(10);

    // Public view works logged out.
    const pub = await world.app.inject({ method: "GET", url: `/r/${token}` });
    expect(pub.statusCode).toBe(200);
    expect(pub.body).toContain("Website Accessibility Report");
    expect(pub.headers["x-robots-tag"]).toContain("noindex");

    // Revoke → 404.
    await post(agent, `/scans/${scanId}/share/revoke`);
    const gone = await world.app.inject({ method: "GET", url: `/r/${token}` });
    expect(gone.statusCode).toBe(404);
  });

  it("404s for invalid tokens", async () => {
    const res = await world.app.inject({ method: "GET", url: "/r/not-a-real-token" });
    expect(res.statusCode).toBe(404);
  });
});

describe("account deletion", () => {
  it("deletes everything and logs out", async () => {
    const agent = makeAgent();
    await signupAgent(world.app, agent, "gone@b.com");
    await post(agent, "/sites", { url: "https://example.com" });
    const res = await post(agent, "/settings/delete-account", { confirm_email: "gone@b.com" });
    expect(res.statusCode).toBe(302);
    expect(world.repo.getUserByEmail("gone@b.com")).toBeUndefined();
    expect(world.db.prepare("SELECT COUNT(*) AS c FROM sites").get()).toEqual({ c: 0 });
  });

  it("requires exact email confirmation", async () => {
    const agent = makeAgent();
    await signupAgent(world.app, agent, "stay@b.com");
    await post(agent, "/settings/delete-account", { confirm_email: "wrong@b.com" });
    expect(world.repo.getUserByEmail("stay@b.com")).toBeDefined();
  });
});

describe("hostile inputs", () => {
  it("404s cleanly on junk ids", async () => {
    const agent = makeAgent();
    await signupAgent(world.app, agent);
    for (const url of ["/sites/999999", "/sites/abc", "/scans/0", "/scans/-1", "/sites/1e9"]) {
      const res = await world.app.inject({ method: "GET", url, headers: { cookie: agent.header() } });
      expect(res.statusCode).toBe(404);
    }
  });

  it("unknown routes render the 404 page", async () => {
    const res = await world.app.inject({ method: "GET", url: "/definitely-not-a-page" });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("Page not found");
  });

  it("oversized session cookies don't crash session resolution", async () => {
    const res = await world.app.inject({
      method: "GET",
      url: "/dashboard",
      headers: { cookie: `siteramp_session=${"x".repeat(5000)}` },
    });
    expect(res.statusCode).toBe(302); // treated as logged out
  });

  it("sets security headers on every response", async () => {
    const res = await world.app.inject({ method: "GET", url: "/" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
  });
});
