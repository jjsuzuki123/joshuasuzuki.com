import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { baseView, setFlash, takeFlash, SESSION_COOKIE, type AppContext } from "../app.js";
import { passwordResetEmail } from "../services/mailer.js";

const credentialsSchema = z.object({
  email: z.string().max(300).default(""),
  password: z.string().max(300).default(""),
});

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const cookieOpts = {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: ctx.config.isProd,
    maxAge: 30 * 24 * 3600,
  };

  app.get("/signup", async (req, reply) => {
    if (req.currentUser) return reply.redirect("/dashboard");
    return reply.view("auth/signup.njk", baseView(req, ctx, { title: "Start your free trial" }));
  });

  app.post("/signup", async (req, reply) => {
    const ip = req.ip;
    if (!ctx.limiters.signup.check(`signup:${ip}`)) {
      return reply.view(
        "auth/signup.njk",
        baseView(req, ctx, {
          title: "Start your free trial",
          error: "Too many signups from this network right now. Please wait a few minutes and try again.",
        }),
      );
    }
    const body = credentialsSchema.parse(req.body ?? {});
    const result = await ctx.auth.signup(body.email, body.password);
    if (!result.ok || !result.sessionToken) {
      return reply.view(
        "auth/signup.njk",
        baseView(req, ctx, { title: "Start your free trial", error: result.error, email: body.email }),
      );
    }
    reply.setCookie(SESSION_COOKIE, result.sessionToken, cookieOpts);
    setFlash(reply, "success", "Welcome! Add your first site to run a scan.");
    return reply.redirect("/dashboard");
  });

  app.get("/login", async (req, reply) => {
    if (req.currentUser) return reply.redirect("/dashboard");
    return reply.view(
      "auth/login.njk",
      baseView(req, ctx, { title: "Log in", flash: takeFlash(req, reply), next: sanitizeNext((req.query as Record<string, unknown>)?.next) }),
    );
  });

  app.post("/login", async (req, reply) => {
    const ip = req.ip;
    if (!ctx.limiters.login.check(`login:${ip}`)) {
      const retry = ctx.limiters.login.retryAfterSeconds(`login:${ip}`);
      return reply.view(
        "auth/login.njk",
        baseView(req, ctx, {
          title: "Log in",
          error: `Too many login attempts. Please wait about ${Math.ceil(retry / 60)} minute(s) and try again.`,
        }),
      );
    }
    const body = credentialsSchema.parse(req.body ?? {});
    const result = await ctx.auth.login(body.email, body.password);
    if (!result.ok || !result.sessionToken) {
      return reply.view(
        "auth/login.njk",
        baseView(req, ctx, { title: "Log in", error: result.error, email: body.email }),
      );
    }
    reply.setCookie(SESSION_COOKIE, result.sessionToken, cookieOpts);
    const next = sanitizeNext((req.body as Record<string, unknown>)?.next);
    return reply.redirect(next ?? "/dashboard");
  });

  app.post("/logout", async (req, reply) => {
    ctx.auth.logout(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.redirect("/");
  });

  app.get("/forgot-password", async (req, reply) => {
    return reply.view(
      "auth/forgot.njk",
      baseView(req, ctx, { title: "Reset your password", emailEnabled: ctx.mailer.enabled }),
    );
  });

  app.post("/forgot-password", async (req, reply) => {
    const ip = req.ip;
    if (!ctx.limiters.forgot.check(`forgot:${ip}`)) {
      return reply.view(
        "auth/forgot.njk",
        baseView(req, ctx, {
          title: "Reset your password",
          error: "Too many reset requests. Please wait a few minutes and try again.",
        }),
      );
    }
    const body = credentialsSchema.pick({ email: true }).parse(req.body ?? {});
    if (ctx.mailer.enabled) {
      const created = ctx.auth.createPasswordResetToken(body.email);
      if (created) {
        const mail = passwordResetEmail(ctx.config.baseUrl, created.token);
        await ctx.mailer.send(created.user.email, mail.subject, mail.text);
      }
      // Same response either way: no account enumeration.
      return reply.view(
        "auth/forgot.njk",
        baseView(req, ctx, {
          title: "Reset your password",
          sent: true,
          email: body.email,
        }),
      );
    }
    return reply.view(
      "auth/forgot.njk",
      baseView(req, ctx, { title: "Reset your password", manualMode: true }),
    );
  });

  app.get("/reset-password", async (req, reply) => {
    const token = String((req.query as Record<string, unknown>)?.token ?? "");
    if (!token) return reply.redirect("/forgot-password");
    return reply.view("auth/reset.njk", baseView(req, ctx, { title: "Choose a new password", token }));
  });

  app.post("/reset-password", async (req, reply) => {
    const body = z
      .object({ token: z.string().max(300).default(""), password: z.string().max(300).default("") })
      .parse(req.body ?? {});
    const result = await ctx.auth.resetPassword(body.token, body.password);
    if (!result.ok || !result.sessionToken) {
      return reply.view(
        "auth/reset.njk",
        baseView(req, ctx, { title: "Choose a new password", token: body.token, error: result.error }),
      );
    }
    reply.setCookie(SESSION_COOKIE, result.sessionToken, cookieOpts);
    setFlash(reply, "success", "Password updated. You're logged in.");
    return reply.redirect("/dashboard");
  });
}

function sanitizeNext(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Internal paths only — never redirect off-site.
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value.length < 200 ? value : null;
}
