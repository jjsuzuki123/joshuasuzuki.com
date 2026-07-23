import type { FastifyInstance } from "fastify";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import argon2 from "argon2";
import { baseView, requireAuth, setFlash, takeFlash, SESSION_COOKIE, type AppContext } from "../app.js";
import { passwordSchema } from "../services/auth.js";
import { safeEqual, generateToken } from "../lib/crypto.js";

const ACCENT_RE = /^#[0-9a-fA-F]{6}$/;

export function registerSettingsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/settings", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return reply.view(
      "settings.njk",
      baseView(req, ctx, { title: "Settings", flash: takeFlash(req, reply) }),
    );
  });

  // Branding form is multipart (logo upload) — CSRF is validated here manually
  // because the global hook skips multipart bodies.
  app.post("/settings/branding", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const user = req.currentUser!;

    let agencyName = user.agency_name;
    let accentColor = user.accent_color;
    let csrf = "";
    let uploadedName: string | null = null;
    let uploadError: string | null = null;
    let removeLogo = false;

    try {
      const parts = req.parts();
      for await (const part of parts) {
        if (part.type === "field") {
          if (part.fieldname === "agency_name") agencyName = String(part.value).slice(0, 120);
          if (part.fieldname === "accent_color") accentColor = String(part.value).slice(0, 7);
          if (part.fieldname === "_csrf") csrf = String(part.value);
          if (part.fieldname === "remove_logo" && String(part.value) === "1") removeLogo = true;
        } else if (part.type === "file" && part.fieldname === "logo") {
          if (!part.filename) {
            // Empty file input — drain and ignore.
            await part.toBuffer();
            continue;
          }
          const buf = await part.toBuffer().catch(() => null);
          if (!buf) {
            uploadError = "That logo file could not be read. Logos must be under 1 MB.";
            continue;
          }
          const kind = sniffImage(buf);
          if (!kind) {
            uploadError = "Logos must be PNG or JPEG images.";
            continue;
          }
          const name = `${user.id}-${generateToken(8)}.${kind}`;
          fs.writeFileSync(path.join(ctx.config.dataDir, "logos", name), buf);
          uploadedName = name;
        }
      }
    } catch (err) {
      // Multipart limits exceeded (file too large etc.)
      ctx.log(`branding upload error user#${user.id}: ${err instanceof Error ? err.message : String(err)}`);
      setFlash(reply, "error", "That upload didn't work — logos must be PNG or JPEG under 1 MB.");
      return reply.redirect("/settings");
    }

    const cookie = req.cookies["siteramp_csrf"] ?? "";
    if (!csrf || !cookie || !safeEqual(csrf, cookie)) {
      return reply.code(403).view("errors/403.njk", baseView(req, ctx, { title: "Form expired" }));
    }

    if (!ACCENT_RE.test(accentColor)) accentColor = "#1d4ed8";
    ctx.repo.updateUserProfile(user.id, agencyName.trim(), accentColor);

    if (removeLogo && !uploadedName) {
      deleteLogoFile(ctx, user.logo_path);
      ctx.repo.updateUserLogo(user.id, null);
    } else if (uploadedName) {
      deleteLogoFile(ctx, user.logo_path);
      ctx.repo.updateUserLogo(user.id, uploadedName);
    }

    if (uploadError) setFlash(reply, "error", `Branding saved, but the logo wasn't updated: ${uploadError}`);
    else setFlash(reply, "success", "Branding saved. New reports will use it immediately.");
    return reply.redirect("/settings");
  });

  app.post("/settings/password", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const user = req.currentUser!;
    const body = z
      .object({ current_password: z.string().max(300).default(""), new_password: z.string().max(300).default("") })
      .parse(req.body ?? {});
    const valid = await argon2.verify(user.password_hash, body.current_password).catch(() => false);
    if (!valid) {
      setFlash(reply, "error", "Your current password didn't match.");
      return reply.redirect("/settings");
    }
    const parsed = passwordSchema.safeParse(body.new_password);
    if (!parsed.success) {
      setFlash(reply, "error", parsed.error.issues[0]!.message);
      return reply.redirect("/settings");
    }
    const hash = await argon2.hash(parsed.data, { type: argon2.argon2id });
    ctx.repo.updateUserPassword(user.id, hash);
    // Keep this session, drop all others.
    ctx.repo.deleteSessionsForUser(user.id);
    const token = ctx.auth.createSession(user.id);
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: ctx.config.isProd,
      maxAge: 30 * 24 * 3600,
    });
    setFlash(reply, "success", "Password changed. Other devices were logged out.");
    return reply.redirect("/settings");
  });

  app.post("/settings/delete-account", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const user = req.currentUser!;
    const body = z.object({ confirm_email: z.string().max(300).default("") }).parse(req.body ?? {});
    if (body.confirm_email.trim().toLowerCase() !== user.email) {
      setFlash(reply, "error", "Type your account email exactly to confirm deletion.");
      return reply.redirect("/settings");
    }
    if (ctx.billing.enabled && user.stripe_subscription_id && user.plan_status === "active") {
      setFlash(
        reply,
        "error",
        "You have an active subscription. Cancel it first from the Billing page (Manage billing), then delete the account.",
      );
      return reply.redirect("/settings");
    }
    deleteLogoFile(ctx, user.logo_path);
    ctx.repo.deleteUser(user.id); // cascades to sites/scans/issues/sessions
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.redirect("/?deleted=1");
  });
}

function deleteLogoFile(ctx: AppContext, logoPath: string | null): void {
  if (!logoPath) return;
  try {
    fs.unlinkSync(path.join(ctx.config.dataDir, "logos", path.basename(logoPath)));
  } catch {
    /* already gone */
  }
}

/** Magic-byte check: PNG or JPEG only. Returns extension or null. */
function sniffImage(buf: Buffer): "png" | "jpg" | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  return null;
}
