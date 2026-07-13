import { describe, expect, it } from "vitest";
import { computeEntitlement } from "../src/domain/plans.js";

const NOW = 1_800_000_000;

describe("computeEntitlement — trial", () => {
  it("is active during the trial with day countdown", () => {
    const e = computeEntitlement(
      { plan: "trial", planStatus: "trialing", trialEndsAt: NOW + 3 * 86400, currentPeriodEnd: null },
      NOW,
    );
    expect(e.active).toBe(true);
    expect(e.reason).toBe("trialing");
    expect(e.trialDaysLeft).toBe(3);
    expect(e.limits.maxSites).toBe(10);
  });
  it("expires the moment the trial ends", () => {
    const e = computeEntitlement(
      { plan: "trial", planStatus: "trialing", trialEndsAt: NOW - 1, currentPeriodEnd: null },
      NOW,
    );
    expect(e.active).toBe(false);
    expect(e.reason).toBe("trial_expired");
  });
  it("is active on the exact final second", () => {
    const e = computeEntitlement(
      { plan: "trial", planStatus: "trialing", trialEndsAt: NOW, currentPeriodEnd: null },
      NOW,
    );
    expect(e.active).toBe(true);
  });
});

describe("computeEntitlement — paid", () => {
  it("active subscription works", () => {
    const e = computeEntitlement(
      { plan: "studio", planStatus: "active", trialEndsAt: 0, currentPeriodEnd: NOW + 86400 },
      NOW,
    );
    expect(e.active).toBe(true);
    expect(e.reason).toBe("subscribed");
    expect(e.limits.maxSites).toBe(30);
    expect(e.limits.maxPagesPerScan).toBe(100);
  });
  it("past_due keeps working through the grace window", () => {
    const e = computeEntitlement(
      { plan: "solo", planStatus: "past_due", trialEndsAt: 0, currentPeriodEnd: NOW - 3 * 86400 },
      NOW,
    );
    expect(e.active).toBe(true);
    expect(e.reason).toBe("past_due_grace");
  });
  it("past_due dies after the grace window", () => {
    const e = computeEntitlement(
      { plan: "solo", planStatus: "past_due", trialEndsAt: 0, currentPeriodEnd: NOW - 8 * 86400 },
      NOW,
    );
    expect(e.active).toBe(false);
    expect(e.reason).toBe("subscription_ended");
  });
  it("canceled stays active until the paid period ends", () => {
    const stillPaid = computeEntitlement(
      { plan: "solo", planStatus: "canceled", trialEndsAt: 0, currentPeriodEnd: NOW + 5 * 86400 },
      NOW,
    );
    expect(stillPaid.active).toBe(true);
    const lapsed = computeEntitlement(
      { plan: "solo", planStatus: "canceled", trialEndsAt: 0, currentPeriodEnd: NOW - 1 },
      NOW,
    );
    expect(lapsed.active).toBe(false);
  });
  it("canceled with no period end is inactive", () => {
    const e = computeEntitlement(
      { plan: "solo", planStatus: "canceled", trialEndsAt: 0, currentPeriodEnd: null },
      NOW,
    );
    expect(e.active).toBe(false);
  });
});
