/* SPDX-License-Identifier: GPL-3.0-or-later */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { downloadCached, downloadCacheDirectory } from "../engine/download-cache.mjs";

const roots: string[] = [];
const content = Buffer.from("A shared verified file\n");
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const digest = sha(content);
const url = "https://example.test/art";
async function root() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "download-cache-test-"));
    roots.push(dir);
    return dir;
}
const response = () =>
    new Response(content, { headers: { "content-length": String(content.length) } });
afterEach(async () => {
    await Promise.all(roots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    vi.unstubAllEnvs();
});

it("shares a verified download across callers and works offline on a hit", async () => {
    const cacheDir = await root();
    const fetcher = vi.fn(async () => response());
    const first = await downloadCached(url, digest, { cacheDir, fetch: fetcher });
    const second = await downloadCached("https://other.test/index", digest, {
        cacheDir,
        fetch: async () => {
            throw new Error("network unavailable");
        },
    });
    expect(first).toBe(second);
    expect(await fs.readFile(second)).toEqual(content);
    expect(fetcher).toHaveBeenCalledTimes(1);
});

it("replaces a corrupt cache entry only after verifying the download", async () => {
    const cacheDir = await root();
    const file = path.join(cacheDir, digest);
    await fs.writeFile(file, "corrupt");
    await expect(
        downloadCached(url, digest, { cacheDir, fetch: async () => new Response("wrong") }),
    ).rejects.toThrow(/SHA-256/);
    expect(await fs.readFile(file, "utf8")).toBe("corrupt");
    await downloadCached(url, digest, { cacheDir, fetch: async () => response() });
    expect(await fs.readFile(file)).toEqual(content);
    expect(await fs.readdir(cacheDir)).toEqual([digest]);
});

it("rejects interrupted, truncated and oversized responses without caching", async () => {
    const cacheDir = await root();
    const broken = new ReadableStream({
        start(controller) {
            controller.enqueue(new Uint8Array([1]));
            controller.error(new Error("interrupted"));
        },
    });
    await expect(
        downloadCached(url, digest, { cacheDir, fetch: async () => new Response(broken) }),
    ).rejects.toThrow();
    await expect(
        downloadCached(url, digest, {
            cacheDir,
            fetch: async () => new Response(content, { headers: { "content-length": "100" } }),
        }),
    ).rejects.toThrow(/incomplete/);
    await expect(
        downloadCached(url, digest, { cacheDir, maxBytes: 2, fetch: async () => response() }),
    ).rejects.toThrow(/size/);
    expect(await fs.readdir(cacheDir)).toEqual([]);
});

it("installs only verified bytes when callers download concurrently", async () => {
    const cacheDir = await root();
    const results = await Promise.all(
        Array.from({ length: 4 }, () =>
            downloadCached(url, digest, { cacheDir, fetch: async () => response() }),
        ),
    );
    expect(new Set(results).size).toBe(1);
    expect(await fs.readFile(results[0])).toEqual(content);
    expect(await fs.readdir(cacheDir)).toEqual([digest]);
});

it("uses an absolute XDG cache outside caller directories", async () => {
    const base = await root();
    vi.stubEnv("XDG_CACHE_HOME", path.join(base, "cache"));
    expect(downloadCacheDirectory()).toBe(path.join(base, "cache", "heroiclands", "downloads"));
    const actual = await downloadCached(url, digest, { fetch: async () => response() });
    expect(actual).toBe(path.join(downloadCacheDirectory(), digest));
});

it("rejects malformed pins, credentialed URLs and relative cache directories", async () => {
    await expect(downloadCached(url, digest.toUpperCase())).rejects.toThrow(/SHA-256/);
    await expect(downloadCached("https://user:secret@example.test/file", digest)).rejects.toThrow(
        /URL/,
    );
    await expect(downloadCached(url, digest, { cacheDir: "relative" })).rejects.toThrow(/absolute/);
});
