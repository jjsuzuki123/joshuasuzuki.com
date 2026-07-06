"use strict";

const fs = require("node:fs");
const path = require("node:path");

const endpoint = String(process.env.IMPORT_ENDPOINT || "").trim();
let parsed;
try {
  parsed = new URL(endpoint);
} catch (error) {
  throw new Error("IMPORT_ENDPOINT must be a valid URL.");
}
if (parsed.protocol !== "https:") {
  throw new Error("IMPORT_ENDPOINT must use HTTPS.");
}

const target = path.resolve(
  process.argv[2] || path.join(__dirname, "..", "fantasy", "config.js")
);
const source = `(function configureRosterLab(root) {
  "use strict";

  root.RosterLabConfig = Object.freeze({
    importEndpoint: ${JSON.stringify(endpoint)},
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
`;

fs.writeFileSync(target, source, { encoding: "utf8", mode: 0o644 });
