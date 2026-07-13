import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyFormbody from "@fastify/formbody";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyView from "@fastify/view";
import nunjucks from "nunjucks";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "./config.js";
import type { DB } from "./db.js";
import { Repo, type UserRow } from "./domain/repo.js";
import { AuthService } from "./services/auth.js";
import { Billing } from "./services/billing.js";
import { Mailer } from "./services/mailer.js";
import { ScanQueue } from "./scanner/queue.js";
import { computeEntitlement, type Entitlement } from "./domain/plans.js";
import { generateToken, safeEqual } from "./lib/crypto.js";
import { RateLimiter } from "./lib/ratelimit.js";
import { now } from "./db.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerBillingRoutes } from "./routes/billing.js";
import { registerPublicRoutes } from "./routes/public.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AppContext {
  config: AppConfig;
  db: DB;
  repo: Repo;
  auth: AuthService;
  billing: Billing;
  mailer: Mailer;
  queue: ScanQueue;
  log: (msg: string) => void;
  limiters: {
    login: RateLimiter;
    signup: RateLimiter;
    forgot: RateLimiter;
    scan: RateLimiter;
    share: RateLimiter;
  };
}

declare module "fastify" {
  interface FastifyRequest {
    currentUser: UserRow | null;
    entitlement: Entitlement | null;
    csrfToken: string;
  }
}

export const SESSION_COOKIE = "siteramp_session";
export const CSRF_COOKIE = "siteramp_csrf";
export const FLASH_COOKIE = "siteramp_flash";

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    trustProxy: true, // deployed behind Caddy/nginx
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(fastifyCookie);
  await app.register(fastifyFormbody);
  await app.register(fastifyMultipart, {
    limits: { fileSize: 1024 * 1024, files: 1, fields: 20 },
  });

  const templateDir = path.join(__dirname, "views");
  const nunjucksEnv = new nunjucks.Environment(new nunjucks.FileSystemLoader(templateDir), {
    autoescape: true,
    noCache: !ctx.config.isProd,
  });
  nunjucksEnv.addFilter("datetime", (unixSeconds: number | null) => {
    if (!unixSeconds) return "—";
    return new Date(unixSeconds * 1000).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    });
  });
  nunjucksEnv.addFilter("dateonly", (unixSeconds: number | null) => {
    if (!unixSeconds) return "—";
    return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  });
  nunjucksEnv.addFilter("hostname", (url: string) => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  });
  nunjucksEnv.addFilter("pathOf", (url: string) => {
    try {
      const u = new URL(url);
      return u.pathname + u.search || "/";
    } catch {
      return url;
    }
  });

  await app.register(fastifyView, {
    engine: { nunjucks },
    root: templateDir,
    viewExt: "njk",
    options: {
      onConfigure: (env: nunjucks.Environment) => {
        // Copy our filters onto the environment fastify-view actually uses.
        for (const name of ["datetime", "dateonly", "hostname", "pathOf"]) {
          env.addFilter(name, (nunjucksEnv.getFilter(name) as (...args: unknown[]) => unknown));
        }
      },
    },
  });

  await app.register(fastifyStatic, {
    root: path.join(__dirname, "public"),
    prefix: "/public/",
    maxAge: ctx.config.isProd ? "7d" : 0,
  });

  const logosDir = path.join(ctx.config.dataDir, "logos");
  fs.mkdirSync(logosDir, { recursive: true });
  await app.register(fastifyStatic, {
    root: logosDir,
    prefix: "/uploads/logos/",
    decorateReply: false,
    maxAge: "1d",
  });

  app.decorateRequest("currentUser", null);
  app.decorateRequest("entitlement", null);
  app.decorateRequest("csrfToken", "");

  // ---- request plumbing: session, CSRF, security headers ----
  app.addHook("onRequest", async (req, reply) => {
    // Session
    const token = req.cookies[SESSION_COOKIE];
    const resolved = ctx.auth.resolveSession(token);
    if (resolved) {
      req.currentUser = resolved.user;
      req.entitlement = computeEntitlement(
        {
          plan: resolved.user.plan,
          planStatus: resolved.user.plan_status,
          trialEndsAt: resolved.user.trial_ends_at,
          currentPeriodEnd: resolved.user.current_period_end,
        },
        now(),
      );
    }

    // CSRF (double-submit cookie). Ensure a token exists for everyone.
    let csrf = req.cookies[CSRF_COOKIE];
    if (!csrf || csrf.length !== 43) {
      csrf = generateToken(32);
      reply.setCookie(CSRF_COOKIE, csrf, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: ctx.config.isProd,
        maxAge: 60 * 60 * 24 * 90,
      });
    }
    req.csrfToken = csrf;

    // Security headers
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "same-origin");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (ctx.config.isProd) {
      reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  });

  // CSRF verification for all mutating requests except the Stripe webhook.
  app.addHook("preHandler", async (req, reply) => {
    if (req.method !== "POST" && req.method !== "PUT" && req.method !== "DELETE") return;
    if (req.url.startsWith("/webhooks/")) return;

    // Origin/Referer check (defense in depth).
    const origin = req.headers.origin ?? req.headers.referer;
    if (origin) {
      try {
        const originHost = new URL(String(origin)).host;
        const expectedHost = new URL(ctx.config.baseUrl).host;
        const requestHost = req.headers.host;
        if (originHost !== expectedHost && originHost !== requestHost) {
          return reply.code(403).view("errors/403.njk", baseView(req, ctx, { title: "Blocked" }));
        }
      } catch {
        return reply.code(403).view("errors/403.njk", baseView(req, ctx, { title: "Blocked" }));
      }
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const submitted = typeof body._csrf === "string" ? body._csrf : "";
    const cookie = req.cookies[CSRF_COOKIE] ?? "";
    // Multipart forms attach fields differently; the settings route re-checks.
    if (req.isMultipart?.()) return;
    if (!submitted || !cookie || !safeEqual(submitted, cookie)) {
      return reply
        .code(403)
        .view("errors/403.njk", baseView(req, ctx, { title: "Form expired" }));
    }
  });

  // ---- error handling ----
  app.setNotFoundHandler((req, reply) => {
    return reply.code(404).view("errors/404.njk", baseView(req, ctx, { title: "Page not found" }));
  });
  app.setErrorHandler((err: unknown, req, reply) => {
    // Body/file too large or bad content type → friendly message, not a stack trace.
    const statusCode = (err as { statusCode?: unknown })?.statusCode;
    const status = typeof statusCode === "number" && statusCode >= 400 ? statusCode : 500;
    const detail = err instanceof Error ? (status >= 500 ? (err.stack ?? err.message) : err.message) : String(err);
    ctx.log(`error ${req.method} ${req.url} → ${status}: ${detail}`);
    if (status === 413) {
      return reply
        .code(413)
        .view("errors/error.njk", baseView(req, ctx, {
          title: "Upload too large",
          message: "That file is too large. Logos must be under 1 MB.",
        }));
    }
    return reply.code(status).view("errors/error.njk", baseView(req, ctx, {
      title: "Something went wrong",
      message:
        "Something went wrong on our side. Your data is safe. Please try again — and if this keeps happening, email " +
        ctx.config.supportEmail +
        ".",
    }));
  });

  // ---- routes ----
  registerPublicRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  registerDashboardRoutes(app, ctx);
  registerSettingsRoutes(app, ctx);
  registerBillingRoutes(app, ctx);

  app.get("/healthz", async () => ({ ok: true }));

  return app;
}

