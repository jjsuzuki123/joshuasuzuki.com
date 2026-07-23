import { describe, expect, it } from "vitest";
import { discoverPages } from "../src/scanner/crawler.js";

/** fetch stub serving an in-memory site map of path → {html|xml, status}. */
function siteFetch(routes: Record<string, { body: string; type?: string; status?: number }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const route = routes[url.pathname + url.search];
    if (!route) {
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    }
    return new Response(route.body, {
      status: route.status ?? 200,
      headers: { "content-type": route.type ?? "text/html" },
    });
  }) as typeof fetch;
}

const ORIGIN = "https://site.test";

describe("discoverPages", () => {
  it("seeds from sitemap.xml and follows links, respecting the cap", async () => {
    const routes: Record<string, { body: string; type?: string }> = {
      "/sitemap.xml": {
        body: `<urlset><url><loc>${ORIGIN}/from-sitemap</loc></url></urlset>`,
        type: "application/xml",
      },
      "/": { body: `<a href="/a">a</a><a href="/b">b</a>` },
      "/a": { body: `<a href="/c">c</a>` },
      "/b": { body: `` },
      "/c": { body: `` },
      "/from-sitemap": { body: `` },
    };
    const result = await discoverPages({
      startUrl: `${ORIGIN}/`,
      origin: ORIGIN,
      maxPages: 10,
      fetchImpl: siteFetch(routes),
      allowPrivateTargets: true, // skip DNS for .test domain
    });
    expect(result.urls).toContain(`${ORIGIN}/`);
    expect(result.urls).toContain(`${ORIGIN}/from-sitemap`);
    expect(result.urls).toContain(`${ORIGIN}/a`);
    expect(result.urls).toContain(`${ORIGIN}/c`);
    expect(result.capped).toBe(false);
  });

  it("caps page count and reports it", async () => {
    const links = Array.from({ length: 30 }, (_, i) => `<a href="/p${i}">${i}</a>`).join("");
    const routes: Record<string, { body: string }> = { "/": { body: links } };
    for (let i = 0; i < 30; i++) routes[`/p${i}`] = { body: "" };
    const result = await discoverPages({
      startUrl: `${ORIGIN}/`,
      origin: ORIGIN,
      maxPages: 5,
      fetchImpl: siteFetch(routes),
      allowPrivateTargets: true,
    });
    expect(result.urls.length).toBe(5);
    expect(result.capped).toBe(true);
  });

  it("survives a missing sitemap and broken pages", async () => {
    const routes = {
      "/": { body: `<a href="/works">x</a><a href="/broken">y</a>` },
      "/works": { body: "" },
      "/broken": { body: "boom", status: 500 },
    };
    const result = await discoverPages({
      startUrl: `${ORIGIN}/`,
      origin: ORIGIN,
      maxPages: 10,
      fetchImpl: siteFetch(routes),
      allowPrivateTargets: true,
    });
    expect(result.urls).toContain(`${ORIGIN}/works`);
    expect(result.urls).toContain(`${ORIGIN}/broken`); // still scanned; failure surfaces per-page later
  });

  it("never leaves the origin", async () => {
    const routes = {
      "/": { body: `<a href="https://evil.test/x">evil</a><a href="/ok">ok</a>` },
      "/ok": { body: "" },
    };
    const result = await discoverPages({
      startUrl: `${ORIGIN}/`,
      origin: ORIGIN,
      maxPages: 10,
      fetchImpl: siteFetch(routes),
      allowPrivateTargets: true,
    });
    expect(result.urls.every((u) => u.startsWith(ORIGIN))).toBe(true);
  });

  it("rejects private targets when not allowed", async () => {
    await expect(
      discoverPages({
        startUrl: "https://127.0.0.1/",
        origin: "https://127.0.0.1",
        maxPages: 5,
        fetchImpl: siteFetch({}),
      }),
    ).rejects.toThrow(/private or internal/i);
  });

  it("follows one level of sitemap indexes", async () => {
    const routes = {
      "/sitemap.xml": {
        body: `<sitemapindex><sitemap><loc>${ORIGIN}/sitemap-pages.xml</loc></sitemap></sitemapindex>`,
        type: "application/xml",
      },
      "/sitemap-pages.xml": {
        body: `<urlset><url><loc>${ORIGIN}/deep-page</loc></url></urlset>`,
        type: "application/xml",
      },
      "/": { body: "" },
      "/deep-page": { body: "" },
    };
    const result = await discoverPages({
      startUrl: `${ORIGIN}/`,
      origin: ORIGIN,
      maxPages: 10,
      fetchImpl: siteFetch(routes),
      allowPrivateTargets: true,
    });
    expect(result.urls).toContain(`${ORIGIN}/deep-page`);
  });
});
