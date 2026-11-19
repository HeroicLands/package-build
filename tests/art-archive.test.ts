/* SPDX-License-Identifier: GPL-3.0-or-later */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { openArtArchive } from "../engine/art-archive.mjs";

const roots: string[] = [];
async function setup() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "art-archive-test-"));
    roots.push(dir);
    const cacheDir = path.join(dir, "cache");
    await fs.mkdir(cacheDir);
    vi.spyOn(os, "tmpdir").mockReturnValue(dir);
    return { dir, cacheDir };
}
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
const zip = (files: Record<string, Uint8Array>) => Buffer.from(zipSync(files, { level: 0 }));
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const fetcher = (bytes: Buffer) => async () => new Response(bytes);
const url = "https://example.test/originals";
afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(roots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

it("extracts exact original bytes and disposes the private root", async () => {
    const { dir, cacheDir } = await setup();
    const bytes = zip({ "images/sample.png": png, "icons/sample.svg": svg });
    const result = await openArtArchive(url, hash(bytes), { cacheDir, fetch: fetcher(bytes) });
    expect(await fs.readFile(path.join(result.root, "images/sample.png"))).toEqual(
        Buffer.from(png),
    );
    expect(await fs.readFile(path.join(result.root, "icons/sample.svg"))).toEqual(Buffer.from(svg));
    expect((await fs.stat(result.root)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(path.join(result.root, "images/sample.png"))).mode & 0o777).toBe(0o600);
    await result.dispose();
    await expect(fs.stat(result.root)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await fs.readdir(dir)).filter((x) => x.startsWith("art-archive-"))).toEqual([]);
});

it.each(["../outside.png", "/outside.png", "a\\outside.png", "bad.txt"])(
    "rejects unsafe archive entry %s",
    async (name) => {
        const { dir, cacheDir } = await setup();
        const bytes = zip({ [name]: png });
        await expect(
            openArtArchive(url, hash(bytes), { cacheDir, fetch: fetcher(bytes) }),
        ).rejects.toThrow();
        expect((await fs.readdir(dir)).filter((x) => x.startsWith("art-archive-"))).toEqual([]);
    },
);

it("rejects case collisions, bad CRC and truncated archives", async () => {
    const { dir, cacheDir } = await setup();
    const collision = zip({ "A.png": png, "a.png": png });
    await expect(
        openArtArchive(url, hash(collision), { cacheDir, fetch: fetcher(collision) }),
    ).rejects.toThrow(/duplicate/);
    const corrupt = zip({ "a.png": png });
    const start = 30 + corrupt.readUInt16LE(26) + corrupt.readUInt16LE(28);
    corrupt[start] ^= 1;
    await expect(
        openArtArchive(url, hash(corrupt), { cacheDir, fetch: fetcher(corrupt) }),
    ).rejects.toThrow(/checksum/);
    const truncated = corrupt.subarray(0, corrupt.length - 5);
    await expect(
        openArtArchive(url, hash(truncated), { cacheDir, fetch: fetcher(truncated) }),
    ).rejects.toThrow();
    expect((await fs.readdir(dir)).filter((x) => x.startsWith("art-archive-"))).toEqual([]);
});

it("enforces entry limits and cancellation without leaving session files", async () => {
    const { dir, cacheDir } = await setup();
    const bytes = zip({ "sample.png": png });
    await expect(
        openArtArchive(url, hash(bytes), { cacheDir, fetch: fetcher(bytes), maxEntryBytes: 2 }),
    ).rejects.toThrow(/size/);
    const abort = new AbortController();
    abort.abort();
    await expect(
        openArtArchive(url, hash(bytes), { cacheDir, fetch: fetcher(bytes), signal: abort.signal }),
    ).rejects.toThrow();
    expect((await fs.readdir(dir)).filter((x) => x.startsWith("art-archive-"))).toEqual([]);
});

it("creates independent roots from one cached source", async () => {
    const { cacheDir } = await setup();
    const bytes = zip({ "sample.png": png });
    const [a, b] = await Promise.all([
        openArtArchive(url, hash(bytes), { cacheDir, fetch: fetcher(bytes) }),
        openArtArchive(url, hash(bytes), { cacheDir, fetch: fetcher(bytes) }),
    ]);
    expect(a.root).not.toBe(b.root);
    expect(hash(await fs.readFile(path.join(a.root, "sample.png")))).toBe(hash(Buffer.from(png)));
    await a.dispose();
    expect(await fs.readFile(path.join(b.root, "sample.png"))).toEqual(Buffer.from(png));
    await b.dispose();
});

it("refuses symbolic links and size mismatches", async () => {
    const { cacheDir } = await setup();
    const link = zip({ "link.png": png });
    const eocd = link.length - 22;
    const central = link.readUInt32LE(eocd + 16);
    link.writeUInt32LE((0o120777 << 16) >>> 0, central + 38);
    await expect(
        openArtArchive(url, hash(link), { cacheDir, fetch: fetcher(link) }),
    ).rejects.toThrow(/unsupported/);
    const wrong = zip({ "sample.png": png });
    const directory = wrong.readUInt32LE(wrong.length - 22 + 16);
    wrong.writeUInt32LE(png.length + 1, directory + 24);
    await expect(
        openArtArchive(url, hash(wrong), { cacheDir, fetch: fetcher(wrong) }),
    ).rejects.toThrow();
});

it("extracts a deflated entry without changing its bytes", async () => {
    const { cacheDir } = await setup();
    const bytes = Buffer.from(zipSync({ "icons/sample.svg": svg }, { level: 6 }));
    const archive = await openArtArchive(url, hash(bytes), { cacheDir, fetch: fetcher(bytes) });
    expect(await fs.readFile(path.join(archive.root, "icons/sample.svg"))).toEqual(
        Buffer.from(svg),
    );
    await archive.dispose();
});
