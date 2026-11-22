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
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";

const repository = "HeroicLands/art-thalorna";
const maxReleaseBytes = 8 * 1024 ** 3;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Compare a public derivative with the rights retained from its released master. */
export function assertDerivativeRights(rightsByAddress, address, rights) {
    assert.ok(rightsByAddress.has(address), `${address}: released master is missing`);
    assert.equal(
        rights,
        rightsByAddress.get(address),
        `${address}: derivative rights differ from its master`,
    );
}

/** Select the complete published archive/checksum set without guessing any digest. */
export function releaseArchives(release, assets, tag) {
    assert.match(tag, /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    assert.equal(release.tag_name, tag, "release tag differs from the requested pin");
    assert.equal(release.draft, false, "a draft is not a published release");
    assert.ok(Number.isSafeInteger(release.id) && release.id > 0);
    assert.ok(
        typeof release.published_at === "string" &&
            Number.isFinite(Date.parse(release.published_at)),
    );
    assert.equal(release.html_url, `https://github.com/${repository}/releases/tag/${tag}`);
    assert.ok(Array.isArray(assets) && assets.length > 0 && assets.length <= 64);
    const names = new Map();
    const ids = new Set();
    const base = `thalorna-originals-${tag.slice(1)}`;
    for (const asset of assets) {
        assert.ok(
            Number.isSafeInteger(asset.id) && asset.id > 0 && !ids.has(asset.id),
            "duplicate or invalid release asset ID",
        );
        ids.add(asset.id);
        assert.equal(typeof asset.name, "string");
        assert.ok(!names.has(asset.name), "duplicate release asset name");
        assert.equal(asset.state, "uploaded", "release asset is incomplete");
        assert.match(
            asset.digest ?? "",
            /^sha256:[0-9a-f]{64}$/,
            "native GitHub SHA-256 is required",
        );
        assert.ok(
            Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= 2_000_000_000,
        );
        assert.equal(
            asset.browser_download_url,
            `https://github.com/${repository}/releases/download/${tag}/${asset.name}`,
        );
        names.set(asset.name, asset);
    }
    const zipNames = [...names.keys()].filter((name) => name.endsWith(".zip"));
    assert.ok(
        zipNames.length > 0 && assets.length === zipNames.length * 2,
        "release requires exactly ZIP/checksum pairs",
    );
    const single = zipNames.length === 1 && zipNames[0] === `${base}.zip`;
    const ordered =
        single ? zipNames : (
            Array.from({ length: zipNames.length }, (_, i) => `${base}-part${i + 1}.zip`)
        );
    if (!single) assert.ok(zipNames.length > 1, "a single ZIP uses the unsuffixed name");
    let total = 0;
    return ordered.map((name) => {
        const archive = names.get(name);
        const checksum = names.get(`${name}.sha256`);
        assert.ok(archive && checksum, "release parts are missing, mixed or nonsequential");
        assert.ok(checksum.size <= 1024, "checksum sidecar exceeds its limit");
        total += archive.size;
        assert.ok(total <= maxReleaseBytes, "release exceeds the proof byte budget");
        const pin = (asset) => ({
            id: asset.id,
            name: asset.name,
            url: asset.browser_download_url,
            sha256: asset.digest.slice(7),
            bytes: asset.size,
        });
        return { ...pin(archive), checksum: pin(checksum) };
    });
}

/** Pin the release identity and ordered native asset digests independently of its tag. */
export function releaseDigest(release, archives) {
    return hash(
        JSON.stringify({
            repository,
            tag: release.tag_name,
            id: release.id,
            publishedAt: release.published_at,
            archives,
        }),
    );
}

/** Map a CI fixture to verified loopback HTTPS; real runs have no source override. */
function fixtureSource(origin) {
    const parsed = new URL(origin);
    assert.equal(parsed.protocol, "https:");
    assert.equal(parsed.hostname, "127.0.0.1");
    assert.equal(parsed.origin, origin);
    assert.equal(parsed.username, "");
    assert.equal(parsed.password, "");
    const transport = (url) => {
        const remote = new URL(url);
        assert.ok(["api.github.com", "github.com"].includes(remote.hostname));
        return origin + remote.pathname + remote.search;
    };
    return { json: (url) => githubJson(transport(url)), transport };
}

/** Read bounded GitHub metadata anonymously, preserving TLS and redirect restrictions. */
async function githubJson(url) {
    const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: { Accept: "application/vnd.github+json" },
    });
    assert.ok(
        response.ok && response.body,
        `GitHub release metadata returned HTTP ${response.status}`,
    );
    let size = 0;
    const chunks = [];
    try {
        for await (const chunk of response.body) {
            size += chunk.length;
            assert.ok(size <= 2 * 1024 * 1024, "GitHub release metadata exceeds its limit");
            chunks.push(chunk);
        }
    } finally {
        if (!response.body.locked) await response.body.cancel().catch(() => {});
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function fileHash(file) {
    const stat = fs.lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), "proof input must be a regular file");
    const digest = createHash("sha256");
    for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
    return digest.digest("hex");
}

