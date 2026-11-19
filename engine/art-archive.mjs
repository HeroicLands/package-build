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
import { createHash } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { lstat, mkdir, mkdtemp, open, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflateRaw } from "node:zlib";
import { downloadCached } from "./download-cache.mjs";

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    return value;
});
function crc32(state, bytes) {
    for (const byte of bytes) state = (state >>> 8) ^ crcTable[(state ^ byte) & 255];
    return state >>> 0;
}
async function readAt(file, length, position) {
    const bytes = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
        const { bytesRead } = await file.read(bytes, offset, length - offset, position + offset);
        if (!bytesRead) throw new Error("truncated artwork archive");
        offset += bytesRead;
    }
    return bytes;
}
function checkExtra(bytes) {
    for (let offset = 0; offset < bytes.length;) {
        if (offset + 4 > bytes.length) throw new Error("invalid artwork archive extra field");
        const type = bytes.readUInt16LE(offset),
            size = bytes.readUInt16LE(offset + 2);
        if (offset + 4 + size > bytes.length)
            throw new Error("invalid artwork archive extra field");
        if (type === 1) throw new Error("ZIP64 artwork archives are unsupported");
        offset += 4 + size;
    }
}
function entryName(bytes) {
    const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!name || name.startsWith("/") || /[\\:<>"|?*\x00-\x1f\uFFFD]/u.test(name))
        throw new Error("unsafe artwork archive path");
    const parts = name.split("/");
    if (
        parts.some(
            (part, i) =>
                part === "." ||
                part === ".." ||
                /[. ]$/u.test(part) ||
                /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part) ||
                (!part && i !== parts.length - 1),
        )
    )
        throw new Error("unsafe artwork archive path");
    return name;
}
async function entries(file, size, limits, signal) {
    if (size < 22 || size > limits.maxArchiveBytes) throw new Error("invalid artwork archive size");
    const tailSize = Math.min(size, 65557),
        tail = await readAt(file, tailSize, size - tailSize);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--)
        if (
            tail.readUInt32LE(i) === 0x06054b50 &&
            i + 22 + tail.readUInt16LE(i + 20) === tail.length
        ) {
            end = i;
            break;
        }
    if (end < 0) throw new Error("invalid artwork archive footer");
    for (let i = end + 1; i <= tail.length - 22; i++)
        if (tail.readUInt32LE(i) === 0x06054b50)
            throw new Error("ambiguous artwork archive footer");
    const absoluteEnd = size - tailSize + end;
    if (end >= 20 && tail.readUInt32LE(end - 20) === 0x07064b50)
        throw new Error("ZIP64 artwork archives are unsupported");
    const count = tail.readUInt16LE(end + 10),
        dirSize = tail.readUInt32LE(end + 12),
        dirStart = tail.readUInt32LE(end + 16);
    if (
        !count ||
        count === 65535 ||
        count > limits.maxEntries ||
        dirSize > limits.maxDirectoryBytes ||
        tail.readUInt16LE(end + 4) ||
        tail.readUInt16LE(end + 6) ||
        tail.readUInt16LE(end + 8) !== count ||
        dirStart + dirSize !== absoluteEnd
    )
        throw new Error("unsupported artwork archive directory");
    const directory = await readAt(file, dirSize, dirStart),
        result = [],
        seen = new Set(),
        ranges = [];
    let at = 0,
        total = 0;
    for (let i = 0; i < count; i++) {
        signal?.throwIfAborted();
        if (at + 46 > directory.length || directory.readUInt32LE(at) !== 0x02014b50)
            throw new Error("invalid artwork archive directory");
        const flags = directory.readUInt16LE(at + 8),
            method = directory.readUInt16LE(at + 10),
            crc = directory.readUInt32LE(at + 16),
            compressed = directory.readUInt32LE(at + 20),
            plain = directory.readUInt32LE(at + 24),
            nl = directory.readUInt16LE(at + 28),
            el = directory.readUInt16LE(at + 30),
            cl = directory.readUInt16LE(at + 32),
            mode = directory.readUInt32LE(at + 38) >>> 16,
            local = directory.readUInt32LE(at + 42);
        if (
            at + 46 + nl + el + cl > directory.length ||
            flags & ~(method === 8 ? 0x080e : 0x0808) ||
            ![0, 8].includes(method) ||
            [compressed, plain, local].includes(0xffffffff) ||
            directory.readUInt16LE(at + 34) !== 0 ||
            (mode & 0xf000 && ![0x8000, 0x4000].includes(mode & 0xf000))
        )
            throw new Error("unsupported artwork archive entry");
        if (plain > limits.maxEntryBytes || (total += plain) > limits.maxTotalBytes)
            throw new Error("artwork archive exceeds size limits");
        checkExtra(directory.subarray(at + 46 + nl, at + 46 + nl + el));
        const nameBytes = directory.subarray(at + 46, at + 46 + nl),
            name = entryName(nameBytes),
            isDir = name.endsWith("/"),
            documentation = name === "README.md" || name === "CHANGELOG.md";
        const key = name.replace(/\/$/u, "").normalize("NFC").toLowerCase();
        if (seen.has(key)) throw new Error("duplicate artwork archive path");
        seen.add(key);
        if (
            isDir ?
                plain !== 0 || compressed !== 0 || (mode & 0xf000) === 0x8000
            :   (!documentation && !/\.(?:png|svg)$/iu.test(name)) || (mode & 0xf000) === 0x4000
        )
            throw new Error("unsupported artwork archive content");
        const header = await readAt(file, 30, local);
        if (
            header.readUInt32LE(0) !== 0x04034b50 ||
            header.readUInt16LE(6) !== flags ||
            header.readUInt16LE(8) !== method ||
            [crc, compressed, plain].some((value, index) => {
                const localValue = header.readUInt32LE(14 + index * 4);
                return localValue !== value && (!(flags & 8) || localValue !== 0);
            })
        )
            throw new Error("invalid artwork archive local header");
        const localName = header.readUInt16LE(26),
            localExtra = header.readUInt16LE(28),
            start = local + 30 + localName + localExtra;
        if (
            localName !== nl ||
            start + compressed > dirStart ||
            !(await readAt(file, localName, local + 30)).equals(nameBytes)
        )
            throw new Error("invalid artwork archive local path");
        checkExtra(await readAt(file, localExtra, local + 30 + localName));
        let rangeEnd = start + compressed;
        if (flags & 8) {
            const remaining = dirStart - rangeEnd;
            if (remaining < 12) throw new Error("missing artwork entry descriptor");
            const descriptor = await readAt(file, Math.min(16, remaining), rangeEnd);
            const validAt = (offset) =>
                descriptor.length >= offset + 12 &&
                descriptor.readUInt32LE(offset) === crc &&
                descriptor.readUInt32LE(offset + 4) === compressed &&
                descriptor.readUInt32LE(offset + 8) === plain;
            const signed =
                descriptor.length >= 16 && descriptor.readUInt32LE(0) === 0x08074b50 && validAt(4);
            if (!signed && !validAt(0)) throw new Error("invalid artwork entry descriptor");
            rangeEnd += signed ? 16 : 12;
        }
        ranges.push([local, rangeEnd]);
        result.push({ name, isDir, documentation, method, crc, compressed, plain, start });
        at += 46 + nl + el + cl;
    }
    if (at !== directory.length) throw new Error("invalid artwork archive directory length");
    ranges.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ranges.length; i++)
        if (ranges[i][0] < ranges[i - 1][1]) throw new Error("overlapping artwork archive entries");
    return result;
}

