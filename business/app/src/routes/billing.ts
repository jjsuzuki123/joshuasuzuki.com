import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { baseView, requireAuth, setFlash, takeFlash, type AppContext } from "../app.js";
import { PLANS } from "../domain/plans.js";

export function registerBillingRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/billing", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const status = String((req.query as Record<string, unknown>)?.status ?? "");
    return reply.view(
      "billing.njk",
      baseView(req, ctx, {
        title: "Billing",
        plans: PLANS,
        checkoutStatus: status,
        flash: takeFlash(req, reply),
      }),
    );
  });

  app.post("/billing/checkout", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    if (!ctx.billing.enabled) {
      setFlash(reply, "error", "Billing isn't configured on this installation.");
      return reply.redirect("/billing");
    }
    const body = z.object({ plan: z.enum(["solo", "studio"]) }).safeParse(req.body ?? {});
    if (!body.success) {
      setFlash(reply, "error", "Please choose a plan.");
      return reply.redirect("/billing");
    }
    try {
      const url = await ctx.billing.createCheckoutUrl(req.currentUser!, body.data.plan);
      return reply.redirect(url);
    } catch (err) {
      ctx.log(`checkout failed user#${req.currentUser!.id}: ${err instanceof Error ? err.message : String(err)}`);
      setFlash(reply, "error", "We couldn't open the checkout just now. Please try again in a minute.");
      return reply.redirect("/billing");
    }
  });

  app.post("/billing/portal", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    if (!ctx.billing.enabled) {
      setFlash(reply, "error", "Billing isn't configured on this installation.");
      return reply.redirect("/billing");
    }
    try {
      const url = await ctx.billing.createPortalUrl(req.currentUser!);
      return reply.redirect(url);
    } catch (err) {
      ctx.log(`portal failed user#${req.currentUser!.id}: ${err instanceof Error ? err.message : String(err)}`);
      setFlash(
        reply,
        "error",
        "We couldn't open the billing portal. If you haven't subscribed yet, there's nothing to manage — otherwise try again shortly.",
      );
      return reply.redirect("/billing");
    }
  });

  // Stripe webhook: raw body + signature verification, CSRF-exempt by path.
  app.route({
    method: "POST",
    url: "/webhooks/stripe",
    config: { rawBody: true },
    // Fastify parses JSON by default; we need raw bytes for signature check.
    preParsing: async (req, _reply, payload) => {
      const chunks: Buffer[] = [];
      for await (const chunk of payload) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks);
      (req as unknown as { rawBodyBuffer: Buffer }).rawBodyBuffer = raw;
      const { Readable } = await import("node:stream");
      return Readable.from(raw);
    },
    handler: async (req, reply) => {
      if (!ctx.billing.enabled) return reply.code(503).send({ error: "billing_disabled" });
      const signature = req.headers["stripe-signature"];
      const raw = (req as unknown as { rawBodyBuffer?: Buffer }).rawBodyBuffer;
      if (!signature || typeof signature !== "string" || !raw) {
        return reply.code(400).send({ error: "missing_signature" });
      }
      let event;
      try {
        event = ctx.billing.verifyWebhook(raw, signature);
      } catch {
        ctx.log("stripe webhook: signature verification failed");
        return reply.code(400).send({ error: "invalid_signature" });
      }
      try {
        await ctx.billing.handleEvent(event);
      } catch (err) {
        ctx.log(`stripe webhook handling failed (${event.type}): ${err instanceof Error ? err.stack : String(err)}`);
        return reply.code(500).send({ error: "handler_error" }); // Stripe will retry
      }
      return reply.send({ received: true });
    },
  });
}
