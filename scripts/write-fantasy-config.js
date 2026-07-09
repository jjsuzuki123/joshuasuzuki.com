"use strict";

const fs = require("node:fs");
const path = require("node:path");

const endpoint = String(process.env.IMPORT_ENDPOINT || "").trim();
const sourceEndpoint = String(process.env.SOURCE_ENDPOINT || "").trim();

function validateEndpoint(value, name, required) {
  if (!value && !required) return;
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
validateEndpoint(endpoint, "IMPORT_ENDPOINT", false);
validateEndpoint(sourceEndpoint, "SOURCE_ENDPOINT", false);

const target = path.resolve(
  process.argv[2] || path.join(__dirname, "..", "fantasy", "config.js")
);
const source = `(function configureRosterLab(root) {
  "use strict";

  root.RosterLabConfig = Object.freeze({
    importEndpoint: ${JSON.stringify(endpoint)},
    sourceEndpoint: ${JSON.stringify(sourceEndpoint)},
    // Set this after the Chrome Web Store listing is approved.
    connectorInstallUrl: "",
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
`;

fs.writeFileSync(target, source, { encoding: "utf8", mode: 0o644 });