function files(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        assert.ok(!entry.isSymbolicLink(), "proof tree contains a symbolic link");
        const file = path.join(directory, entry.name);
        return (
            entry.isDirectory() ? files(file)
            : entry.isFile() ? [file]
            : []
        );
    });
}

/** Clear generated data while retaining only materialized dependency inputs. */
export function clearOutputs(consumer) {
    const build = path.join(consumer, "build");
    if (!fs.existsSync(build)) return;
    for (const name of fs.readdirSync(build))
        if (name !== "cache") fs.rmSync(path.join(build, name), { recursive: true, force: true });
    const cache = path.join(build, "cache");
    if (fs.existsSync(cache))
        for (const name of fs.readdirSync(cache))
            if (!["foreign", "metadata", "navigation"].includes(name))
                fs.rmSync(path.join(cache, name), { recursive: true, force: true });
}

/** Execute the existing Thalorna build against an actual published artwork release. */
export async function proveRelease({ fixture } = {}) {
    assert.ok(
        process.env.GITHUB_ACTIONS === "true" || process.env.GITEA_ACTIONS === "true",
        "CI only",
    );
    assert.ok(path.isAbsolute(process.env.RUNNER_TEMP ?? ""), "RUNNER_TEMP is required");
    assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "0", "TLS verification is required");
    assert.match(process.env.CANDIDATE_SHA ?? "", /^[0-9a-f]{40}$/);
    assert.match(process.env.CONSUMER_SHA ?? "", /^[0-9a-f]{40}$/);
    const tag = process.env.ART_RELEASE_TAG ?? "";
    assert.match(tag, /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    const checkout = path.resolve(path.dirname(import.meta.filename), "..");
    const proof = fixture?.proof ?? path.join(process.env.RUNNER_TEMP, "consumer-proof");
    assert.ok(path.isAbsolute(proof));
    const upstream =
        fixture ? fixtureSource(fixture.origin) : { json: githubJson, transport: (url) => url };
    assert.match(
        process.env.ART_RELEASE_SHA256 ?? "",
        /^[0-9a-f]{64}$/,
        "an expected release SHA-256 is required",
    );
    // The total deadline includes both builds, metadata, inventory and output verification.
    const deadline = Date.now() + 150 * 60 * 1000;
    const remaining = () => {
        const milliseconds = deadline - Date.now();
        assert.ok(milliseconds > 0, "release proof exceeds its total time budget");
        return milliseconds;
    };
    const consumer = fs.realpathSync(path.join(proof, "source"));
    const evidence = path.join(proof, fixture ? "fixture-evidence" : "art-release-evidence");
    const git = (cwd, ...args) =>
        execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    assert.equal(git(checkout, "rev-parse", "HEAD").trim(), process.env.CANDIDATE_SHA);
    const source = fixture?.source ?? path.join(checkout, "consumer-proof-consumer");
    assert.equal(git(source, "rev-parse", "HEAD").trim(), process.env.CONSUMER_SHA);
    const requireConsumer = createRequire(path.join(consumer, "package.json"));
    const installed = path.dirname(
        requireConsumer.resolve("@heroiclands/package-build/package.json"),
    );
    assert.ok(
        installed.startsWith(consumer + path.sep),
        "candidate must be installed inside the isolated consumer",
    );
    const requireCandidate = createRequire(path.join(installed, "package.json"));
    const YAML = requireCandidate("yaml");
    const moduleAt = (name) => import(pathToFileURL(path.join(installed, "engine", name)).href);
    const { downloadCached } = await moduleAt("download-cache.mjs");
    const { openArtArchive } = await moduleAt("art-archive.mjs");
    const { collectArtMasters, masterAssetRecords } = await moduleAt("art-masters.mjs");
    const { inspectPublicDerivative } = await moduleAt("art-public-derivative.mjs");
    const { decodeIndexAddresses } = await moduleAt("note-addresses.mjs");
    const { renderAddress } = await moduleAt("address.mjs");
    const release = await upstream.json(
        `https://api.github.com/repos/${repository}/releases/tags/${tag}`,
    );
    assert.ok(Number.isSafeInteger(release.id) && release.id > 0);
    const assets = [];
    for (let page = 1; ; page++) {
        assert.ok(page <= 2, "release asset pagination exceeds its limit");
        const batch = await upstream.json(
            `https://api.github.com/repos/${repository}/releases/${release.id}/assets?per_page=100&page=${page}`,
        );
        assert.ok(Array.isArray(batch) && batch.length <= 100);
        assets.push(...batch);
        if (batch.length < 100) break;
    }
    const archives = releaseArchives(release, assets, tag);
    const releaseSha256 = releaseDigest(release, archives);
    assert.equal(
        releaseSha256,
        process.env.ART_RELEASE_SHA256,
        "release differs from its expected digest pin",
    );
    const configFile = path.join(consumer, "package-build.config.yaml");
    const originalConfig = fs.readFileSync(configFile);
    const config = YAML.parse(originalConfig.toString("utf8"));
    assert.equal(config.contentPackage, "thalorna");
    const art = {
        archives: archives.map(({ url, sha256 }) => ({ url: upstream.transport(url), sha256 })),
    };
    const configMode = config.art === undefined ? "overlaid" : "declared";
    if (configMode === "declared")
        assert.deepEqual(
            config.art,
            art,
            "declared artwork must exactly match the complete release pins",
        );
    const tracked = git(source, "ls-files", "-z").split("\0").filter(Boolean);
    assert.ok(tracked.length <= 50000, "consumer source exceeds the proof file budget");
    const baseline = new Map();
    for (const file of tracked) baseline.set(file, await fileHash(path.join(consumer, file)));
    const workingDigest = hash(JSON.stringify([...baseline]));
    const gitTreeSha256 = hash(git(source, "ls-tree", "-rz", "HEAD"));
    const overlaidConfig =
        configMode === "declared" ? originalConfig : (
            Buffer.from(originalConfig.toString("utf8") + "\n" + YAML.stringify({ art }))
        );
    assert.deepEqual(YAML.parse(overlaidConfig.toString("utf8")), { ...config, art });
    const scratch = fs.mkdtempSync(path.join(proof, "real-art-release-"));
    const cacheHome = path.join(scratch, "cache");
    const cache = path.join(cacheHome, "heroiclands/downloads");
    const temp = path.join(scratch, "tmp");
    fs.mkdirSync(temp);
    const network = path.join(scratch, "network.json");
    const requestsFile = path.join(scratch, "requests.jsonl");
    fs.writeFileSync(requestsFile, "");
    const preload = pathToFileURL(path.join(checkout, "ci/consumer-art-release-network.mjs")).href;
    const env = {
        ...process.env,
        XDG_CACHE_HOME: cacheHome,
        TMPDIR: temp,
        PACKAGE_BUILD_CONFIG: configFile,
        ART_RELEASE_PROOF_NETWORK: network,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${preload}`,
    };
    let child;
    let cancelled = false;
    const kill = () => {
        if (!child?.pid) return;
        try {
            process.kill(-child.pid, "SIGKILL");
        } catch (error) {
            if (error.code !== "ESRCH") throw error;
        }
    };
    const cancel = () => {
        cancelled = true;
        kill();
    };
    const deadlineTimer = setTimeout(cancel, remaining());
    process.once("SIGTERM", cancel);
    process.once("SIGINT", cancel);
    const runBuild = async (phase) => {
        assert.ok(!cancelled, "proof cancelled");
        fs.writeFileSync(
            network,
            JSON.stringify({ phase, urls: art.archives.map((a) => a.url), log: requestsFile }),
        );
        await new Promise((resolve, reject) => {
            child = spawn("npm", ["run", "build:db"], {
                cwd: consumer,
                env,
                stdio: "inherit",
                detached: true,
            });
            const timer = setTimeout(kill, Math.min(60 * 60 * 1000, remaining()));
            child.once("error", (error) => {
                clearTimeout(timer);
                child = undefined;
                reject(error);
            });
            child.once("close", (code, signal) => {
                clearTimeout(timer);
                child = undefined;
                if (code === 0 && !signal && !cancelled) resolve();
                else
                    reject(
                        new Error(`${phase} consumer build failed: exit=${code}, signal=${signal}`),
                    );
            });
        });
    };
    const requests = () =>
        fs.readFileSync(requestsFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
    const assertSources = async (overlay = true) => {
        for (const [file, digest] of baseline)
            assert.equal(
                await fileHash(path.join(consumer, file)),
                overlay && file === "package-build.config.yaml" ? hash(overlaidConfig) : digest,
                `consumer source changed: ${file}`,
            );
    };
    const assertClean = () => {
        assert.ok(
            !fs
                .readdirSync(cache)
                .some((name) => name.startsWith(".art-archive-") || name.startsWith(".download-")),
            "archive extraction or download temporary files leak",
        );
    };
    const cachedFiles = async () => {
        for (const archive of archives) {
            const file = path.join(cache, archive.sha256);
            assert.equal(fs.statSync(file).size, archive.bytes);
            assert.equal(
                await fileHash(file),
                archive.sha256,
                "cached archive differs from its native digest",
            );
        }
    };
    let originals;
    let expected;
    let rightsByAddress;
    const inspectOutputs = async () => {
        const index = path.join(consumer, "build/content-index/thalorna-metadata.jsonl");
        assert.ok(
            fs.statSync(index).size <= 512 * 1024 * 1024,
            "consumer index exceeds proof limit",
        );
        const byAddress = new Map();
        const lines = createInterface({ input: fs.createReadStream(index), crlfDelay: Infinity });
        for await (const line of lines) {
            if (!line.trim()) continue;
            const record = decodeIndexAddresses(JSON.parse(line), { package: "thalorna" });
            if (record.asset) {
                const address = renderAddress(record.address.canonical);
                assert.ok(!byAddress.has(address), "duplicate indexed artwork identity");
                byAddress.set(address, record);
            }
        }
        const staged = new Map();
        const outputs = [];
        for (const original of expected) {
            const address = original.address.canonical;
            const indexed = byAddress.get(address);
            assert.ok(indexed, `released artwork is absent from the index: ${address}`);
            for (const key of ["path", "attribution", "ai", "license"])
                assert.deepEqual(
                    indexed.asset[key],
                    original.asset[key],
                    `${address}: indexed ${key} differs from its original`,
                );
            const alternative =
                indexed.asset.nonAiAlternative ?
                    renderAddress(indexed.asset.nonAiAlternative)
                :   null;
            assert.equal(
                alternative,
                original.asset.nonAiAlternative,
                `${address}: indexed alternative differs from its original`,
            );
            for (const key of ["prompt", "generator", "processing", "composition", "formerNames"])
                assert.equal(
                    indexed.asset[key],
                    undefined,
                    `${address}: private provenance in public index`,
                );
            const file = path.join(consumer, "build/stage", original.asset.path);
            if (original.asset.ai === true) {
                assert.ok(!fs.existsSync(file), "AI original is present in the Foundry stage");
                assert.ok(
                    alternative && byAddress.get(alternative)?.asset.ai === false,
                    "AI artwork requires its declared non-AI alternative",
                );
                continue;
            }
            assert.equal(original.asset.ai, false, "released artwork requires explicit AI status");
            const bytes = fs.readFileSync(file);
            const output = inspectPublicDerivative(original.asset.path, bytes, "thalorna");
            assert.equal(output.metadata.address, address);
            assert.equal(output.metadata.ai, false);
            assert.deepEqual(output.metadata.creator, original.asset.attribution);
            assertDerivativeRights(rightsByAddress, address, output.metadata.rights);
            const format =
                original.asset.path.endsWith(".jpg") ?
                    "jpeg"
                :   path.extname(original.asset.path).slice(1);
            assert.equal(output.format, format);
            const reference = `modules/thalorna/${original.asset.path}`;
            staged.set(reference, address);
            outputs.push({ address, path: original.asset.path, format, sha256: hash(bytes) });
        }
        assert.ok(outputs.length > 0, "no released non-AI artwork reaches the Foundry stage");
        const packs = {};
        const references = [];
        for (const pack of config.packs) {
            const json = files(path.join(consumer, "build/packs-json", pack.name)).filter((file) =>
                file.endsWith(".json"),
            );
            assert.ok(json.length, `${pack.name}: no compiled documents`);
            for (const file of json) {
                const doc = JSON.parse(fs.readFileSync(file, "utf8"));
                assert.ok(typeof doc._id === "string" && doc._id.length > 0);
                const visit = (value, field = "") => {
                    if (typeof value === "string" && staged.has(value))
                        references.push({
                            pack: pack.name,
                            document: doc._id,
                            field,
                            address: staged.get(value),
                        });
                    else if (value && typeof value === "object")
                        for (const [key, nested] of Object.entries(value))
                            visit(nested, field ? `${field}.${key}` : key);
                };
                visit(doc);
            }
            const directory = path.join(consumer, "build/stage/packs", pack.name);
            const manifest = fs.readFileSync(path.join(directory, "CURRENT"), "utf8").trim();
            assert.match(manifest, /^MANIFEST-[0-9]+$/);
            assert.ok(fs.statSync(path.join(directory, manifest)).size > 0);
            assert.ok(
                fs
                    .readdirSync(directory)
                    .some(
                        (name) =>
                            /\.(?:ldb|sst|log)$/.test(name) &&
                            fs.statSync(path.join(directory, name)).size > 0,
                    ),
            );
            packs[pack.name] = json.length;
        }
        assert.ok(references.length > 0, "no real compiled note refers to released artwork");
        const order = (a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b));
        return { outputs: outputs.sort(order), references: references.sort(order), packs };
    };
    try {
        // Sidecars are real released assets; their cache entries cannot seed ZIP entries.
        for (const archive of archives) {
            const sidecar = await downloadCached(
                upstream.transport(archive.checksum.url),
                archive.checksum.sha256,
                {
                    cacheDir: cache,
                    maxBytes: 1024,
                    signal: AbortSignal.timeout(30000),
                },
            );
            assert.equal(fs.statSync(sidecar).size, archive.checksum.bytes);
            assert.equal(
                fs.readFileSync(sidecar, "utf8"),
                `${archive.sha256}  ${archive.name}\n`,
                "released checksum does not identify the exact native-digest ZIP",
            );
            assert.ok(
                !fs.existsSync(path.join(cache, archive.sha256)),
                "cold archive cache must be empty",
            );
        }
        fs.writeFileSync(configFile, overlaidConfig);
        clearOutputs(consumer);
        await runBuild("cold");
        for (const archive of archives)
            assert.equal(
                requests().filter(
                    (r) => r.phase === "cold" && r.url === upstream.transport(archive.url),
                ).length,
                1,
                "cold build must request each released archive exactly once",
            );
        await cachedFiles();
        assertClean();
        const inventoryDeadline = Date.now() + Math.min(20 * 60 * 1000, remaining());
        const sessions = [];
        originals = [];
        try {
            for (const archive of archives) {
                const inventoryRemaining = inventoryDeadline - Date.now();
                assert.ok(inventoryRemaining > 0, "ZIP inventory exceeds its shared time budget");
                const session = await openArtArchive(
                    upstream.transport(archive.url),
                    archive.sha256,
                    {
                        cacheDir: cache,
                        signal: AbortSignal.timeout(Math.min(inventoryRemaining, remaining())),
                        fetch: () => {
                            throw new Error("archive inventory must use the verified cold cache");
                        },
                    },
                );
                sessions.push(session);
                const inventory = JSON.parse(
                    execFileSync(
                        "python3",
                        [
                            "-c",
                            "import hashlib,json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n result=[]\n for entry in z.infolist():\n  h=hashlib.sha256()\n  with z.open(entry) as f:\n   while chunk:=f.read(1048576): h.update(chunk)\n  result.append({'name':entry.filename,'bytes':entry.file_size,'sha256':h.hexdigest()})\n print(json.dumps(result))",
                            path.join(cache, archive.sha256),
                        ],
                        {
                            encoding: "utf8",
                            maxBuffer: 8 * 1024 * 1024,
                            timeout: Math.max(
                                1,
                                Math.min(inventoryDeadline - Date.now(), remaining()),
                            ),
                        },
                    ),
                );
                assert.ok(inventory.length > 2 && inventory.length <= 10000);
                assert.equal(inventory.filter((entry) => entry.name === "README.md").length, 1);
                assert.equal(inventory.filter((entry) => entry.name === "CHANGELOG.md").length, 1);
                for (const entry of inventory.filter(
                    (entry) => !["README.md", "CHANGELOG.md"].includes(entry.name),
                )) {
                    assert.match(entry.name, /^artwork\/[A-Za-z0-9_-]+\.(png|svg)$/);
                    const file = path.join(session.root, entry.name);
                    assert.equal(fs.statSync(file).size, entry.bytes);
                    assert.equal(
                        await fileHash(file),
                        entry.sha256,
                        "extracted original differs from its release member",
                    );
                    originals.push({ archive: archive.name, ...entry });
                }
                archive.layout = inventory;
            }
            const collected = collectArtMasters(
                sessions.map((session) => session.root),
                "thalorna",
            );
            assert.equal(
                collected.findings.length,
                0,
                "released originals fail normal master validation",
            );
            rightsByAddress = new Map(
                [...collected.masters].map(([address, master]) => [address, master.record.rights]),
            );
            expected = masterAssetRecords(collected.masters);
            assert.equal(expected.length, originals.length);
        } finally {
            for (const session of sessions) await session.dispose();
        }
        const cold = await inspectOutputs();
        await assertSources();
        assertClean();
        clearOutputs(consumer);
        await runBuild("warm");
        const warm = await inspectOutputs();
        assert.deepEqual(warm, cold, "cold and cached release outputs differ");
        assert.equal(
            requests().filter((r) => r.phase === "warm").length,
            0,
            "warm phase requests an archive",
        );
        await cachedFiles();
        await assertSources();
        assertClean();
        fs.writeFileSync(configFile, originalConfig);
        await assertSources(false);
        const receipt = {
            scope:
                fixture ?
                    "Synthetic HTTPS fixture; not published-release evidence"
                :   "Actual complete published artwork release consumed by the pinned Thalorna tree",
            fixture: Boolean(fixture),
            candidate: process.env.CANDIDATE_SHA,
            consumer: process.env.CONSUMER_SHA,
            candidateSha256: await fileHash(path.join(proof, "candidate.tgz")),
            release: {
                repository,
                tag,
                id: release.id,
                publishedAt: release.published_at,
                url: release.html_url,
            },
            archives,
            originals,
            releaseSha256,
            consumerGitTreeSha256: gitTreeSha256,
            postInstallWorkingSourceSha256: workingDigest,
            config: {
                mode: configMode,
                before: hash(originalConfig),
                overlay: hash(overlaidConfig),
                restored: true,
            },
            coldArchiveRequests: requests(),
            warmArchiveFetchesRefused: true,
            cold,
            warm,
        };
        remaining();
        fs.mkdirSync(evidence, { recursive: true });
        fs.writeFileSync(
            path.join(evidence, fixture ? "fixture-result.json" : "receipt.json"),
            JSON.stringify(receipt, null, 2) + "\n",
        );
        console.log(
            `Verified ${fixture ? "synthetic fixture" : "real release"} ${tag}: ${archives.length} archives, ${originals.length} unchanged originals, ${cold.outputs.length} staged images, ${cold.references.length} compiled references; warm archive requests: 0.`,
        );
        return receipt;
    } finally {
        kill();
        clearTimeout(deadlineTimer);
        fs.writeFileSync(configFile, originalConfig);
        fs.rmSync(scratch, { recursive: true, force: true });
        process.removeListener("SIGTERM", cancel);
        process.removeListener("SIGINT", cancel);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) await proveRelease();
