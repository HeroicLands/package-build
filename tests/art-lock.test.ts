/* SPDX-License-Identifier: GPL-3.0-or-later */
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { subprocessTimeout } from "./subprocess-timeout.js";
import { zipSync } from "fflate";
import { configFromData } from "../engine/pack-config.mjs";
import { indexRecordsFor } from "../engine/content-index.mjs";
import { noteTree } from "../engine/note-cache.mjs";
import { writeSvgProvenance, writeDerivativeProvenance } from "../engine/art-provenance.mjs";
import {
    readArtLock,
    fetchPublicArt,
    loadPinnedArt,
    fetchArtSource,
    reproducePinnedArt,
} from "../engine/art-lock.mjs";

const roots: string[] = [];
const hash = (bytes: Uint8Array) => crypto.createHash("sha256").update(bytes).digest("hex");
function fixture() {
    fs.mkdirSync("build", { recursive: true });
    const root = fs.mkdtempSync(path.resolve("build/art-lock-test-"));
    roots.push(root);
    const config = {
        rootDir: root,
        contentPackage: "sample",
        art: { masterRoots: [] },
        paths: { assets: path.join(root, "assets") },
    };
    const address = "sample-none-image-example";
    const records = [
        {
            type: "image",
            address: { canonical: address },
            asset: {
                path: "images/example.svg",
                attribution: "Artist",
                license: "CC-BY-SA-4.0",
                ai: false,
            },
        },
    ];
    const rendered = writeDerivativeProvenance(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
        { address, creator: "Artist", rights: "Terms", derivedFrom: address },
        { repeat: ["derivedFrom"] },
    ).bytes;
    const zip = Buffer.from(zipSync({ "arbitrary/name.svg": rendered }));
    const lock = {
        version: 1,
        package: "sample",
        source: { repository: "https://forge.example/art.git", revision: "a".repeat(40) },
        rendered: { url: "https://public.example/art.zip", sha256: hash(zip) },
    };
    fs.writeFileSync(path.join(root, "art.lock"), JSON.stringify(lock));
    const from = path.join(root, "input.zip");
    fs.writeFileSync(from, zip);
    return { config, root, address, records, rendered, zip, lock, from };
}
afterEach(() => {
    vi.unstubAllGlobals();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("pinned artwork", () => {
    it("validates the closed lock and refuses credentials, unknown keys and malformed pins", () => {
        const f = fixture();
        expect(readArtLock(f.config)?.package).toBe("sample");
        for (const lock of [
            { ...f.lock, extra: true },
            { ...f.lock, version: 2 },
            { ...f.lock, package: "foreign" },
            { ...f.lock, source: { ...f.lock.source, revision: "main" } },
            {
                ...f.lock,
                source: { ...f.lock.source, repository: "https://user:secret@host/art.git" },
            },
            { ...f.lock, rendered: { ...f.lock.rendered, sha256: "bad" } },
            { ...f.lock, rendered: { ...f.lock.rendered, url: "https://host/a.zip?token=secret" } },
        ]) {
            fs.writeFileSync(path.join(f.root, "art.lock"), JSON.stringify(lock));
            expect(() => readArtLock(f.config)).toThrow(/art.lock.*error:/);
        }
    });
    it("fetches once, reads offline, derives identity from metadata, and detects partial cache", async () => {
        const f = fixture();
        await fetchPublicArt(f.config, { from: f.from, records: f.records });
        vi.stubGlobal("fetch", () => {
            throw new Error("network forbidden");
        });
        const loaded = loadPinnedArt(f.config, f.records);
        expect(loaded.files.size).toBe(1);
        expect(fs.readFileSync(loaded.files.get(f.address)!)).toEqual(f.rendered);
        expect(loaded.records[0].asset.ai).toBe(false);
        expect(loaded.records[0].asset.path).toBe("images/example.svg");
        fs.writeFileSync(loaded.files.get(f.address)!, "corrupt");
        expect(() => loadPinnedArt(f.config, f.records)).toThrow(/art fetch/);
        await fetchPublicArt(f.config, { from: f.from, records: f.records });
        expect(fs.readFileSync(loadPinnedArt(f.config, f.records).files.get(f.address)!)).toEqual(
            f.rendered,
        );
    });
    it("requires explicit fetch and refuses digest mismatch without exposing a cache", async () => {
        const f = fixture();
        expect(() => loadPinnedArt(f.config, f.records)).toThrow(/art fetch/);
        fs.writeFileSync(f.from, "broken");
        await expect(
            fetchPublicArt(f.config, { from: f.from, records: f.records }),
        ).rejects.toThrow(/SHA-256/);
    });
    it("rejects unknown identities, private metadata and unchanged publication exclusions", async () => {
        const f = fixture();
        await expect(fetchPublicArt(f.config, { from: f.from, records: [] })).rejects.toThrow(
            /standard index/,
        );
        f.records[0].asset.ai = true;
        await fetchPublicArt(f.config, { from: f.from, records: f.records });
        expect(loadPinnedArt(f.config, f.records).records[0].asset.ai).toBe(true);
        const privateSvg = writeSvgProvenance(f.rendered, { prompt: "private" }).bytes;
        const zip = zipSync({ "a.svg": privateSvg });
        fs.writeFileSync(f.from, zip);
        f.lock.rendered.sha256 = hash(zip);
        fs.writeFileSync(path.join(f.root, "art.lock"), JSON.stringify(f.lock));
        await expect(
            fetchPublicArt(f.config, { from: f.from, records: f.records }),
        ).rejects.toThrow(/metadata/);
    });
    it.each([
        "../escape.svg",
        "/absolute.svg",
        "x\\escape.svg",
        "A.svg",
        "CON.svg",
        "x./image.svg",
    ])("rejects unsafe archive path %s", async (name) => {
        const f = fixture();
        const files: Record<string, Uint8Array> = { [name]: f.rendered };
        if (name === "A.svg") files["a.svg"] = f.rendered;
        const zip = zipSync(files);
        fs.writeFileSync(f.from, zip);
        f.lock.rendered.sha256 = hash(zip);
        fs.writeFileSync(path.join(f.root, "art.lock"), JSON.stringify(f.lock));
        await expect(
            fetchPublicArt(f.config, { from: f.from, records: f.records }),
        ).rejects.toThrow(/archive/);
    });
    it.each([false, true])(
        "refuses private source assets through index and note cache (alias: %s)",
        async (alias) => {
            const f = fixture();
            fs.writeFileSync(
                path.join(f.root, "package.json"),
                JSON.stringify({ name: "sample", version: "1.0.0" }),
            );
            const source = path.join(f.root, "build/.cache/art-sources/pin/repository");
            fs.mkdirSync(source, { recursive: true });
            const assets = alias ? path.join(f.root, "alias") : source;
            if (alias) fs.symlinkSync(source, assets);
            const config = configFromData(
                {
                    contentPackage: "sample",
                    packageKind: "modules",
                    stats: { lastModifiedBy: "samplebuilder000" },
                    compatibility: { minimum: "14", verified: "14" },
                    packs: [],
                    art: { masterRoots: [], componentRoots: [] },
                    paths: { assets: path.relative(f.root, assets) },
                },
                path.join(f.root, "package-build.config.yaml"),
            );
            for (const pinnedArt of [false, true]) {
                for (const masterRecords of [undefined, []]) {
                    expect(() => indexRecordsFor({ config, pinnedArt, masterRecords })).toThrow(
                        /private master root.*overlaps input/,
                    );
                    expect(() =>
                        indexRecordsFor({ config, assetsBase: assets, pinnedArt, masterRecords }),
                    ).toThrow(/private master root.*overlaps input/);
                }
            }
            for (const cache of [false, true])
                await expect(noteTree(config, { cache })).rejects.toThrow(
                    /private master root.*overlaps input/,
                );
        },
    );
    it("rejects a footer hidden in the archive comment before allocating its entry", async () => {
        const f = fixture();
        const cd = f.zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
        const end = f.zip.length - 22;
        const directory = Buffer.from(f.zip.subarray(cd, end));
        directory.writeUInt32LE(300 * 1024 * 1024, 24);
        const footer = Buffer.from(f.zip.subarray(end));
        footer.writeUInt32LE(f.zip.length, 16);
        const comment = Buffer.concat([directory, footer, Buffer.from([0])]);
        f.zip.writeUInt16LE(comment.length, end + 20);
        const crafted = Buffer.concat([f.zip, comment]);
        fs.writeFileSync(f.from, crafted);
        f.lock.rendered.sha256 = hash(crafted);
        fs.writeFileSync(path.join(f.root, "art.lock"), JSON.stringify(f.lock));
        const script = `
            let oversized = false;
            const Native = globalThis.Uint8Array;
            globalThis.Uint8Array = class extends Native {
                constructor(...args) {
                    if (typeof args[0] === "number" && args[0] > 16 * 1024 * 1024)
                        { oversized = true; throw new Error("allocation guard"); }
                    super(...args);
                }
            };
            const { fetchPublicArt } = await import(${JSON.stringify(new URL("../engine/art-lock.mjs", import.meta.url).href)});
            try {
                await fetchPublicArt(${JSON.stringify(f.config)}, { from: ${JSON.stringify(f.from)}, records: ${JSON.stringify(f.records)} });
                process.exit(2);
            } catch (error) {
                if (oversized || !error.message.includes("malformed public artwork archive")) process.exit(3);
            }
        `;
        const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
            encoding: "utf8",
        });
        expect(result.status, result.stderr).toBe(0);
    });
    it("rejects a ZIP64 locator before decompression", async () => {
        const f = fixture();
        const end = f.zip.length - 22;
        const locator = Buffer.alloc(20);
        locator.writeUInt32LE(0x07064b50);
        const crafted = Buffer.concat([f.zip.subarray(0, end), locator, f.zip.subarray(end)]);
        fs.writeFileSync(f.from, crafted);
        f.lock.rendered.sha256 = hash(crafted);
        fs.writeFileSync(path.join(f.root, "art.lock"), JSON.stringify(f.lock));
        await expect(
            fetchPublicArt(f.config, { from: f.from, records: f.records }),
        ).rejects.toThrow(/malformed public artwork archive/);
    });
    it("rejects duplicate embedded addresses and private output symlinks", async () => {
        const f = fixture();
        const zip = zipSync({ "a.svg": f.rendered, "b.svg": f.rendered });
        fs.writeFileSync(f.from, zip);
        f.lock.rendered.sha256 = hash(zip);
        fs.writeFileSync(path.join(f.root, "art.lock"), JSON.stringify(f.lock));
        await expect(
            fetchPublicArt(f.config, { from: f.from, records: f.records }),
        ).rejects.toThrow(/duplicate.*address/);
        const other = fixture();
        fs.symlinkSync(other.root, path.join(f.root, "build"));
        await expect(
            fetchPublicArt(f.config, { from: f.from, records: f.records }),
        ).rejects.toThrow(/symbolic/);
    });
});

