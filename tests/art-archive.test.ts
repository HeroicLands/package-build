/* SPDX-License-Identifier: GPL-3.0-or-later */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { openArtArchive } from "../engine/art-archive.mjs";
import { downloadCached } from "../engine/download-cache.mjs";

const hooks = vi.hoisted(() => ({
    lstat: undefined as undefined | ((file: string) => Promise<void>),
    opened: undefined as undefined | ((file: string, handle: any) => void),
}));
vi.mock("node:fs/promises", async (original) => {
    const actual = await original<typeof import("node:fs/promises")>();
    return {
        ...actual,
        lstat: async (file: string) => {
            await hooks.lstat?.(file);
            return actual.lstat(file);
        },
        open: async (...args: Parameters<typeof actual.open>) => {
            const handle = await actual.open(...args);
            hooks.opened?.(String(args[0]), handle);
            return handle;
        },
    };
});

const roots: string[] = [];
async function setup() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "art-archive-test-"));
    roots.push(dir);
    const cacheDir = path.join(dir, "cache");
    await fs.mkdir(cacheDir);
    return { dir, cacheDir };
}
const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR7sAAAAASUVORK5CYII=",
    "base64",
);
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
const zip = (files: Record<string, Uint8Array>) => Buffer.from(zipSync(files, { level: 0 }));
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const fetcher = (bytes: Buffer) => async () => new Response(bytes);
const url = "https://example.test/originals";
afterEach(async () => {
    hooks.lstat = undefined;
    hooks.opened = undefined;
    vi.restoreAllMocks();
    await Promise.all(roots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

it("extracts exact original bytes and disposes the private root", async () => {
    const { cacheDir } = await setup();
    const bytes = zip({
        "README.md": new TextEncoder().encode("Release information"),
        "CHANGELOG.md": new TextEncoder().encode("Release changes"),
        "images/sample.png": png,
        "icons/sample.svg": svg,
    });
    const result = await openArtArchive(url, hash(bytes), { cacheDir, fetch: fetcher(bytes) });
    expect(await fs.readFile(path.join(result.root, "images/sample.png"))).toEqual(
        Buffer.from(png),
    );
    expect(await fs.readFile(path.join(result.root, "icons/sample.svg"))).toEqual(Buffer.from(svg));
    expect((await fs.readdir(result.root)).sort()).toEqual(["icons", "images"]);
    expect((await fs.stat(result.root)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(path.join(result.root, "images/sample.png"))).mode & 0o777).toBe(0o600);
    await result.dispose();
    await expect(fs.stat(result.root)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await fs.readdir(cacheDir)).filter((x) => x.startsWith(".art-archive-"))).toEqual([]);
});

it.each([
    "../outside.png",
    "/outside.png",
    "a\\outside.png",
    "bad.txt",
    ".env",
    "nested/README.md",
    "readme.md",
])("rejects unsafe archive entry %s", async (name) => {
    const { cacheDir } = await setup();
    const bytes = zip({ [name]: png });
    await expect(
        openArtArchive(url, hash(bytes), { cacheDir, fetch: fetcher(bytes) }),
    ).rejects.toThrow();
    expect((await fs.readdir(cacheDir)).filter((x) => x.startsWith(".art-archive-"))).toEqual([]);
});

it("rejects case collisions, bad CRC and truncated archives", async () => {
    const { cacheDir } = await setup();
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
    expect((await fs.readdir(cacheDir)).filter((x) => x.startsWith(".art-archive-"))).toEqual([]);
});

it("checks documentation CRC, duplicate names and limits without exposing it as artwork", async () => {
    const { cacheDir } = await setup();
    const info = new TextEncoder().encode("release information");
    const corrupted = zip({ "README.md": info, "image.png": png });
    const start = 30 + corrupted.readUInt16LE(26) + corrupted.readUInt16LE(28);
    corrupted[start] ^= 1;
    await expect(
        openArtArchive(url, hash(corrupted), { cacheDir, fetch: fetcher(corrupted) }),
    ).rejects.toThrow(/checksum/);
    const duplicate = zip({ "README.md": info, "readme.md": info, "image.png": png });
    await expect(
        openArtArchive(url, hash(duplicate), { cacheDir, fetch: fetcher(duplicate) }),
    ).rejects.toThrow(/duplicate/);
    const oversized = zip({ "README.md": info, "image.png": png });
    const largeDoc = zip({ "README.md": new Uint8Array(png.length + 1), "image.png": png });
    await expect(
        openArtArchive(url, hash(largeDoc), {
            cacheDir,
            fetch: fetcher(largeDoc),
            maxEntryBytes: png.length,
        }),
    ).rejects.toThrow(/size/);
    await expect(
        openArtArchive(url, hash(oversized), {
            cacheDir,
            fetch: fetcher(oversized),
            maxEntries: 1,
        }),
    ).rejects.toThrow(/directory/);
    await expect(
        openArtArchive(url, hash(oversized), {
            cacheDir,
            fetch: fetcher(oversized),
            maxTotalBytes: png.length,
        }),
    ).rejects.toThrow(/size/);
});

it("enforces entry limits and cancellation without leaving session files", async () => {
    const { cacheDir } = await setup();
    const bytes = zip({ "sample.png": png });
    await expect(
        openArtArchive(url, hash(bytes), { cacheDir, fetch: fetcher(bytes), maxEntryBytes: 2 }),
    ).rejects.toThrow(/size/);
    const abort = new AbortController();
    abort.abort();
    await expect(
        openArtArchive(url, hash(bytes), { cacheDir, fetch: fetcher(bytes), signal: abort.signal }),
    ).rejects.toThrow();
    expect((await fs.readdir(cacheDir)).filter((x) => x.startsWith(".art-archive-"))).toEqual([]);
});

it("creates independent roots from one cached source", async () => {
    const { cacheDir } = await setup();
    const bytes = zip({ "sample.png": png });
    const [a, b] = await Promise.all([
        openArtArchive(url, hash(bytes), { cacheDir, fetch: fetcher(bytes) }),
        openArtArchive(url, hash(bytes), { cacheDir, fetch: fetcher(bytes) }),
    ]);
    expect(a.root).not.toBe(b.root);
    expect(path.dirname(path.dirname(a.root))).toBe(cacheDir);
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

function withDescriptor(input: Buffer, signed: boolean) {
    const old = input.readUInt32LE(input.length - 22 + 16);
    const extra = Buffer.alloc(signed ? 16 : 12);
    const at = signed ? 4 : 0;
    if (signed) extra.writeUInt32LE(0x08074b50);
    input.copy(extra, at, old + 16, old + 28);
    const out = Buffer.concat([input.subarray(0, old), extra, input.subarray(old)]);
    const central = old + extra.length;
    out.writeUInt16LE(out.readUInt16LE(6) | 8, 6);
    out.writeUInt16LE(out.readUInt16LE(central + 8) | 8, central + 8);
    out.fill(0, 14, 26);
    out.writeUInt32LE(central, out.length - 22 + 16);
    return { out, descriptor: old, central };
}

it.each([true, false])("validates streamed entry descriptors (signature %s)", async (signed) => {
    const { cacheDir } = await setup();
    const { out } = withDescriptor(zip({ "image.png": png }), signed);
    const result = await openArtArchive(url, hash(out), { cacheDir, fetch: fetcher(out) });
    expect(await fs.readFile(path.join(result.root, "image.png"))).toEqual(png);
    await result.dispose();
});

it("rejects missing and mismatched descriptors", async () => {
    const { cacheDir } = await setup();
    const missing = zip({ "image.png": png });
    const center = missing.readUInt32LE(missing.length - 6);
    missing.writeUInt16LE(missing.readUInt16LE(6) | 8, 6);
    missing.writeUInt16LE(missing.readUInt16LE(center + 8) | 8, center + 8);
    missing.fill(0, 14, 26);
    await expect(
        openArtArchive(url, hash(missing), { cacheDir, fetch: fetcher(missing) }),
    ).rejects.toThrow(/descriptor/);
    const { out, descriptor } = withDescriptor(zip({ "image.png": png }), true);
    out[descriptor + 4] ^= 1;
    await expect(openArtArchive(url, hash(out), { cacheDir, fetch: fetcher(out) })).rejects.toThrow(
        /descriptor/,
    );
    expect((await fs.readdir(cacheDir)).filter((x) => x.startsWith(".art-archive-"))).toEqual([]);
});

it.each([2, 4, 6])("accepts DEFLATE option bits %i", async (flags) => {
    const { cacheDir } = await setup();
    const bytes = Buffer.from(zipSync({ "image.png": png }, { level: 6 }));
    const central = bytes.readUInt32LE(bytes.length - 6);
    bytes.writeUInt16LE(bytes.readUInt16LE(6) | flags, 6);
    bytes.writeUInt16LE(bytes.readUInt16LE(central + 8) | flags, central + 8);
    const result = await openArtArchive(url, hash(bytes), { cacheDir, fetch: fetcher(bytes) });
    expect(await fs.readFile(path.join(result.root, "image.png"))).toEqual(png);
    await result.dispose();
});

it("rejects trailing bytes after a deflate stream", async () => {
    const { cacheDir } = await setup();
    const source = Buffer.from(zipSync({ "image.png": png }, { level: 6 }));
    const center = source.readUInt32LE(source.length - 6);
    const bytes = Buffer.concat([
        source.subarray(0, center),
        Buffer.from([1, 2, 3]),
        source.subarray(center),
    ]);
    const next = center + 3;
    bytes.writeUInt32LE(bytes.readUInt32LE(18) + 3, 18);
    bytes.writeUInt32LE(bytes.readUInt32LE(next + 20) + 3, next + 20);
    bytes.writeUInt32LE(next, bytes.length - 6);
    await expect(
        openArtArchive(url, hash(bytes), { cacheDir, fetch: fetcher(bytes) }),
    ).rejects.toThrow(/trailing/);
    expect((await fs.readdir(cacheDir)).filter((x) => x.startsWith(".art-archive-"))).toEqual([]);
});

it("rejects decompression output larger than both matching headers claim", async () => {
    const { cacheDir } = await setup();
    const bytes = Buffer.from(zipSync({ "image.png": png }, { level: 6 }));
    const center = bytes.readUInt32LE(bytes.length - 6);
    bytes.writeUInt32LE(2, 22);
    bytes.writeUInt32LE(2, center + 24);
    await expect(
        openArtArchive(url, hash(bytes), { cacheDir, fetch: fetcher(bytes) }),
    ).rejects.toThrow(/size limit/);
    expect((await fs.readdir(cacheDir)).filter((x) => x.startsWith(".art-archive-"))).toEqual([]);
});

it("rejects a cache mutation between verification and snapshot capture", async () => {
    const { cacheDir } = await setup();
    const bytes = zip({ "image.png": png });
    const digest = hash(bytes);
    const target = await downloadCached(url, digest, { cacheDir, fetch: fetcher(bytes) });
    let calls = 0;
    hooks.lstat = async (file) => {
        if (file === target && ++calls === 3)
            await fs.writeFile(target, "changed after verification");
    };
    await expect(openArtArchive(url, digest, { cacheDir, fetch: fetcher(bytes) })).rejects.toThrow(
        /SHA-256/,
    );
    expect(calls).toBe(3);
    expect((await fs.readdir(cacheDir)).filter((x) => x.startsWith(".art-archive-"))).toEqual([]);
});

it("cleans up when capture is aborted after reading begins", async () => {
    const { cacheDir } = await setup();
    const bytes = zip({ "image.png": png });
    const digest = hash(bytes);
    const target = await downloadCached(url, digest, { cacheDir, fetch: fetcher(bytes) });
    const controller = new AbortController();
    let opens = 0,
        captured = false;
    hooks.opened = (file, handle) => {
        if (file !== target || ++opens !== 2) return;
        const read = handle.createReadStream.bind(handle);
        handle.createReadStream = (options: any) => {
            const stream = read(options);
            stream.once("data", () => {
                captured = true;
                controller.abort();
            });
            return stream;
        };
    };
    await expect(
        openArtArchive(url, digest, { cacheDir, fetch: fetcher(bytes), signal: controller.signal }),
    ).rejects.toThrow();
    expect(captured).toBe(true);
    expect((await fs.readdir(cacheDir)).filter((x) => x.startsWith(".art-archive-"))).toEqual([]);
});

it("rejects a truncated data descriptor", async () => {
    const { cacheDir } = await setup();
    const { out, descriptor, central } = withDescriptor(zip({ "image.png": png }), true);
    const bytes = Buffer.concat([out.subarray(0, descriptor + 8), out.subarray(central)]);
    bytes.writeUInt32LE(descriptor + 8, bytes.length - 6);
    await expect(
        openArtArchive(url, hash(bytes), { cacheDir, fetch: fetcher(bytes) }),
    ).rejects.toThrow(/descriptor/);
    expect((await fs.readdir(cacheDir)).filter((x) => x.startsWith(".art-archive-"))).toEqual([]);
});

it("rejects a signed descriptor that overlaps the central directory", async () => {
    const { cacheDir } = await setup();
    const { out, descriptor, central } = withDescriptor(zip({ "image.png": png }), true);
    // The signature, CRC and compressed length fit; the plain length would
    // begin at the central-directory boundary.
    const bytes = Buffer.concat([out.subarray(0, central - 4), out.subarray(central)]);
    bytes.writeUInt32LE(central - 4, bytes.length - 6);
    expect(central - 4 - descriptor).toBe(12);
    await expect(
        openArtArchive(url, hash(bytes), { cacheDir, fetch: fetcher(bytes) }),
    ).rejects.toThrow("invalid artwork entry descriptor");
    expect(
        (await fs.readdir(cacheDir)).filter((entry) => entry.startsWith(".art-archive-")),
    ).toEqual([]);
});

it.each(["encrypted", "unsupported method", "ZIP64 sizes", "ZIP64 footer", "ZIP64 extra"])(
    "refuses %s without exposing extracted originals",
    async (kind) => {
        const { cacheDir } = await setup();
        let bytes = zip({ "image.png": png });
        const center = bytes.readUInt32LE(bytes.length - 6);
        if (kind === "encrypted") {
            bytes.writeUInt16LE(1, 6);
            bytes.writeUInt16LE(1, center + 8);
        } else if (kind === "unsupported method") {
            bytes.writeUInt16LE(12, 8);
            bytes.writeUInt16LE(12, center + 10);
        } else if (kind === "ZIP64 sizes") {
            bytes.writeUInt32LE(0xffffffff, 22);
            bytes.writeUInt32LE(0xffffffff, center + 24);
        } else if (kind === "ZIP64 footer") {
            const end = bytes.length - 22;
            const locator = Buffer.alloc(20);
            locator.writeUInt32LE(0x07064b50);
            bytes = Buffer.concat([bytes.subarray(0, end), locator, bytes.subarray(end)]);
        } else {
            const end = bytes.length - 22;
            const extra = Buffer.from([1, 0, 0, 0]);
            bytes = Buffer.concat([bytes.subarray(0, end), extra, bytes.subarray(end)]);
            bytes.writeUInt16LE(4, center + 30);
            bytes.writeUInt32LE(bytes.readUInt32LE(bytes.length - 10) + 4, bytes.length - 10);
        }
        await expect(
            openArtArchive(url, hash(bytes), { cacheDir, fetch: fetcher(bytes) }),
        ).rejects.toThrow(/unsupported|ZIP64/);
        expect(
            (await fs.readdir(cacheDir)).filter((name) => name.startsWith(".art-archive-")),
        ).toEqual([]);
    },
);

it("reclaims dead local sessions while preserving live, foreign and unrecognized directories", async () => {
    const { cacheDir } = await setup();
    const bytes = zip({ "image.png": png });
    const a = await openArtArchive(url, hash(bytes), { cacheDir, fetch: fetcher(bytes) });
    const host = createHash("sha256").update(os.hostname()).digest("hex").slice(0, 16);
    const deadPid = process.pid + 100000;
    const dead = path.join(cacheDir, `.art-archive-${host}-${deadPid}-stale`);
    const foreign = path.join(cacheDir, `.art-archive-otherhost-${deadPid}-keep`);
    const unknown = path.join(cacheDir, `.art-archive-${host}-unknown`);
    for (const dir of [dead, foreign, unknown]) {
        await fs.mkdir(dir);
        await fs.writeFile(path.join(dir, "original.png"), png);
    }
    const kill = process.kill.bind(process);
    vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
        if (pid === deadPid) throw Object.assign(new Error("absent"), { code: "ESRCH" });
        return kill(pid, signal);
    });
    const b = await openArtArchive(url, hash(bytes), { cacheDir, fetch: fetcher(bytes) });
    await expect(fs.stat(dead)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(path.join(a.root, "image.png"))).toEqual(png);
    for (const dir of [foreign, unknown])
        expect(await fs.readFile(path.join(dir, "original.png"))).toEqual(png);
    await a.dispose();
    expect(await fs.readFile(path.join(b.root, "image.png"))).toEqual(png);
    await b.dispose();
});
