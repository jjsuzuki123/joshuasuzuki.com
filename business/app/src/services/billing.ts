import Stripe from "stripe";
import type { AppConfig } from "../config.js";
import type { Repo, UserRow } from "../domain/repo.js";
import type { PlanId, PlanStatus } from "../domain/plans.js";

/**
 * Thin billing layer around Stripe Checkout + Billing Portal + webhooks.
 * The rest of the app only ever reads users.plan/plan_status — this module is
 * the only writer of those fields (besides trial setup at signup).
 */
export class Billing {
  private stripe: Stripe | null = null;
  readonly enabled: boolean;

  constructor(
    private readonly config: AppConfig,
    private readonly repo: Repo,
    private readonly log: (msg: string) => void,
  ) {
    this.enabled = config.billing.mode === "stripe";
    if (this.enabled) {
      this.stripe = new Stripe(config.billing.stripeSecretKey!);
    }
  }

  private priceFor(plan: Exclude<PlanId, "trial">): string {
    return plan === "solo" ? this.config.billing.priceSolo! : this.config.billing.priceStudio!;
  }

  planForPrice(priceId: string): Exclude<PlanId, "trial"> | null {
    if (priceId === this.config.billing.priceSolo) return "solo";
    if (priceId === this.config.billing.priceStudio) return "studio";
    return null;
  }

  /** Create (or reuse) the Stripe customer and open a Checkout session. */
  async createCheckoutUrl(user: UserRow, plan: Exclude<PlanId, "trial">): Promise<string> {
    if (!this.stripe) throw new Error("Billing is not configured.");
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        email: user.email,
        metadata: { siteramp_user_id: String(user.id) },
      });
      customerId = customer.id;
      this.repo.setStripeCustomer(user.id, customerId);
    }
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: this.priceFor(plan), quantity: 1 }],
      success_url: `${this.config.baseUrl}/billing?status=success`,
      cancel_url: `${this.config.baseUrl}/billing?status=canceled`,
      allow_promotion_codes: true,
      subscription_data: { metadata: { siteramp_user_id: String(user.id) } },
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    return session.url;
  }

  async createPortalUrl(user: UserRow): Promise<string> {
    if (!this.stripe) throw new Error("Billing is not configured.");
    if (!user.stripe_customer_id) throw new Error("No billing profile exists for this account yet.");
    const session = await this.stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${this.config.baseUrl}/billing`,
    });
    return session.url;
  }

  verifyWebhook(rawBody: Buffer, signature: string): Stripe.Event {
    if (!this.stripe) throw new Error("Billing is not configured.");
    return this.stripe.webhooks.constructEvent(rawBody, signature, this.config.billing.stripeWebhookSecret!);
  }

  /**
   * Apply a verified Stripe event to our user rows. Idempotent per event id
   * (webhook_events table). Unknown events are acknowledged and ignored.
   */
  async handleEvent(event: Stripe.Event): Promise<void> {
    if (!this.repo.recordWebhookEvent(event.id)) {
      this.log(`stripe: duplicate event ${event.id} ignored`);
      return;
    }
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        if (!customerId || !subscriptionId) return;
        await this.syncSubscription(customerId, subscriptionId);
        return;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        this.applySubscriptionObject(customerId, sub);
        return;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
        if (!customerId) return;
        const user = this.repo.getUserByStripeCustomer(customerId);
        if (user && user.plan !== "trial") {
          this.repo.applySubscription(user.id, {
            plan: user.plan,
            planStatus: "past_due",
            subscriptionId: user.stripe_subscription_id,
            currentPeriodEnd: user.current_period_end,
          });
          this.log(`stripe: user#${user.id} marked past_due`);
        }
        return;
      }
      default:
        return; // acknowledged, ignored
    }
  }

  private async syncSubscription(customerId: string, subscriptionId: string): Promise<void> {
    if (!this.stripe) return;
    const sub = await this.stripe.subscriptions.retrieve(subscriptionId);
    this.applySubscriptionObject(customerId, sub);
  }

  private applySubscriptionObject(customerId: string, sub: Stripe.Subscription): void {
    const user = this.repo.getUserByStripeCustomer(customerId);
    if (!user) {
      this.log(`stripe: no user for customer ${customerId}`);
      return;
    }
    const item = sub.items.data[0];
    const priceId = item?.price?.id ?? "";
    const plan = this.planForPrice(priceId);
    if (!plan) {
      this.log(`stripe: unknown price ${priceId} on subscription ${sub.id}`);
      return;
    }
    const status = mapStripeStatus(sub.status);
    // current_period_end moved to the item level in newer API versions; fall back defensively.
    const periodEnd =
      (item as unknown as { current_period_end?: number })?.current_period_end ??
      (sub as unknown as { current_period_end?: number }).current_period_end ??
      null;
    this.repo.applySubscription(user.id, {
      plan,
      planStatus: status,
      subscriptionId: sub.id,
      currentPeriodEnd: periodEnd,
    });
    this.log(`stripe: user#${user.id} → ${plan}/${status}`);
  }
}

export function mapStripeStatus(status: Stripe.Subscription.Status): PlanStatus {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete":
    case "incomplete_expired":
    case "paused":
      return "canceled";
    default:
      return "canceled";
  }
}
