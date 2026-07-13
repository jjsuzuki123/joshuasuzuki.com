import { describe, expect, it } from "vitest";
import {
  extractLinks,
  extractSitemapLocs,
  isSameOrigin,
  looksLikeHtmlPage,
  normalizeUrl,
  parseTargetUrl,
  robotsDisallowsAll,
} from "../src/lib/urls.js";

describe("parseTargetUrl", () => {
  it("accepts bare domains and adds https", () => {
    const r = parseTargetUrl("example.com");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.origin).toBe("https://example.com");
      expect(r.value.startUrl).toBe("https://example.com/");
    }
  });
  it("keeps paths as the start URL", () => {
    const r = parseTargetUrl("https://example.com/shop/");
    expect(r.ok && r.value.startUrl).toBe("https://example.com/shop");
  });
  it("rejects garbage with a friendly message", () => {
    const r = parseTargetUrl("not a url at all");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/valid website address/i);
  });
  it("rejects non-http schemes", () => {
    expect(parseTargetUrl("ftp://example.com").ok).toBe(false);
    expect(parseTargetUrl("javascript:alert(1)").ok).toBe(false);
    expect(parseTargetUrl("file:///etc/passwd").ok).toBe(false);
  });
  it("rejects hostnames without a dot", () => {
    expect(parseTargetUrl("localhost").ok).toBe(false);
    expect(parseTargetUrl("http://intranet").ok).toBe(false);
  });
  it("rejects embedded credentials", () => {
    expect(parseTargetUrl("https://user:pass@example.com").ok).toBe(false);
  });
  it("strips default ports from the origin", () => {
    const r = parseTargetUrl("https://example.com:443/x");
    expect(r.ok && r.value.origin).toBe("https://example.com");
  });
  it("handles empty input", () => {
    expect(parseTargetUrl("").ok).toBe(false);
    expect(parseTargetUrl("   ").ok).toBe(false);
  });
});

describe("normalizeUrl", () => {
  const base = "https://example.com";
  it("strips fragments", () => {
    expect(normalizeUrl("https://example.com/a#section", base)).toBe("https://example.com/a");
  });
  it("strips tracking params but keeps real ones, sorted", () => {
    expect(normalizeUrl("https://example.com/p?utm_source=x&b=2&a=1&fbclid=y", base)).toBe(
      "https://example.com/p?a=1&b=2",
    );
  });
  it("collapses trailing slashes except root", () => {
    expect(normalizeUrl("https://example.com/about/", base)).toBe("https://example.com/about");
    expect(normalizeUrl("https://example.com/", base)).toBe("https://example.com/");
  });
  it("collapses duplicate slashes in the path", () => {
    expect(normalizeUrl("https://example.com//a///b", base)).toBe("https://example.com/a/b");
  });
  it("resolves relative URLs against the base", () => {
    expect(normalizeUrl("/contact", base)).toBe("https://example.com/contact");
  });
  it("returns null for non-http schemes", () => {
    expect(normalizeUrl("mailto:x@example.com", base)).toBeNull();
  });
});

describe("isSameOrigin", () => {
  it("matches scheme + host + port", () => {
    expect(isSameOrigin("https://example.com/x", "https://example.com")).toBe(true);
    expect(isSameOrigin("http://example.com/x", "https://example.com")).toBe(false);
    expect(isSameOrigin("https://sub.example.com/x", "https://example.com")).toBe(false);
    expect(isSameOrigin("https://example.com:8443/x", "https://example.com")).toBe(false);
  });
});

describe("looksLikeHtmlPage", () => {
  it("skips binary/asset extensions", () => {
    expect(looksLikeHtmlPage("https://example.com/brochure.pdf")).toBe(false);
    expect(looksLikeHtmlPage("https://example.com/logo.png")).toBe(false);
    expect(looksLikeHtmlPage("https://example.com/app.js")).toBe(false);
  });
  it("keeps pages and clean paths", () => {
    expect(looksLikeHtmlPage("https://example.com/about")).toBe(true);
    expect(looksLikeHtmlPage("https://example.com/page.html")).toBe(true);
    expect(looksLikeHtmlPage("https://example.com/")).toBe(true);
  });
});

describe("extractLinks", () => {
  const base = "https://example.com";
  it("finds same-origin links in various quote styles and resolves them", () => {
    const html = `
      <a href="/a">A</a>
      <a href='https://example.com/b?utm_source=news'>B</a>
      <a href=/c>C</a>
      <a href="https://other.com/x">off-site</a>
      <a href="mailto:hi@example.com">mail</a>
      <a href="#frag">frag</a>
      <a href="/file.pdf">pdf</a>
    `;
    const links = extractLinks(html, `${base}/`, base);
    expect(links.sort()).toEqual(["https://example.com/a", "https://example.com/b", "https://example.com/c"]);
  });
  it("de-duplicates normalized equivalents", () => {
    const html = `<a href="/a">1</a><a href="/a#x">2</a><a href="/a?utm_source=z">3</a>`;
    expect(extractLinks(html, `${base}/`, base)).toEqual(["https://example.com/a"]);
  });
  it("handles malformed HTML without throwing", () => {
    expect(() => extractLinks("<a href=", `${base}/`, base)).not.toThrow();
    expect(extractLinks("<a href='http://'>x</a>", `${base}/`, base)).toEqual([]);
  });
});

describe("extractSitemapLocs", () => {
  it("pulls same-origin locs only", () => {
    const xml = `<?xml version="1.0"?><urlset>
      <url><loc>https://example.com/one</loc></url>
      <url><loc> https://example.com/two </loc></url>
      <url><loc>https://evil.com/three</loc></url>
    </urlset>`;
    expect(extractSitemapLocs(xml, "https://example.com").sort()).toEqual([
      "https://example.com/one",
      "https://example.com/two",
    ]);
  });
});

describe("robotsDisallowsAll", () => {
  it("detects a global disallow", () => {
    expect(robotsDisallowsAll("User-agent: *\nDisallow: /")).toBe(true);
  });
  it("accepts sites that allow crawling", () => {
    expect(robotsDisallowsAll("User-agent: *\nDisallow:")).toBe(false);
    expect(robotsDisallowsAll("User-agent: *\nDisallow: /admin")).toBe(false);
    expect(robotsDisallowsAll("")).toBe(false);
  });
  it("respects agent-specific blocks for our bot", () => {
    expect(robotsDisallowsAll("User-agent: siterampbot\nDisallow: /")).toBe(true);
    expect(robotsDisallowsAll("User-agent: googlebot\nDisallow: /")).toBe(false);
  });
  it("allow / overrides", () => {
    expect(robotsDisallowsAll("User-agent: *\nAllow: /\nDisallow: /")).toBe(false);
  });
});
