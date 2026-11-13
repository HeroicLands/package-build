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

/** Pinned public artwork and private Git/LFS source inputs. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { unzipSync } from "fflate";
import { readCanonicalKey, renderAddress } from "./address.mjs";
import { isAddressSegment } from "./address-charset.mjs";
import {
    readSvgProvenance,
    readWebpProvenance,
    sniffFormat,
    hasForeignXmp,
} from "./art-provenance-core.mjs";
import { writeDerivativeProvenance } from "./art-provenance.mjs";
import { buildPrimaryNoteIndex, resolvePrimaryNote } from "./art-primary-note.mjs";
import { assertPrivateArtRoots, collectArtMasters } from "./art-masters.mjs";
import { renderArtMasters } from "./art-master-render.mjs";
import { setArtSource } from "./art-source.mjs";

/** @typedef {{version: 1, package: string, source: {repository: string, revision: string}, rendered: {url: string, sha256: string}}} ArtLock */
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const PUBLIC_FIELDS = new Set([
    "address",
    "identifier",
    "derived",
    "derivedFrom",
    "creator",
    "rights",
    "name",
    "primaryNote",
]);
const PUBLIC_PROPERTIES = [
    "hl:address",
    "dc:identifier",
    "hl:derived",
    "hl:derivedFrom",
    "dc:creator",
    "dc:rights",
    "hl:name",
    "hl:primarynote",
];

/** Located failure without including authored credential values. */
function failure(config, message) {
    return Object.assign(new Error(`${path.join(config.rootDir, "art.lock")}: error: ${message}`), {
        located: true,
    });
}
function closed(value, keys) {
    return (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length === keys.length &&
        keys.every((key) => Object.hasOwn(value, key))
    );
}
const CREDENTIAL_QUERY =
    /^(?:access[_-]?token|token|api[_-]?key|auth|authorization|password|secret|x-amz-(?:credential|signature|security-token)|x-goog-(?:credential|signature)|sig)$/iu;
function safeUrl(value) {
    if (typeof value !== "string") return false;
    try {
        const url = new URL(value);
        return (
            url.protocol === "https:" &&
            !!url.hostname &&
            !url.username &&
            !url.password &&
            !url.hash &&
            ![...url.searchParams.keys()].some((key) => CREDENTIAL_QUERY.test(key)) &&
            !/[\s\x00-\x1f]/u.test(value)
        );
    } catch {
        return false;
    }
}
/**
 * Read the root art.lock, or return null when the package has no pin.
 * @param {{rootDir:string, contentPackage:string, art?:{masterRoots?:readonly string[]}}} config Package configuration.
 * @returns {ArtLock|null} Validated lock.
 */
export function readArtLock(config) {
    if (!config.rootDir) return null;
    const file = path.join(config.rootDir, "art.lock");
    if (!fs.existsSync(file)) return null;
    let lock;
    try {
        lock = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        throw failure(config, "invalid JSON");
    }
    if (
        !closed(lock, ["version", "package", "source", "rendered"]) ||
        lock.version !== 1 ||
        lock.package !== config.contentPackage ||
        !isAddressSegment(lock.package)
    )
        throw failure(
            config,
            "expected version 1, this content package, source and rendered fields only",
        );
    if (
        !closed(lock.source, ["repository", "revision"]) ||
        !safeUrl(lock.source.repository) ||
        typeof lock.source.revision !== "string" ||
        !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(lock.source.revision)
    )
        throw failure(
            config,
            "source requires a credential-free HTTPS repository and full hexadecimal commit",
        );
    if (
        !closed(lock.rendered, ["url", "sha256"]) ||
        !safeUrl(lock.rendered.url) ||
        typeof lock.rendered.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(lock.rendered.sha256)
    )
        throw failure(
            config,
            "rendered requires a public HTTPS URL without credentials and a SHA-256 digest",
        );
    if (config.art?.masterRoots?.length)
        throw failure(config, "art.lock and art.masterRoots are separate input modes; select one");
    return lock;
}
/** Private fetched sources are protected even when no master roots are configured. */
export function privateArtRoots(config) {
    if (!config.rootDir)
        return [...(config.art?.masterRoots ?? []), ...(config.art?.componentRoots ?? [])];
    const fetched = path.join(config.rootDir, "build", ".cache", "art-sources");
    return [
        ...(config.art?.masterRoots ?? []),
        ...(config.art?.componentRoots ?? []),
        ...(fs.existsSync(fetched) ? [fetched] : []),
    ];
}
function safeOutput(config, folder) {
    const root = path.resolve(config.rootDir);
    const rel = path.relative(root, path.resolve(folder));
    if (rel.startsWith("..") || path.isAbsolute(rel) || rel.split(path.sep)[0] !== "build")
        throw failure(config, "art outputs must be beneath build/");
    let current = root;
    for (const part of rel.split(path.sep)) {
        current = path.join(current, part);
        const stat = fs.lstatSync(current, { throwIfNoEntry: false });
        if (stat?.isSymbolicLink())
            throw failure(config, "symbolic links are not allowed in artwork output paths");
        if (stat && !stat.isDirectory())
            throw failure(config, "artwork output path is not a directory");
    }
    assertPrivateArtRoots(config.art?.masterRoots ?? [], [folder]);
}
function cacheDirectory(config, lock) {
    return path.join(config.rootDir, "build", ".cache", "pinned-art", digest(JSON.stringify(lock)));
}

