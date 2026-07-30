"use strict";

const { cleanText, normalizeCompanyDomain } = require("./core.js");

const GITHUB_API_BASE = "https://api.github.com";
const MAX_RESPONSE_BYTES = 2_000_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_TOTAL_CALLS = 40;
const MAX_ORGS_AUTHENTICATED = 2;
const MAX_ORGS_UNAUTHENTICATED = 1;

const ORG_LOGIN_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/;

// Public, deterministic adoption markers per vendor. Code and commit search
// require an authenticated token; issue/PR search also works anonymously.
const CODE_SIGNALS = [
  {
    id: "claudeMdFiles",
    vendor: "claude-code",
    metric: "CLAUDE.md files in public repos",
    query: (login) => `org:${login} filename:CLAUDE.md`,
  },
  {
    id: "claudeSettings",
    vendor: "claude-code",
    metric: ".claude configuration files",
    query: (login) => `org:${login} path:.claude filename:settings.json`,
  },
  {
    id: "cursorRulesFiles",
    vendor: "cursor",
    metric: ".cursorrules files in public repos",
    query: (login) => `org:${login} filename:.cursorrules`,
  },
  {
    id: "cursorRulesDir",
    vendor: "cursor",
    metric: ".cursor/rules files in public repos",
    query: (login) => `org:${login} path:.cursor/rules`,
  },
  {
    id: "agentsMdFiles",
    vendor: "openai",
    metric: "AGENTS.md files in public repos",
    query: (login) => `org:${login} filename:AGENTS.md`,
  },
  {
    id: "copilotInstructions",
    vendor: "github-copilot",
    metric: "copilot-instructions.md files",
    query: (login) => `org:${login} filename:copilot-instructions.md`,
  },
];

const COMMIT_SIGNALS = [
  {
    id: "claudeCoauthoredCommits",
    vendor: "claude-code",
    metric: "Commits co-authored by Claude",
    query: (login) => `org:${login} "co-authored-by: claude"`,
  },
  {
    id: "cursorCoauthoredCommits",
    vendor: "cursor",
    metric: "Commits co-authored by Cursor Agent",
    query: (login) => `org:${login} "co-authored-by: cursor agent"`,
  },
];

const PR_SIGNALS = [
  {
    id: "devinPrs",
    vendor: "devin",
    metric: "Pull requests opened by Devin",
    query: (login) => `org:${login} type:pr author:app/devin-ai-integration`,
  },
  {
    id: "copilotAgentPrs",
    vendor: "github-copilot",
    metric: "Pull requests opened by Copilot coding agent",
    query: (login) => `org:${login} type:pr author:app/copilot-swe-agent`,
  },
  {
    id: "cursorAgentPrs",
    vendor: "cursor",
    metric: "Pull requests opened by Cursor agents",
    query: (login) => `org:${login} type:pr author:app/cursor`,
  },
  {
    id: "claudeAppPrs",
    vendor: "claude-code",
    metric: "Pull requests opened by the Claude GitHub app",
    query: (login) => `org:${login} type:pr author:app/claude`,
  },
  {
    id: "codexConnectorPrs",
    vendor: "openai",
    metric: "Pull requests opened by the Codex connector",
    query: (login) => `org:${login} type:pr author:app/chatgpt-codex-connector`,
  },
];

function humanSearchUrl(query, type) {
  return `https://github.com/search?q=${encodeURIComponent(query)}&type=${type}`;
}

async function readJsonWithLimit(response) {
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error("GitHub response exceeded the size limit.");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new Error("GitHub response exceeded the size limit.");
  }
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

