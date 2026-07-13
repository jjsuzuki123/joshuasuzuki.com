import { describe, expect, it } from "vitest";
import { buildReportViewModel } from "../src/domain/report.js";
import type { IssueRow, ScanPageRow, ScanRow } from "../src/domain/repo.js";

function scanRow(overrides: Partial<ScanRow> = {}): ScanRow {
  return {
    id: 1,
    site_id: 1,
    status: "done",
    trigger_kind: "manual",
    started_at: 1000,
    finished_at: 2000,
    pages_crawled: 2,
    pages_failed: 1,
    score: 82,
    grade: "C",
    critical_count: 2,
    serious_count: 1,
    moderate_count: 0,
    minor_count: 0,
    new_issue_count: 3,
    resolved_issue_count: 0,
    error_message: null,
    created_at: 900,
    ...overrides,
  };
}

const pages: ScanPageRow[] = [
  { id: 1, scan_id: 1, url: "https://x.com/", status: "ok", fail_reason: null, score: 76, critical_count: 2, serious_count: 1, moderate_count: 0, minor_count: 0 },
  { id: 2, scan_id: 1, url: "https://x.com/about", status: "failed", fail_reason: "The page took too long to load (over the per-page time limit).", score: null, critical_count: 0, serious_count: 0, moderate_count: 0, minor_count: 0 },
];

const issues: IssueRow[] = [
  { id: 1, scan_id: 1, page_id: 1, fingerprint: "f1", rule_id: "image-alt", impact: "critical", selector: "img.hero", snippet: "<img src=x>", help_url: "https://dequeuniversity.com/rules/axe/image-alt", wcag_tags: "wcag2a,wcag111", description: "Images must have alternate text" },
  { id: 2, scan_id: 1, page_id: 1, fingerprint: "f2", rule_id: "image-alt", impact: "critical", selector: "img.logo", snippet: "<img src=y>", help_url: "https://dequeuniversity.com/rules/axe/image-alt", wcag_tags: "wcag2a,wcag111", description: "Images must have alternate text" },
  { id: 3, scan_id: 1, page_id: 1, fingerprint: "f3", rule_id: "color-contrast", impact: "serious", selector: "p.small", snippet: "<p>x</p>", help_url: "https://dequeuniversity.com/rules/axe/color-contrast", wcag_tags: "wcag2aa,wcag143", description: "Elements must meet contrast" },
];

const user = { agency_name: "Acme Studio", accent_color: "#123456", logo_path: null };
const site = { name: "Client Site", origin: "https://x.com" };

describe("buildReportViewModel", () => {
  it("groups issues by rule with counts and pages", () => {
    const vm = buildReportViewModel({ user, site, scan: scanRow(), pages, issues });
    expect(vm.groupsByImpact.length).toBe(2); // critical + serious
    const critical = vm.groupsByImpact[0]!;
    expect(critical.impact).toBe("critical");
    expect(critical.groups[0]!.ruleId).toBe("image-alt");
    expect(critical.groups[0]!.totalCount).toBe(2);
    expect(critical.groups[0]!.pages[0]!.count).toBe(2);
  });

  it("uses plain-English guidance for known rules", () => {
    const vm = buildReportViewModel({ user, site, scan: scanRow(), pages, issues });
    const group = vm.groupsByImpact[0]!.groups[0]!;
    expect(group.title).toMatch(/missing text alternatives/i);
    expect(group.fix).toMatch(/alt attribute/i);
  });

  it("falls back to axe descriptions for unknown rules", () => {
    const weird: IssueRow[] = [{ ...issues[0]!, rule_id: "some-new-rule", description: "Custom axe help text" }];
    const vm = buildReportViewModel({ user, site, scan: scanRow(), pages, issues: weird });
    expect(vm.groupsByImpact[0]!.groups[0]!.title).toBe("Custom axe help text");
  });

  it("ranks top fixes by impact × spread", () => {
    const vm = buildReportViewModel({ user, site, scan: scanRow(), pages, issues });
    expect(vm.topFixes[0]!.ruleId).toBe("image-alt");
    expect(vm.topFixes.length).toBeLessThanOrEqual(5);
  });

  it("lists failed pages with their reasons", () => {
    const vm = buildReportViewModel({ user, site, scan: scanRow(), pages, issues });
    expect(vm.failedPages).toEqual([
      { url: "https://x.com/about", reason: "The page took too long to load (over the per-page time limit)." },
    ]);
  });

  it("writes an honest verdict for critical findings", () => {
    const vm = buildReportViewModel({ user, site, scan: scanRow(), pages, issues });
    expect(vm.summary.verdictLine).toMatch(/2 critical/);
  });

  it("celebrates a clean scan without overclaiming", () => {
    const clean = scanRow({ critical_count: 0, serious_count: 0, moderate_count: 0, minor_count: 0 });
    const vm = buildReportViewModel({
      user,
      site,
      scan: clean,
      pages: [pages[0]!],
      issues: [],
    });
    expect(vm.summary.verdictLine).toMatch(/manual review is still recommended/i);
  });

  it("defaults branding when unset", () => {
    const vm = buildReportViewModel({
      user: { agency_name: "", accent_color: "", logo_path: null },
      site,
      scan: scanRow(),
      pages,
      issues,
    });
    expect(vm.branding.agencyName).toBe("Your agency");
    expect(vm.branding.accentColor).toBe("#1d4ed8");
  });
});