/** Read central-directory metadata before decompression; ZIP64 and encrypted entries are refused. */
function checkZip(bytes) {
    let end = -1;
    for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
        if (
            bytes.readUInt32LE(at) === 0x06054b50 &&
            at + 22 + bytes.readUInt16LE(at + 20) === bytes.length
        ) {
            end = at;
            break;
        }
    }
    if (end < 0 || bytes.length > 2 ** 31)
        throw new Error("malformed or oversized artwork archive");
    const count = bytes.readUInt16LE(end + 10),
        size = bytes.readUInt32LE(end + 12),
        start = bytes.readUInt32LE(end + 16);
    if (
        !count ||
        count === 65535 ||
        bytes.readUInt16LE(end + 4) ||
        bytes.readUInt16LE(end + 6) ||
        bytes.readUInt16LE(end + 8) !== count ||
        start + size !== end
    )
        throw new Error("unsupported artwork archive directory");
    let at = start,
        total = 0;
    const names = new Set(),
        checks = new Map();
    for (let i = 0; i < count; i++) {
        if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50)
            throw new Error("malformed artwork archive entry");
        const flags = bytes.readUInt16LE(at + 8),
            method = bytes.readUInt16LE(at + 10),
            n = bytes.readUInt16LE(at + 28),
            extra = bytes.readUInt16LE(at + 30),
            comment = bytes.readUInt16LE(at + 32),
            mode = bytes.readUInt32LE(at + 38) >>> 16;
        if (
            at + 46 + n + extra + comment > end ||
            flags & 1 ||
            ![0, 8].includes(method) ||
            bytes.readUInt32LE(at + 20) === 0xffffffff ||
            bytes.readUInt32LE(at + 24) === 0xffffffff ||
            (mode & 0xf000 && ![0x8000, 0x4000].includes(mode & 0xf000))
        )
            throw new Error("unsafe or unsupported artwork archive entry");
        const originalSize = bytes.readUInt32LE(at + 24);
        total += originalSize;
        if (originalSize > 256 * 1024 * 1024 || total > 2 ** 31)
            throw new Error("oversized artwork archive");
        const name = bytes.subarray(at + 46, at + 46 + n).toString("utf8");
        checks.set(name, { size: originalSize, crc: bytes.readUInt32LE(at + 16) });
        if (
            !name ||
            /[\\:<>"|?*\x00-\x1f\uFFFD]/u.test(name) ||
            name.startsWith("/") ||
            name
                .split("/")
                .some(
                    (part, index, parts) =>
                        part === "." ||
                        part === ".." ||
                        /[. ]$/u.test(part) ||
                        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part) ||
                        (!part && index !== parts.length - 1),
                )
        )
            throw new Error("unsafe artwork archive path");
        const key = name.replace(/\/$/u, "").normalize("NFC").toLowerCase();
        if (names.has(key)) throw new Error("duplicate artwork archive path");
        names.add(key);
        const local = bytes.readUInt32LE(at + 42);
        if (
            local + 30 > start ||
            bytes.readUInt32LE(local) !== 0x04034b50 ||
            bytes.readUInt16LE(local + 6) !== flags ||
            bytes.readUInt16LE(local + 8) !== method
        )
            throw new Error("malformed artwork archive local entry");
        const ln = bytes.readUInt16LE(local + 26),
            le = bytes.readUInt16LE(local + 28);
        if (
            local + 30 + ln + le + bytes.readUInt32LE(at + 20) > start ||
            !bytes
                .subarray(local + 30, local + 30 + ln)
                .equals(bytes.subarray(at + 46, at + 46 + n))
        )
            throw new Error("artwork archive entry names disagree");
        at += 46 + n + extra + comment;
    }
    if (at !== end) throw new Error("malformed artwork archive directory size");
    return checks;
}
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    return value;
});
function crc32(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) value = (value >>> 8) ^ CRC_TABLE[(value ^ byte) & 255];
    return (value ^ 0xffffffff) >>> 0;
}
function archiveFiles(config, lock, bytes) {
    if (digest(bytes) !== lock.rendered.sha256)
        throw failure(config, "public archive SHA-256 does not match the pin");
    try {
        const checks = checkZip(bytes),
            files = unzipSync(bytes);
        if (Object.keys(files).length !== checks.size) throw new Error("duplicate entries");
        for (const [name, value] of Object.entries(files)) {
            const check = checks.get(name);
            if (!check || value.length !== check.size || crc32(value) !== check.crc)
                throw new Error("invalid entry checksum");
        }
        return files;
    } catch {
        throw failure(config, "unsafe, duplicate or malformed public artwork archive");
    }
}
function inspectPublic(config, lock, files, records) {
    const indexed = new Map(
        records
            .filter((r) => r.asset)
            .map((r) => [renderAddress(readCanonicalKey(r.address.canonical)), r]),
    );
    const noteIndex = buildPrimaryNoteIndex(records);
    const byAddress = new Map();
    for (const [name, value] of Object.entries(files)) {
        if (name.endsWith("/")) {
            if (value.length) throw failure(config, "archive directory carries data");
            continue;
        }
        const bytes = Buffer.from(value),
            format = sniffFormat(bytes);
        if (!["webp", "svg"].includes(format) || path.extname(name).toLowerCase() !== `.${format}`)
            throw failure(config, "public artwork archive accepts only WebP and SVG derivatives");
        let read;
        try {
            read = format === "svg" ? readSvgProvenance(bytes) : readWebpProvenance(bytes);
        } catch {
            throw failure(config, "invalid image metadata in public artwork archive");
        }
        const r = read.record,
            tuple = readCanonicalKey(r.address);
        if (
            !tuple ||
            tuple.package !== lock.package ||
            tuple.system !== "none" ||
            !["image", "icon"].includes(tuple.type) ||
            !Object.values(tuple).every(isAddressSegment) ||
            r.identifier !== r.address ||
            r.derived !== "true" ||
            r.derivedFrom !== r.address
        )
            throw failure(config, "invalid embedded public image identity or parent trace");
        if (byAddress.has(r.address))
            throw failure(config, "duplicate embedded image address in public archive");
        const standard = indexed.get(r.address);
        if (!standard)
            throw failure(config, "public archive address is absent from the standard index");
        if (
            Object.keys(r).some((key) => !PUBLIC_FIELDS.has(key)) ||
            !read.packet ||
            hasForeignXmp(read.packet, PUBLIC_PROPERTIES)
        )
            throw failure(config, "public image metadata exceeds the publication allowlist");
        if (r.creator !== (standard.asset.attribution || undefined))
            throw failure(config, "public image attribution differs from the standard index");
        if (r.name !== undefined || r.primaryNote !== undefined) {
            const resolved = resolvePrimaryNote(noteIndex, r.address).note;
            const primary = r.primaryNote ?? resolved?.address;
            const named = noteIndex.notes.get(primary);
            if (
                !named ||
                !noteIndex.publicNotes.has(primary) ||
                (resolved && resolved.address !== primary) ||
                (r.name !== undefined && r.name !== named.name)
            )
                throw failure(
                    config,
                    "public note metadata requires its matching public standard-index note",
                );
        }
        let sanitized;
        try {
            sanitized = writeDerivativeProvenance(bytes, r, {
                repeat: [
                    "derivedFrom",
                    ...(r.name !== undefined ? ["name"] : []),
                    ...(r.primaryNote !== undefined ? ["primaryNote"] : []),
                ],
                notePublic: r.name !== undefined || r.primaryNote !== undefined,
            }).bytes;
        } catch {
            throw failure(config, "public archive contains unsafe image metadata or markup");
        }
        if (!sanitized.equals(bytes))
            throw failure(config, "public archive contains unsanitized image metadata or markup");
        byAddress.set(r.address, { name, bytes, format, record: standard });
    }
    if (!byAddress.size) throw failure(config, "public artwork archive contains no images");
    return byAddress;
}
function requireLock(config) {
    const lock = readArtLock(config);
    if (!lock) throw failure(config, "create the package's art.lock before fetching artwork");
    return lock;
}