function createGithubClient({ token, fetchImpl }) {
  const state = { calls: 0, rateLimited: false };
  async function request(path) {
    if (state.rateLimited) {
      const error = new Error("GitHub rate limit already reached.");
      error.code = "RATE_LIMITED";
      throw error;
    }
    if (state.calls >= MAX_TOTAL_CALLS) {
      const error = new Error("GitHub call budget exhausted.");
      error.code = "CALL_BUDGET";
      throw error;
    }
    state.calls += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers = {
        Accept: "application/vnd.github+json",
        "User-Agent": "spendscope-enrichment",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetchImpl(`${GITHUB_API_BASE}${path}`, {
        method: "GET",
        headers,
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status === 403 || response.status === 429) {
        state.rateLimited = true;
        const error = new Error("GitHub rate limit reached.");
        error.code = "RATE_LIMITED";
        error.statusCode = response.status;
        throw error;
      }
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
  return { request, state };
}

async function fetchOrgProfile(client, login) {
  if (!ORG_LOGIN_PATTERN.test(login)) return null;
  let response;
  try {
    response = await client.request(`/orgs/${login}`);
  } catch (_error) {
    return null;
  }
  if (response.status !== 200) return null;
  const body = await readJsonWithLimit(response);
  if (!body || body.type !== "Organization") return null;
  return {
    login: String(body.login || login),
    name: cleanText(body.name, 120),
    blog: cleanText(body.blog, 300),
    email: cleanText(body.email, 200),
    isVerified: body.is_verified === true,
    publicRepos: Math.max(0, Number(body.public_repos) || 0),
    followers: Math.max(0, Number(body.followers) || 0),
    createdAt: cleanText(body.created_at, 40),
    url: `https://github.com/${String(body.login || login)}`,
  };
}

function profileMatchesDomain(profile, domain) {
  if (!profile) return false;
  const hosts = [];
  const blog = profile.blog || "";
  if (blog) {
    try {
      hosts.push(new URL(/^[a-z]+:\/\//i.test(blog) ? blog : `https://${blog}`).hostname);
    } catch (_error) {
      // Not a parseable website; ignore.
    }
  }
  const email = profile.email || "";
  if (email.includes("@")) hosts.push(email.split("@").at(-1));
  return hosts.some((host) => {
    const normalized = normalizeCompanyDomain(host);
    return normalized === domain;
  });
}

async function searchOrgCandidates(client, query) {
  let response;
  try {
    response = await client.request(
      `/search/users?q=${encodeURIComponent(`${query} type:org`)}&per_page=5`
    );
  } catch (_error) {
    return [];
  }
  if (response.status !== 200) return [];
  const body = await readJsonWithLimit(response);
  return (Array.isArray(body?.items) ? body.items : [])
    .map((item) => String(item?.login || ""))
    .filter((login) => ORG_LOGIN_PATTERN.test(login))
    .slice(0, 5);
}

async function resolveOrgs(client, domain, maxOrgs, companyName) {
  const matches = [];
  const checked = new Set();
  const ownerLabel = domain.split(".")[0];
  const candidates = [ownerLabel];
  if (companyName) {
    const slug = String(companyName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (slug && slug !== ownerLabel) candidates.push(slug.replace(/-/g, ""));
  }
  try {
    candidates.push(...(await searchOrgCandidates(client, `"${domain}"`)));
    if (companyName) {
      candidates.push(...(await searchOrgCandidates(client, `"${companyName}"`)));
    }
  } catch (_error) {
    // Search failures leave the direct-login probe as the only candidate.
  }
  for (const candidate of candidates) {
    if (matches.length >= maxOrgs) break;
    const key = candidate.toLowerCase();
    if (!candidate || checked.has(key)) continue;
    checked.add(key);
    if (client.state.rateLimited) break;
    const profile = await fetchOrgProfile(client, candidate);
    if (profileMatchesDomain(profile, domain)) matches.push(profile);
  }
  return matches;
}

// Exact public-member count from the Link header of a one-item page.
async function fetchPublicMemberCount(client, login) {
  let response;
  try {
    response = await client.request(
      `/orgs/${login}/public_members?per_page=1`
    );
  } catch (_error) {
    return null;
  }
  if (response.status !== 200) return null;
  const body = await readJsonWithLimit(response);
  if (!Array.isArray(body)) return null;
  const link = String(response.headers?.get?.("link") || "");
  const lastPage = link.match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/);
  if (lastPage) return Number(lastPage[1]);
  return body.length;
}

async function fetchSearchCount(client, endpoint, query) {
  const response = await client.request(
    `${endpoint}?q=${encodeURIComponent(query)}&per_page=1`
  );
  if (response.status === 401) {
    const error = new Error("GitHub search requires authentication.");
    error.code = "AUTH_REQUIRED";
    throw error;
  }
  if (response.status === 422) return 0; // Unknown qualifiers (e.g. app slug) count as zero.
  if (response.status !== 200) {
    const error = new Error(`GitHub search failed with ${response.status}.`);
    error.statusCode = response.status;
    throw error;
  }
  const body = await readJsonWithLimit(response);
  const count = Number(body?.total_count);
  return Number.isFinite(count) && count >= 0 ? Math.round(count) : 0;
}

async function collectSignalGroup({
  client,
  org,
  signals,
  endpoint,
  humanType,
  readings,
  notes,
  now,
}) {
  let completed = 0;
  for (const signal of signals) {
    if (client.state.rateLimited) break;
    const query = signal.query(org.login);
    try {
      const value = await fetchSearchCount(client, endpoint, query);
      readings.push({
        id: `github.${org.login}.${signal.id}`,
        vendor: signal.vendor,
        metric: signal.metric,
        value,
        unit: "count",
        source: "github",
        url: humanSearchUrl(query, humanType),
        detail: `GitHub search: ${query}`,
        observedAt: now.toISOString(),
      });
      completed += 1;
    } catch (error) {
      if (error?.code === "AUTH_REQUIRED") {
        notes.push(`GitHub ${humanType} search requires a configured token.`);
        break;
      }
      if (error?.code === "RATE_LIMITED" || error?.code === "CALL_BUDGET") {
        notes.push("GitHub rate limit reached before all signals were read.");
        break;
      }
      notes.push(`GitHub ${humanType} search failed for ${org.login}.`);
    }
  }
  return completed;
}

async function collectGithubSignals({
  domain,
  companyName,
  token,
  fetchImpl,
  now = new Date(),
}) {
  const client = createGithubClient({ token, fetchImpl });
  const readings = [];
  const notes = [];
  const maxOrgs = token ? MAX_ORGS_AUTHENTICATED : MAX_ORGS_UNAUTHENTICATED;
  const coverage = {
    githubOrgResolved: false,
    githubAuthenticated: Boolean(token),
    codeSearch: false,
    commitSearch: false,
    prSearch: false,
  };

  let orgs = [];
  try {
    orgs = await resolveOrgs(client, domain, maxOrgs, companyName);
  } catch (_error) {
    orgs = [];
  }
  if (orgs.length === 0) {
    notes.push(
      client.state.rateLimited
        ? "GitHub rate limit reached while resolving the organization."
        : "No public GitHub organization matched this domain."
    );
    return { orgs: [], readings, coverage, notes, calls: client.state.calls };
  }
  coverage.githubOrgResolved = true;

  for (const org of orgs) {
    if (client.state.rateLimited) break;
    const publicMembers = await fetchPublicMemberCount(client, org.login);
    org.publicMembers = publicMembers === null ? 0 : publicMembers;

    // Code search has its own ~10 req/min limit, so code and commit signals
    // stay scoped to the primary org; PR search covers every matched org.
    const primaryOrg = org === orgs[0];
    if (token && primaryOrg) {
      const codeCompleted = await collectSignalGroup({
        client,
        org,
        signals: CODE_SIGNALS,
        endpoint: "/search/code",
        humanType: "code",
        readings,
        notes,
        now,
      });
      if (codeCompleted > 0) coverage.codeSearch = true;
      const commitCompleted = await collectSignalGroup({
        client,
        org,
        signals: COMMIT_SIGNALS,
        endpoint: "/search/commits",
        humanType: "commits",
        readings,
        notes,
        now,
      });
      if (commitCompleted > 0) coverage.commitSearch = true;
    } else if (!token) {
      notes.push(
        "Code and commit search were skipped because no GitHub token is configured."
      );
    }

    const prCompleted = await collectSignalGroup({
      client,
      org,
      signals: PR_SIGNALS,
      endpoint: "/search/issues",
      humanType: "issues",
      readings,
      notes,
      now,
    });
    if (prCompleted > 0) coverage.prSearch = true;
  }

  return {
    orgs,
    readings,
    coverage,
    notes: [...new Set(notes)],
    calls: client.state.calls,
  };
}

module.exports = {
  CODE_SIGNALS,
  COMMIT_SIGNALS,
  GITHUB_API_BASE,
  PR_SIGNALS,
  collectGithubSignals,
  fetchPublicMemberCount,
  profileMatchesDomain,
  resolveOrgs,
};