/** Common template context: user, flash, csrf, brand. */
export function baseView(
  req: FastifyRequest,
  ctx: AppContext,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    brand: "SiteRamp",
    supportEmail: ctx.config.supportEmail,
    baseUrl: ctx.config.baseUrl,
    user: req.currentUser,
    entitlement: req.entitlement,
    billingEnabled: ctx.billing.enabled,
    emailEnabled: ctx.mailer.enabled,
    csrfToken: req.csrfToken,
    currentPath: req.url,
    ...extra,
  };
}

/** One-shot flash message via cookie (survives a redirect). */
export function setFlash(reply: FastifyReply, kind: "success" | "error", message: string): void {
  reply.setCookie(FLASH_COOKIE, JSON.stringify({ kind, message }), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60,
  });
}

export function takeFlash(req: FastifyRequest, reply: FastifyReply): { kind: string; message: string } | null {
  const raw = req.cookies[FLASH_COOKIE];
  if (!raw) return null;
  reply.clearCookie(FLASH_COOKIE, { path: "/" });
  try {
    const parsed = JSON.parse(raw) as { kind?: string; message?: string };
    if (typeof parsed.message === "string") {
      return { kind: parsed.kind === "error" ? "error" : "success", message: parsed.message };
    }
  } catch {
    /* ignore malformed flash */
  }
  return null;
}

export function requireAuth(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!req.currentUser) {
    void reply.redirect("/login?next=" + encodeURIComponent(req.url));
    return false;
  }
  return true;
}
