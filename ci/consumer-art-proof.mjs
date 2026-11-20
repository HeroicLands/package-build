/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE.md file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Manual CI proof with real consumer notes and explicitly synthetic artwork. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFileSync, spawn } from "node:child_process";

assert.ok(process.env.GITHUB_ACTIONS === "true" || process.env.GITEA_ACTIONS === "true", "CI only");
assert.ok(path.isAbsolute(process.env.RUNNER_TEMP ?? ""), "RUNNER_TEMP is required");
assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "0", "TLS verification is required");
const checkout = fs.realpathSync(process.cwd());
const consumer = fs.realpathSync(path.join(checkout, "consumer-proof-consumer"));
const proof = path.join(process.env.RUNNER_TEMP, "consumer-proof");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (cwd, ...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
assert.match(process.env.CANDIDATE_SHA ?? "", /^[a-f0-9]{40}$/);
assert.match(process.env.CONSUMER_SHA ?? "", /^[a-f0-9]{40}$/);
assert.equal(git(checkout, "rev-parse", "HEAD").trim(), process.env.CANDIDATE_SHA);
assert.equal(git(consumer, "rev-parse", "HEAD").trim(), process.env.CONSUMER_SHA);
const requireConsumer = createRequire(path.join(consumer, "package.json"));
const installed = path.dirname(requireConsumer.resolve("@heroiclands/package-build/package.json"));
assert.ok(installed.startsWith(consumer + path.sep), "candidate must be installed in the consumer");
const requireCandidate = createRequire(path.join(installed, "package.json"));
const YAML = requireCandidate("yaml");
const sharp = requireCandidate("sharp");
const { zipSync, unzipSync } = requireCandidate("fflate");
const moduleAt = (file) => import(pathToFileURL(path.join(installed, "engine", file)).href);
const { writeProvenance, writeSvgProvenance } = await moduleAt("art-provenance.mjs");
const { inspectPublicDerivative } = await moduleAt("art-public-derivative.mjs");
const { isNoteRecord } = await moduleAt("index-records.mjs");
const { renderAddress } = await moduleAt("address.mjs");
const fixtureAddress = (spec) =>
    renderAddress({
        package: "kethira",
        system: "none",
        type: "image",
        shortcode: spec.shortcode,
    });
const scratch = fs.mkdtempSync(path.join(proof, "archive-fixture-"));
const cacheHome = path.join(scratch, "cache");
const temp = path.join(scratch, "tmp");
fs.mkdirSync(temp);
const originals = new Map();
const restored = new Map();
const sentinel = "CI_PRIVATE_ARTWORK_SENTINEL";
const credits = ["CI geometric fixture", "Archive interoperability proof"];
const specs = [
    { note: "agrik", shortcode: "ciproofopaque", suffix: "jpg", format: "jpeg", alpha: 1 },
    { note: "halea", shortcode: "ciproofalpha", suffix: "webp", format: "webp", alpha: 0.4 },
    { note: "ilvir", shortcode: "ciproofvector", suffix: "svg", format: "svg" },
];
const tracked = git(consumer, "ls-files", "-z").split("\0").filter(Boolean);
assert.ok(tracked.length < 10000, "consumer source inventory exceeds proof limit");
let sourceBytes = 0;
const baseline = new Map(
    tracked.map((file) => {
        const absolute = path.join(consumer, file);
        const stat = fs.lstatSync(absolute);
        assert.ok(stat.isFile(), `consumer source is not a regular file: ${file}`);
        sourceBytes += stat.size;
        assert.ok(sourceBytes <= 256 * 1024 * 1024, "consumer source exceeds proof limit");
        const bytes = fs.readFileSync(absolute);
        assert.equal(bytes.length, stat.size, `consumer source changed during capture: ${file}`);
        return [file, hash(bytes)];
    }),
);
const overlays = [];
let server;
let requests = 0;
let badRequests = 0;
let child;
const cancellation = new AbortController();
function killGroup(running) {
    if (!running?.pid) return;
    try {
        process.kill(-running.pid, "SIGKILL");
    } catch (error) {
        if (error.code !== "ESRCH") throw error;
    }
}
const cancel = () => {
    cancellation.abort();
    killGroup(child);
};
process.once("SIGTERM", cancel);
process.once("SIGINT", cancel);

async function run(command, args, env = process.env, quiet = false) {
    cancellation.signal.throwIfAborted();
    await new Promise((resolve, reject) => {
        const running = spawn(command, args, {
            cwd: consumer,
            env,
            stdio: quiet ? "ignore" : "inherit",
            detached: true,
        });
        child = running;
        const timer = setTimeout(
            () => {
                killGroup(running);
            },
            15 * 60 * 1000,
        );
        running.once("error", (error) => {
            clearTimeout(timer);
            child = undefined;
            reject(error);
        });
        running.once("close", (code, signal) => {
            clearTimeout(timer);
            child = undefined;
            if (code === 0 && !signal) resolve();
            else reject(new Error(`${command} failed: exit=${code}, signal=${signal}`));
        });
    });
}

async function stopServer() {
    if (!server?.listening) return;
    const closed = new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
    );
    server.closeAllConnections();
    await closed;
}

