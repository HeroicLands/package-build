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
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { zipSync } from "fflate";
import YAML from "yaml";
import { writeSvgProvenance } from "../engine/art-provenance.mjs";
import { releaseArchives, releaseDigest } from "./consumer-art-release-proof.mjs";

assert.ok(process.env.GITHUB_ACTIONS === "true" || process.env.GITEA_ACTIONS === "true", "CI only");
assert.ok(path.isAbsolute(process.env.RUNNER_TEMP ?? ""));
const checkout = path.resolve(import.meta.dirname, "..");
const root = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, "release-proof-fixture-"));
const proof = path.join(root, "proof");
const consumer = path.join(proof, "source");
const source = path.join(root, "pinned-source");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: source, encoding: "utf8" }).trim();
const write = (file, bytes) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
};
const deadline = Date.now() + 50 * 60 * 1000;
const run = (command, args, cwd, env = process.env) =>
    new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            env,
            stdio: ["ignore", "pipe", "pipe"],
            detached: true,
        });
        let output = "";
        const append = (bytes) => {
            output = (output + bytes.toString()).slice(-2 * 1024 * 1024);
        };
        child.stdout.on("data", append);
        child.stderr.on("data", append);
        const terminate = () => {
            try {
                process.kill(-child.pid, "SIGTERM");
            } catch (error) {
                if (error.code !== "ESRCH") throw error;
            }
        };
        const timer = setTimeout(
            terminate,
            Math.max(1, Math.min(5 * 60 * 1000, deadline - Date.now())),
        );
        child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({ code, output });
        });
    });
const checked = async (...args) => {
    const result = await run(...args);
    assert.equal(result.code, 0, result.output);
};
const tag = "v1.2.3";
const name = "thalorna-originals-1.2.3.zip";
const base = `https://github.com/HeroicLands/art-thalorna/releases/download/${tag}/`;
const release = {
    id: 17,
    tag_name: tag,
    draft: false,
    published_at: "2026-01-01T00:00:00Z",
    html_url: `https://github.com/HeroicLands/art-thalorna/releases/tag/${tag}`,
};
const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="red"/></svg>';
const master = (address, extra) =>
    writeSvgProvenance(svg, {
        address,
        creator: ["Fixture artist", "Fixture credit"],
        rights: "Fixture terms",
        license: "CC0-1.0",
        prompt: "private fixture sentinel",
        ...extra,
    }).bytes;
