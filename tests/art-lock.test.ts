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
    vi.unstubAllEnvs();
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
            { ...f.lock, rendered: { ...f.lock.rendered, url: "http://host/art.zip" } },
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
        expect(await fetchArtSource(f.config, { from: path.join(f.root, "unavailable") })).toBe(
            fetched,
        );
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

function sourceFixture(objectFormat = "sha1") {
    const f = fixture(),
        repository = path.join(f.root, "source");
    fs.mkdirSync(repository);
    const git = (args: string[], cwd = repository) =>
        execFileSync(
            "git",
            ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
            { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ).trim();
    git(["init", "--template=", `--object-format=${objectFormat}`]);
    git(["config", "user.name", "Fixture"]);
    git(["config", "user.email", "fixture@example.invalid"]);
    git(["lfs", "install", "--local", "--skip-repo"]);
    git(["lfs", "track", "*.svg"]);
    const master = writeSvgProvenance(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
        {
            address: f.address,
            creator: "Artist",
            rights: "Terms",
            license: "CC-BY-SA-4.0",
        },
    ).bytes;
    fs.writeFileSync(path.join(repository, "source.svg"), master);
    fs.writeFileSync(path.join(repository, "notes.txt"), "source bytes\n");
    fs.writeFileSync(path.join(repository, ".gitignore"), "ignored\n");
    git(["add", "."]);
    git(["commit", "-m", "Store source fixture"]);
    f.lock.source.revision = git(["rev-parse", "HEAD"]);
    fs.writeFileSync(path.join(f.root, "art.lock"), JSON.stringify(f.lock));
    return { ...f, repository, git, master };
}

describe.skipIf(spawnSync("git", ["lfs", "version"]).status !== 0)("private source cache", () => {
    it(
        "restores, reuses and reproduces a SHA-256 source repository",
        async () => {
            const f = sourceFixture("sha256");
            expect(f.lock.source.revision).toHaveLength(64);
            await fetchPublicArt(f.config, { from: f.from, records: f.records });
            const checkout = await fetchArtSource(f.config, { from: f.repository });
            expect(await fetchArtSource(f.config, { from: path.join(f.root, "unavailable") })).toBe(
                checkout,
            );
            expect([
                ...(await reproducePinnedArt(f.config, { records: f.records })).keys(),
            ]).toEqual([f.address]);
        },
        subprocessTimeout(40),
    );

    it.each([
        "head",
        "ordinary",
        "master",
        "missing-file",
        "corrupt-git",
        "symbolic-head",
        "extra",
        "ignored",
        "missing-lfs",
        "corrupt-lfs",
        "receipt",
        "forged-receipt",
        "index-flags",
    ])(
        "rejects %s corruption on reuse and reproduction without replacing it",
        async (kind) => {
            const f = sourceFixture(),
                checkout = await fetchArtSource(f.config, { from: f.repository });
            const receipt = path.join(path.dirname(checkout), "integrity.json");
            const object = path.join(
                checkout,
                ".git/lfs/objects",
                hash(f.master).slice(0, 2),
                hash(f.master).slice(2, 4),
                hash(f.master),
            );
            if (kind === "head")
                fs.writeFileSync(path.join(checkout, ".git/HEAD"), "b".repeat(40) + "\n");
            if (kind === "missing-file") fs.unlinkSync(path.join(checkout, "notes.txt"));
            if (kind === "symbolic-head")
                fs.writeFileSync(path.join(checkout, ".git/HEAD"), "ref: refs/heads/main\n");
            if (kind === "corrupt-git") {
                const pack = path.join(checkout, ".git/objects/pack");
                const file = fs.readdirSync(pack).find((name) => name.endsWith(".pack"))!;
                fs.writeFileSync(path.join(pack, file), "corrupt");
            }
            if (kind === "ordinary" || kind === "index-flags") {
                if (kind === "index-flags")
                    f.git(
                        ["update-index", "--skip-worktree", "--assume-unchanged", "notes.txt"],
                        checkout,
                    );
                fs.writeFileSync(path.join(checkout, "notes.txt"), "changed\n");
            }
            if (kind === "master" || kind === "forged-receipt")
                fs.writeFileSync(path.join(checkout, "source.svg"), "changed");
            if (kind === "extra" || kind === "ignored")
                fs.writeFileSync(path.join(checkout, kind), "extra");
            if (kind === "missing-lfs") fs.unlinkSync(object);
            if (kind === "corrupt-lfs") fs.writeFileSync(object, "corrupt");
            if (kind === "receipt") fs.writeFileSync(receipt, "{}");
            if (kind === "forged-receipt")
                fs.writeFileSync(
                    receipt,
                    JSON.stringify({
                        revision: f.lock.source.revision,
                        masterSha256: [hash(Buffer.from("changed"))],
                    }),
                );
            const inode = fs.statSync(checkout).ino;
            await expect(fetchArtSource(f.config, { from: f.repository })).rejects.toThrow(
                /source cache.*invalid.*clean.*art source fetch/,
            );
            await expect(reproducePinnedArt(f.config, { records: f.records })).rejects.toThrow(
                /source cache.*invalid.*clean.*art source fetch/,
            );
            expect(fs.statSync(checkout).ino).toBe(inode);
            if (kind === "corrupt-lfs") expect(fs.readFileSync(object, "utf8")).toBe("corrupt");
        },
        subprocessTimeout(40),
    );
    it(
        "ignores cached executable configuration, index flags and inherited Git selectors without fetching",
        async () => {
            const f = sourceFixture(),
                checkout = await fetchArtSource(f.config, { from: f.repository });
            f.git(
                ["-c", "core.fsmonitor=false", "update-index", "--skip-worktree", "source.svg"],
                checkout,
            );
            await fetchPublicArt(f.config, { from: f.from, records: f.records });
            const marker = path.join(f.root, "executed");
            const script = path.join(f.root, "marker.sh");
            fs.writeFileSync(script, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, { mode: 0o755 });
            const include = path.join(f.root, "hostile.config");
            fs.writeFileSync(
                include,
                `[core]\nfsmonitor = ${script}\n[filter "lfs"]\nprocess = ${script}\nrequired = true\n[credential]\nhelper = !${script}\n`,
            );
            fs.appendFileSync(
                path.join(checkout, ".git/config"),
                `[include]\npath = ${include}\n[lfs]\nfetchexclude = *\nstorage = ${f.repository}/.git/lfs\n[core]\nhooksPath = ${f.root}\n`,
            );
            fs.writeFileSync(path.join(f.root, "post-checkout"), fs.readFileSync(script), {
                mode: 0o755,
            });
            const bin = path.join(f.root, "bin");
            fs.mkdirSync(bin);
            const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
            const calls = path.join(f.root, "git-calls");
            fs.writeFileSync(
                path.join(bin, "git"),
                `#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\ncase " $* " in *' clone '*|*' fetch '*) exit 79;; esac\nexec '${realGit}' "$@"\n`,
                { mode: 0o755 },
            );
            vi.stubEnv("PATH", bin + path.delimiter + process.env.PATH);
            vi.stubEnv("GIT_CONFIG_COUNT", "1");
            vi.stubEnv("GIT_CONFIG_KEY_0", "core.fsmonitor");
            vi.stubEnv("GIT_CONFIG_VALUE_0", script);
            vi.stubEnv("GIT_ASKPASS", script);
            vi.stubEnv("GIT_SSH_COMMAND", script);
            vi.stubEnv("GIT_DIR", path.join(f.root, "missing"));
            vi.stubEnv("GIT_INDEX_FILE", path.join(f.root, "missing-index"));
            vi.stubEnv("GIT_ALTERNATE_OBJECT_DIRECTORIES", path.join(f.root, "missing-objects"));
            const inode = fs.statSync(checkout).ino;
            expect(await fetchArtSource(f.config, { from: path.join(f.root, "unavailable") })).toBe(
                checkout,
            );
            expect(fs.statSync(checkout).ino).toBe(inode);
            expect(fs.existsSync(marker)).toBe(false);
            expect(fs.readFileSync(calls, "utf8")).not.toMatch(
                /(?:^| )(?:(?:clone)|(?:fetch))(?: |$)/m,
            );
            fs.writeFileSync(path.join(checkout, "source.svg"), "changed");
            await expect(fetchArtSource(f.config)).rejects.toThrow(/source cache.*invalid/);
            expect(fs.existsSync(marker)).toBe(false);
        },
        subprocessTimeout(40),
    );
    it.each([
        "gitfile",
        "git-symlink",
        "objects-symlink",
        "lfs-symlink",
        "worktree-symlink",
        "receipt-symlink",
        "alternates",
        "http-alternates",
        "lfsconfig",
        "special-file",
    ])(
        "refuses %s cache structure",
        async (kind) => {
            const f = sourceFixture(),
                checkout = await fetchArtSource(f.config, { from: f.repository });
            if (kind === "special-file") execFileSync("mkfifo", [path.join(checkout, "fifo")]);
            if (kind === "gitfile") {
                fs.renameSync(path.join(checkout, ".git"), path.join(f.root, "control"));
                fs.writeFileSync(path.join(checkout, ".git"), `gitdir: ${f.root}/control\n`);
            }
            if (kind.endsWith("-symlink")) {
                const relative = {
                    "git-symlink": ".git",
                    "objects-symlink": ".git/objects",
                    "lfs-symlink": ".git/lfs",
                    "worktree-symlink": "notes.txt",
                    "receipt-symlink": "../integrity.json",
                }[kind]!;
                const target = path.resolve(checkout, relative),
                    outside = path.join(f.root, "outside");
                fs.renameSync(target, outside);
                fs.symlinkSync(outside, target);
            }
            if (kind === "alternates" || kind === "http-alternates")
                fs.writeFileSync(
                    path.join(checkout, ".git/objects/info", kind),
                    f.repository + "/.git/objects\n",
                );
            if (kind === "lfsconfig")
                fs.writeFileSync(
                    path.join(checkout, ".lfsconfig"),
                    "[lfs]\nurl = https://invalid.example/lfs\n",
                );
            await expect(fetchArtSource(f.config, { from: f.repository })).rejects.toThrow(
                /source cache.*invalid/,
            );
        },
        subprocessTimeout(40),
    );
    it.each(["lfsconfig", "lfsconfig-case", "symlink", "gitlink"])(
        "refuses tracked %s before materializing a source",
        async (kind) => {
            const f = sourceFixture();
            if (kind === "lfsconfig" || kind === "lfsconfig-case")
                fs.writeFileSync(
                    path.join(f.repository, kind === "lfsconfig" ? ".lfsconfig" : ".LFSCONFIG"),
                    "[lfs]\nurl = https://invalid.example/lfs\n",
                );
            if (kind === "symlink") fs.symlinkSync("notes.txt", path.join(f.repository, "link"));
            if (kind === "gitlink")
                f.git([
                    "update-index",
                    "--add",
                    "--cacheinfo",
                    `160000,${f.lock.source.revision},submodule`,
                ]);
            else f.git(["add", "."]);
            f.git(["commit", "-m", "Store unsafe fixture"]);
            f.lock.source.revision = f.git(["rev-parse", "HEAD"]);
            fs.writeFileSync(path.join(f.root, "art.lock"), JSON.stringify(f.lock));
            const bin = path.join(f.root, "bin"),
                calls = path.join(f.root, "git-calls");
            fs.mkdirSync(bin);
            const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
            fs.writeFileSync(
                path.join(bin, "git"),
                `#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\ncase " $* " in *' checkout '*|*' lfs fetch '*) exit 79;; esac\nexec '${realGit}' "$@"\n`,
                { mode: 0o755 },
            );
            vi.stubEnv("PATH", bin + path.delimiter + process.env.PATH);
            await expect(fetchArtSource(f.config, { from: f.repository })).rejects.toThrow(
                /Git\/LFS/,
            );
            expect(fs.readdirSync(path.join(f.root, "build/.cache/art-sources"))).toEqual([]);
            expect(fs.readFileSync(calls, "utf8")).not.toMatch(/(?: checkout | lfs fetch )/);
        },
        subprocessTimeout(40),
    );
});

function cleanFixture(root: string, art: Record<string, string[]>, extra: string[] = []) {
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sample", version: "1.0.0" }),
    );
    const file = path.join(root, "package-build.config.yaml");
    fs.writeFileSync(
        file,
        JSON.stringify({
            contentPackage: "sample",
            packageKind: "modules",
            stats: { lastModifiedBy: "samplebuilder000" },
            compatibility: { minimum: "14", verified: "14" },
            packs: [],
            art,
            packageBuild: { clean: { extra } },
        }),
    );
    return () =>
        spawnSync(process.execPath, [path.resolve("bin/package-build.mjs"), "clean"], {
            cwd: root,
            env: { ...process.env, PACKAGE_BUILD_CONFIG: file },
            encoding: "utf8",
        });
}