/**
 * Fetch and verify a pinned public archive; no build invokes this operation.
 * @param {object} config Resolved package configuration.
 * @param {{records: readonly Record<string, any>[], from?: string}} options Standard index and optional local ZIP.
 * @returns {Promise<string>} Complete cache directory.
 */
export async function fetchPublicArt(config, { records, from }) {
    const lock = requireLock(config),
        folder = cacheDirectory(config, lock);
    safeOutput(config, folder);
    let bytes;
    if (from) bytes = fs.readFileSync(path.resolve(from));
    else {
        let response,
            url = lock.rendered.url;
        for (let redirects = 0; redirects <= 5; redirects++) {
            try {
                response = await fetch(url, { redirect: "manual" });
            } catch {
                throw failure(config, "cannot fetch the public artwork archive");
            }
            if (![301, 302, 303, 307, 308].includes(response.status)) break;
            const location = response.headers.get("location");
            await response.body?.cancel();
            let next;
            try {
                next = new URL(location ?? "", url);
            } catch {
                throw failure(config, "invalid public artwork redirect");
            }
            if (
                !location ||
                redirects === 5 ||
                next.protocol !== "https:" ||
                next.username ||
                next.password ||
                next.hash
            )
                throw failure(
                    config,
                    "public artwork redirect must remain HTTPS without user credentials and within five hops",
                );
            url = next.href;
        }
        if (!response.ok)
            throw failure(config, `public artwork fetch returned HTTP ${response.status}`);
        const chunks = [];
        let length = 0;
        try {
            for await (const chunk of response.body) {
                length += chunk.length;
                if (length > 2 ** 31)
                    throw failure(config, "public archive exceeds the 2 GiB size limit");
                chunks.push(chunk);
            }
        } catch (error) {
            if (error.located) throw error;
            throw failure(config, "public artwork download is incomplete");
        }
        bytes = Buffer.concat(chunks);
    }
    const files = archiveFiles(config, lock, bytes);
    inspectPublic(config, lock, files, records);
    fs.mkdirSync(path.dirname(folder), { recursive: true });
    const staging = fs.mkdtempSync(path.join(path.dirname(folder), ".fetch-"));
    try {
        fs.mkdirSync(path.join(staging, "files"));
        for (const [name, value] of Object.entries(files)) {
            if (name.endsWith("/")) continue;
            const file = path.join(staging, "files", name);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, value, { flag: "wx" });
        }
        fs.writeFileSync(path.join(staging, "archive.zip"), bytes, { flag: "wx" });
        if (fs.existsSync(folder)) {
            try {
                loadPinnedArt(config, records);
                return folder;
            } catch {
                const displaced = fs.mkdtempSync(path.join(path.dirname(folder), ".replace-"));
                try {
                    fs.renameSync(folder, path.join(displaced, "cache"));
                    try {
                        fs.renameSync(staging, folder);
                    } catch (error) {
                        fs.renameSync(path.join(displaced, "cache"), folder);
                        throw error;
                    }
                } finally {
                    fs.rmSync(displaced, { recursive: true, force: true });
                }
                return folder;
            }
        }
        fs.renameSync(staging, folder);
        return folder;
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
    }
}