const members = {
    "README.md": Buffer.from("Synthetic release fixture.\n"),
    "CHANGELOG.md": Buffer.from("Synthetic release fixture.\n"),
    "artwork/portrait.svg": master("thalorna-none-image-portrait", { ai: false }),
    "artwork/artificial.svg": master("thalorna-none-image-artificial", {
        ai: true,
        nonAiAlternative: "thalorna-none-image-portrait",
    }),
};
let payloads = new Map();
let metadata;
let activeRelease;
let requests = [];
const cert = path.join(root, "cert.pem");
execFileSync(
    "openssl",
    [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        path.join(root, "key.pem"),
        "-out",
        cert,
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "ignore" },
);
const server = https.createServer(
    { key: fs.readFileSync(path.join(root, "key.pem")), cert: fs.readFileSync(cert) },
    (req, res) => {
        assert.equal(req.headers.authorization, undefined, "fixture request carries credentials");
        requests.push(req.url);
        if (req.url.startsWith("/repos/") && req.url.includes("/assets?"))
            res.end(JSON.stringify(metadata));
        else if (req.url.startsWith("/repos/")) res.end(JSON.stringify(activeRelease));
        else {
            const data = payloads.get(req.url);
            if (!data) {
                res.writeHead(404);
                res.end();
                return;
            }
            res.setHeader("content-length", data.length);
            res.end(data);
        }
    },
);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `https://127.0.0.1:${server.address().port}`;
const config = {
    contentPackage: "thalorna",
    packageKind: "modules",
    currentDate: "721.1",
    stats: { lastModifiedBy: "fixturebuilder00" },
    compatibility: { minimum: "14", verified: "14" },
    packageBuild: { baseStyles: false },
    packs: [
        { name: "macros", type: "Macro", default: true },
        { name: "journals", type: "JournalEntry", default: true },
    ],
};
const sourcePackage = {
    name: "thalorna",
    version: "1.0.0",
    type: "module",
    scripts: { "build:db": "node fixture-build.mjs" },
};
try {
    fs.mkdirSync(consumer, { recursive: true });
    fs.mkdirSync(source);
    await checked("npm", ["pack", "--ignore-scripts", "--pack-destination", proof], checkout);
    const tarball = fs.readdirSync(proof).find((file) => file.endsWith(".tgz"));
    fs.renameSync(path.join(proof, tarball), path.join(proof, "candidate.tgz"));
    write(path.join(source, "package.json"), JSON.stringify(sourcePackage));
    write(path.join(source, "package-build.config.yaml"), YAML.stringify(config));
    write(
        path.join(source, "assets/content/fixture.md"),
        "---\n" +
            YAML.stringify({
                type: "macro",
                shortcode: "fixture",
                name: { full: "Fixture" },
                data: { icon: "image-portrait" },
            }) +
            "---\n\nFixture documentation.\n\n# Script {#script}\n\n```js\nreturn;\n```\n",
    );
    write(
        path.join(source, "fixture-build.mjs"),
        fs.readFileSync(path.join(import.meta.dirname, "consumer-art-release-fixture-build.mjs")),
    );
    git("init", "-q");
    git("add", ".");
    git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-qm",
        "Create synthetic consumer",
    );
    fs.cpSync(source, consumer, {
        recursive: true,
        filter: (file) => path.basename(file) !== ".git",
    });
    write(
        path.join(consumer, "package.json"),
        JSON.stringify({
            ...sourcePackage,
            devDependencies: {
                "@heroiclands/package-build": `file:${path.join(proof, "candidate.tgz")}`,
            },
        }),
    );
    await checked(
        "npm",
        ["update", "@heroiclands/package-build", "--package-lock-only", "--ignore-scripts"],
        consumer,
    );
    await checked("npm", ["ci", "--ignore-scripts"], consumer);
    const cases = [
        ["overlaid", null],
        ["declared", null],
        ["draft", /draft is not a published/],
        ["fixture-origin", /127\.0\.0\.1/],
        ["tls", /TLS verification is required/],
        ["cold-extra-fetch", /exactly once/],
        ["cached-bytes", /cached archive differs from its native digest/],
        ["digest", /expected digest pin/],
        ["declared-mismatch", /declared artwork must exactly match/],
        ["sidecar", /released checksum does not identify/],
        ["zip-digest", /download SHA-256 does not match/],
        ["layout", /artwork/],
        ["missing-index", /released artwork is absent/],
        ["private-index", /private provenance in public index/],
        ["credits", /indexed attribution differs/],
        ["license", /indexed license differs/],
        ["alternative", /indexed alternative differs/],
        ["rights", /derivative rights differ/],
        ["private-derivative", /publication allowlist/],
        ["ai-stage", /AI original is present/],
        ["reference", /no real compiled note refers/],
        ["pack", /MANIFEST/],
        ["source", /consumer source changed/],
        ["cleanup", /temporary files leak/],
        ["warm-output", /cold and cached release outputs differ/],
        ["warm-fetch", /warm artwork cache attempted/],
    ];
    for (const [fault, failure] of cases) {
        fs.rmSync(path.join(proof, "fixture-evidence"), { recursive: true, force: true });
        fs.rmSync(path.join(consumer, "build"), { recursive: true, force: true });
        fs.copyFileSync(
            path.join(source, "assets/content/fixture.md"),
            path.join(consumer, "assets/content/fixture.md"),
        );
        const entries = { ...members };
        if (fault === "layout") {
            entries["other/portrait.svg"] = entries["artwork/portrait.svg"];
            delete entries["artwork/portrait.svg"];
        }
        const zip = Buffer.from(zipSync(entries, { level: 0 }));
        const sidecar = Buffer.from(
            `${fault === "sidecar" ? "0".repeat(64) : hash(zip)}  ${name}\n`,
        );
        metadata = [zip, sidecar].map((bytes, i) => ({
            id: i + 1,
            name: name + (i ? ".sha256" : ""),
            state: "uploaded",
            size: bytes.length,
            digest: `sha256:${hash(bytes)}`,
            browser_download_url: base + name + (i ? ".sha256" : ""),
        }));
        activeRelease = { ...release, draft: fault === "draft" };
        payloads = new Map(
            metadata.map((asset, i) => [
                new URL(asset.browser_download_url).pathname,
                i ? sidecar
                : fault === "zip-digest" ? Buffer.alloc(zip.length)
                : zip,
            ]),
        );
        const archives = releaseArchives(release, metadata, tag);
        const selected = structuredClone(config);
        if (fault === "declared" || fault === "declared-mismatch")
            selected.art = {
                archives: archives.map(({ url, sha256 }) => ({
                    url: origin + new URL(url).pathname,
                    sha256: fault === "declared-mismatch" ? "0".repeat(64) : sha256,
                })),
            };
        const originalConfig = YAML.stringify(selected);
        write(path.join(consumer, "package-build.config.yaml"), originalConfig);
        for (const directory of ["build/.cache/art", "build/cache/note-page"])
            write(path.join(consumer, directory, "fixture-sentinel"), "must be removed");
        requests = [];
        const env = {
            ...process.env,
            NODE_EXTRA_CA_CERTS: cert,
            GITHUB_TOKEN: "synthetic-credential-must-not-be-sent",
            NODE_TLS_REJECT_UNAUTHORIZED: fault === "tls" ? "0" : "1",
            CANDIDATE_SHA: execFileSync("git", ["rev-parse", "HEAD"], {
                cwd: checkout,
                encoding: "utf8",
            }).trim(),
            CONSUMER_SHA: git("rev-parse", "HEAD"),
            ART_RELEASE_TAG: tag,
            ART_RELEASE_SHA256:
                fault === "digest" ? "0".repeat(64) : releaseDigest(release, archives),
            FIXTURE_FAULT: fault,
            FIXTURE_OPTIONS: JSON.stringify({
                proof,
                source,
                origin: fault === "fixture-origin" ? "https://github.com" : origin,
            }),
        };
        const entry = `import { proveRelease } from ${JSON.stringify(pathToFileURL(path.join(import.meta.dirname, "consumer-art-release-proof.mjs")).href)}; await proveRelease({fixture: JSON.parse(process.env.FIXTURE_OPTIONS)});`;
        const result = await run(
            process.execPath,
            ["--input-type=module", "-e", entry],
            checkout,
            env,
        );
        const evidence = path.join(proof, "fixture-evidence/fixture-result.json");
        assert.equal(
            fs.existsSync(path.join(proof, "art-release-evidence/receipt.json")),
            false,
            "fixture creates real-release receipt",
        );
        assert.equal(
            fs.readFileSync(path.join(consumer, "package-build.config.yaml"), "utf8"),
            originalConfig,
            "configuration restoration",
        );
        assert.equal(
            fs.readdirSync(proof).some((file) => file.startsWith("real-art-release-")),
            false,
            "scratch cleanup",
        );
        if (failure) {
            assert.notEqual(result.code, 0, `${fault}: proof accepts invalid evidence`);
            assert.match(result.output, failure, `${fault}: wrong failure\n${result.output}`);
            assert.equal(fs.existsSync(evidence), false);
        } else {
            assert.equal(result.code, 0, result.output);
            const receipt = JSON.parse(fs.readFileSync(evidence, "utf8"));
            assert.equal(receipt.fixture, true);
            assert.match(receipt.scope, /Synthetic/);
            assert.equal(receipt.config.mode, fault);
            assert.equal(receipt.originals.length, 2);
            assert.equal(receipt.cold.outputs.length, 1);
            assert.ok(receipt.cold.references.length > 0);
            assert.deepEqual(receipt.cold, receipt.warm);
            assert.equal(receipt.coldArchiveRequests.length, 1);
            assert.equal(requests.filter((url) => url.endsWith(".zip")).length, 1);
            assert.match(receipt.consumerGitTreeSha256, /^[a-f0-9]{64}$/);
            assert.match(receipt.postInstallWorkingSourceSha256, /^[a-f0-9]{64}$/);
        }
        console.log(`Complete release-proof fixture: ${fault} passed`);
    }
    console.log(
        `${cases.length} complete-entry-point fixture cases passed; no real release is proven.`,
    );
} finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
}