function overlay(file, bytes) {
    const absolute = path.join(consumer, file);
    const before = fs.readFileSync(absolute);
    restored.set(absolute, before);
    fs.writeFileSync(absolute, bytes);
    overlays.push({ file, before: hash(before), fixture: hash(bytes) });
}

function assertSourceBytes() {
    for (const [file, digest] of baseline) {
        const expected = overlays.find((entry) => entry.file === file)?.fixture ?? digest;
        assert.equal(
            hash(fs.readFileSync(path.join(consumer, file))),
            expected,
            `source changed: ${file}`,
        );
    }
    for (const [file, bytes] of originals) assert.deepEqual(fs.readFileSync(file), bytes);
}

function clearBuildOutputs() {
    // Dependency inputs survive; note, image and compiler caches do not.
    const build = path.join(consumer, "build");
    for (const name of fs.readdirSync(build)) {
        if (name !== "cache") fs.rmSync(path.join(build, name), { recursive: true, force: true });
    }
    const cache = path.join(build, "cache");
    if (fs.existsSync(cache))
        for (const name of fs.readdirSync(cache)) {
            if (!["foreign", "metadata", "navigation"].includes(name))
                fs.rmSync(path.join(cache, name), { recursive: true, force: true });
        }
}

function files(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(directory, entry.name);
        assert.ok(!entry.isSymbolicLink(), "proof output contains a symbolic link");
        return (
            entry.isDirectory() ? files(file)
            : entry.isFile() ? [file]
            : []
        );
    });
}

function inspectOutputs() {
    const text = fs.readFileSync(
        path.join(consumer, "build/content-index/kethira-metadata.jsonl"),
        "utf8",
    );
    assert.ok(!text.includes(sentinel), "private metadata in public index");
    const records = text.trim().split("\n").map(JSON.parse);
    const documents = new Map();
    const packs = {};
    for (const name of ["characteristics", "mysteries", "journals", "characters"]) {
        const json = files(path.join(consumer, "build/packs-json", name)).filter((file) =>
            file.endsWith(".json"),
        );
        assert.ok(json.length, `${name}: no compiled documents`);
        for (const file of json) {
            const doc = JSON.parse(fs.readFileSync(file, "utf8"));
            assert.ok(doc._id, `compiled document lacks identity: ${file}`);
            documents.set(`${name}/${doc._id}`, doc);
        }
        const pack = path.join(consumer, "build/stage/packs", name);
        const manifest = fs.readFileSync(path.join(pack, "CURRENT"), "utf8").trim();
        assert.match(manifest, /^MANIFEST-[0-9]+$/);
        assert.ok(fs.statSync(path.join(pack, manifest)).size > 0);
        assert.ok(
            fs
                .readdirSync(pack)
                .some(
                    (file) =>
                        /\.(?:ldb|sst|log)$/.test(file) &&
                        fs.statSync(path.join(pack, file)).size > 0,
                ),
        );
        packs[name] = json.length;
    }
    const assets = specs.map((spec) => {
        const matches = records.filter((r) => r.type === "image" && r.shortcode === spec.shortcode);
        assert.equal(matches.length, 1, "fixture image must be indexed exactly once");
        const record = matches[0];
        assert.deepEqual(record.asset.attribution, credits);
        assert.equal(record.asset.ai, false);
        assert.equal(record.asset.license, "CC0-1.0");
        assert.equal(record.asset.path, `images/${spec.shortcode}.${spec.suffix}`);
        const relative = record.asset.path;
        const bytes = fs.readFileSync(path.join(consumer, "build/stage", relative));
        const inspected = inspectPublicDerivative(relative, bytes, "kethira");
        assert.equal(inspected.format, spec.format);
        assert.equal(inspected.metadata.address, fixtureAddress(spec));
        assert.equal(inspected.metadata.ai, false);
        assert.equal(inspected.metadata.rights, "Geometric CI fixture dedicated to CC0-1.0");
        assert.equal(inspected.metadata.license, undefined);
        assert.deepEqual(inspected.metadata.creator, credits);
        assert.equal(inspected.metadata.prompt, undefined);
        assert.ok(!bytes.includes(Buffer.from(sentinel)), "private metadata in derivative");
        const notes = records.filter(
            (r) => isNoteRecord(r) && r.type === "affiliation" && r.shortcode === spec.note,
        );
        assert.equal(notes.length, 1);
        const uuid = notes[0].foundry?.sohl?.uuid;
        assert.equal(typeof uuid, "string");
        const doc = documents.get(`mysteries/${uuid.split(".").at(-1)}`);
        assert.ok(doc, `missing compiled real note: ${spec.note}`);
        // Foundry paths use the module ID; image Addresses use contentPackage.
        assert.equal(doc.img, `modules/sohl-kethira-basic/${relative}`);
        return {
            address: inspected.metadata.address,
            note: spec.note,
            uuid,
            img: doc.img,
            format: inspected.format,
            sha256: hash(bytes),
            attribution: record.asset.attribution,
            license: record.asset.license,
            rights: inspected.metadata.rights,
        };
    });
    assert.deepEqual(
        fs.readdirSync(temp).filter((name) => name.startsWith("art-archive-")),
        [],
        "system temporary archive captures leak",
    );
    assert.deepEqual(
        fs
            .readdirSync(path.join(cacheHome, "heroiclands/downloads"))
            .filter((name) => name.startsWith(".art-archive-")),
        [],
        "cached archive captures leak",
    );
    return { assets, packs };
}

