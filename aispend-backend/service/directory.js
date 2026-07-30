"use strict";

function cleanText(value, maximum = 200) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function normalizeCompanyDomain(value) {
  let raw = cleanText(value, 300).toLowerCase();
  if (!raw) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(raw)) {
    try {
      raw = new URL(raw).hostname;
    } catch (_error) {
      return null;
    }
  }
  raw = raw.split("/")[0].split("?")[0].split("#")[0];
  raw = raw.replace(/^www\./, "").replace(/^\.+|\.+$/g, "");
  if (raw.includes("@") || raw.includes(":") || raw.length > 253) return null;
  const labels = raw.split(".");
  if (labels.length < 2) return null;
  if (!labels.every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    return null;
  }
  if (labels.every((label) => /^\d+$/.test(label))) return null;
  const multi = new Set(["co.uk", "com.au", "co.nz", "co.jp", "com.br", "co.in", "co.za", "com.sg"]);
  const lastTwo = labels.slice(-2).join(".");
  const keep = multi.has(lastTwo) ? 3 : 2;
  if (labels.length < keep) return null;
  return labels.slice(-keep).join(".");
}

// Curated name → domain map for instant GTM lookups. Kept small and
// deterministic so typeahead works offline and unknown names fall through
// to GitHub/web resolution in the worker.
const COMPANIES = [
  ["Stripe", "stripe.com"],
  ["Vercel", "vercel.com"],
  ["Linear", "linear.app"],
  ["Notion", "notion.so"],
  ["Figma", "figma.com"],
  ["GitHub", "github.com"],
  ["GitLab", "gitlab.com"],
  ["Datadog", "datadoghq.com"],
  ["Snowflake", "snowflake.com"],
  ["Databricks", "databricks.com"],
  ["Cloudflare", "cloudflare.com"],
  ["Fastly", "fastly.com"],
  ["Twilio", "twilio.com"],
  ["Shopify", "shopify.com"],
  ["Square", "squareup.com"],
  ["Block", "block.xyz"],
  ["Coinbase", "coinbase.com"],
  ["Robinhood", "robinhood.com"],
  ["Plaid", "plaid.com"],
  ["Brex", "brex.com"],
  ["Ramp", "ramp.com"],
  ["Rippling", "rippling.com"],
  ["Gusto", "gusto.com"],
  ["Deel", "deel.com"],
  ["Remote", "remote.com"],
  ["Mercury", "mercury.com"],
  ["AngelList", "angellist.com"],
  ["Wellfound", "wellfound.com"],
  ["OpenAI", "openai.com"],
  ["Anthropic", "anthropic.com"],
  ["Cohere", "cohere.com"],
  ["Hugging Face", "huggingface.co"],
  ["Perplexity", "perplexity.ai"],
  ["Scale AI", "scale.com"],
  ["Cognition", "cognition.ai"],
  ["Anysphere", "cursor.com"],
  ["Cursor", "cursor.com"],
  ["Replit", "replit.com"],
  ["Sourcegraph", "sourcegraph.com"],
  ["PlanetScale", "planetscale.com"],
  ["Neon", "neon.tech"],
  ["Supabase", "supabase.com"],
  ["MongoDB", "mongodb.com"],
  ["Elastic", "elastic.co"],
  ["HashiCorp", "hashicorp.com"],
  ["Docker", "docker.com"],
  ["Kubernetes", "kubernetes.io"],
  ["Red Hat", "redhat.com"],
  ["Canonical", "canonical.com"],
  ["Atlassian", "atlassian.com"],
  ["Asana", "asana.com"],
  ["Monday.com", "monday.com"],
  ["Airtable", "airtable.com"],
  ["Coda", "coda.io"],
  ["Loom", "loom.com"],
  ["Zoom", "zoom.us"],
  ["Slack", "slack.com"],
  ["Discord", "discord.com"],
  ["Dropbox", "dropbox.com"],
  ["Box", "box.com"],
  ["Adobe", "adobe.com"],
  ["Salesforce", "salesforce.com"],
  ["HubSpot", "hubspot.com"],
  ["Zendesk", "zendesk.com"],
  ["Intercom", "intercom.com"],
  ["Segment", "segment.com"],
  ["Amplitude", "amplitude.com"],
  ["Mixpanel", "mixpanel.com"],
  ["Pendo", "pendo.io"],
  ["LaunchDarkly", "launchdarkly.com"],
  ["Statsig", "statsig.com"],
  ["Split", "split.io"],
  ["Sentry", "sentry.io"],
  ["PagerDuty", "pagerduty.com"],
  ["Grafana", "grafana.com"],
  ["Netflix", "netflix.com"],
  ["Spotify", "spotify.com"],
  ["Uber", "uber.com"],
  ["Lyft", "lyft.com"],
  ["Airbnb", "airbnb.com"],
  ["DoorDash", "doordash.com"],
  ["Instacart", "instacart.com"],
  ["Snap", "snap.com"],
  ["Pinterest", "pinterest.com"],
  ["Reddit", "reddit.com"],
  ["Twitter", "x.com"],
  ["X", "x.com"],
  ["Meta", "meta.com"],
  ["Facebook", "meta.com"],
  ["Google", "google.com"],
  ["Alphabet", "abc.xyz"],
  ["Microsoft", "microsoft.com"],
  ["Amazon", "amazon.com"],
  ["Apple", "apple.com"],
  ["Nvidia", "nvidia.com"],
  ["Tesla", "tesla.com"],
  ["SpaceX", "spacex.com"],
  ["Palantir", "palantir.com"],
  ["Anduril", "anduril.com"],
  ["Rivian", "rivian.com"],
  ["The New York Times", "nytimes.com"],
  ["Washington Post", "washingtonpost.com"],
  ["Bloomberg", "bloomberg.com"],
  ["Vox Media", "voxmedia.com"],
  ["Condé Nast", "condenast.com"],
  ["Disney", "disney.com"],
  ["Warner Bros", "wbd.com"],
  ["Comcast", "comcast.com"],
  ["Verizon", "verizon.com"],
  ["AT&T", "att.com"],
  ["Walmart", "walmart.com"],
  ["Target", "target.com"],
  ["Costco", "costco.com"],
  ["Nike", "nike.com"],
  ["Starbucks", "starbucks.com"],
  ["McDonald's", "mcdonalds.com"],
  ["JPMorgan", "jpmorganchase.com"],
  ["Goldman Sachs", "goldmansachs.com"],
  ["Morgan Stanley", "morganstanley.com"],
  ["Capital One", "capitalone.com"],
  ["American Express", "americanexpress.com"],
  ["Visa", "visa.com"],
  ["Mastercard", "mastercard.com"],
  ["PayPal", "paypal.com"],
  ["Intuit", "intuit.com"],
  ["Adobe", "adobe.com"],
  ["Oracle", "oracle.com"],
  ["SAP", "sap.com"],
  ["IBM", "ibm.com"],
  ["Cisco", "cisco.com"],
  ["Intel", "intel.com"],
  ["AMD", "amd.com"],
  ["Qualcomm", "qualcomm.com"],
  ["ServiceNow", "servicenow.com"],
  ["Workday", "workday.com"],
  ["Okta", "okta.com"],
  ["CrowdStrike", "crowdstrike.com"],
  ["Zscaler", "zscaler.com"],
  ["Cloudflare", "cloudflare.com"],
  ["Twitch", "twitch.tv"],
  ["Roblox", "roblox.com"],
  ["Unity", "unity.com"],
  ["Epic Games", "epicgames.com"],
  ["Duolingo", "duolingo.com"],
  ["Coursera", "coursera.org"],
  ["Khan Academy", "khanacademy.org"],
  ["Canva", "canva.com"],
  ["Grammarly", "grammarly.com"],
  ["Zapier", "zapier.com"],
  ["Airbyte", "airbyte.com"],
  ["dbt Labs", "getdbt.com"],
  ["Fivetran", "fivetran.com"],
  ["Hex", "hex.tech"],
  ["Observable", "observablehq.com"],
  ["Retool", "retool.com"],
  ["Temporal", "temporal.io"],
  ["Pulumi", "pulumi.com"],
  ["Tailscale", "tailscale.com"],
  ["1Password", "1password.com"],
  ["LastPass", "lastpass.com"],
  ["Notion Labs", "notion.so"],
];