/**
 * Extract a verified original-art ZIP into a private directory.
 * @param {string} url HTTPS archive URL.
 * @param {string} sha256 Expected lowercase SHA-256.
 * @param {{cacheDir?: string, fetch?: typeof globalThis.fetch, signal?: AbortSignal, maxArchiveBytes?: number, maxDirectoryBytes?: number, maxEntries?: number, maxEntryBytes?: number, maxTotalBytes?: number}} [options] Cache, request and archive limits.
 * @returns {Promise<{root: string, dispose: () => Promise<void>}>} The root and its cleanup function.
 */
export async function openArtArchive(url, sha256, options = {}) {
    const limits = {
        maxArchiveBytes: options.maxArchiveBytes ?? 2_000_000_000,
        maxDirectoryBytes: options.maxDirectoryBytes ?? 16_000_000,
        maxEntries: options.maxEntries ?? 10000,
        maxEntryBytes: options.maxEntryBytes ?? 256_000_000,
        maxTotalBytes: options.maxTotalBytes ?? 2_000_000_000,
    };
    for (const value of Object.values(limits))
        if (!Number.isSafeInteger(value) || value <= 0)
            throw new Error("artwork archive limits must be positive safe integers");
    const cached = await downloadCached(url, sha256, {
        cacheDir: options.cacheDir,
        fetch: options.fetch,
        signal: options.signal,
        maxBytes: limits.maxArchiveBytes,
    });
    const session = await mkdtemp(path.join(os.tmpdir(), "art-archive-"));
    const root = path.join(session, "originals"),
        snapshot = path.join(session, "archive.zip");
    let source, archive;
    try {
        const before = await lstat(cached);
        if (!before.isFile() || before.isSymbolicLink())
            throw new Error("invalid cached artwork archive");
        source = await open(cached, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const info = await source.stat();
        if (
            !info.isFile() ||
            info.dev !== before.dev ||
            info.ino !== before.ino ||
            info.size > limits.maxArchiveBytes
        )
            throw new Error("invalid cached artwork archive");
        const hash = createHash("sha256");
        let size = 0;
        const meter = new Transform({
            transform(chunk, _, done) {
                size += chunk.length;
                if (size > limits.maxArchiveBytes)
                    return done(new Error("artwork archive exceeds size limit"));
                hash.update(chunk);
                done(null, chunk);
            },
        });
        await pipeline(
            source.createReadStream({ autoClose: false, signal: options.signal }),
            meter,
            createWriteStream(snapshot, { flags: "wx", mode: 0o600 }),
            { signal: options.signal },
        );
        if (hash.digest("hex") !== sha256)
            throw new Error("artwork archive SHA-256 does not match");
        await source.close();
        source = undefined;
        archive = await open(snapshot, "r");
        const list = await entries(archive, size, limits, options.signal);
        await mkdir(root, { mode: 0o700 });
        for (const item of list) {
            options.signal?.throwIfAborted();
            const output = path.join(root, ...item.name.split("/"));
            if (item.isDir) {
                await mkdir(output, { recursive: true, mode: 0o700 });
                continue;
            }
            if (!item.documentation)
                await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
            let crc = 0xffffffff,
                actual = 0;
            const check = new Transform({
                transform(chunk, _, done) {
                    actual += chunk.length;
                    if (actual > item.plain || actual > limits.maxEntryBytes)
                        return done(new Error("artwork entry exceeds size limit"));
                    crc = crc32(crc, chunk);
                    done(null, chunk);
                },
            });
            if (item.compressed === 0) {
                if (item.plain !== 0 || item.method !== 0)
                    throw new Error("invalid empty artwork entry");
                if (!item.documentation) await open(output, "wx", 0o600).then((f) => f.close());
            } else {
                const input = archive.createReadStream({
                    autoClose: false,
                    start: item.start,
                    end: item.start + item.compressed - 1,
                    signal: options.signal,
                });
                const inflater = item.method === 8 ? createInflateRaw() : undefined;
                const target =
                    item.documentation ?
                        new Writable({
                            write(_chunk, _encoding, done) {
                                done();
                            },
                        })
                    :   createWriteStream(output, { flags: "wx", mode: 0o600 });
                const streams =
                    inflater ? [input, inflater, check, target] : [input, check, target];
                await pipeline(streams, { signal: options.signal });
                if (inflater && inflater.bytesWritten !== item.compressed)
                    throw new Error("artwork entry has trailing compressed bytes");
            }
            if (actual !== item.plain || (crc ^ 0xffffffff) >>> 0 !== item.crc)
                throw new Error("artwork entry checksum or size mismatch");
        }
        await archive.close();
        archive = undefined;
        await rm(snapshot);
        return {
            root,
            async dispose() {
                await rm(session, { recursive: true, force: true });
            },
        };
    } catch (error) {
        await source?.close();
        await archive?.close();
        await rm(session, { recursive: true, force: true });
        throw error;
    }
}
