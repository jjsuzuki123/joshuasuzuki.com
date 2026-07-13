export type PlanId = "trial" | "solo" | "studio";
export type PlanStatus = "trialing" | "active" | "past_due" | "canceled";

export interface PlanLimits {
  label: string;
  maxSites: number;
  maxPagesPerScan: number;
  schedulesAllowed: ReadonlyArray<"off" | "weekly" | "monthly">;
  priceMonthlyUsd: number;
}

export const PLANS: Record<PlanId, PlanLimits> = {
  trial: {
    label: "Free trial",
    maxSites: 10,
    maxPagesPerScan: 25,
    schedulesAllowed: ["off", "weekly", "monthly"],
    priceMonthlyUsd: 0,
  },
  solo: {
    label: "Solo",
    maxSites: 10,
    maxPagesPerScan: 25,
    schedulesAllowed: ["off", "weekly", "monthly"],
    priceMonthlyUsd: 29,
  },
  studio: {
    label: "Studio",
    maxSites: 30,
    maxPagesPerScan: 100,
    schedulesAllowed: ["off", "weekly", "monthly"],
    priceMonthlyUsd: 59,
  },
};

export const TRIAL_DAYS = 7;

export interface EntitlementInput {
  plan: PlanId;
  planStatus: PlanStatus;
  trialEndsAt: number; // unix seconds
  currentPeriodEnd: number | null; // unix seconds
}

export interface Entitlement {
  active: boolean;
  reason: "trialing" | "subscribed" | "trial_expired" | "subscription_ended" | "past_due_grace";
  limits: PlanLimits;
  planId: PlanId;
  /** days left on trial (0 when not trialing) */
  trialDaysLeft: number;
}

const PAST_DUE_GRACE_SECONDS = 7 * 24 * 3600;

/**
 * The single source of truth for "can this account use the product right now,
 * and at what limits". Pure and unit-tested.
 */
export function computeEntitlement(input: EntitlementInput, nowSec: number): Entitlement {
  const limits = PLANS[input.plan];

  if (input.plan === "trial") {
    if (nowSec <= input.trialEndsAt) {
      const trialDaysLeft = Math.max(0, Math.ceil((input.trialEndsAt - nowSec) / 86_400));
      return { active: true, reason: "trialing", limits, planId: "trial", trialDaysLeft };
    }
    return { active: false, reason: "trial_expired", limits, planId: "trial", trialDaysLeft: 0 };
  }

  // Paid plans.
  if (input.planStatus === "active") {
    return { active: true, reason: "subscribed", limits, planId: input.plan, trialDaysLeft: 0 };
  }
  if (input.planStatus === "past_due") {
    // Stripe retries payment for a while; keep the product working during a short grace
    // window so a flaky card doesn't interrupt scheduled monitoring.
    const periodEnd = input.currentPeriodEnd ?? 0;
    if (nowSec <= periodEnd + PAST_DUE_GRACE_SECONDS) {
      return { active: true, reason: "past_due_grace", limits, planId: input.plan, trialDaysLeft: 0 };
    }
    return { active: false, reason: "subscription_ended", limits, planId: input.plan, trialDaysLeft: 0 };
  }
  // 'canceled' — active until the end of the already-paid period.
  if (input.currentPeriodEnd && nowSec <= input.currentPeriodEnd) {
    return { active: true, reason: "subscribed", limits, planId: input.plan, trialDaysLeft: 0 };
  }
  return { active: false, reason: "subscription_ended", limits, planId: input.plan, trialDaysLeft: 0 };
}
