/* SPDX-License-Identifier: GPL-3.0-or-later */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import sharp from "sharp";
import YAML from "yaml";
import { afterEach, expect, it, vi } from "vitest";
import { configFromData } from "../engine/pack-config.mjs";
import { createContentSession } from "../engine/content-session.mjs";
import { prepareContentIndex, serializeContentIndex } from "../engine/content-index.mjs";
import { buildCompileCorpus } from "../engine/compile-corpus.mjs";
import { BasePackCompiler } from "../engine/base-compiler.mjs";
import { routerFor } from "../engine/pack-router.mjs";
import { buildPackageSite } from "../engine/site-render.mjs";
import { noteTree } from "../engine/note-cache.mjs";
import { renderArtMasters } from "../engine/art-master-render.mjs";
import { writeProvenance, writeSvgProvenance } from "../engine/art-provenance.mjs";
import { assetReferenceLookup, annotateAssetReferences } from "../engine/asset-references.mjs";
import { encodeAddresses } from "../engine/note-addresses.mjs";
import { stagePackageAssets } from "../engine/asset-shipping.mjs";
import { shippingAssetRecords } from "../engine/art-masters.mjs";
import { stagePackageBuildAssets } from "../engine/build-assets.mjs";
import { note } from "./content-session-fixture.js";

const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function fixture(alpha = false) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "archive-pipeline-"));
    roots.push(root);
    const cacheHome = path.join(root, "user-cache");
    vi.stubEnv("XDG_CACHE_HOME", cacheHome);
    vi.spyOn(os, "tmpdir").mockReturnValue(root);
    fs.mkdirSync(path.join(root, "assets/content"), { recursive: true });
    fs.mkdirSync(path.join(root, "assets/images"), { recursive: true });
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({
            name: "sample",
            version: "1.0.0",
            homepage: "https://example.invalid/sample/",
        }),
    );
    const source = await sharp({
        create: {
            width: 4,
            height: 4,
            channels: 4,
            background: { r: 255, g: 0, b: 0, alpha: alpha ? 0.4 : 1 },
        },
    })
        .png()
        .toBuffer();
    const master = writeProvenance(source, {
        address: "sample-none-image-portrait",
        creator: ["Artist", "Credit"],
        rights: "Terms",
        license: "CC-BY-SA-4.0",
        ai: false,
        prompt: "private sentinel",
    }).bytes;
    function seed(bytes: Buffer) {
        const zip = Buffer.from(zipSync({ "images/portrait.png": bytes }, { level: 0 }));
        const sha256 = digest(zip),
            dir = path.join(cacheHome, "heroiclands/downloads");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, sha256), zip);
        return { url: "https://127.0.0.1:1/original.zip", sha256 };
    }
    const configData: any = {
        contentPackage: "sample",
        currentDate: "721.1",
        packageKind: "modules",
        stats: { lastModifiedBy: "samplebuilder000" },
        compatibility: { minimum: "14", verified: "14" },
        packs: [],
        art: { archives: [seed(master)] },
    };
    const configFile = path.join(root, "package-build.config.yaml");
    const save = () => {
        fs.writeFileSync(configFile, YAML.stringify(configData));
        return configFromData(configData, configFile);
    };
    const subject = path.join(root, "assets/content/subject.md");
    const writeSubject = (title = "Subject") =>
        fs.writeFileSync(
            subject,
            note(
                {
                    type: "being",
                    shortcode: "subject",
                    name: { full: title },
                    data: { icon: "image-portrait" },
                },
                `![Portrait](images/portrait.${alpha ? "webp" : "jpg"})`,
            ),
        );
    writeSubject();
    return {
        root,
        cacheHome,
        configData,
        configFile,
        config: save(),
        save,
        seed,
        master,
        subject,
        writeSubject,
        alpha,
    };
}
function captures(root: string) {
    return fs.readdirSync(root).filter((name) => name.startsWith("art-archive-"));
}

