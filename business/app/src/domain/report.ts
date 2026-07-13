import type { IssueRow, ScanPageRow, ScanRow, SiteRow, UserRow } from "./repo.js";
import { IMPACT_ORDER, type Impact } from "./scoring.js";

/**
 * Plain-English guidance for the most common axe rules, written for the
 * agency's *client* to understand and the agency to act on. Rules without an
 * entry fall back to axe's own description + help URL.
 */
const RULE_GUIDANCE: Record<string, { title: string; why: string; fix: string }> = {
  "image-alt": {
    title: "Images are missing text alternatives",
    why: "Screen-reader users hear nothing useful for these images, so any information they carry is lost.",
    fix: "Add an alt attribute to every meaningful image describing what it shows. Purely decorative images should have an empty alt (alt=\"\").",
  },
  "color-contrast": {
    title: "Text doesn't have enough contrast against its background",
    why: "Low-contrast text is hard or impossible to read for people with low vision — and for anyone on a phone in sunlight.",
    fix: "Darken the text or lighten the background until the contrast ratio reaches at least 4.5:1 for normal text (3:1 for large text).",
  },
  label: {
    title: "Form fields have no label",
    why: "Without a label, assistive technology announces an anonymous box — users can't tell what to type.",
    fix: "Give every input a visible <label> element connected with the for attribute (or aria-label where a visible label truly can't work).",
  },
  "link-name": {
    title: "Links have no accessible name",
    why: "Screen readers announce these as just 'link', so users can't tell where they lead.",
    fix: "Ensure every link contains text (or an aria-label). For icon-only links, add descriptive text for assistive technology.",
  },
  "button-name": {
    title: "Buttons have no accessible name",
    why: "A button that announces as just 'button' is unusable with a screen reader.",
    fix: "Give every button visible text or an aria-label describing the action, e.g. 'Search' or 'Close menu'.",
  },
  "document-title": {
    title: "Pages are missing a title",
    why: "The page title is the first thing screen readers announce and what appears in tabs and search results.",
    fix: "Add a unique, descriptive <title> to each page.",
  },
  "html-has-lang": {
    title: "The page doesn't declare its language",
    why: "Screen readers use the language attribute to pick the right pronunciation. Without it, text can be read with the wrong voice entirely.",
    fix: "Add lang=\"en\" (or the site's actual language) to the <html> element.",
  },
  "meta-viewport": {
    title: "Zooming is disabled on mobile",
    why: "Blocking pinch-to-zoom prevents people with low vision from enlarging text.",
    fix: "Remove user-scalable=no and any maximum-scale limit from the viewport meta tag.",
  },
  "heading-order": {
    title: "Headings skip levels",
    why: "Screen-reader users navigate by heading structure; skipped levels make the page's outline confusing.",
    fix: "Use headings in order (h1 → h2 → h3) without skipping. Style them with CSS rather than picking a heading for its size.",
  },
  "landmark-one-main": {
    title: "The page has no main content landmark",
    why: "Landmarks let assistive-technology users jump straight to the content instead of tabbing through the whole header.",
    fix: "Wrap the primary content of each page in a <main> element.",
  },
  region: {
    title: "Content sits outside page landmarks",
    why: "Content outside landmarks is easy to miss when navigating by region.",
    fix: "Place all meaningful content inside semantic regions: <header>, <nav>, <main>, <footer>.",
  },
  "duplicate-id": {
    title: "Duplicate element IDs",
    why: "Assistive technologies and scripts rely on IDs being unique; duplicates cause labels and descriptions to attach to the wrong element.",
    fix: "Make every id attribute on the page unique.",
  },
  "aria-allowed-attr": {
    title: "Invalid ARIA attributes",
    why: "Incorrect ARIA confuses assistive technology more than having none at all.",
    fix: "Remove or correct the ARIA attributes flagged on these elements (see the referenced guideline for allowed attributes per role).",
  },
  "frame-title": {
    title: "Embedded frames have no title",
    why: "Screen readers announce iframes by their title; without one, users hear 'frame' with no context.",
    fix: "Add a descriptive title attribute to every <iframe> (e.g. 'Booking calendar').",
  },
  "select-name": {
    title: "Dropdowns have no accessible name",
    why: "An unlabeled dropdown gives no clue what is being chosen.",
    fix: "Attach a <label> to every <select> element.",
  },
  list: {
    title: "Malformed lists",
    why: "Screen readers announce list sizes and positions; broken markup makes navigation unpredictable.",
    fix: "Ensure <ul> and <ol> contain only <li> elements (and script/template elements).",
  },
  tabindex: {
    title: "Positive tabindex values",
    why: "Positive tabindex overrides the natural tab order, producing a keyboard order that jumps around the page.",
    fix: "Remove tabindex values greater than 0 and let the DOM order define tab order.",
  },
};

export interface RuleGroup {
  ruleId: string;
  impact: Impact;
  title: string;
  why: string;
  fix: string;
  helpUrl: string;
  wcagTags: string[];
  pages: Array<{ url: string; count: number; sampleSelector: string; sampleSnippet: string }>;
  totalCount: number;
}

export interface ReportViewModel {
  site: { name: string; origin: string };
  scan: ScanRow;
  branding: { agencyName: string; accentColor: string; logoPath: string | null };
  summary: {
    score: number | null;
    grade: string;
    totalIssues: number;
    counts: Record<Impact, number>;
    pagesOk: number;
    pagesFailed: number;
    newIssueCount: number;
    resolvedIssueCount: number;
    verdictLine: string;
  };
  topFixes: RuleGroup[];
  groupsByImpact: Array<{ impact: Impact; groups: RuleGroup[] }>;
  failedPages: Array<{ url: string; reason: string }>;
  okPages: Array<{ url: string; score: number | null; issueCount: number }>;
  generatedAt: number;
}

