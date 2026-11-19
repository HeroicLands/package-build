/* SPDX-License-Identifier: GPL-3.0-or-later */
import { createHash } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { lstat, mkdir, mkdtemp, open, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

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

function safeUrl(value, base) {
    let parsed;
    try {
        parsed = new URL(value, base);
    } catch {
        throw new Error("download URL must be HTTPS without user information");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
        throw new Error("download URL must be HTTPS without user information");
    return parsed;
}

/**
 * Fetch bytes into the shared checksum cache and return their verified path.
 * @param {string} url HTTPS URL without user information.
 * @param {string} sha256 Expected lowercase SHA-256.
 * @param {{cacheDir?: string, maxBytes?: number, signal?: AbortSignal, fetch?: typeof globalThis.fetch}} [options] Download options.
 * @returns {Promise<string>} Absolute path of the verified cached file.
 */
export async function downloadCached(url, sha256, options = {}) {
    if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(sha256))
        throw new Error("expected a lowercase SHA-256 digest");
    let parsed = safeUrl(url);
    const cache = options.cacheDir ?? downloadCacheDirectory();
    if (typeof cache !== "string" || !path.isAbsolute(cache))
        throw new Error("download cache directory must be absolute");
    const maxBytes = options.maxBytes ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
        throw new Error("download size limit must be a non-negative safe integer");
    await mkdir(cache, { recursive: true });
    const target = path.join(cache, sha256);
    if (await matches(target, sha256, maxBytes, options.signal)) return target;
    const temporary = await mkdtemp(path.join(cache, ".download-"));
    const file = path.join(temporary, "content");
    let response;
    try {
        for (let redirects = 0; ; redirects++) {
            try {
                response = await (options.fetch ?? globalThis.fetch)(parsed.href, {
                    signal: options.signal,
                    redirect: "manual",
                    headers: { "accept-encoding": "identity" },
                });
            } catch {
                throw new Error("download request failed");
            }
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                const location = response.headers.get("location");
                await response.body?.cancel().catch(() => {});
                if (!location || redirects >= 5)
                    throw new Error("download redirect limit or missing location");
                parsed = safeUrl(location, parsed);
                continue;
            }
            if (!response.ok || !response.body) throw new Error("download request failed");
            if (response.url) safeUrl(response.url);
            break;
        }
        const encoding = response.headers.get("content-encoding");
        if (encoding && encoding.toLowerCase() !== "identity")
            throw new Error("download uses an unsupported content encoding");
        const length = response.headers.get("content-length");
        if (length !== null && (!/^\d+$/u.test(length) || Number(length) > maxBytes))
            throw new Error("download exceeds its size limit or has an invalid length");
        const hash = createHash("sha256");
        let size = 0;
        const meter = new Transform({
            transform(chunk, _encoding, callback) {
                size += chunk.length;
                if (size > maxBytes) return callback(new Error("download exceeds its size limit"));
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
            throw new Error("download stream failed");
        }
        if (length !== null && size !== Number(length)) throw new Error("download is incomplete");
        if (hash.digest("hex") !== sha256) throw new Error("download SHA-256 does not match");
        await rename(file, target);
        if (!(await matches(target, sha256, maxBytes, options.signal)))
            throw new Error("cached download failed verification");
        return target;
    } finally {
        if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
        await rm(temporary, { recursive: true, force: true });
    }
}