it.skipIf(spawnSync("git", ["lfs", "version"]).status !== 0)(
    "clean removes a fetched source cache and unlinks its outside symlinks",
    async () => {
        const f = sourceFixture(),
            checkout = await fetchArtSource(f.config, { from: f.repository });
        const outside = path.join(f.root, "canonical");
        fs.mkdirSync(outside);
        fs.writeFileSync(path.join(outside, "master.svg"), "canonical original");
        fs.symlinkSync(outside, path.join(checkout, "outside"));
        const clean = cleanFixture(f.root, { masterRoots: [outside], componentRoots: [] });
        const result = clean();
        expect(result.status, result.stderr + result.stdout).toBe(0);
        expect(fs.existsSync(path.join(f.root, "build"))).toBe(false);
        expect(fs.readFileSync(path.join(outside, "master.svg"), "utf8")).toBe(
            "canonical original",
        );
        expect(fs.readFileSync(path.join(f.repository, "source.svg"))).toEqual(f.master);
    },
    subprocessTimeout(40),
);

it.each(["masterRoots", "componentRoots"])(
    "clean protects configured %s through physical overlaps",
    (key) => {
        const f = fixture();
        for (const kind of ["build", "extra", "alias", "fetched-location"]) {
            const relative =
                kind === "build" ? "build/private"
                : kind === "fetched-location" ? "build/.cache/art-sources/authored"
                : "originals/private";
            const original = path.join(f.root, relative);
            fs.mkdirSync(original, { recursive: true });
            const sentinel = path.join(original, "master.svg");
            fs.writeFileSync(sentinel, "canonical original");
            if (kind === "alias")
                fs.symlinkSync(path.join(f.root, "originals"), path.join(f.root, "alias"));
            const configured = kind === "alias" ? path.join(f.root, "alias/private") : original;
            const clean = cleanFixture(
                f.root,
                { [key]: [configured] },
                ["extra", "alias"].includes(kind) ? ["originals"] : [],
            );
            const result = clean();
            expect(result.status, result.stderr + result.stdout).not.toBe(0);
            expect(result.stderr + result.stdout).toMatch(/overlap/);
            expect(fs.readFileSync(sentinel, "utf8")).toBe("canonical original");
        }
    },
    subprocessTimeout(10),
);

