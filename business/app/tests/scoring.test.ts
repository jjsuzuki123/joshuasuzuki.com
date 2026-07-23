import { describe, expect, it } from "vitest";
import { diffIssues, grade, issueFingerprint, pageScore, siteScore } from "../src/domain/scoring.js";

describe("pageScore", () => {
  it("gives 100 for a clean page", () => {
    expect(pageScore([])).toBe(100);
  });
  it("penalizes by impact", () => {
    expect(pageScore([{ impact: "critical", ruleId: "image-alt" }])).toBe(88);
    expect(pageScore([{ impact: "serious", ruleId: "color-contrast" }])).toBe(94);
    expect(pageScore([{ impact: "moderate", ruleId: "region" }])).toBe(98);
    expect(pageScore([{ impact: "minor", ruleId: "x" }])).toBe(100); // 0.5 rounds away
  });
  it("discounts repeats of the same rule", () => {
    // 1st critical = 12, next two at 25% (3 each) → 100 - 18 = 82
    const violations = Array.from({ length: 3 }, () => ({ impact: "critical" as const, ruleId: "image-alt" }));
    expect(pageScore(violations)).toBe(82);
  });
  it("never goes below zero", () => {
    const violations = Array.from({ length: 100 }, (_, i) => ({
      impact: "critical" as const,
      ruleId: `rule-${i}`,
    }));
    expect(pageScore(violations)).toBe(0);
  });
  it("is deterministic regardless of order", () => {
    const a = [
      { impact: "critical" as const, ruleId: "a" },
      { impact: "minor" as const, ruleId: "b" },
    ];
    expect(pageScore(a)).toBe(pageScore([...a].reverse()));
  });
});

describe("siteScore + grade", () => {
  it("averages and rounds", () => {
    expect(siteScore([100, 80])).toBe(90);
    expect(siteScore([88])).toBe(88);
    expect(siteScore([])).toBeNull();
  });
  it("maps to grade bands", () => {
    expect(grade(100)).toBe("A");
    expect(grade(95)).toBe("A");
    expect(grade(94)).toBe("B");
    expect(grade(85)).toBe("B");
    expect(grade(84)).toBe("C");
    expect(grade(70)).toBe("C");
    expect(grade(69)).toBe("D");
    expect(grade(50)).toBe("D");
    expect(grade(49)).toBe("F");
    expect(grade(0)).toBe("F");
    expect(grade(null)).toBe("—");
  });
});

describe("issueFingerprint", () => {
  it("is stable for identical inputs", () => {
    expect(issueFingerprint("image-alt", "https://x.com/a", "img.hero")).toBe(
      issueFingerprint("image-alt", "https://x.com/a", "img.hero"),
    );
  });
  it("differs when any component differs", () => {
    const base = issueFingerprint("image-alt", "https://x.com/a", "img.hero");
    expect(issueFingerprint("link-name", "https://x.com/a", "img.hero")).not.toBe(base);
    expect(issueFingerprint("image-alt", "https://x.com/b", "img.hero")).not.toBe(base);
    expect(issueFingerprint("image-alt", "https://x.com/a", "img.other")).not.toBe(base);
  });
  it("does not collide via delimiter injection", () => {
    expect(issueFingerprint("a\nb", "c", "d")).not.toBe(issueFingerprint("a", "b\nc", "d"));
  });
});

describe("diffIssues", () => {
  it("classifies new, resolved, persisting", () => {
    const diff = diffIssues(["a", "b", "c"], ["b", "c", "d"]);
    expect([...diff.newFingerprints]).toEqual(["d"]);
    expect([...diff.resolvedFingerprints]).toEqual(["a"]);
    expect([...diff.persistingFingerprints].sort()).toEqual(["b", "c"]);
  });
  it("handles first scans (everything new)", () => {
    const diff = diffIssues([], ["a", "b"]);
    expect(diff.newFingerprints.size).toBe(2);
    expect(diff.resolvedFingerprints.size).toBe(0);
  });
  it("handles duplicates in input", () => {
    const diff = diffIssues(["a", "a"], ["a", "a", "b"]);
    expect(diff.newFingerprints.size).toBe(1);
    expect(diff.persistingFingerprints.size).toBe(1);
  });
});