function uniqueCompanies() {
  const seen = new Set();
  const out = [];
  for (const [name, domain] of COMPANIES) {
    const normalized = normalizeCompanyDomain(domain);
    if (!normalized || seen.has(`${name.toLowerCase()}|${normalized}`)) continue;
    seen.add(`${name.toLowerCase()}|${normalized}`);
    out.push({ name, domain: normalized });
  }
  return out;
}

const DIRECTORY = uniqueCompanies();

const SCALE_BY_DOMAIN = {
  "stripe.com": { employees: 8500, engineers: 3200 },
  "vercel.com": { employees: 700, engineers: 380 },
  "linear.app": { employees: 100, engineers: 60 },
  "notion.so": { employees: 800, engineers: 280 },
  "figma.com": { employees: 1600, engineers: 600 },
  "github.com": { employees: 4000, engineers: 1800 },
  "gitlab.com": { employees: 2200, engineers: 900 },
  "datadoghq.com": { employees: 6500, engineers: 2400 },
  "snowflake.com": { employees: 7500, engineers: 2800 },
  "databricks.com": { employees: 6000, engineers: 2600 },
  "cloudflare.com": { employees: 4000, engineers: 1600 },
  "twilio.com": { employees: 5500, engineers: 1800 },
  "shopify.com": { employees: 11000, engineers: 3500 },
  "coinbase.com": { employees: 4000, engineers: 1500 },
  "openai.com": { employees: 3500, engineers: 1600 },
  "anthropic.com": { employees: 2000, engineers: 900 },
  "cursor.com": { employees: 200, engineers: 140 },
  "anysphere.com": { employees: 200, engineers: 140 },
  "google.com": { employees: 180000, engineers: 50000 },
  "microsoft.com": { employees: 220000, engineers: 60000 },
  "amazon.com": { employees: 1500000, engineers: 80000 },
  "apple.com": { employees: 160000, engineers: 40000 },
  "meta.com": { employees: 70000, engineers: 28000 },
  "netflix.com": { employees: 13000, engineers: 3500 },
  "uber.com": { employees: 30000, engineers: 8000 },
  "airbnb.com": { employees: 7000, engineers: 2200 },
  "spotify.com": { employees: 10000, engineers: 2800 },
  "salesforce.com": { employees: 70000, engineers: 15000 },
  "adobe.com": { employees: 30000, engineers: 8000 },
  "nvidia.com": { employees: 30000, engineers: 12000 },
  "plaid.com": { employees: 1500, engineers: 600 },
  "brex.com": { employees: 1200, engineers: 450 },
  "ramp.com": { employees: 1000, engineers: 400 },
  "rippling.com": { employees: 2500, engineers: 800 },
  "atlassian.com": { employees: 12000, engineers: 4000 },
  "okta.com": { employees: 5500, engineers: 1800 },
  "crowdstrike.com": { employees: 8000, engineers: 2500 },
  "discord.com": { employees: 800, engineers: 400 },
  "slack.com": { employees: 2500, engineers: 900 },
  "dropbox.com": { employees: 2500, engineers: 900 },
  "reddit.com": { employees: 2500, engineers: 900 },
  "pinterest.com": { employees: 4000, engineers: 1400 },
  "mongodb.com": { employees: 5000, engineers: 1800 },
  "hashicorp.com": { employees: 2000, engineers: 800 },
  "elastic.co": { employees: 3000, engineers: 1100 },
  "doordash.com": { employees: 19000, engineers: 4500 },
  "lyft.com": { employees: 4500, engineers: 1400 },
  "paypal.com": { employees: 27000, engineers: 6000 },
};