it.skipIf(spawnSync("git", ["lfs", "version"]).status !== 0)(
    "reproduction refuses each live publication mismatch before changing rendered output",
    async () => {
        const f = sourceFixture();
        const primary = "sample-note-being-subject";
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
        await fetchArtSource(f.config, { from: f.repository });
        const out = path.join(f.root, "build/art-reproduced");
        fs.mkdirSync(out);
        fs.writeFileSync(path.join(out, "sentinel"), "rendered bytes");
        const file = loadPinnedArt(f.config, [...f.records, note]).files.get(f.address)!;
        for (const records of [
            [...f.records, { ...note, name: { full: "Current" } }],
            [...f.records, { ...note, tags: ["gm"] }],
            [{ ...f.records[0], asset: { ...f.records[0].asset, attribution: "Current" } }, note],
            [note],
            [{ ...f.records[0], address: { canonical: "sample-none-image-other" } }, note],
        ]) {
            await expect(reproducePinnedArt(f.config, { records })).rejects.toThrow(
                /new archive.*art\.lock/,
            );
            expect(fs.readdirSync(out)).toEqual(["sentinel"]);
            expect(fs.readFileSync(path.join(out, "sentinel"), "utf8")).toBe("rendered bytes");
            expect(fs.readFileSync(file)).toEqual(rendered);
        }
    },
    subprocessTimeout(40),
);