/**
 * Read a complete verified public cache offline and bind it to standard records.
 * @param {object} config Resolved package configuration.
 * @param {readonly Record<string, any>[]} records Existing standard content index.
 * @returns {{records: Record<string,any>[], files: Map<string,string>, paths:string[]}} Public inputs; never canonical masters.
 */
export function loadPinnedArt(config, records) {
    const lock = readArtLock(config);
    if (!lock) return { records: [...records], files: new Map(), paths: [] };
    const folder = cacheDirectory(config, lock);
    safeOutput(config, folder);
    try {
        const archive = path.join(folder, "archive.zip");
        if (fs.lstatSync(archive).isSymbolicLink()) throw new Error("linked archive");
        const files = archiveFiles(config, lock, fs.readFileSync(archive));
        const addressed = inspectPublic(config, lock, files, records);
        const paths = [path.join(config.rootDir, "art.lock"), archive],
            actual = new Map();
        const visit = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const file = path.join(dir, entry.name);
                if (entry.isSymbolicLink()) throw new Error("linked cache entry");
                if (entry.isDirectory()) visit(file);
                else if (entry.isFile())
                    actual.set(
                        path.relative(path.join(folder, "files"), file).split(path.sep).join("/"),
                        file,
                    );
                else throw new Error("non-file cache entry");
            }
        };
        if (fs.lstatSync(path.join(folder, "files")).isSymbolicLink())
            throw new Error("linked cache directory");
        visit(path.join(folder, "files"));
        const expected = Object.entries(files).filter(([name]) => !name.endsWith("/"));
        if (actual.size !== expected.length) throw new Error("partial cache");
        for (const [name, bytes] of expected) {
            const file = actual.get(name);
            if (!file || !fs.readFileSync(file).equals(Buffer.from(bytes)))
                throw new Error("changed cache entry");
            paths.push(file);
        }
        const mapped = new Map(
            [...addressed].map(([address, row]) => [address, actual.get(row.name)]),
        );
        return {
            files: mapped,
            paths,
            records: records.map((record) => {
                if (!record.asset) return record;
                const address = renderAddress(readCanonicalKey(record.address.canonical)),
                    row = addressed.get(address);
                if (!row) return record;
                const tuple = readCanonicalKey(address);
                return setArtSource(
                    {
                        ...record,
                        asset: {
                            ...record.asset,
                            path: `${tuple.type === "icon" ? "icons" : "images"}/${tuple.shortcode}.${row.format}`,
                        },
                    },
                    mapped.get(address),
                );
            }),
        };
    } catch (error) {
        throw failure(
            config,
            `pinned public artwork is missing or invalid; run package-build art fetch (${error.located ? error.message.split("error: ").at(-1) : "cache integrity check failed"})`,
        );
    }
}

