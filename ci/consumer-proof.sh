#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
set -euo pipefail

proof="$RUNNER_TEMP/consumer-proof"
cd consumer-proof-kethira
test "$(git rev-parse HEAD)" = fc95936a8a89449e5785835311c85428743f74f4
printf 'Kethira commit: %s\n' "$(git rev-parse HEAD)"
cp package-lock.json "$proof/original-lock.json"
npm pkg set "devDependencies.@heroiclands/package-build=file:$proof/candidate.tgz"
npm update @heroiclands/package-build --package-lock-only --ignore-scripts
node - "$proof/original-lock.json" <<'NODE'
const fs = require('node:fs');
const assert = require('node:assert/strict');
const before = JSON.parse(fs.readFileSync(process.argv[2]));
const after = JSON.parse(fs.readFileSync('package-lock.json'));
const candidate = 'node_modules/@heroiclands/package-build';
for (const key of new Set([...Object.keys(before.packages), ...Object.keys(after.packages)])) {
    if (key === candidate) continue;
    if (key === '') {
        const a = structuredClone(before.packages[key]);
        const b = structuredClone(after.packages[key]);
        delete a.devDependencies['@heroiclands/package-build'];
        delete b.devDependencies['@heroiclands/package-build'];
        assert.deepEqual(b, a, 'consumer root dependencies changed');
    } else {
        assert.deepEqual(after.packages[key], before.packages[key], `unrelated lock entry changed: ${key}`);
    }
}
const crypto = require('node:crypto');
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
npm run build:db
node -e '
  const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
  const index = "build/content-index/kethira-metadata.jsonl";
  const rows = fs.readFileSync(index, "utf8").trim().split("\n").map(JSON.parse);
  const imageAddress = "kethira-none-image-kpagrik";
  const matches = rows.filter(row => row.address?.canonical?.address === imageAddress);
  assert.equal(matches.length, 1);
  const asset = matches[0].asset;
  assert.equal(asset.path, "images/kpagrik.webp");
  assert.deepEqual(asset.attribution, ["Keléstia Productions"]);
  assert.equal(asset.ai, false);
  assert.equal(asset.license, "Harn Fanon");
  const source = fs.readFileSync("assets/images/kpagrik.webp");
  const staged = fs.readFileSync("build/stage/images/kpagrik.webp");
  assert.ok(source.length > 0);
  assert.deepEqual(staged, source);
  const set = JSON.parse(fs.readFileSync("build/stage/asset-sets/default.json", "utf8"));
  const entries = set.assets.filter(entry => entry.address === imageAddress);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].target, "images/kpagrik.webp");
  assert.equal(entries[0].size, staged.length);
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
  console.log("Verified indexed credit, copied image, shipped asset set, and compiled packs.");
'
sha512sum build/content-index/kethira-metadata.jsonl build/stage/images/kpagrik.webp