it.skipIf(spawnSync("git", ["lfs", "version"]).status !== 0)(
    "restores real Git/LFS masters at the pinned revision and reproduces only public images",
    async () => {
        const f = fixture(),
            repository = path.join(f.root, "source");
        fs.mkdirSync(repository);
        const git = (args: string[]) =>
            execFileSync(
                "git",
                ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
                { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
            ).trim();
        git(["init"]);
        git(["config", "user.name", "Fixture"]);
        git(["config", "user.email", "fixture@example.invalid"]);
        git(["lfs", "install", "--local", "--skip-repo"]);
        git(["lfs", "track", "*.svg"]);
        const master = writeSvgProvenance(
            '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
            { address: f.address, creator: "Artist", rights: "Terms", license: "CC-BY-SA-4.0" },
        ).bytes;
        fs.writeFileSync(path.join(repository, "source.svg"), master);
        const component = writeSvgProvenance(master, {
            address: "sample-none-image-component",
        }).bytes;
        fs.writeFileSync(path.join(repository, "component.svg"), component);
        git(["add", ".gitattributes", "source.svg", "component.svg"]);
        git(["commit", "-m", "Store fixture artwork"]);
        f.lock.source.revision = git(["rev-parse", "HEAD"]);
        fs.writeFileSync(path.join(f.root, "art.lock"), JSON.stringify(f.lock));
        await fetchPublicArt(f.config, { from: f.from, records: f.records });
        const before = fs.readFileSync(path.join(f.root, "art.lock"));
        const fetched = await fetchArtSource(f.config, { from: repository });
        expect(fs.readFileSync(path.join(fetched, "source.svg"))).toEqual(master);
        const reproduced = await reproducePinnedArt(f.config, { records: f.records });
        expect([...reproduced.keys()]).toEqual([f.address]);
        expect(fs.readFileSync(path.join(f.root, "art.lock"))).toEqual(before);
        fs.writeFileSync(path.join(fetched, "source.svg"), "changed");
        await expect(reproducePinnedArt(f.config, { records: f.records })).rejects.toThrow(
            /differs|verification/,
        );
        const validRevision = f.lock.source.revision;
        f.lock.source.revision = "b".repeat(40);
        fs.writeFileSync(path.join(f.root, "art.lock"), JSON.stringify(f.lock));
        await expect(fetchArtSource(f.config, { from: repository })).rejects.toThrow(/Git\/LFS/);
        const missing = fixture();
        missing.lock.source.revision = validRevision;
        fs.writeFileSync(path.join(missing.root, "art.lock"), JSON.stringify(missing.lock));
        fs.rmSync(path.join(repository, ".git", "lfs", "objects"), { recursive: true });
        await expect(fetchArtSource(missing.config, { from: repository })).rejects.toThrow(
            /Git\/LFS/,
        );
        expect(fs.readdirSync(path.join(missing.root, "build", ".cache", "art-sources"))).toEqual(
            [],
        );
    },
    subprocessTimeout(40),
);

it("fetches only public HTTPS without forwarding credentials and refuses failed responses", async () => {
    const f = fixture();
    const request = vi.fn(async () => new Response(f.zip));
    vi.stubGlobal("fetch", request);
    await fetchPublicArt(f.config, { records: f.records });
    expect(request).toHaveBeenCalledWith(f.lock.rendered.url, { redirect: "manual" });
    request.mockResolvedValue(new Response(null, { status: 403 }));
    await expect(fetchPublicArt(f.config, { records: f.records })).rejects.toThrow(/HTTP 403/);
});
it("rejects altered ZIP entry checksums before exposing any files", async () => {
    const f = fixture();
    const zip = Buffer.from(f.zip);
    const directory = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    zip.writeUInt32LE(0, directory + 16);
    fs.writeFileSync(f.from, zip);
    f.lock.rendered.sha256 = hash(zip);
    fs.writeFileSync(path.join(f.root, "art.lock"), JSON.stringify(f.lock));
    await expect(fetchPublicArt(f.config, { from: f.from, records: f.records })).rejects.toThrow(
        /malformed/,
    );
});

it.each(["symlink", "duplicate", "local-name"])(
    "rejects %s ZIP entries with a matching archive digest",
    async (kind) => {
        const f = fixture();
        const zip = Buffer.from(zipSync({ "a.svg": f.rendered, "b.svg": f.rendered }));
        const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]),
            first = zip.indexOf(signature),
            second = zip.indexOf(signature, first + 4);
        if (kind === "symlink") zip.writeUInt32LE((0xa1ff << 16) >>> 0, first + 38);
        if (kind === "duplicate") {
            zip[second + 46] = 97;
            const local = zip.readUInt32LE(second + 42);
            zip[local + 30] = 97;
        }
        if (kind === "local-name") zip[30] = 120;
        fs.writeFileSync(f.from, zip);
        f.lock.rendered.sha256 = hash(zip);
        fs.writeFileSync(path.join(f.root, "art.lock"), JSON.stringify(f.lock));
        await expect(
            fetchPublicArt(f.config, { from: f.from, records: f.records }),
        ).rejects.toThrow(/malformed/);
    },
);