it("keeps archive records in publication and the standalone compiler after disposal", async () => {
    const f = await fixture();
    fs.writeFileSync(
        path.join(f.root, "assets/content/home.md"),
        note({ type: "homepage", shortcode: "home", name: { full: "Home" } }),
    );
    const session = await createContentSession({ config: f.config });
    try {
        const standalone = await prepareContentIndex({ config: f.config });
        const captured = await prepareContentIndex({ config: f.config, session });
        expect(serializeContentIndex(standalone.records)).toBe(
            serializeContentIndex(captured.records),
        );
        expect(standalone.records.find((row: any) => row.asset)?.asset.attribution).toEqual([
            "Artist",
            "Credit",
        ]);
    } finally {
        await session.dispose();
    }
    fs.writeFileSync(
        path.join(f.root, "assets/content/broken.md"),
        "---\nname: [broken\n---\n\nText.\n",
    );
    const corpus = await buildCompileCorpus({
        config: f.config,
        contentBase: f.config.paths.content,
        assetsBase: f.config.paths.assets,
        skipDirectories: f.config.skipDirectories,
        router: routerFor(f.config),
    });
    class Consumer extends BasePackCompiler {
        static convertsWikilinks = false;
    }
    const compiler = new Consumer({
        corpus,
        contentBase: f.config.paths.content,
        assetsBase: f.config.paths.assets,
        skipDirectories: f.config.skipDirectories,
        dest: path.join(f.root, "build/consumer"),
    });
    await compiler.prepare();
    expect(compiler.currentDate).toBe("721.1");
    expect(corpus.problems.some((item: any) => String(item.file).endsWith("broken.md"))).toBe(true);
    expect(compiler.convertBody({}, "A paragraph.")).toBe("A paragraph.");
    expect(captures(f.root)).toEqual([]);
});

it("invalidates note cache on a changed second credit or local note", async () => {
    const f = await fixture();
    await noteTree(f.config, { toolchain: "fixture" });
    expect((await noteTree(f.config, { toolchain: "fixture" })).cache.tree).toBe("hit");
    const changedMaster = writeProvenance(f.master, {
        creator: ["Artist", "Changed credit"],
    }).bytes;
    f.configData.art.archives = [f.seed(changedMaster)];
    const changed = f.save();
    const result = await noteTree(changed, { toolchain: "fixture" });
    expect(result.cache.tree).toBe("miss");
    expect(result.records.find((row: any) => row.asset)?.asset.attribution).toEqual([
        "Artist",
        "Changed credit",
    ]);
    expect((await noteTree(changed, { toolchain: "fixture" })).cache.tree).toBe("hit");
    f.writeSubject("Revised subject");
    const renamed = await noteTree(changed, { toolchain: "fixture" });
    expect(renamed.cache.tree).toBe("miss");
    expect(renamed.records.find((row: any) => row.shortcode === "subject")?.name?.full).toBe(
        "Revised subject",
    );
    expect(captures(f.root)).toEqual([]);
});

function bookConfig(f: Awaited<ReturnType<typeof fixture>>) {
    const extension = f.alpha ? "webp" : "jpg";
    const relative = `images/portrait.${extension}`;
    fs.writeFileSync(
        path.join(f.root, "assets/content/map.md"),
        note(
            {
                type: "map",
                subType: "battlemap",
                shortcode: "samplemap",
                name: { full: "Sample map" },
                data: {
                    fixup: [
                        {
                            path: ".levels[level0000000000].background.src",
                            type: "address",
                            value: "portrait",
                        },
                    ],
                    scene: {
                        name: "Sample map",
                        width: 4,
                        height: 4,
                        levels: [
                            {
                                _id: "level0000000000",
                                name: "Ground",
                                background: { src: `modules/sample/${relative}` },
                            },
                        ],
                    },
                },
            },
            "A map.",
        ),
    );
    fs.writeFileSync(
        path.join(f.root, "book.yaml"),
        `contents:\n  - sectionName: People\n    page:\n      banner: assets/${relative}\n    contents:\n      - filter: "type = 'being'"\n      - filter: "type = 'map'"\n`,
    );
    f.configData.pdf = {
        unprinted: "type = 'homepage'",
        books: [
            {
                id: "core",
                title: "People",
                document: "book.yaml",
                coverImage: `assets/${relative}`,
            },
        ],
    };
    return f.save();
}