function lookupCompanyScale(domain) {
  const normalized = normalizeCompanyDomain(domain) || String(domain || "").toLowerCase();
  const scale = SCALE_BY_DOMAIN[normalized];
  if (!scale) return null;
  return { ...scale, source: "directory" };
}

function normalizeQuery(value) {
  return cleanText(value, 200)
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=_`~()'"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugifyCompanyName(value) {
  return normalizeQuery(value)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 40);
}

function scoreMatch(company, query) {
  const name = company.name.toLowerCase();
  const domain = company.domain;
  const owner = domain.split(".")[0];
  if (name === query || domain === query || owner === query) return 100;
  if (name.startsWith(query) || owner.startsWith(query)) return 80;
  if (name.includes(query) || domain.includes(query)) return 60;
  const tokens = query.split(" ").filter((part) => part.length > 1);
  if (tokens.length > 1 && tokens.every((token) => name.includes(token))) {
    return 70;
  }
  return 0;
}

function suggestCompanies(rawQuery, limit = 6) {
  const query = normalizeQuery(rawQuery);
  if (!query || query.length < 1) return [];
  const asDomain = normalizeCompanyDomain(rawQuery);
  const results = [];
  if (asDomain) {
    results.push({
      name: asDomain.split(".")[0],
      domain: asDomain,
      source: "domain",
      score: 100,
    });
  }
  for (const company of DIRECTORY) {
    const score = scoreMatch(company, query);
    if (score <= 0) continue;
    if (results.some((entry) => entry.domain === company.domain && entry.name === company.name)) {
      continue;
    }
    results.push({ ...company, source: "directory", score });
  }
  results.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
  const deduped = [];
  const seenDomains = new Set();
  for (const entry of results) {
    if (seenDomains.has(entry.domain) && entry.source !== "domain") continue;
    if (entry.source !== "domain") seenDomains.add(entry.domain);
    deduped.push({
      name: entry.name,
      domain: entry.domain,
      source: entry.source,
    });
    if (deduped.length >= limit) break;
  }
  return deduped;
}

function resolveCompanyQuery(rawQuery) {
  const query = cleanText(rawQuery, 200);
  if (!query) return null;
  const asDomain = normalizeCompanyDomain(query);
  if (asDomain) {
    return {
      query,
      domain: asDomain,
      companyName: asDomain.split(".")[0],
      source: "domain",
    };
  }
  const suggestions = suggestCompanies(query, 3);
  if (suggestions[0]?.source === "directory" && suggestions[0].domain) {
    const exact =
      suggestions.find(
        (entry) => entry.name.toLowerCase() === normalizeQuery(query)
      ) || suggestions[0];
    return {
      query,
      domain: exact.domain,
      companyName: exact.name,
      source: "directory",
      suggestions,
    };
  }
  return {
    query,
    domain: null,
    companyName: query,
    source: "unresolved",
    suggestions,
    slug: slugifyCompanyName(query),
  };
}

module.exports = {
  DIRECTORY,
  SCALE_BY_DOMAIN,
  lookupCompanyScale,
  normalizeQuery,
  resolveCompanyQuery,
  slugifyCompanyName,
  suggestCompanies,
};
