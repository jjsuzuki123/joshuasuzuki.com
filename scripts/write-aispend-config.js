"use strict";

const fs = require("node:fs");
const path = require("node:path");

const endpoint = String(process.env.AISPEND_ENDPOINT || "").trim();
const suggestEndpoint = String(process.env.AISPEND_SUGGEST_ENDPOINT || "").trim();
const gated =
  String(process.env.AISPEND_GATED || "").trim() === "true" ||
  String(process.env.AISPEND_ACCESS_CODE || "").trim().length > 0;

if (endpoint) {
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch (_error) {
    throw new Error("AISPEND_ENDPOINT must be a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("AISPEND_ENDPOINT must use HTTPS.");
  }
}

if (suggestEndpoint) {
  let parsed;
  try {
    parsed = new URL(suggestEndpoint);
  } catch (_error) {
    throw new Error("AISPEND_SUGGEST_ENDPOINT must be a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("AISPEND_SUGGEST_ENDPOINT must use HTTPS.");
  }
}

const derivedSuggest =
  suggestEndpoint ||
  (endpoint ? endpoint.replace(/\/company\/?$/, "/suggest") : "");

const target = path.resolve(
  process.argv[2] || path.join(__dirname, "..", "aispend", "config.js")
);
const source = `(function configureSpendscope(root) {
  "use strict";

  root.SpendscopeConfig = Object.freeze({
    apiEndpoint: ${JSON.stringify(endpoint)},
    suggestEndpoint: ${JSON.stringify(derivedSuggest)},
    gated: ${gated ? "true" : "false"},
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
`;

fs.writeFileSync(target, source, { encoding: "utf8", mode: 0o644 });