/**
 * Restore an exact private Git/LFS revision without altering authored roots.
 * @param {object} config Resolved package configuration.
 * @param {{from?:string}} [options] Optional local Git repository for offline verification.
 * @returns {Promise<string>} Verified private source checkout beneath build/.
 */
export async function fetchArtSource(config, { from } = {}) {
    const lock = requireLock(config),
        parent = path.join(config.rootDir, "build", ".cache", "art-sources");
    safeOutput(config, parent);
    const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" };
    const git = (args, cwd) => {
        try {
            return execFileSync("git", ["-c", `core.hooksPath=${os.devNull}`, ...args], {
                cwd,
                env,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
                maxBuffer: 64 * 1024 * 1024,
            });
        } catch {
            throw failure(
                config,
                "private source Git/LFS verification failed; check Git credentials, git-lfs and the pinned revision",
            );
        }
    };
    git(["lfs", "version"], config.rootDir);
    fs.mkdirSync(parent, { recursive: true });
    const staging = fs.mkdtempSync(path.join(parent, ".fetch-"));
    const checkout = path.join(staging, "repository"),
        folder = path.join(parent, digest(JSON.stringify(lock.source)));
    try {
        git(
            [
                "clone",
                "--no-checkout",
                "--no-local",
                "--",
                from ? path.resolve(from) : lock.source.repository,
                checkout,
            ],
            config.rootDir,
        );
        git(["lfs", "install", "--local", "--skip-repo", "--skip-smudge"], checkout);
        git(["fetch", "--no-tags", "origin", lock.source.revision], checkout);
        const revision = git(
            ["rev-parse", "--verify", `${lock.source.revision}^{commit}`],
            checkout,
        ).trim();
        if (revision !== lock.source.revision)
            throw failure(config, "private source revision differs from the pin");
        if (git(["ls-tree", "--name-only", revision, ".lfsconfig"], checkout).trim())
            throw failure(
                config,
                "private art repositories must use their Git remote's LFS endpoint",
            );
        git(
            [
                "-c",
                "filter.lfs.smudge=",
                "-c",
                "filter.lfs.process=",
                "-c",
                "filter.lfs.required=false",
                "checkout",
                "--detach",
                revision,
            ],
            checkout,
        );
        git(["lfs", "fetch", "origin", revision], checkout);
        git(["lfs", "checkout"], checkout);
        git(["fsck", "--full"], checkout);
        git(["lfs", "fsck", "--objects", "--pointers", revision], checkout);
        const lfs = new Set(git(["lfs", "ls-files", "--name-only"], checkout).trim().split("\n"));
        const { masters, findings } = collectArtMasters([checkout], lock.package);
        if (findings.length || !masters.size)
            throw failure(config, "private source masters fail embedded identity validation");
        const hashes = [];
        for (const master of masters.values()) {
            if (!lfs.has(path.relative(checkout, master.file).split(path.sep).join("/")))
                throw failure(config, "every private master must be stored in Git LFS");
            hashes.push(digest(fs.readFileSync(master.file)));
        }
        const receipt = { revision, masterSha256: hashes.sort() };
        fs.writeFileSync(path.join(staging, "integrity.json"), JSON.stringify(receipt) + "\n");
        if (fs.existsSync(folder))
            throw failure(
                config,
                "verified source destination exists; retain it and choose an empty build workspace for another restore",
            );
        fs.renameSync(staging, folder);
        return path.join(folder, "repository");
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
    }
}

