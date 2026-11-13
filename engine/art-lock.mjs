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
import { formatLocator } from "./diagnostics.mjs";

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
    return Object.assign(
        new Error(
            `${formatLocator({ file: path.join(config.rootDir, "art.lock") })}: error: ${message}`,
        ),
        {
            located: true,
        },
    );
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
 * @param {{rootDir:string, contentPackage:string, art?:{masterRoots?:readonly string[],componentRoots?:readonly string[]}}} config Package configuration.
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
    if (config.art?.masterRoots?.length || config.art?.componentRoots?.length)
        throw failure(
            config,
            "art.lock and private art roots are separate input modes; select one",
        );
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
    assertPrivateArtRoots(
        [...(config.art?.masterRoots ?? []), ...(config.art?.componentRoots ?? [])],
        [folder],
    );
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
    // The decompressor scans backward for a footer and also recognizes ZIP64
    // locators. Require it to select the directory checked here.
    for (let at = bytes.length - 22; at > end; at--) {
        if (bytes.readUInt32LE(at) === 0x06054b50)
            throw new Error("ambiguous artwork archive footer");
    }
    if (end >= 20 && bytes.readUInt32LE(end - 20) === 0x07064b50)
        throw new Error("unsupported artwork archive ZIP64 locator");
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

/** Git selectors belong to the operation, never to the invoking repository. */
function sourceEnvironment(offline = false) {
    const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    );
    if (!offline)
        for (const key of ["GIT_ASKPASS", "GIT_SSH", "GIT_SSH_COMMAND", "GIT_SSH_VARIANT"])
            if (process.env[key] !== undefined) env[key] = process.env[key];
    Object.assign(env, { GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" });
    if (offline)
        Object.assign(env, {
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_SYSTEM: os.devNull,
            GIT_CONFIG_GLOBAL: os.devNull,
            GIT_NO_REPLACE_OBJECTS: "1",
            GIT_NO_LAZY_FETCH: "1",
            GIT_ATTR_NOSYSTEM: "1",
        });
    return env;
}
function sourceGit(args, cwd, env) {
    return execFileSync("git", ["-c", `core.hooksPath=${os.devNull}`, ...args], {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
    });
}
/** Fixed control paths and policy keep offline commands away from cached configuration. */
function offlineSourceGit(control, checkout) {
    const gitDir = path.join(control, ".git");
    const env = {
        ...sourceEnvironment(true),
        GIT_DIR: gitDir,
        GIT_WORK_TREE: checkout,
        GIT_OBJECT_DIRECTORY: path.join(checkout, ".git", "objects"),
        GIT_INDEX_FILE: path.join(gitDir, "index"),
    };
    return (args) =>
        sourceGit(
            [
                "-c",
                "core.fsmonitor=false",
                "-c",
                `core.attributesFile=${os.devNull}`,
                "-c",
                `lfs.storage=${path.join(checkout, ".git", "lfs")}`,
                "-c",
                "lfs.fetchinclude=",
                "-c",
                "lfs.fetchexclude=",
                "-c",
                "protocol.allow=never",
                ...args,
            ],
            control,
            env,
        );
}
function sourceDirectory(folder) {
    if (!fs.lstatSync(folder).isDirectory()) throw new Error("source directory required");
}
function sourceFile(file) {
    if (!fs.lstatSync(file).isFile()) throw new Error("regular source file required");
    return fs.readFileSync(file);
}
/** Walk without following links, including ignored files and empty directories. */
function sourceFiles(folder, skipGit = false, prefix = "", files = new Set()) {
    sourceDirectory(folder);
    for (const name of fs.readdirSync(folder)) {
        if (skipGit && !prefix && name === ".git") continue;
        const file = path.join(folder, name),
            relative = prefix + name;
        const stat = fs.lstatSync(file);
        if (stat.isDirectory()) sourceFiles(file, false, relative + "/", files);
        else if (stat.isFile()) files.add(relative);
        else throw new Error("source links and special files are forbidden");
    }
    return files;
}
/** NUL framing and blob IDs keep tracked paths out of revision expressions. */
function sourceTree(git, revision) {
    if (
        git(["rev-parse", "--verify", `${revision}^{commit}`])
            .toString("utf8")
            .trim() !== revision
    )
        throw new Error("source revision differs from the pin");
    const bytes = git(["ls-tree", "-r", "-z", "--full-tree", revision]);
    const text = bytes.toString("utf8");
    if (!Buffer.from(text).equals(bytes) || (text && !text.endsWith("\0")))
        throw new Error("unrepresentable source tree");
    const entries = new Map(),
        folded = new Set();
    for (const row of text.split("\0").filter(Boolean)) {
        const match = /^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})\t(.+)$/u.exec(row);
        if (!match) throw new Error("source tree requires regular files");
        const [, , oid, file] = match;
        if (
            file.split("/")[0].toLowerCase() === ".lfsconfig" ||
            file.startsWith("/") ||
            /[\\:<>"|?*\x00-\x1f\x7f]/u.test(file) ||
            file
                .split("/")
                .some(
                    (part) =>
                        !part ||
                        part === "." ||
                        part === ".." ||
                        part.toLowerCase() === ".git" ||
                        /[. ]$/u.test(part) ||
                        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
                )
        )
            throw new Error("unsafe source tree path");
        const key = file.normalize("NFC").toLowerCase();
        if (folded.has(key)) throw new Error("colliding source tree paths");
        folded.add(key);
        entries.set(file, oid);
    }
    return entries;
}
/** A canonical LFS pointer declares the exact materialized bytes. */
function sourcePointer(bytes) {
    const text = bytes.toString("utf8");
    if (!text.startsWith("version https://git-lfs.github.com/spec/v1")) return null;
    const match =
        /^version https:\/\/git-lfs.github.com\/spec\/v1\noid sha256:([a-f0-9]{64})\nsize (0|[1-9][0-9]*)\n$/u.exec(
            text,
        );
    if (!match || !Number.isSafeInteger(Number(match[2]))) throw new Error("invalid LFS pointer");
    return { sha256: match[1], size: Number(match[2]) };
}
/** Verify bytes through fresh Git control metadata; receipts are an additional check. */
function verifyArtSource(config, lock, folder, requireReceipt = true) {
    safeOutput(config, folder);
    const checkout = path.join(folder, "repository"),
        gitDir = path.join(checkout, ".git");
    sourceDirectory(folder);
    sourceDirectory(checkout);
    sourceDirectory(gitDir);
    const files = sourceFiles(checkout, true);
    sourceFiles(path.join(gitDir, "objects"));
    sourceFiles(path.join(gitDir, "lfs"));
    for (const file of ["alternates", "http-alternates"])
        if (fs.lstatSync(path.join(gitDir, "objects", "info", file), { throwIfNoEntry: false }))
            throw new Error("alternative source objects are forbidden");
    if (fs.lstatSync(path.join(checkout, ".lfsconfig"), { throwIfNoEntry: false }))
        throw new Error("source LFS configuration is forbidden");
    if (sourceFile(path.join(gitDir, "HEAD")).toString("utf8") !== lock.source.revision + "\n")
        throw new Error("source HEAD must be detached at the pin");
    const temporary = fs.mkdtempSync(path.join(path.dirname(folder), ".verify-"));
    try {
        sourceGit(
            [
                "init",
                "--quiet",
                "--template=",
                `--object-format=${lock.source.revision.length === 40 ? "sha1" : "sha256"}`,
                temporary,
            ],
            temporary,
            sourceEnvironment(true),
        );
        const git = offlineSourceGit(temporary, checkout),
            entries = sourceTree(git, lock.source.revision);
        git(["fsck", "--full", lock.source.revision]);
        git(["read-tree", lock.source.revision]);
        fs.writeFileSync(path.join(temporary, ".git", "HEAD"), lock.source.revision + "\n");
        git(["lfs", "fsck", "--dry-run", "--objects", "--pointers", lock.source.revision]);
        if (files.size !== entries.size || [...files].some((file) => !entries.has(file)))
            throw new Error("source file set differs from the pin");
        const pointers = new Set();
        for (const [file, oid] of entries) {
            const blob = git(["cat-file", "blob", oid]),
                pointer = sourcePointer(blob);
            const actual = sourceFile(path.join(checkout, file));
            if (pointer) {
                const object = sourceFile(
                    path.join(
                        gitDir,
                        "lfs",
                        "objects",
                        pointer.sha256.slice(0, 2),
                        pointer.sha256.slice(2, 4),
                        pointer.sha256,
                    ),
                );
                if (
                    actual.length !== pointer.size ||
                    digest(actual) !== pointer.sha256 ||
                    object.length !== pointer.size ||
                    digest(object) !== pointer.sha256
                )
                    throw new Error("source LFS bytes differ from the pin");
                pointers.add(file);
            } else if (!actual.equals(blob))
                throw new Error("source file bytes differ from the pin");
        }
        const { masters, findings } = collectArtMasters([checkout], lock.package);
        if (findings.length || !masters.size) throw new Error("invalid source master identities");
        const hashes = [];
        for (const master of masters.values()) {
            if (!pointers.has(path.relative(checkout, master.file).split(path.sep).join("/")))
                throw new Error("every private master must be stored in Git LFS");
            hashes.push(digest(sourceFile(master.file)));
        }
        const receipt = { revision: lock.source.revision, masterSha256: hashes.sort() };
        if (requireReceipt) {
            const saved = JSON.parse(
                sourceFile(path.join(folder, "integrity.json")).toString("utf8"),
            );
            if (
                !closed(saved, ["revision", "masterSha256"]) ||
                saved.revision !== receipt.revision ||
                JSON.stringify(saved.masterSha256) !== JSON.stringify(receipt.masterSha256)
            )
                throw new Error("source integrity receipt differs from verified bytes");
        }
        return { checkout, masters, receipt };
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}
function cachedArtSource(config, lock, folder) {
    try {
        return verifyArtSource(config, lock, folder);
    } catch {
        throw failure(
            config,
            "private source cache is invalid; verification requires package-build clean followed by package-build art source fetch",
        );
    }
}

/**
 * Restore or reuse a verified private Git/LFS revision without changing the lock.
 * @param {object} config Resolved package configuration.
 * @param {{from?:string}} [options] Optional local Git repository for explicit acquisition.
 * @returns {Promise<string>} Verified private source checkout beneath build/.
 */
export async function fetchArtSource(config, { from } = {}) {
    const lock = requireLock(config),
        parent = path.resolve(config.rootDir, "build", ".cache", "art-sources"),
        folder = path.join(parent, digest(JSON.stringify(lock.source)));
    safeOutput(config, parent);
    if (fs.lstatSync(folder, { throwIfNoEntry: false }))
        return cachedArtSource(config, lock, folder).checkout;
    fs.mkdirSync(parent, { recursive: true });
    const staging = fs.mkdtempSync(path.join(parent, ".fetch-")),
        checkout = path.join(staging, "repository");
    try {
        const acquire = (args, cwd) => sourceGit(args, cwd, sourceEnvironment());
        acquire(
            [
                "clone",
                "--no-checkout",
                "--no-local",
                "--template=",
                "--",
                from ? path.resolve(from) : lock.source.repository,
                checkout,
            ],
            staging,
        );
        acquire(["fetch", "--no-tags", "origin", lock.source.revision], checkout);
        const git = offlineSourceGit(checkout, checkout);
        sourceTree(git, lock.source.revision);
        git([
            "-c",
            "filter.lfs.smudge=",
            "-c",
            "filter.lfs.process=",
            "-c",
            "filter.lfs.required=false",
            "checkout",
            "--detach",
            lock.source.revision,
        ]);
        // A local setting keeps file-transport peers from inheriting our object destination.
        git(["config", "--local", "lfs.storage", path.join(checkout, ".git", "lfs")]);
        acquire(
            [
                "-c",
                "core.fsmonitor=false",
                "-c",
                `core.attributesFile=${os.devNull}`,
                "-c",
                "lfs.fetchinclude=",
                "-c",
                "lfs.fetchexclude=",
                "lfs",
                "fetch",
                "origin",
                lock.source.revision,
            ],
            checkout,
        );
        // LFS checkout requires its trusted clean filter to be declared as installed.
        git(["-c", "filter.lfs.clean=git-lfs clean -- %f", "lfs", "checkout"]);
        const { receipt } = verifyArtSource(config, lock, staging, false);
        fs.writeFileSync(path.join(staging, "integrity.json"), JSON.stringify(receipt) + "\n");
        if (fs.lstatSync(folder, { throwIfNoEntry: false }))
            throw new Error("source destination exists");
        fs.renameSync(staging, folder);
        return path.join(folder, "repository");
    } catch {
        throw failure(
            config,
            "private source Git/LFS verification failed; check Git credentials, git-lfs and the pinned revision",
        );
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
        folder = path.resolve(
            config.rootDir,
            "build",
            ".cache",
            "art-sources",
            digest(JSON.stringify(lock.source)),
        );
    const { masters } = cachedArtSource(config, lock, folder);
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
