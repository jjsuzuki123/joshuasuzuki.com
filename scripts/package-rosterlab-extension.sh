#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${ROOT_DIR}/extensions/rosterlab-espn"
OUTPUT_DIR="${1:-${ROOT_DIR}/dist}"

if [[ "${OUTPUT_DIR}" != /* ]]; then
  OUTPUT_DIR="${ROOT_DIR}/${OUTPUT_DIR}"
fi

VERSION="$(
  node -e 'const manifest = require(process.argv[1]); process.stdout.write(manifest.version)' \
    "${SOURCE_DIR}/manifest.json"
)"
ARCHIVE="${OUTPUT_DIR}/rosterlab-espn-connector-v${VERSION}.zip"
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "${STAGE_DIR}"' EXIT

node - "${SOURCE_DIR}/manifest.json" <<'NODE'
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const expectedHosts = [
  "https://lm-api-reads.fantasy.espn.com/*",
];
const expectedRosterLabMatches = [
  "https://joshuasuzuki.com/fantasy",
  "https://joshuasuzuki.com/fantasy/",
  "https://joshuasuzuki.com/fantasy/index.html",
  "https://www.joshuasuzuki.com/fantasy",
  "https://www.joshuasuzuki.com/fantasy/",
  "https://www.joshuasuzuki.com/fantasy/index.html",
];
const expectedEspnMatches = [
  "https://www.espn.com/fantasy/baseball/*",
  "https://fantasy.espn.com/baseball/*",
];

if (manifest.manifest_version !== 3) {
  throw new Error("The store package must use Manifest V3.");
}
if ((manifest.permissions || []).includes("cookies")) {
  throw new Error("The connector must not request cookie access.");
}
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(expectedHosts)) {
  throw new Error("Unexpected extension host permission.");
}
if (
  JSON.stringify(manifest.content_scripts?.[0]?.matches) !==
  JSON.stringify(expectedRosterLabMatches)
) {
  throw new Error("Unexpected RosterLab content-script match.");
}
if (
  JSON.stringify(manifest.content_scripts?.[1]?.matches) !==
  JSON.stringify(expectedEspnMatches)
) {
  throw new Error("Unexpected ESPN content-script match.");
}
NODE

mkdir -p \
  "${STAGE_DIR}/content" \
  "${STAGE_DIR}/icons" \
  "${STAGE_DIR}/lib" \
  "${OUTPUT_DIR}"

cp "${SOURCE_DIR}/manifest.json" "${STAGE_DIR}/manifest.json"
cp "${SOURCE_DIR}/service-worker.js" "${STAGE_DIR}/service-worker.js"
cp "${SOURCE_DIR}/popup.html" "${STAGE_DIR}/popup.html"
cp "${SOURCE_DIR}/popup.css" "${STAGE_DIR}/popup.css"
cp "${SOURCE_DIR}/popup.js" "${STAGE_DIR}/popup.js"
cp "${SOURCE_DIR}/content/"*.js "${STAGE_DIR}/content/"
cp "${SOURCE_DIR}/icons/"*.png "${STAGE_DIR}/icons/"
cp "${SOURCE_DIR}/lib/"*.js "${STAGE_DIR}/lib/"

rm -f "${ARCHIVE}"
(
  cd "${STAGE_DIR}"
  zip -q -r "${ARCHIVE}" .
)
unzip -tq "${ARCHIVE}" >/dev/null

echo "Created ${ARCHIVE}"