it.each([false, true])(
    "uses captured original for screen body, cover, banner and map (transparent: %s)",
    async (alpha) => {
        const f = await fixture(alpha);
        const config = bookConfig(f);
        const session = await createContentSession({ config });
        let screen: Buffer;
        try {
            const outputs = await renderArtMasters(
                session.masters,
                session.records,
                path.join(f.root, "build", "art"),
                path.join(f.root, "build", "cache"),
            );
            screen = fs.readFileSync(outputs.get("sample-none-image-portrait")!);
        } finally {
            await session.dispose();
        }
        const { buildPdf, pdfFileName } = await import("../engine/pdf-build.mjs");
        const originalMkdir = fs.mkdtempSync;
        let mutated = false;
        const hook = vi.spyOn(fs, "mkdtempSync").mockImplementation(((
            prefix: any,
            ...args: any[]
        ) => {
            if (!mutated && String(prefix).includes("content-pdf-")) {
                const cache = path.join(
                    f.cacheHome,
                    "heroiclands/downloads",
                    config.art.archives[0].sha256,
                );
                fs.writeFileSync(cache, "changed after acquisition");
                mutated = true;
            }
            return originalMkdir(prefix, ...(args as []));
        }) as typeof fs.mkdtempSync);
        try {
            const result = await buildPdf({ config, edition: "screen", compile: false });
            expect(result.built, JSON.stringify(result.findings)).toBe(true);
            expect(mutated).toBe(true);
            const stage = pdfFileName(config.pdf.books[0].out, "", "screen").replace(/\.pdf$/, "");
            const ext = alpha ? "webp" : "jpg";
            const body = `${stage}/assets/images/portrait.${ext}`,
                cover = `${stage}/cover/portrait.${ext}`,
                banner = `${stage}/plates/assets/images/portrait.${ext}`;
            for (const relative of [body, cover, banner])
                expect(fs.readFileSync(path.join(f.root, "build/dist", relative))).toEqual(screen!);
            const typst = result.books
                .filter((book: any) => book.typ)
                .map((book: any) => fs.readFileSync(book.typ, "utf8"))
                .join("\n");
            for (const relative of [body, cover, banner]) expect(typst).toContain(relative);
            expect(typst).toContain(`#book-place-map([Sample map: Ground], "${body}")`);
            expect(captures(f.root)).toEqual([]);
        } finally {
            hook.mockRestore();
        }
    },
);

it.each(["corrupt", "invalid master", "second archive"])(
    "preserves content-build output and marker on %s",
    async (kind) => {
        const f = await fixture();
        if (kind === "corrupt") {
            fs.writeFileSync(
                path.join(
                    f.cacheHome,
                    "heroiclands/downloads",
                    f.configData.art.archives[0].sha256,
                ),
                "invalid cache",
            );
        } else if (kind === "second archive") {
            f.configData.art.archives.push({
                url: "https://127.0.0.1:1/missing.zip",
                sha256: "f".repeat(64),
            });
            f.save();
        } else {
            const invalid = writeProvenance(f.master, {
                address: "foreign-none-image-portrait",
            }).bytes;
            f.configData.art.archives = [f.seed(invalid)];
            f.save();
        }
        const index = f.config.paths.contentIndex;
        fs.mkdirSync(index, { recursive: true });
        const marker = path.join(index, ".publication-ready"),
            old = path.join(index, "sentinel");
        fs.writeFileSync(marker, "ready");
        fs.writeFileSync(old, "old output");
        const result = spawnSync(
            process.execPath,
            [
                path.resolve("bin/package-build.mjs"),
                "content",
                "build",
                "--calendaria-version",
                "1.4.2",
            ],
            {
                cwd: f.root,
                encoding: "utf8",
                env: {
                    ...process.env,
                    TMPDIR: f.root,
                    XDG_CACHE_HOME: f.cacheHome,
                    PACKAGE_BUILD_CONFIG: f.configFile,
                },
            },
        );
        expect(result.status, result.stderr + result.stdout).not.toBe(0);
        expect(fs.readFileSync(marker, "utf8")).toBe("ready");
        expect(fs.readFileSync(old, "utf8")).toBe("old output");
        expect(captures(f.root)).toEqual([]);
    },
);

