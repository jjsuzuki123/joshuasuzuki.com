import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { baseView, requireAuth, setFlash, takeFlash, type AppContext } from "../app.js";
import { parseTargetUrl } from "../lib/urls.js";
import { assertPublicHost, SsrfError } from "../lib/ssrf.js";
import { fetchRobotsTxt } from "../scanner/crawler.js";
import { robotsDisallowsAll } from "../lib/urls.js";
import { generateToken, hashToken } from "../lib/crypto.js";
import { buildReportViewModel } from "../domain/report.js";
import { renderReportPdf, logoToDataUri } from "../services/pdf.js";

export function registerDashboardRoutes(app: FastifyInstance, ctx: AppContext): void {
  // ---------- dashboard ----------
  app.get("/dashboard", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const sites = ctx.repo.listSites(req.currentUser!.id).map((site) => ({
      ...site,
      latestScan: ctx.repo.latestScanForSite(site.id) ?? null,
    }));
    return reply.view(
      "dashboard.njk",
      baseView(req, ctx, {
        title: "Dashboard",
        sites,
        flash: takeFlash(req, reply),
        siteLimit: req.entitlement!.limits.maxSites,
      }),
    );
  });

  // ---------- add site ----------
  app.post("/sites", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const user = req.currentUser!;
    const ent = req.entitlement!;

    if (!ent.active) {
      setFlash(reply, "error", planInactiveMessage(ent.reason));
      return reply.redirect("/billing");
    }
    const body = z
      .object({ url: z.string().max(2000).default(""), name: z.string().max(120).default("") })
      .parse(req.body ?? {});

    if (ctx.repo.countSites(user.id) >= ent.limits.maxSites) {
      setFlash(
        reply,
        "error",
        `Your plan includes up to ${ent.limits.maxSites} sites. Remove a site or upgrade to add more.`,
      );
      return reply.redirect("/dashboard");
    }

    const parsed = parseTargetUrl(body.url);
    if (!parsed.ok) {
      setFlash(reply, "error", parsed.error);
      return reply.redirect("/dashboard");
    }
    try {
      await assertPublicHost(new URL(parsed.value.origin).hostname, ctx.config.scan.allowPrivateTargets);
    } catch (err) {
      setFlash(
        reply,
        "error",
        err instanceof SsrfError ? err.message : "We couldn't verify that address. Please check it and try again.",
      );
      return reply.redirect("/dashboard");
    }

    const name = body.name.trim() || new URL(parsed.value.origin).hostname;
    const created = ctx.repo.createSite(user.id, name, parsed.value.origin, parsed.value.startUrl);
    if ("duplicate" in created) {
      setFlash(reply, "error", "You're already tracking that website.");
      return reply.redirect("/dashboard");
    }
    setFlash(reply, "success", `${name} added. Run your first scan from the site page.`);
    return reply.redirect(`/sites/${created.id}`);
  });

  // ---------- site detail ----------
  app.get("/sites/:id", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const site = ctx.repo.getSite(req.currentUser!.id, idParam(req.params));
    if (!site) return reply.callNotFound();
    const scans = ctx.repo.listScansForSite(site.id);

    // robots.txt advisory check (cached per request only; cheap HEAD-ish call).
    let robotsBlocked = false;
    if (!site.robots_override) {
      const robots = await fetchRobotsTxt(site.origin);
      robotsBlocked = robots ? robotsDisallowsAll(robots) : false;
    }

    return reply.view(
      "site.njk",
      baseView(req, ctx, {
        title: site.name,
        site,
        scans,
        robotsBlocked,
        flash: takeFlash(req, reply),
        pageLimit: req.entitlement!.limits.maxPagesPerScan,
        hasActiveScan: ctx.repo.hasActiveScan(site.id),
      }),
    );
  });

  app.post("/sites/:id/update", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const site = ctx.repo.getSite(req.currentUser!.id, idParam(req.params));
    if (!site) return reply.callNotFound();
    const body = z
      .object({
        name: z.string().trim().min(1, "Please give this site a name.").max(120),
        schedule: z.enum(["off", "weekly", "monthly"]),
      })
      .safeParse(req.body ?? {});
    if (!body.success) {
      setFlash(reply, "error", body.error.issues[0]!.message);
      return reply.redirect(`/sites/${site.id}`);
    }
    ctx.repo.updateSite(site.id, { name: body.data.name, schedule: body.data.schedule });
    setFlash(
      reply,
      "success",
      body.data.schedule === "off"
        ? "Saved. Automatic monitoring is off for this site."
        : `Saved. This site will be rescanned ${body.data.schedule}.`,
    );
    return reply.redirect(`/sites/${site.id}`);
  });

  app.post("/sites/:id/robots-override", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const site = ctx.repo.getSite(req.currentUser!.id, idParam(req.params));
    if (!site) return reply.callNotFound();
    ctx.repo.setRobotsOverride(site.id, true);
    setFlash(reply, "success", "Noted — you've confirmed you manage this site. Scans will proceed.");
    return reply.redirect(`/sites/${site.id}`);
  });

  app.post("/sites/:id/delete", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const site = ctx.repo.getSite(req.currentUser!.id, idParam(req.params));
    if (!site) return reply.callNotFound();
    ctx.repo.deleteSite(site.id);
    setFlash(reply, "success", `${site.name} and all its scan history were deleted.`);
    return reply.redirect("/dashboard");
  });

  // ---------- run scan ----------
  app.post("/sites/:id/scan", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const user = req.currentUser!;
    const ent = req.entitlement!;
    const site = ctx.repo.getSite(user.id, idParam(req.params));
    if (!site) return reply.callNotFound();

    if (!ent.active) {
      setFlash(reply, "error", planInactiveMessage(ent.reason));
      return reply.redirect("/billing");
    }
    if (ctx.repo.hasActiveScan(site.id)) {
      setFlash(reply, "error", "A scan for this site is already queued or running.");
      return reply.redirect(`/sites/${site.id}`);
    }
    if (!ctx.limiters.scan.check(`scan:${user.id}`)) {
      setFlash(reply, "error", "You've started a lot of scans in a short time. Give it a few minutes.");
      return reply.redirect(`/sites/${site.id}`);
    }
    // robots advisory: block until user confirms they manage the site.
    if (!site.robots_override) {
      const robots = await fetchRobotsTxt(site.origin);
      if (robots && robotsDisallowsAll(robots)) {
        setFlash(
          reply,
          "error",
          "This site's robots.txt asks crawlers to stay away. Confirm you own or manage it (button on this page) and scan again.",
        );
        return reply.redirect(`/sites/${site.id}`);
      }
    }
    const scan = ctx.repo.createScan(site.id, "manual");
    ctx.queue.poke();
    setFlash(reply, "success", "Scan started. This page will update as it runs.");
    return reply.redirect(`/scans/${scan.id}`);
  });

  // ---------- scan status (polled by tiny JS) ----------
  app.get("/scans/:id/status", async (req, reply) => {
    if (!req.currentUser) return reply.code(401).send({ error: "unauthorized" });
    const scan = ctx.repo.getScanForUser(req.currentUser.id, idParam(req.params));
    if (!scan) return reply.code(404).send({ error: "not_found" });
    return reply.send({
      status: scan.status,
      queuePosition: scan.status === "queued" ? ctx.queue.queuePosition(scan.id) : 0,
    });
  });

  // ---------- scan detail ----------
  app.get("/scans/:id", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const user = req.currentUser!;
    const scan = ctx.repo.getScanForUser(user.id, idParam(req.params));
    if (!scan) return reply.callNotFound();
    const site = ctx.repo.getSiteById(scan.site_id)!;

    if (scan.status === "queued" || scan.status === "running") {
      return reply.view(
        "scan-progress.njk",
        baseView(req, ctx, {
          title: `Scanning ${site.name}…`,
          scan,
          site,
          queuePosition: ctx.queue.queuePosition(scan.id),
          flash: takeFlash(req, reply),
        }),
      );
    }

    const pages = ctx.repo.listScanPages(scan.id);
    const issues = ctx.repo.listIssues(scan.id);
    const vm = buildReportViewModel({ user, site, scan, pages, issues });
    const shareRaw = (req.query as Record<string, unknown>)?.share;
    const shareToken = typeof shareRaw === "string" && /^[A-Za-z0-9_-]{10,64}$/.test(shareRaw) ? shareRaw : null;
    return reply.view(
      "scan.njk",
      baseView(req, ctx, {
        title: `${site.name} — scan report`,
        vm,
        site,
        scan,
        shareToken,
        shareCount: ctx.repo.countActiveShareLinks(scan.id),
        flash: takeFlash(req, reply),
      }),
    );
  });

  // ---------- branded print view + PDF ----------
  app.get("/scans/:id/pdf", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const user = req.currentUser!;
    const scan = ctx.repo.getScanForUser(user.id, idParam(req.params));
    if (!scan || scan.status !== "done") {
      setFlash(reply, "error", "The report PDF is available once a scan completes successfully.");
      return reply.redirect(scan ? `/scans/${scan.id}` : "/dashboard");
    }
    const site = ctx.repo.getSiteById(scan.site_id)!;
    const pages = ctx.repo.listScanPages(scan.id);
    const issues = ctx.repo.listIssues(scan.id);
    const vm = buildReportViewModel({ user, site, scan, pages, issues });
    try {
      const pdf = await renderReportPdf(vm, ctx);
      const fileName = `accessibility-report-${site.name.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}-${scan.id}.pdf`;
      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `attachment; filename="${fileName}"`)
        .send(pdf);
    } catch (err) {
      ctx.log(`pdf render failed for scan#${scan.id}: ${err instanceof Error ? err.stack : String(err)}`);
      setFlash(
        reply,
        "error",
        "The PDF couldn't be generated just now (the report page still works). Please try again in a minute.",
      );
      return reply.redirect(`/scans/${scan.id}`);
    }
  });

  // ---------- share links ----------
  app.post("/scans/:id/share", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const user = req.currentUser!;
    const scan = ctx.repo.getScanForUser(user.id, idParam(req.params));
    if (!scan || scan.status !== "done") {
      setFlash(reply, "error", "Share links are available once a scan completes successfully.");
      return reply.redirect(scan ? `/scans/${scan.id}` : "/dashboard");
    }
    if (!ctx.limiters.share.check(`share:${user.id}`)) {
      setFlash(reply, "error", "You've created a lot of share links recently. Give it an hour.");
      return reply.redirect(`/scans/${scan.id}`);
    }
    const token = generateToken(16);
    ctx.repo.createShareLink(scan.id, hashToken(token));
    setFlash(reply, "success", "Share link created — copy it below. Anyone with the link can view this report.");
    return reply.redirect(`/scans/${scan.id}?share=${token}`);
  });

  app.post("/scans/:id/share/revoke", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const scan = ctx.repo.getScanForUser(req.currentUser!.id, idParam(req.params));
    if (!scan) return reply.callNotFound();
    ctx.repo.revokeShareLinks(scan.id);
    setFlash(reply, "success", "All share links for this report were revoked.");
    return reply.redirect(`/scans/${scan.id}`);
  });

  // ---------- public shared report ----------
  app.get("/r/:token", async (req, reply) => {
    const token = String((req.params as Record<string, unknown>).token ?? "");
    const link = token.length <= 64 ? ctx.repo.getShareLink(hashToken(token)) : undefined;
    if (!link) {
      return reply.code(404).view("errors/404.njk", baseView(req, ctx, { title: "Report not found" }));
    }
    const scan = ctx.repo.getScanById(link.scan_id);
    if (!scan || scan.status !== "done") {
      return reply.code(404).view("errors/404.njk", baseView(req, ctx, { title: "Report not found" }));
    }
    const site = ctx.repo.getSiteById(scan.site_id)!;
    const owner = ctx.repo.getUserById(site.user_id)!;
    const pages = ctx.repo.listScanPages(scan.id);
    const issues = ctx.repo.listIssues(scan.id);
    const vm = buildReportViewModel({ user: owner, site, scan, pages, issues });
    reply.header("X-Robots-Tag", "noindex, nofollow");
    return reply.view("report-shared.njk", {
      vm,
      brand: "SiteRamp",
      shared: true,
      logoDataUri: owner.logo_path ? logoToDataUri(ctx.config.dataDir, owner.logo_path) : null,
    });
  });
}

function idParam(params: unknown): number {
  const raw = (params as Record<string, unknown>)?.id;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : -1;
}

function planInactiveMessage(reason: string): string {
  return reason === "trial_expired"
    ? "Your free trial has ended. Pick a plan to keep scanning — your sites and reports are saved."
    : "Your subscription is inactive. Update billing to keep scanning — your sites and reports are saved.";
}
