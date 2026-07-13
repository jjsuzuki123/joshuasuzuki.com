import { randomBytes } from "node:crypto";
import path from "node:path";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Public origin of the app, used in emails and share links. */
  BASE_URL: z.string().url().optional(),
  /** Directory for the SQLite database and uploaded files. */
  DATA_DIR: z.string().default("./data"),
  /** Secret for session/CSRF token HMACs. Required in production. */
  SESSION_SECRET: z.string().min(32).optional(),
  SUPPORT_EMAIL: z.string().email().default("support@example.com"),

  // Billing. Either configure Stripe fully or explicitly disable billing.
  BILLING_MODE: z.enum(["stripe", "disabled"]).default("disabled"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_SOLO: z.string().optional(),
  STRIPE_PRICE_STUDIO: z.string().optional(),

  // Outbound email (password resets, scan alerts). Optional; features degrade gracefully.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  // Scan engine tunables (sane defaults; override only for debugging).
  SCAN_PAGE_TIMEOUT_MS: z.coerce.number().int().min(5_000).default(30_000),
  SCAN_TOTAL_TIMEOUT_MS: z.coerce.number().int().min(60_000).default(15 * 60_000),
  SCAN_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
  /**
   * Allow scanning private/loopback addresses. For the local demo and tests
   * ONLY — ignored (forced off) in production for SSRF safety.
   */
  SCAN_ALLOW_PRIVATE: z.enum(["0", "1"]).default("0"),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${detail}`);
  }
  const raw = parsed.data;
  const isProd = raw.NODE_ENV === "production";

  if (isProd && !raw.SESSION_SECRET) {
    throw new Error(
      "SESSION_SECRET is required in production (32+ random characters). Generate one with: openssl rand -hex 32",
    );
  }
  if (isProd && !raw.BASE_URL) {
    throw new Error("BASE_URL is required in production, e.g. https://app.example.com");
  }

  const stripeConfigured = Boolean(
    raw.STRIPE_SECRET_KEY && raw.STRIPE_WEBHOOK_SECRET && raw.STRIPE_PRICE_SOLO && raw.STRIPE_PRICE_STUDIO,
  );
  if (raw.BILLING_MODE === "stripe" && !stripeConfigured) {
    throw new Error(
      "BILLING_MODE=stripe but Stripe is not fully configured. " +
        "Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_SOLO and STRIPE_PRICE_STUDIO — " +
        "or set BILLING_MODE=disabled (development only).",
    );
  }
  if (isProd && raw.BILLING_MODE === "disabled" && env.ALLOW_UNBILLED_PRODUCTION !== "yes") {
    throw new Error(
      "Refusing to start in production with billing disabled: every signup would get the product for free. " +
        "Configure Stripe (BILLING_MODE=stripe) or set ALLOW_UNBILLED_PRODUCTION=yes if this is intentional.",
    );
  }

  const smtpConfigured = Boolean(raw.SMTP_HOST && raw.SMTP_PORT && raw.SMTP_FROM);

  return {
    env: raw.NODE_ENV,
    isProd,
    host: raw.HOST,
    port: raw.PORT,
    baseUrl: raw.BASE_URL ?? `http://${raw.HOST}:${raw.PORT}`,
    dataDir: path.resolve(raw.DATA_DIR),
    sessionSecret: raw.SESSION_SECRET ?? randomBytes(32).toString("hex"),
    supportEmail: raw.SUPPORT_EMAIL,
    billing: {
      mode: raw.BILLING_MODE,
      stripeSecretKey: raw.STRIPE_SECRET_KEY,
      stripeWebhookSecret: raw.STRIPE_WEBHOOK_SECRET,
      priceSolo: raw.STRIPE_PRICE_SOLO,
      priceStudio: raw.STRIPE_PRICE_STUDIO,
    },
    smtp: smtpConfigured
      ? {
          host: raw.SMTP_HOST!,
          port: raw.SMTP_PORT!,
          user: raw.SMTP_USER,
          pass: raw.SMTP_PASS,
          from: raw.SMTP_FROM!,
        }
      : null,
    scan: {
      pageTimeoutMs: raw.SCAN_PAGE_TIMEOUT_MS,
      totalTimeoutMs: raw.SCAN_TOTAL_TIMEOUT_MS,
      concurrency: raw.SCAN_CONCURRENCY,
      allowPrivateTargets: raw.SCAN_ALLOW_PRIVATE === "1" && !isProd,
    },
  };
}