try {
    const entries = {
        "README.md": Buffer.from(
            "CI fixture artwork only. Geometric test inputs, dedicated to CC0-1.0. No published art release or setting illustration is represented.\n",
        ),
        "CHANGELOG.md": Buffer.from(
            "CI interoperability fixture: opaque, transparent and vector originals.\n",
        ),
    };
    for (const spec of specs) {
        const metadata = {
            address: fixtureAddress(spec),
            creator: credits,
            rights: "Geometric CI fixture dedicated to CC0-1.0",
            license: "CC0-1.0",
            ai: false,
            prompt: sentinel,
        };
        const bytes =
            spec.format === "svg" ?
                writeSvgProvenance(
                    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#456789"/></svg>',
                    metadata,
                ).bytes
            :   writeProvenance(
                    await sharp({
                        create: {
                            width: 16,
                            height: 16,
                            channels: 4,
                            background: { r: 69, g: 103, b: 137, alpha: spec.alpha },
                        },
                    })
                        .png()
                        .toBuffer(),
                    metadata,
                ).bytes;
        const filename = `${spec.shortcode}.${spec.format === "svg" ? "svg" : "png"}`;
        const file = path.join(scratch, filename);
        fs.writeFileSync(file, bytes);
        originals.set(file, bytes);
        entries[`images/${filename}`] = bytes;
    }
    const zip = Buffer.from(zipSync(entries, { level: 0 }));
    assert.ok(zip.length < 256 * 1024, "fixture archive exceeds proof limit");
    const zipHash = hash(zip);
    const archiveFile = path.join(scratch, "fixture-originals.zip");
    fs.writeFileSync(archiveFile, zip);
    originals.set(archiveFile, zip);
    const keyFile = path.join(scratch, "server-key.pem");
    const certFile = path.join(scratch, "server-cert.pem");
    await run(
        "openssl",
        [
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-sha256",
            "-nodes",
            "-keyout",
            keyFile,
            "-out",
            certFile,
            "-days",
            "1",
            "-subj",
            "/CN=127.0.0.1",
            "-addext",
            "subjectAltName=IP:127.0.0.1",
            "-addext",
            "basicConstraints=critical,CA:TRUE",
        ],
        process.env,
        true,
    );
    fs.chmodSync(keyFile, 0o600);
    const trustFile = path.join(scratch, "trusted-ca.pem");
    if (process.env.NODE_EXTRA_CA_CERTS)
        assert.ok(fs.statSync(process.env.NODE_EXTRA_CA_CERTS).size < 1024 * 1024);
    const inheritedTrust =
        process.env.NODE_EXTRA_CA_CERTS ?
            fs.readFileSync(process.env.NODE_EXTRA_CA_CERTS)
        :   Buffer.alloc(0);
    assert.ok(inheritedTrust.length < 1024 * 1024);
    fs.writeFileSync(
        trustFile,
        Buffer.concat([inheritedTrust, Buffer.from("\n"), fs.readFileSync(certFile)]),
    );
    server = https.createServer(
        { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) },
        (request, response) => {
            requests++;
            if (
                requests > 8 ||
                request.url !== "/fixture-originals.zip" ||
                request.method !== "GET" ||
                request.headers.authorization
            ) {
                badRequests++;
                response.writeHead(400).end();
                return;
            }
            response.writeHead(200, {
                "content-type": "application/zip",
                "content-length": zip.length,
            });
            response.end(zip);
        },
    );
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const url = `https://127.0.0.1:${server.address().port}/fixture-originals.zip`;
    const configFile = "package-build.config.yaml";
    const rawConfig = fs.readFileSync(path.join(consumer, configFile), "utf8");
    const config = YAML.parse(rawConfig);
    assert.equal(config.contentPackage, "kethira");
    assert.equal(config.art, undefined, "pinned consumer already declares artwork inputs");
    const art = { archives: [{ url, sha256: zipHash }] };
    const nextConfig = rawConfig + "\n" + YAML.stringify({ art });
    assert.deepEqual(YAML.parse(nextConfig), { ...config, art });
    overlay(configFile, nextConfig);
    const found = new Set();
    for (const file of tracked.filter(
        (file) => file.startsWith("assets/content/") && file.endsWith(".md"),
    )) {
        const raw = fs.readFileSync(path.join(consumer, file), "utf8");
        const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
        if (!match) continue;
        const doc = YAML.parseDocument(match[1]);
        const fm = doc.toJS();
        const spec = specs.find((item) => fm?.type === "affiliation" && fm.shortcode === item.note);
        if (!spec) continue;
        assert.ok(!found.has(spec.note), "duplicate fixture target note");
        found.add(spec.note);
        assert.equal(fm.data.pack, "mysteries");
        const scalar = doc.getIn(["data", "icon"], true);
        assert.equal(typeof scalar?.value, "string");
        const start = raw.indexOf(match[1]);
        const icon = fixtureAddress(spec);
        const changed =
            raw.slice(0, start + scalar.range[0]) +
            JSON.stringify(icon) +
            raw.slice(start + scalar.range[1]);
        const changedFm = YAML.parse(/^---\r?\n([\s\S]*?)\r?\n---/.exec(changed)[1]);
        assert.deepEqual(changedFm, { ...fm, data: { ...fm.data, icon } });
        overlay(file, changed);
    }
    assert.equal(found.size, specs.length);
    const cacheFile = path.join(cacheHome, "heroiclands/downloads", zipHash);
    assert.ok(!fs.existsSync(cacheFile), "cold archive cache must be empty");
    const env = {
        ...process.env,
        XDG_CACHE_HOME: cacheHome,
        TMPDIR: temp,
        NODE_EXTRA_CA_CERTS: trustFile,
    };
    clearBuildOutputs();
    await run("npm", ["run", "build:db"], env);
    const cold = inspectOutputs();
    assert.equal(badRequests, 0);
    assert.equal(requests, 1, "cold build must download the archive exactly once");
    assert.deepEqual(fs.readFileSync(cacheFile), zip);
    const cachedEntries = unzipSync(fs.readFileSync(cacheFile));
    for (const [name, bytes] of Object.entries(entries))
        assert.deepEqual(Buffer.from(cachedEntries[name]), bytes);
    assertSourceBytes();
    await stopServer();
    clearBuildOutputs();
    await run("npm", ["run", "build:db"], env);
    const warm = inspectOutputs();
    assert.deepEqual(warm, cold, "cold and cached consumer artwork differ");
    assert.equal(requests, 1);
    assert.deepEqual(fs.readFileSync(cacheFile), zip);
    assertSourceBytes();
    const receipt = {
        scope: "Synthetic artwork archive interoperability in pinned real Kethira; not public-release or collection-eligibility evidence",
        candidate: process.env.CANDIDATE_SHA,
        consumer: process.env.CONSUMER_SHA,
        candidateSha512: createHash("sha512")
            .update(fs.readFileSync(path.join(proof, "candidate.tgz")))
            .digest("hex"),
        overlays,
        archiveSha256: zipHash,
        archiveBytes: zip.length,
        originals: [...originals].map(([file, bytes]) => ({
            file: path.basename(file),
            sha256: hash(bytes),
        })),
        coldArchiveRequests: requests,
        warmServerStopped: !server.listening,
        cold,
        warm,
    };
    fs.writeFileSync(
        path.join(proof, "art-archive-receipt.json"),
        JSON.stringify(receipt, null, 2) + "\n",
    );
    console.log(JSON.stringify(receipt, null, 2));
} finally {
    try {
        await stopServer();
    } finally {
        try {
            for (const [file, bytes] of restored) fs.writeFileSync(file, bytes);
        } finally {
            fs.rmSync(scratch, { recursive: true, force: true });
            process.removeListener("SIGTERM", cancel);
            process.removeListener("SIGINT", cancel);
        }
    }
}
