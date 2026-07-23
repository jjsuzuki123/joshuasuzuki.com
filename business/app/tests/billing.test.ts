import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { makeTestWorld, type TestWorld } from "./helpers.js";
import { Billing, mapStripeStatus } from "../src/services/billing.js";
import { now } from "../src/db.js";

const WEBHOOK_SECRET = "whsec_test_secret_for_unit_tests";

let world: TestWorld;
beforeEach(async () => {
  world = await makeTestWorld({
    BILLING_MODE: "stripe",
    STRIPE_SECRET_KEY: "sk_test_dummy",
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_PRICE_SOLO: "price_solo_123",
    STRIPE_PRICE_STUDIO: "price_studio_456",
  });
});
afterEach(async () => {
  await world.cleanup();
});

function makeUser(): number {
  const user = world.repo.createUser("pay@er.com", "hash", now() + 86400);
  world.repo.setStripeCustomer(user.id, "cus_123");
  return user.id;
}

function subscriptionEvent(
  type: string,
  sub: Record<string, unknown>,
  id = `evt_${Math.random().toString(36).slice(2)}`,
): Stripe.Event {
  return { id, type, data: { object: sub } } as unknown as Stripe.Event;
}

function fakeSubscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sub_123",
    customer: "cus_123",
    status: "active",
    items: { data: [{ price: { id: "price_solo_123" }, current_period_end: now() + 30 * 86400 }] },
    ...overrides,
  };
}

describe("webhook signature verification", () => {
  it("accepts a correctly signed payload and rejects a tampered one", async () => {
    const billing = new Billing(world.config, world.repo, () => undefined);
    const payload = JSON.stringify(subscriptionEvent("customer.subscription.updated", fakeSubscription()));
    const stripe = new Stripe("sk_test_dummy");
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });

    const event = billing.verifyWebhook(Buffer.from(payload), header);
    expect(event.type).toBe("customer.subscription.updated");

    expect(() => billing.verifyWebhook(Buffer.from(payload + " "), header)).toThrow();
    const badHeader = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_wrong" });
    expect(() => billing.verifyWebhook(Buffer.from(payload), badHeader)).toThrow();
  });
});

describe("webhook event handling", () => {
  it("activates a plan from a subscription event", async () => {
    const userId = makeUser();
    const billing = new Billing(world.config, world.repo, () => undefined);
    await billing.handleEvent(subscriptionEvent("customer.subscription.updated", fakeSubscription()));
    const user = world.repo.getUserById(userId)!;
    expect(user.plan).toBe("solo");
    expect(user.plan_status).toBe("active");
    expect(user.stripe_subscription_id).toBe("sub_123");
    expect(user.current_period_end).toBeGreaterThan(now());
  });

  it("maps studio price and cancellation", async () => {
    const userId = makeUser();
    const billing = new Billing(world.config, world.repo, () => undefined);
    await billing.handleEvent(
      subscriptionEvent(
        "customer.subscription.updated",
        fakeSubscription({ items: { data: [{ price: { id: "price_studio_456" }, current_period_end: now() + 10 }] } }),
      ),
    );
    expect(world.repo.getUserById(userId)!.plan).toBe("studio");

    await billing.handleEvent(
      subscriptionEvent("customer.subscription.deleted", fakeSubscription({ status: "canceled" })),
    );
    const user = world.repo.getUserById(userId)!;
    expect(user.plan_status).toBe("canceled");
  });

  it("is idempotent per event id", async () => {
    const userId = makeUser();
    const billing = new Billing(world.config, world.repo, () => undefined);
    const evt = subscriptionEvent("customer.subscription.updated", fakeSubscription(), "evt_fixed");
    await billing.handleEvent(evt);
    // Tamper the same event id with a different plan — must be ignored.
    const evt2 = subscriptionEvent(
      "customer.subscription.updated",
      fakeSubscription({ items: { data: [{ price: { id: "price_studio_456" }, current_period_end: now() + 10 }] } }),
      "evt_fixed",
    );
    await billing.handleEvent(evt2);
    expect(world.repo.getUserById(userId)!.plan).toBe("solo");
  });

  it("marks past_due on payment failure", async () => {
    const userId = makeUser();
    const billing = new Billing(world.config, world.repo, () => undefined);
    await billing.handleEvent(subscriptionEvent("customer.subscription.updated", fakeSubscription()));
    await billing.handleEvent(
      subscriptionEvent("invoice.payment_failed", { customer: "cus_123" }),
    );
    expect(world.repo.getUserById(userId)!.plan_status).toBe("past_due");
  });

  it("ignores unknown prices and unknown customers without crashing", async () => {
    makeUser();
    const billing = new Billing(world.config, world.repo, () => undefined);
    await billing.handleEvent(
      subscriptionEvent(
        "customer.subscription.updated",
        fakeSubscription({ items: { data: [{ price: { id: "price_unknown" } }] } }),
      ),
    );
    await billing.handleEvent(
      subscriptionEvent("customer.subscription.updated", fakeSubscription({ customer: "cus_ghost" })),
    );
    expect(world.repo.getUserById(1)!.plan).toBe("trial"); // unchanged
  });
});

describe("HTTP webhook endpoint", () => {
  it("accepts signed events and rejects unsigned ones", async () => {
    makeUser();
    const payload = JSON.stringify(subscriptionEvent("customer.subscription.updated", fakeSubscription()));
    const stripe = new Stripe("sk_test_dummy");
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });

    const ok = await world.app.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: { "stripe-signature": header, "content-type": "application/json" },
      payload,
    });
    expect(ok.statusCode).toBe(200);
    expect(world.repo.getUserById(1)!.plan).toBe("solo");

    const bad = await world.app.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: { "content-type": "application/json" },
      payload,
    });
    expect(bad.statusCode).toBe(400);

    const tampered = await world.app.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: { "stripe-signature": header, "content-type": "application/json" },
      payload: payload.replace("solo", "stud"),
    });
    expect(tampered.statusCode).toBe(400);
  });
});

describe("mapStripeStatus", () => {
  it("maps statuses conservatively", () => {
    expect(mapStripeStatus("active")).toBe("active");
    expect(mapStripeStatus("trialing")).toBe("active");
    expect(mapStripeStatus("past_due")).toBe("past_due");
    expect(mapStripeStatus("unpaid")).toBe("past_due");
    expect(mapStripeStatus("canceled")).toBe("canceled");
    expect(mapStripeStatus("incomplete")).toBe("canceled");
    expect(mapStripeStatus("paused")).toBe("canceled");
  });
});
