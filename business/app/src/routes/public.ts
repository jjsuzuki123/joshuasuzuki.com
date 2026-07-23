import type { FastifyInstance } from "fastify";
import { baseView, type AppContext } from "../app.js";
import { PLANS } from "../domain/plans.js";

export function registerPublicRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/", async (req, reply) => {
    if (req.currentUser) return reply.redirect("/dashboard");
    return reply.view(
      "landing.njk",
      baseView(req, ctx, {
        title: "Accessibility reports your clients can actually read",
        plans: PLANS,
        deleted: String((req.query as Record<string, unknown>)?.deleted ?? "") === "1",
      }),
    );
  });

  app.get("/legal/terms", async (req, reply) => {
    return reply.view("legal/terms.njk", baseView(req, ctx, { title: "Terms of Service" }));
  });

  app.get("/legal/privacy", async (req, reply) => {
    return reply.view("legal/privacy.njk", baseView(req, ctx, { title: "Privacy Policy" }));
  });
}