it("builds a site with archive artwork and closes its source session", async () => {
    const f = await fixture();
    const { siteBuildConfig } = await import("../content-config.mjs");
    const standin = writeSvgProvenance('<svg xmlns="http://www.w3.org/2000/svg"/>', {
        address: "sample-none-icon-standin",
        creator: ["Artist"],
        rights: "Terms",
        license: "CC-BY-SA-4.0",
        ai: false,
    }).bytes;
    const ai = writeProvenance(f.master, {
        ai: true,
        nonAiAlternative: "sample-none-icon-standin",
    }).bytes;
    const unknown = writeSvgProvenance('<svg xmlns="http://www.w3.org/2000/svg"/>', {
        address: "sample-none-icon-unknown",
        creator: ["Artist"],
        rights: "Terms",
        license: "CC-BY-SA-4.0",
    }).bytes;
    const zip = Buffer.from(
        zipSync(
            {
                "images/portrait.png": ai,
                "icons/standin.svg": standin,
                "icons/unknown.svg": unknown,
            },
            { level: 0 },
        ),
    );
    const sha256 = digest(zip);
    fs.writeFileSync(path.join(f.cacheHome, "heroiclands/downloads", sha256), zip);
    f.configData.art.archives = [{ url: "https://127.0.0.1:1/site.zip", sha256 }];
    f.configData.site = {
        title: "Sample",
        description: "Sample site",
        assets: "https://cdn.example.test",
        inputs: "utils/site-inputs.mjs",
    };
    fs.mkdirSync(path.join(f.root, "utils"));
    fs.writeFileSync(
        path.join(f.root, "utils/site-inputs.mjs"),
        "export default () => ({navigation: [], files: {}});\n",
    );
    fs.writeFileSync(
        path.join(f.root, "assets/content/home.md"),
        note(
            { type: "homepage", shortcode: "root", name: { full: "Home" } },
            "[Subject](being-subject/).",
        ),
    );
    fs.writeFileSync(
        f.subject,
        note(
            {
                type: "being",
                shortcode: "subject",
                name: { full: "Subject" },
                data: { icon: "image-portrait" },
            },
            "![Portrait](sample/assets/images/portrait.jpg)",
        ),
    );
    const config = siteBuildConfig(f.save());
    const result = await buildPackageSite({ config, out: path.join(f.root, "site-out") });
    expect(result.written).not.toBeNull();
    const html = result
        .written!.files.filter((file: string) => file.endsWith(".html"))
        .map((file: string) => fs.readFileSync(file, "utf8"))
        .join("\n");
    expect(html).toContain("sample/images/portrait.jpg");
    expect(result.built.site.records.find((row: any) => row.asset)?.asset.attribution).toEqual([
        "Artist",
        "Credit",
    ]);
    const records = result.built.site.records;
    const lookup = assetReferenceLookup(
        {
            assets: new Map(
                records
                    .filter((row: any) => row.asset)
                    .map((row: any) => [encodeAddresses(row.address.canonical), row]),
            ),
        },
        config,
    );
    const document: any = { img: "modules/sample/images/portrait.jpg" },
        findings: string[] = [];
    annotateAssetReferences(document, "Item", {
        lookup,
        system: "sohl",
        report: (message: string) => findings.push(message),
    });
    expect(findings).toEqual([]);
    expect(document.img).toBe("modules/sample/icons/standin.svg");
    const session = await createContentSession({ config });
    try {
        const rendered = await renderArtMasters(
            session.masters,
            session.records,
            path.join(f.root, "build/art"),
            path.join(f.root, "build/cache"),
        );
        const stage = path.join(f.root, "build/stage");
        const staged = stagePackageAssets({
            assetsBase: config.paths.assets,
            contentPackage: "sample",
            stageDir: stage,
            title: "Sample",
            records: shippingAssetRecords(session.records),
            preparedMasters: rendered,
        });
        expect(staged.staged.map((row: any) => row.shortcode)).toEqual(["standin"]);
        expect(staged.excluded.map((item: any) => item.record.shortcode).sort()).toEqual([
            "portrait",
            "unknown",
        ]);
        expect(fs.readFileSync(path.join(stage, "icons/standin.svg"))).toEqual(
            fs.readFileSync(rendered.get("sample-none-icon-standin")!),
        );
        await stagePackageBuildAssets({
            config: {
                rootDir: f.root,
                assets: [],
                stageDir: "build/full-stage",
                baseStyles: false,
            } as any,
            packConfig: config,
            session,
        });
        expect(fs.readFileSync(path.join(f.root, "build/full-stage/icons/standin.svg"))).toEqual(
            fs.readFileSync(rendered.get("sample-none-icon-standin")!),
        );
        expect(fs.existsSync(path.join(f.root, "build/full-stage/images/portrait.jpg"))).toBe(
            false,
        );
    } finally {
        await session.dispose();
    }
    expect(captures(f.root)).toEqual([]);
});