/**
 * Reproduce the pinned public images from the fetched private revision.
 * @param {object} config Resolved package configuration with the unchanged art.lock.
 * @param {{records:readonly Record<string,any>[]}} options Standard content index.
 * @returns {Promise<Map<string,string>>} Byte-verified public renders beneath build/.
 */
export async function reproducePinnedArt(config, { records }) {
    const lock = requireLock(config),
        folder = path.join(
            config.rootDir,
            "build",
            ".cache",
            "art-sources",
            digest(JSON.stringify(lock.source)),
        );
    safeOutput(config, folder);
    const checkout = path.join(folder, "repository");
    const git = (args) => {
        try {
            return execFileSync("git", ["-c", `core.hooksPath=${os.devNull}`, ...args], {
                cwd: checkout,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
                env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" },
            }).trim();
        } catch {
            throw failure(
                config,
                "private source verification failed; run package-build art source fetch in an empty build workspace",
            );
        }
    };
    if (
        git(["rev-parse", "HEAD"]) !== lock.source.revision ||
        git(["status", "--porcelain", "--untracked-files=all"])
    )
        throw failure(config, "private source checkout differs from its pinned revision");
    git(["fsck", "--full"]);
    git(["lfs", "fsck", "--objects", "--pointers", lock.source.revision]);
    const { masters, findings } = collectArtMasters([checkout], lock.package);
    if (findings.length)
        throw failure(config, "private source master identity verification failed");
    let receipt;
    try {
        receipt = JSON.parse(fs.readFileSync(path.join(folder, "integrity.json"), "utf8"));
    } catch {
        throw failure(config, "private source integrity receipt is missing");
    }
    if (
        receipt.revision !== lock.source.revision ||
        JSON.stringify(receipt.masterSha256) !==
            JSON.stringify(
                [...masters.values()].map((master) => digest(fs.readFileSync(master.file))).sort(),
            )
    )
        throw failure(config, "private source master checksums differ from the verified restore");
    const pinned = loadPinnedArt(config, records),
        selected = new Map();
    for (const address of pinned.files.keys()) {
        const master = masters.get(address);
        if (!master) throw failure(config, "pinned public artwork has no matching private master");
        selected.set(address, master);
    }
    const out = path.join(config.rootDir, "build", "art-reproduced"),
        cache = path.join(config.rootDir, "build", ".cache", "art");
    safeOutput(config, out);
    safeOutput(config, cache);
    assertPrivateArtRoots(privateArtRoots(config), [out, cache]);
    const rendered = await renderArtMasters(selected, records, out, cache);
    for (const [address, file] of rendered)
        if (!fs.readFileSync(file).equals(fs.readFileSync(pinned.files.get(address))))
            throw failure(
                config,
                "private regeneration differs from the pinned public image bytes",
            );
    return rendered;
}