it("follows bounded HTTPS release redirects and refuses downgrade or credential destinations", async () => {
    const f = fixture();
    const target = "https://storage.example/object.zip?X-Amz-Signature=temporary";
    const request = vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: target } }))
        .mockResolvedValueOnce(new Response(f.zip));
    vi.stubGlobal("fetch", request);
    await fetchPublicArt(f.config, { records: f.records });
    expect(request).toHaveBeenNthCalledWith(2, target, { redirect: "manual" });
    for (const location of [
        "http://storage.example/file",
        "https://user:secret@storage.example/file",
    ]) {
        request.mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
        await expect(fetchPublicArt(f.config, { records: f.records })).rejects.toThrow(/HTTPS/);
    }
    request.mockResolvedValue(
        new Response(null, { status: 302, headers: { location: "https://public.example/again" } }),
    );
    await expect(fetchPublicArt(f.config, { records: f.records })).rejects.toThrow(/five hops/);
});

it("requires public indexed authority for current note metadata", async () => {
    const f = fixture(),
        primary = "sample-note-being-subject";
    const note = {
        type: "being",
        address: { canonical: primary },
        name: { full: "Subject" },
        namedImages: [f.address],
        tags: [] as string[],
    };
    const rendered = writeDerivativeProvenance(
        f.rendered,
        {
            address: f.address,
            creator: "Artist",
            rights: "Terms",
            derivedFrom: f.address,
            primaryNote: primary,
            name: "Subject",
        },
        { repeat: ["derivedFrom", "primaryNote", "name"], notePublic: true },
    ).bytes;
    const zip = zipSync({ "image.svg": rendered });
    fs.writeFileSync(f.from, zip);
    f.lock.rendered.sha256 = hash(zip);
    fs.writeFileSync(path.join(f.root, "art.lock"), JSON.stringify(f.lock));
    await fetchPublicArt(f.config, { from: f.from, records: [...f.records, note] });
    for (const records of [
        f.records,
        [...f.records, { ...note, tags: ["gm"] }],
        [...f.records, { ...note, name: { full: "Changed" } }],
    ])
        await expect(fetchPublicArt(f.config, { from: f.from, records })).rejects.toThrow(
            /public standard-index note/,
        );
    const other = { ...note, address: { canonical: "sample-note-being-other" } };
    await expect(
        fetchPublicArt(f.config, {
            from: f.from,
            records: [...f.records, { ...note, namedImages: [] }, other],
        }),
    ).rejects.toThrow(/public standard-index note/);
});
it("does not discover a lock through a partial index configuration", () => {
    expect(readArtLock({ contentPackage: "sample" } as never)).toBeNull();
});
