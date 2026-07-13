"use strict";

const fs = require("node:fs");
const path = require("node:path");

const apiBase = String(process.env.RSVP_API_ENDPOINT || "").trim();

function validateEndpoint(value, name) {
  if (!value) return;
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS.`);
  }
}
validateEndpoint(apiBase, "RSVP_API_ENDPOINT");

const target = path.resolve(
  process.argv[2] || path.join(__dirname, "..", "rsvp", "config.js")
);
const source = `(function configureRsvp(root) {
  "use strict";

  root.RsvpConfig = Object.freeze({
    apiBase: ${JSON.stringify(apiBase.replace(/\/$/, ""))},
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
`;

fs.writeFileSync(target, source, { encoding: "utf8", mode: 0o644 });