it.each(["setup", "staging"])("cleans archive after book %s failure", async (kind) => {
    const f = await fixture();
    const config = bookConfig(f);
    const { buildPdf } = await import("../engine/pdf-build.mjs");
    const dist = path.join(f.root, "build/dist");
    fs.mkdirSync(dist, { recursive: true });
    const sentinel = path.join(dist, "sentinel");
    fs.writeFileSync(sentinel, "previous book");
    const mkdir = fs.mkdtempSync,
        write = fs.writeFileSync;
    let failed = false;
    const mkdirHook = vi.spyOn(fs, "mkdtempSync").mockImplementation(((
        prefix: any,
        ...args: any[]
    ) => {
        if (kind === "setup" && String(prefix).includes("content-pdf-")) {
            failed = true;
            throw new Error("book setup failure");
        }
        return mkdir(prefix, ...(args as []));
    }) as typeof fs.mkdtempSync);
    const writeHook = vi.spyOn(fs, "writeFileSync").mockImplementation(((
        file: any,
        data: any,
        options: any,
    ) => {
        if (
            kind === "staging" &&
            String(file).includes(`${path.sep}build${path.sep}dist${path.sep}`) &&
            String(file).endsWith("portrait.jpg")
        ) {
            failed = true;
            throw new Error("book staging failure");
        }
        return write(file, data, options);
    }) as typeof fs.writeFileSync);
    try {
        await expect(buildPdf({ config, edition: "screen", compile: false })).rejects.toThrow(
            `book ${kind} failure`,
        );
        expect(failed).toBe(true);
        expect(captures(f.root)).toEqual([]);
        if (kind === "setup") expect(fs.readFileSync(sentinel, "utf8")).toBe("previous book");
    } finally {
        mkdirHook.mockRestore();
        writeHook.mockRestore();
    }
});

it("uses the archived master for a print rendition", async () => {
    const f = await fixture();
    const config = bookConfig(f);
    const session = await createContentSession({ config });
    let screen: Buffer;
    try {
        const rendered = await renderArtMasters(
            session.masters,
            session.records,
            path.join(f.root, "build/art"),
            path.join(f.root, "build/cache"),
        );
        screen = fs.readFileSync(rendered.get("sample-none-image-portrait")!);
    } finally {
        await session.dispose();
    }
    const { buildPdf, pdfFileName } = await import("../engine/pdf-build.mjs");
    const result = await buildPdf({ config, edition: "print", compile: false });
    expect(result.built, JSON.stringify(result.findings)).toBe(true);
    const stage = pdfFileName(config.pdf.books[0].out, "", "print").replace(/\.pdf$/, "");
    const output = fs.readFileSync(
        path.join(f.root, "build/dist", stage, "assets/images/portrait.jpg"),
    );
    expect(output).not.toEqual(screen!);
    expect(output.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(captures(f.root)).toEqual([]);
});
