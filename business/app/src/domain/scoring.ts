import { createHash } from "node:crypto";

export type Impact = "critical" | "serious" | "moderate" | "minor";

export const IMPACT_ORDER: Impact[] = ["critical", "serious", "moderate", "minor"];

/**
 * Score weights per violation impact. Chosen so a handful of critical issues
 * clearly tanks a page, while minor issues nudge it. Deterministic and
 * documented in the report footer.
 */
const IMPACT_PENALTY: Record<Impact, number> = {
  critical: 12,
  serious: 6,
  moderate: 2,
  minor: 0.5,
};

/** Diminishing returns: repeated instances of the same rule matter less. */
export function pageScore(violations: Array<{ impact: Impact; ruleId: string }>): number {
  const byRule = new Map<string, { impact: Impact; count: number }>();
  for (const v of violations) {
    const cur = byRule.get(v.ruleId);
    if (cur) cur.count += 1;
    else byRule.set(v.ruleId, { impact: v.impact, count: 1 });
  }
  let penalty = 0;
  for (const { impact, count } of byRule.values()) {
    // First instance full price, subsequent instances at 25%.
    penalty += IMPACT_PENALTY[impact] * (1 + 0.25 * (count - 1));
  }
  return Math.max(0, Math.round(100 - penalty));
}

export function siteScore(pageScores: number[]): number | null {
  if (pageScores.length === 0) return null;
  const mean = pageScores.reduce((a, b) => a + b, 0) / pageScores.length;
  return Math.round(mean);
}

export function grade(score: number | null): string {
  if (score === null) return "—";
  if (score >= 95) return "A";
  if (score >= 85) return "B";
  if (score >= 70) return "C";
  if (score >= 50) return "D";
  return "F";
}

/**
 * Stable identity of an issue across scans of the same site:
 * same rule on the same (normalized) page at the same DOM location.
 * Components are length-prefixed so crafted values can't collide across the
 * component boundaries.
 */
export function issueFingerprint(ruleId: string, normalizedUrl: string, selector: string): string {
  const packed = [ruleId, normalizedUrl, selector]
    .map((part) => `${Buffer.byteLength(part, "utf8")}:${part}`)
    .join("|");
  return createHash("sha256").update(packed, "utf8").digest("hex").slice(0, 32);
}

export interface DiffResult {
  newFingerprints: Set<string>;
  resolvedFingerprints: Set<string>;
  persistingFingerprints: Set<string>;
}

export function diffIssues(previous: Iterable<string>, current: Iterable<string>): DiffResult {
  const prev = new Set(previous);
  const cur = new Set(current);
  const newFingerprints = new Set<string>();
  const resolvedFingerprints = new Set<string>();
  const persistingFingerprints = new Set<string>();
  for (const f of cur) {
    if (prev.has(f)) persistingFingerprints.add(f);
    else newFingerprints.add(f);
  }
  for (const f of prev) {
    if (!cur.has(f)) resolvedFingerprints.add(f);
  }
  return { newFingerprints, resolvedFingerprints, persistingFingerprints };
}