const IMPACT_WEIGHT: Record<Impact, number> = { critical: 4, serious: 3, moderate: 2, minor: 1 };

export function buildReportViewModel(input: {
  user: Pick<UserRow, "agency_name" | "accent_color" | "logo_path">;
  site: Pick<SiteRow, "name" | "origin">;
  scan: ScanRow;
  pages: ScanPageRow[];
  issues: IssueRow[];
}): ReportViewModel {
  const { user, site, scan, pages, issues } = input;
  const pageById = new Map<number, ScanPageRow>(pages.map((p) => [p.id, p]));

  // Group issues rule-first.
  const ruleMap = new Map<string, { impact: Impact; issues: IssueRow[] }>();
  for (const issue of issues) {
    const entry = ruleMap.get(issue.rule_id);
    if (entry) entry.issues.push(issue);
    else ruleMap.set(issue.rule_id, { impact: issue.impact, issues: [issue] });
  }

  const groups: RuleGroup[] = [];
  for (const [ruleId, { impact, issues: ruleIssues }] of ruleMap) {
    const byPage = new Map<number, IssueRow[]>();
    for (const i of ruleIssues) {
      const list = byPage.get(i.page_id) ?? [];
      list.push(i);
      byPage.set(i.page_id, list);
    }
    const guidance = RULE_GUIDANCE[ruleId];
    const sample = ruleIssues[0]!;
    groups.push({
      ruleId,
      impact,
      title: guidance?.title ?? sample.description,
      why: guidance?.why ?? "This pattern fails an accessibility guideline and can block some visitors from using the page.",
      fix: guidance?.fix ?? "See the linked guideline for how to correct the flagged elements.",
      helpUrl: sample.help_url,
      wcagTags: (sample.wcag_tags ?? "").split(",").filter(Boolean),
      pages: [...byPage.entries()]
        .map(([pageId, list]) => ({
          url: pageById.get(pageId)?.url ?? "",
          count: list.length,
          sampleSelector: list[0]!.selector,
          sampleSnippet: list[0]!.snippet,
        }))
        .sort((a, b) => b.count - a.count),
      totalCount: ruleIssues.length,
    });
  }

  const impactRank = (i: Impact) => IMPACT_ORDER.indexOf(i);
  groups.sort((a, b) => impactRank(a.impact) - impactRank(b.impact) || b.totalCount - a.totalCount);

  const topFixes = [...groups]
    .sort(
      (a, b) =>
        IMPACT_WEIGHT[b.impact] * b.pages.length - IMPACT_WEIGHT[a.impact] * a.pages.length ||
        b.totalCount - a.totalCount,
    )
    .slice(0, 5);

  const groupsByImpact = IMPACT_ORDER.map((impact) => ({
    impact,
    groups: groups.filter((g) => g.impact === impact),
  })).filter((g) => g.groups.length > 0);

  const counts: Record<Impact, number> = {
    critical: scan.critical_count,
    serious: scan.serious_count,
    moderate: scan.moderate_count,
    minor: scan.minor_count,
  };
  const totalIssues = counts.critical + counts.serious + counts.moderate + counts.minor;
  const pagesOk = pages.filter((p) => p.status === "ok").length;
  const pagesFailed = pages.filter((p) => p.status === "failed").length;

  return {
    site: { name: site.name, origin: site.origin },
    scan,
    branding: {
      agencyName: user.agency_name || "Your agency",
      accentColor: user.accent_color || "#1d4ed8",
      logoPath: user.logo_path,
    },
    summary: {
      score: scan.score,
      grade: scan.grade ?? "—",
      totalIssues,
      counts,
      pagesOk,
      pagesFailed,
      newIssueCount: scan.new_issue_count,
      resolvedIssueCount: scan.resolved_issue_count,
      verdictLine: verdictLine(scan.score, counts, pagesOk),
    },
    topFixes,
    groupsByImpact,
    failedPages: pages
      .filter((p) => p.status === "failed")
      .map((p) => ({ url: p.url, reason: p.fail_reason ?? "The page could not be checked." })),
    okPages: pages
      .filter((p) => p.status === "ok")
      .map((p) => ({
        url: p.url,
        score: p.score,
        issueCount: p.critical_count + p.serious_count + p.moderate_count + p.minor_count,
      })),
    generatedAt: Math.floor(Date.now() / 1000),
  };
}

function verdictLine(score: number | null, counts: Record<Impact, number>, pagesOk: number): string {
  if (score === null || pagesOk === 0) return "The scan could not produce a score for this site.";
  if (counts.critical > 0) {
    return `This site has ${counts.critical} critical accessibility ${counts.critical === 1 ? "problem" : "problems"} that will block some visitors outright. Fixing the critical and serious items below should be the immediate priority.`;
  }
  if (counts.serious > 0) {
    return `No show-stoppers were found, but ${counts.serious} serious ${counts.serious === 1 ? "issue makes" : "issues make"} parts of the site hard to use for some visitors. The fixes below are well within reach.`;
  }
  if (counts.moderate + counts.minor > 0) {
    return "The site is in good shape overall. The remaining items below are quality improvements rather than blockers.";
  }
  return "No issues were detected by the automated checks on the pages scanned. A manual review is still recommended for full coverage.";
}
