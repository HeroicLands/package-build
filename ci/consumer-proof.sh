#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
set -euo pipefail

proof="$RUNNER_TEMP/consumer-proof"
guard="$PWD/ci/consumer-lock-guard.mjs"
case "$CONSUMER_PROOF" in
    kethira|thalorna-encoding|thalorna-headwords) ;;
    *) printf 'Unknown consumer proof: %s\n' "$CONSUMER_PROOF" >&2; exit 1 ;;
esac
cd consumer-proof-consumer
test "$(git rev-parse HEAD)" = "$CONSUMER_SHA"
printf 'Consumer commit: %s\n' "$(git rev-parse HEAD)"
cp package-lock.json "$proof/original-lock.json"
npm pkg set "devDependencies.@heroiclands/package-build=file:$proof/candidate.tgz"
npm update @heroiclands/package-build --package-lock-only --ignore-scripts
node --input-type=module - "$proof/original-lock.json" "$guard" <<'NODE'
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
const { checkConsumerLock } = await import(pathToFileURL(process.argv[3]));
const before = JSON.parse(fs.readFileSync(process.argv[2]));
const after = JSON.parse(fs.readFileSync('package-lock.json'));
const candidate = 'node_modules/@heroiclands/package-build';
checkConsumerLock(before, after);
const archive = fs.readFileSync(process.env.RUNNER_TEMP + '/consumer-proof/candidate.tgz');
const integrity = 'sha512-' + crypto.createHash('sha512').update(archive).digest('base64');
assert.equal(after.packages[candidate].integrity, integrity);
assert.match(after.packages[candidate].resolved, /^file:/);
console.log('Candidate archive integrity: ' + integrity);
NODE
npm ci
mkdir -p "$proof/unpacked"
tar -xzf "$proof/candidate.tgz" -C "$proof/unpacked"
node - "$proof/unpacked/package" node_modules/@heroiclands/package-build <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
function compare(source, installed) {
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const a = path.join(source, entry.name), b = path.join(installed, entry.name);
        if (entry.isDirectory()) compare(a, b);
        else if (entry.isFile()) assert.deepEqual(fs.readFileSync(b), fs.readFileSync(a), b);
        else throw Error('Unexpected archive entry: ' + a);
    }
}
compare(process.argv[2], process.argv[3]);
console.log('Installed package matches every archived file.');
NODE
if [ "$CONSUMER_PROOF" != kethira ]; then
    overlay="${CONSUMER_PROOF#thalorna-}-consumer-overlay.mjs"
    cp "../ci/$overlay" ".$overlay"
    node ".$overlay" prepare
fi
if [ "$CONSUMER_PROOF" != kethira ]; then
    CONSUMER_PROOF_MEMORY_DIR="$RUNNER_TEMP/consumer-proof-memory" \
        NODE_OPTIONS="$NODE_OPTIONS --import=\"$PWD/../ci/content-memory-diagnostics.mjs\"" \
        npm run build:db
else
    npm run build:db
fi
if [ "$CONSUMER_PROOF" != kethira ]; then
    node ".$overlay" verify
    exit 0
fi
node -e '
  const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
  const index = "build/content-index/kethira-metadata.jsonl";
  const rows = fs.readFileSync(index, "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(rows.length > 0, "content index is empty");
  function files(dir) {
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
          const file = path.join(dir, entry.name);
          return entry.isDirectory() ? files(file) : entry.isFile() ? [file] : [];
      });
  }
  for (const name of ["characteristics", "mysteries", "journals", "characters"]) {
      const json = files(path.join("build/packs-json", name)).filter(file => file.endsWith(".json"));
      assert.ok(json.length, name + " has no compiled JSON");
      for (const file of json) {
          assert.ok(fs.statSync(file).size > 0);
          assert.ok(JSON.parse(fs.readFileSync(file, "utf8")));
      }
      const dir = path.join("build/stage/packs", name);
      const manifest = fs.readFileSync(path.join(dir, "CURRENT"), "utf8").trim();
      assert.match(manifest, /^MANIFEST-[0-9]+$/);
      assert.ok(fs.statSync(path.join(dir, manifest)).size > 0);
      assert.ok(fs.readdirSync(dir).some(file => /\.(?:ldb|sst|log)$/.test(file) && fs.statSync(path.join(dir, file)).size > 0), name + " has no LevelDB data");
      console.log(name + ": " + json.length + " JSON documents, " + manifest);
  }
  console.log("Verified the content index and compiled packs.");
'
sha512sum build/content-index/kethira-metadata.jsonl
