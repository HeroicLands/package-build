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
import { lstat, mkdir, mkdtemp, open, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fetchFollowingRedirects } from "./user-agent.mjs";

/** Return the user's shared download cache directory. */
export function downloadCacheDirectory() {
    const xdg = process.env.XDG_CACHE_HOME;
    if (xdg && path.isAbsolute(xdg)) return path.join(xdg, "heroiclands", "downloads");
    const home = os.homedir();
    const base =
        process.platform === "darwin" ? path.join(home, "Library", "Caches")
        : (
            process.platform === "win32" &&
            process.env.LOCALAPPDATA &&
            path.isAbsolute(process.env.LOCALAPPDATA)
        ) ?
            process.env.LOCALAPPDATA
        :   path.join(home, ".cache");
    return path.join(base, "heroiclands", "downloads");
}

async function matches(file, expected, maxBytes, signal) {
    let handle;
    try {
        signal?.throwIfAborted();
        const before = await lstat(file);
        if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) return false;
        handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const info = await handle.stat();
        if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino) return false;
        const hash = createHash("sha256");
        let size = 0;
        for await (const chunk of handle.createReadStream({ autoClose: false, signal })) {
            signal?.throwIfAborted();
            size += chunk.length;
            if (size > maxBytes) return false;
            hash.update(chunk);
        }
        signal?.throwIfAborted();
        const after = await lstat(file);
        const current = await handle.stat();
        return (
            after.isFile() &&
            !after.isSymbolicLink() &&
            after.dev === info.dev &&
            after.ino === info.ino &&
            current.size === info.size &&
            current.mtimeMs === info.mtimeMs &&
            size === info.size &&
            hash.digest("hex") === expected
        );
    } catch (error) {
        if (error.code === "ENOENT" || error.code === "ELOOP") return false;
        throw error;
    } finally {
        await handle?.close();
    }
}

function safeUrl(value, base, allowLoopback = false) {
    let parsed;
    try {
        parsed = new URL(value, base);
    } catch {
        throw new Error("download URL must be HTTPS without user information");
    }
    const loopback =
        parsed.hostname === "localhost" ||
        parsed.hostname === "[::1]" ||
        /^127\.\d+\.\d+\.\d+$/.test(parsed.hostname);
    if (
        (parsed.protocol !== "https:" &&
            !(allowLoopback && parsed.protocol === "http:" && loopback)) ||
        parsed.username ||
        parsed.password
    )
        throw new Error("download URL must be HTTPS without user information");
    return parsed;
}

/**
 * Fetch bytes into the shared checksum cache and return their verified path.
 * @param {string} url HTTPS URL without user information.
 * @param {string|null} sha256 Expected lowercase SHA-256, or `null` with `trustOnFirstUse`, which
 *   names the file by the SHA-256 of the bytes received.
 * @param {{trustOnFirstUse?: boolean, cacheDir?: string, maxBytes?: number, signal?: AbortSignal, fetch?: typeof globalThis.fetch, token?: string, allowLoopback?: boolean, config?: object}} [options] Download options.
 * @returns {Promise<string>} Absolute path of the verified cached file.
 */
export async function downloadCached(url, sha256, options = {}) {
    const firstUse = sha256 === null && options.trustOnFirstUse === true;
    if (!firstUse && (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(sha256)))
        throw new Error("expected a lowercase SHA-256 digest");
    let parsed = safeUrl(url, undefined, options.allowLoopback === true);
    const origin = parsed.origin;
    // Query strings and fragments may carry signed download credentials.
    const displayUrl = `${parsed.origin}${parsed.pathname}`.slice(0, 512);
    const failure = (message, status) =>
        new Error(`${message}: ${displayUrl}${status === undefined ? "" : ` (HTTP ${status})`}`);
    const cache = options.cacheDir ?? downloadCacheDirectory();
    if (typeof cache !== "string" || !path.isAbsolute(cache))
        throw new Error("download cache directory must be absolute");
    const maxBytes = options.maxBytes ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
        throw new Error("download size limit must be a non-negative safe integer");
    await mkdir(cache, { recursive: true });
    if (!firstUse && (await matches(path.join(cache, sha256), sha256, maxBytes, options.signal)))
        return path.join(cache, sha256);
    const temporary = await mkdtemp(path.join(cache, ".download-"));
    const file = path.join(temporary, "content");
    let response;
    try {
        try {
            response = await fetchFollowingRedirects(
                parsed.href,
                {
                    signal: options.signal,
                    headers: {
                        "accept-encoding": "identity",
                        ...(options.token ? { Authorization: `token ${options.token}` } : {}),
                    },
                },
                {
                    fetch: options.fetch,
                    config: options.config,
                    onRedirect({ response: hop, current, location, hops }) {
                        const refuse = (message) => {
                            const error = failure(message, hop.status);
                            error.refused = true;
                            return error;
                        };
                        if (!location || hops >= 5)
                            throw refuse("download redirect limit or missing location");
                        const next = safeUrl(location, current, options.allowLoopback === true);
                        if (current.protocol === "https:" && next.protocol !== "https:")
                            throw refuse("download redirect refused");
                        if (options.token && next.origin !== origin)
                            throw refuse("authenticated download redirect refused");
                        parsed = next;
                        return next;
                    },
                },
            );
        } catch (cause) {
            if (cause?.refused || /download URL must be HTTPS/u.test(cause?.message ?? ""))
                throw cause;
            const error = failure("download request failed");
            error.retryable = true;
            throw error;
        }
        if (!response.ok || !response.body) {
            const error = failure("download request failed", response.status);
            error.retryable = response.status >= 500 && response.status < 600;
            throw error;
        }
        if (response.url) {
            const actual = safeUrl(response.url, undefined, options.allowLoopback === true);
            if (options.token && actual.origin !== origin)
                throw failure("authenticated download redirect refused", response?.status);
        }
        const encoding = response.headers.get("content-encoding");
        if (encoding && encoding.toLowerCase() !== "identity")
            throw failure("download uses an unsupported content encoding", response?.status);
        const length = response.headers.get("content-length");
        if (length !== null && (!/^\d+$/u.test(length) || Number(length) > maxBytes))
            throw failure(
                "download exceeds its size limit or has an invalid length",
                response?.status,
            );
        const hash = createHash("sha256");
        let size = 0;
        const meter = new Transform({
            transform(chunk, _encoding, callback) {
                size += chunk.length;
                if (size > maxBytes)
                    return callback(failure("download exceeds its size limit", response?.status));
                hash.update(chunk);
                callback(null, chunk);
            },
        });
        try {
            await pipeline(
                Readable.fromWeb(response.body),
                meter,
                createWriteStream(file, { flags: "wx", mode: 0o600 }),
                { signal: options.signal },
            );
        } catch {
            if (size > maxBytes) throw failure("download exceeds its size limit", response?.status);
            const error = failure("download stream failed", response?.status);
            error.retryable = true;
            throw error;
        }
        if (length !== null && size !== Number(length)) {
            const error = failure("download is incomplete", response?.status);
            error.retryable = true;
            throw error;
        }
        const actual = hash.digest("hex");
        if (!firstUse && actual !== sha256)
            throw failure("download SHA-256 does not match", response?.status);
        sha256 = actual;
        const target = path.join(cache, sha256);
        await rename(file, target);
        for (let attempt = 0; attempt < 3; attempt++)
            if (await matches(target, sha256, maxBytes, options.signal)) return target;
        throw failure("cached download failed verification", response?.status);
    } finally {
        if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
        await rm(temporary, { recursive: true, force: true });
    }
}
