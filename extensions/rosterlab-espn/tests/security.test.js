import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const extensionRoot = fileURLToPath(new URL("../", import.meta.url));

async function read(relativePath) {
  return readFile(new URL(relativePath, new URL("../", import.meta.url)), "utf8");
}

test("manifest uses exact hosts and never requests cookie access", async () => {
  const manifest = JSON.parse(await read("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.permissions.includes("cookies"), false);
  assert.deepEqual(manifest.host_permissions, [
    "https://lm-api-reads.fantasy.espn.com/*",
  ]);
  assert.equal(
    manifest.host_permissions.some(
      (permission) =>
        permission.includes("www.espn.com") ||
        permission.includes("fantasy.espn.com/baseball")
    ),
    false
  );
  assert.equal(
    manifest.host_permissions.some((permission) => permission.includes("<all_urls>")),
    false
  );
  assert.equal(
    manifest.content_scripts[0].matches.some((match) =>
      match.endsWith("/fantasy/*")
    ),
    false
  );
});

test("runtime code does not read or name ESPN session-cookie values", async () => {
  const runtimeFiles = [
    "manifest.json",
    "service-worker.js",
    "content/rosterlab-bridge.js",
    "content/espn-location.js",
    "lib/espn.js",
    "lib/protocol.js",
    "lib/session.js",
    "popup.js",
  ];
  const source = (
    await Promise.all(runtimeFiles.map((relativePath) => read(relativePath)))
  ).join("\n");

  assert.doesNotMatch(source, /chrome\.cookies/i);
  assert.doesNotMatch(source, /espn_s2/i);
  assert.doesNotMatch(source, /\bswid\b/i);
  assert.match(source, /credentials:\s*"include"/);
  assert.match(source, /lm-api-reads\.fantasy\.espn\.com/);
  assert.ok(extensionRoot.endsWith("rosterlab-espn/"));
});
