/* SPDX-License-Identifier: GPL-3.0-or-later */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configFromData } from "../engine/pack-config.mjs";
import { siteBuildConfig } from "../content-config.mjs";
import { createContentSession } from "../engine/content-session.mjs";
import { buildCompileCorpus } from "../engine/compile-corpus.mjs";
import { BasePackCompiler } from "../engine/base-compiler.mjs";
import { routerFor } from "../engine/pack-router.mjs";
import { noteTree } from "../engine/note-cache.mjs";
import {
    serializeContentIndex,
    prepareContentIndex,
    emitContentIndex,
} from "../engine/content-index.mjs";
import { buildSite } from "../engine/site-build.mjs";
import { buildPackageSite } from "../engine/site-render.mjs";
import { assetReferenceLookup, annotateAssetReferences } from "../engine/asset-references.mjs";
import { encodeAddresses } from "../engine/note-addresses.mjs";
import { decodeIndexAddresses } from "../engine/note-addresses.mjs";
import { writeDerivativeProvenance } from "../engine/art-provenance.mjs";
import { stagePackageAssets } from "../engine/asset-shipping.mjs";
import { shippingAssetRecords } from "../engine/art-masters.mjs";
import { note } from "./content-session-fixture.js";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>';
function fixture(options: { name?: string; primaryNote?: string; ai?: boolean | null } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "art-consumer-"));
    roots.push(root);
    const npmName = "@example/art-sample",
        version = "1.0.0",
        dir = path.join(root, "node_modules", npmName);
    fs.mkdirSync(path.join(dir, "images"), { recursive: true });
    const deps = { [npmName]: version };
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sample", version, devDependencies: deps }),
    );
    fs.writeFileSync(
        path.join(root, "package-lock.json"),
        JSON.stringify({
            lockfileVersion: 3,
            packages: {
                "": { devDependencies: deps },
                [`node_modules/${npmName}`]: {
                    version,
                    integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
                },
            },
        }),
    );
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: npmName, version }));
    const address = "sample-none-image-portrait";
    const record = {
        package: "sample",
        type: "image",
        shortcode: "portrait",
        address: { canonical: address },
        asset: {
            path: "images/portrait.svg",
            attribution: ["Artist"],
            license: "CC0-1.0",
            ai: options.ai === undefined ? false : options.ai,
        },
    };
    const index = serializeContentIndex([decodeIndexAddresses(record, { package: "sample" })]);
    fs.writeFileSync(path.join(dir, "index.jsonl"), index);
    const metadata = {
        address,
        creator: ["Artist"],
        rights: "Terms",
        derivedFrom: address,
        ...(options.name ? { name: options.name } : {}),
        ...(options.primaryNote ? { primaryNote: options.primaryNote } : {}),
    };
    const repeat = [
        "derivedFrom",
        ...(options.name ? ["name"] : []),
        ...(options.primaryNote ? ["primaryNote"] : []),
    ];
    const bytes = writeDerivativeProvenance(svg, metadata, { repeat, notePublic: true }).bytes;
    const image = path.join(dir, "images/portrait.svg");
    fs.writeFileSync(image, bytes);
    fs.writeFileSync(
        path.join(dir, "artwork.json"),
        JSON.stringify({
            formatVersion: 1,
            contentPackage: "sample",
            index: { path: "index.jsonl", sha256: sha(index) },
            assets: [{ path: "images/portrait.svg", sha256: sha(bytes) }],
        }),
    );
    fs.mkdirSync(path.join(root, "assets/content"), { recursive: true });
    fs.mkdirSync(path.join(root, "assets/images"), { recursive: true });
    fs.writeFileSync(path.join(root, "assets/images/legacy.webp"), "legacy");
    const subject = path.join(root, "assets/content/subject.md");
    fs.writeFileSync(
        subject,
        note({
            type: "being",
            shortcode: "subject",
            name: { full: "Subject" },
            data: { icon: "image-portrait" },
        }),
    );
    const configData = {
        contentPackage: "sample",
        currentDate: "721.1",
        packageKind: "modules",
        stats: { lastModifiedBy: "samplebuilder000" },
        compatibility: { minimum: "14", verified: "14" },
        packs: [],
        art: { packages: [npmName] },
    };
    const configFile = path.join(root, "package-build.config.yaml");
    fs.writeFileSync(configFile, YAML.stringify(configData));
    const config = configFromData(configData, configFile);
    return { root, config, dir, image, subject, address };
}

function addSplit(f: ReturnType<typeof fixture>, assetPath: string, shortcode: string) {
    const name = "@example/art-second",
        version = "1.0.0",
        dir = path.join(f.root, "node_modules", name);
    fs.mkdirSync(path.dirname(path.join(dir, assetPath)), { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version }));
    const address = `sample-none-image-${shortcode}`;
    const record = {
        package: "sample",
        type: "image",
        shortcode,
        address: { canonical: address },
        asset: { path: assetPath, attribution: ["Artist"], license: "CC0-1.0", ai: false },
    };
    const bytes = writeDerivativeProvenance(
        svg,
        { address, creator: ["Artist"], rights: "Terms", derivedFrom: address },
        { repeat: ["derivedFrom"] },
    ).bytes;
    fs.writeFileSync(path.join(dir, assetPath), bytes);
    const index = serializeContentIndex([decodeIndexAddresses(record, { package: "sample" })]);
    fs.writeFileSync(path.join(dir, "index.jsonl"), index);
    fs.writeFileSync(
        path.join(dir, "artwork.json"),
        JSON.stringify({
            formatVersion: 1,
            contentPackage: "sample",
            index: { path: "index.jsonl", sha256: sha(index) },
            assets: [{ path: assetPath, sha256: sha(bytes) }],
        }),
    );
    const packageFile = path.join(f.root, "package.json"),
        lockFile = path.join(f.root, "package-lock.json");
    const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8")),
        lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
    pkg.devDependencies[name] = version;
    lock.packages[""].devDependencies[name] = version;
    lock.packages[`node_modules/${name}`] = {
        version,
        integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
    };
    fs.writeFileSync(packageFile, JSON.stringify(pkg));
    fs.writeFileSync(lockFile, JSON.stringify(lock));
    const configPath = path.join(f.root, "package-build.config.yaml"),
        data = YAML.parse(fs.readFileSync(configPath, "utf8"));
    data.art.packages.push(name);
    fs.writeFileSync(configPath, YAML.stringify(data));
    return { config: configFromData(data, configPath), bytes };
}

function addAlternative(f: ReturnType<typeof fixture>) {
    const original = JSON.parse(fs.readFileSync(path.join(f.dir, "index.jsonl"), "utf8").trim());
    original.asset.ai = true;
    original.asset.nonAiAlternative = "sample-none-icon-standin";
    const replacement = {
        package: "sample",
        type: "icon",
        shortcode: "standin",
        address: { canonical: "sample-none-icon-standin" },
        asset: {
            path: "icons/standin.svg",
            attribution: ["Artist"],
            license: "CC0-1.0",
            ai: false,
        },
    };
    const alternativeBytes = writeDerivativeProvenance(
        svg,
        {
            address: "sample-none-icon-standin",
            creator: ["Artist"],
            rights: "Terms",
            derivedFrom: "sample-none-icon-standin",
            ai: false,
        },
        { repeat: ["derivedFrom"] },
    ).bytes;
    fs.mkdirSync(path.join(f.dir, "icons"));
    fs.writeFileSync(path.join(f.dir, "icons/standin.svg"), alternativeBytes);
    const index = serializeContentIndex([
        decodeIndexAddresses(original, { package: "sample" }),
        decodeIndexAddresses(replacement, { package: "sample" }),
    ]);
    fs.writeFileSync(path.join(f.dir, "index.jsonl"), index);
    const descriptorPath = path.join(f.dir, "artwork.json"),
        descriptor = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
    descriptor.index.sha256 = sha(index);
    descriptor.assets.push({ path: "icons/standin.svg", sha256: sha(alternativeBytes) });
    fs.writeFileSync(descriptorPath, JSON.stringify(descriptor));
    return alternativeBytes;
}

describe("installed artwork in the content session", () => {
    it("keeps standalone compiler body scanning and the configured date after capture closes", async () => {
        const f = fixture();
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
        expect(
            corpus.problems.some((problem: any) => String(problem.file).endsWith("broken.md")),
        ).toBe(true);
        expect(compiler.convertBody({}, "A paragraph.")).toBe("A paragraph.");
    });
    it("publishes normal index records and supplies them to the website entry", async () => {
        const f = fixture();
        fs.writeFileSync(
            path.join(f.root, "assets/content/home.md"),
            note({ type: "homepage", shortcode: "home", name: { full: "Home" } }),
        );
        const session = await createContentSession({ config: f.config });
        try {
            const publication = await prepareContentIndex({ config: f.config, session });
            const standalone = await prepareContentIndex({ config: f.config });
            expect(
                standalone.records.filter((row: any) => row.asset).map((row: any) => row.shortcode),
            ).toEqual(["portrait"]);
            const outDir = path.join(f.root, "index-output");
            const emitted = emitContentIndex({ config: f.config, publication, outDir });
            const text = fs.readFileSync(emitted.file, "utf8");
            expect(text).toContain("sample-none-image-portrait");
            expect(text).not.toContain("legacy.webp");
            const built = buildSite({ config: f.config, records: session.records });
            expect(
                built.site?.records
                    .filter((row: any) => row.asset)
                    .map((row: any) => row.shortcode),
            ).toContain("portrait");
        } finally {
            session.dispose();
        }
    });
    it("loads distinct installed splits and rejects a flattened deployment collision", async () => {
        const f = fixture();
        const good = addSplit(f, "images/second.svg", "second");
        const session = await createContentSession({ config: good.config });
        try {
            expect(session.artSources.size).toBe(2);
        } finally {
            session.dispose();
        }
        const other = fixture();
        const collision = addSplit(other, "images/sub/portrait.svg", "other");
        await expect(createContentSession({ config: collision.config })).rejects.toThrow(
            /duplicate artwork deployment path/i,
        );
    });
    it("renders the original on the website and the declared alternative in Foundry", async () => {
        const f = fixture();
        addAlternative(f);
        const pkgPath = path.join(f.root, "package.json"),
            pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        pkg.homepage = "https://www.example.test/sample/";
        fs.writeFileSync(pkgPath, JSON.stringify(pkg));
        const configPath = path.join(f.root, "package-build.config.yaml"),
            data = YAML.parse(fs.readFileSync(configPath, "utf8"));
        data.site = {
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
        fs.writeFileSync(configPath, YAML.stringify(data));
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
                "![Portrait](sample/assets/images/portrait.svg)",
            ),
        );
        const config = siteBuildConfig(configFromData(data, configPath));
        const originalMkdir = fs.mkdtempSync,
            captures: string[] = [];
        const spy = vi.spyOn(fs, "mkdtempSync").mockImplementation(((
            prefix: any,
            ...args: any[]
        ) => {
            const result = originalMkdir(prefix, ...(args as []));
            if (String(prefix).includes("content-art-snapshot-")) captures.push(String(result));
            return result;
        }) as typeof fs.mkdtempSync);
        try {
            const result = await buildPackageSite({ config, out: path.join(f.root, "site-out") });
            expect(result.written).not.toBeNull();
            expect(captures.length).toBeGreaterThan(0);
            for (const capture of captures) expect(fs.existsSync(capture)).toBe(false);
            const html = result
                .written!.files.filter((file: string) => file.endsWith(".html"))
                .map((file: string) => fs.readFileSync(file, "utf8"))
                .join("\n");
            expect(html).toContain("sample/images/portrait.svg");
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
            const doc: any = { img: "modules/sample/images/portrait.svg" },
                findings: string[] = [];
            annotateAssetReferences(doc, "Item", {
                lookup,
                system: "sohl",
                report: (message: string) => findings.push(message),
            });
            expect(findings).toEqual([]);
            expect(doc.img).toBe("modules/sample/icons/standin.svg");
        } finally {
            spy.mockRestore();
        }
    });
    it("keeps unknown AI visible to the index but excludes it from Foundry", async () => {
        const f = fixture({ ai: null });
        fs.writeFileSync(
            path.join(f.root, "assets/content/home.md"),
            note({ type: "homepage", shortcode: "home", name: { full: "Home" } }),
        );
        const session = await createContentSession({ config: f.config });
        try {
            expect(session.records.find((row) => row.asset)?.asset.ai).toBeNull();
            const stage = stagePackageAssets({
                assetsBase: f.config.paths.assets,
                contentPackage: "sample",
                stageDir: path.join(f.root, "stage"),
                title: "Sample",
                records: shippingAssetRecords(session.records),
                artSources: session.artSources,
            });
            expect(stage.excluded.map((entry) => entry.record.shortcode)).toContain("portrait");
            expect(fs.existsSync(path.join(f.root, "stage/images/portrait.svg"))).toBe(false);
            expect(
                buildSite({ config: f.config, records: session.records }).site?.records.find(
                    (row: any) => row.asset,
                )?.asset.ai,
            ).toBeNull();
        } finally {
            session.dispose();
        }
    });
    it("derives its own asset records and stages validated bytes without legacy fallback", async () => {
        const f = fixture();
        const session = await createContentSession({ config: f.config });
        try {
            const artwork = session.records.filter((row) => row.asset && row.type === "image");
            expect(artwork).toHaveLength(1);
            expect(artwork[0].shortcode).toBe("portrait");
            expect(session.problems).toEqual([]);
            const result = stagePackageAssets({
                assetsBase: f.config.paths.assets,
                contentPackage: "sample",
                stageDir: path.join(f.root, "stage"),
                title: "Sample",
                records: shippingAssetRecords(session.records),
                artSources: session.artSources,
            });
            expect(result.findings).toEqual([]);
            expect(fs.readFileSync(path.join(f.root, "stage/images/portrait.svg"))).toEqual(
                fs.readFileSync(f.image),
            );
        } finally {
            session.dispose();
        }
    });
    it("uses a private snapshot and physically removes it on disposal", async () => {
        const f = fixture();
        const original = fs.mkdtempSync;
        const created: string[] = [];
        const spy = vi.spyOn(fs, "mkdtempSync").mockImplementation(((
            prefix: any,
            ...args: any[]
        ) => {
            const result = original(prefix, ...(args as []));
            if (String(prefix).includes("content-art-snapshot-")) created.push(String(result));
            return result;
        }) as typeof fs.mkdtempSync);
        try {
            const session = await createContentSession({ config: f.config });
            expect(created).toHaveLength(1);
            const directory = created[0];
            expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
            const entries = fs.readdirSync(directory);
            expect(entries).toHaveLength(1);
            expect(fs.statSync(path.join(directory, entries[0])).mode & 0o777).toBe(0o600);
            session.dispose();
            expect(fs.existsSync(directory)).toBe(false);
        } finally {
            spy.mockRestore();
        }
    });
    it("removes a partially captured snapshot when a later capture fails", async () => {
        const f = fixture();
        const split = addSplit(f, "images/second.svg", "second");
        const originalMkdir = fs.mkdtempSync,
            originalWrite = fs.writeFileSync;
        const created: string[] = [];
        const mkdir = vi.spyOn(fs, "mkdtempSync").mockImplementation(((
            prefix: any,
            ...args: any[]
        ) => {
            const result = originalMkdir(prefix, ...(args as []));
            if (String(prefix).includes("content-art-snapshot-")) created.push(String(result));
            return result;
        }) as typeof fs.mkdtempSync);
        const write = vi.spyOn(fs, "writeFileSync").mockImplementation(((
            file: any,
            data: any,
            options: any,
        ) => {
            if (created.length && String(file) === path.join(created[0], "1"))
                throw new Error("capture failed");
            return originalWrite(file, data, options);
        }) as typeof fs.writeFileSync);
        try {
            await expect(createContentSession({ config: split.config })).rejects.toThrow(
                /capture failed/,
            );
            expect(created).toHaveLength(1);
            expect(fs.existsSync(created[0])).toBe(false);
        } finally {
            write.mockRestore();
            mkdir.mockRestore();
        }
    });
    it("does not retain usable captured artwork after the session closes", async () => {
        const f = fixture();
        const session = await createContentSession({ config: f.config });
        const source = session.artSources.get(f.address);
        expect(source).toBeDefined();
        session.dispose();
        expect(() => source!()).toThrow();
    });
    it("stages the captured verified bytes when the installed file changes afterward", async () => {
        const f = fixture();
        const session = await createContentSession({ config: f.config });
        try {
            const captured = fs.readFileSync(f.image);
            fs.appendFileSync(f.image, "changed");
            const result = stagePackageAssets({
                assetsBase: f.config.paths.assets,
                contentPackage: "sample",
                stageDir: path.join(f.root, "stage"),
                title: "Sample",
                records: shippingAssetRecords(session.records),
                artSources: session.artSources,
            });
            expect(result.findings).toEqual([]);
            expect(fs.readFileSync(path.join(f.root, "stage/images/portrait.svg"))).toEqual(
                captured,
            );
        } finally {
            session.dispose();
        }
    });
    it.each(["digest", "descriptor", "stale-name"])(
        "preserves output and readiness marker for %s input",
        (kind) => {
            const f =
                kind === "stale-name" ?
                    fixture({ name: "Old name", primaryNote: "sample-note-being-subject" })
                :   fixture();
            fs.mkdirSync(f.config.paths.contentIndex, { recursive: true });
            const marker = path.join(f.config.paths.contentIndex, ".publication-ready");
            const old = path.join(f.config.paths.contentIndex, "sentinel");
            fs.writeFileSync(marker, "ready");
            fs.writeFileSync(old, "old output");
            if (kind === "digest") fs.appendFileSync(f.image, "changed");
            if (kind === "descriptor") fs.writeFileSync(path.join(f.dir, "artwork.json"), "{bad");
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
                        PACKAGE_BUILD_CONFIG: path.join(f.root, "package-build.config.yaml"),
                    },
                },
            );
            expect(result.status, result.stderr + result.stdout).toBe(1);
            expect(result.stderr + result.stdout).toMatch(
                kind === "digest" ? /SHA-256|digest/i
                : kind === "descriptor" ? /JSON|Unexpected|position/i
                : /note|metadata/i,
            );
            expect(fs.readFileSync(marker, "utf8")).toBe("ready");
            expect(fs.readFileSync(old, "utf8")).toBe("old output");
        },
    );
    it("retains an eligible non-AI alternative and excludes the AI asset from Foundry", async () => {
        const f = fixture();
        const alternativeBytes = addAlternative(f);
        const session = await createContentSession({ config: f.config });
        try {
            const result = stagePackageAssets({
                assetsBase: f.config.paths.assets,
                contentPackage: "sample",
                stageDir: path.join(f.root, "stage"),
                title: "Sample",
                records: shippingAssetRecords(session.records),
                artSources: session.artSources,
            });
            expect(result.findings).toEqual([]);
            expect(fs.existsSync(path.join(f.root, "stage/images/portrait.svg"))).toBe(false);
            expect(fs.readFileSync(path.join(f.root, "stage/icons/standin.svg"))).toEqual(
                alternativeBytes,
            );
        } finally {
            session.dispose();
        }
    });
    it("rejects a missing local install rather than looking in a parent node_modules", async () => {
        const f = fixture();
        const sibling = path.join(f.root, "other-consumer");
        fs.mkdirSync(sibling);
        fs.copyFileSync(path.join(f.root, "package.json"), path.join(sibling, "package.json"));
        fs.copyFileSync(
            path.join(f.root, "package-lock.json"),
            path.join(sibling, "package-lock.json"),
        );
        fs.cpSync(path.join(f.root, "assets"), path.join(sibling, "assets"), { recursive: true });
        const data = YAML.parse(
            fs.readFileSync(path.join(f.root, "package-build.config.yaml"), "utf8"),
        );
        const config = configFromData(data, path.join(sibling, "package-build.config.yaml"));
        await expect(createContentSession({ config })).rejects.toThrow(/missing/);
    });
    it("rejects a second installed split claiming the same image address", async () => {
        const f = fixture();
        const second = "@example/art-second";
        const dest = path.join(f.root, "node_modules", second);
        fs.cpSync(f.dir, dest, { recursive: true });
        fs.writeFileSync(
            path.join(dest, "package.json"),
            JSON.stringify({ name: second, version: "1.0.0" }),
        );
        const pkgPath = path.join(f.root, "package.json"),
            lockPath = path.join(f.root, "package-lock.json");
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")),
            lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        pkg.devDependencies[second] = "1.0.0";
        lock.packages[""].devDependencies[second] = "1.0.0";
        lock.packages[`node_modules/${second}`] = {
            version: "1.0.0",
            integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
        };
        fs.writeFileSync(pkgPath, JSON.stringify(pkg));
        fs.writeFileSync(lockPath, JSON.stringify(lock));
        const data = YAML.parse(
            fs.readFileSync(path.join(f.root, "package-build.config.yaml"), "utf8"),
        );
        data.art.packages.push(second);
        const config = configFromData(data, path.join(f.root, "package-build.config.yaml"));
        await expect(createContentSession({ config })).rejects.toThrow(/duplicate/);
    });
    it("reuses a cache only after validating the same installed artwork", async () => {
        const f = fixture();
        const first = await noteTree(f.config, { toolchain: "fixture" });
        const second = await noteTree(f.config, { toolchain: "fixture" });
        expect(first.cache.tree).not.toBe("hit");
        expect(second.cache.tree).toBe("hit");
        fs.appendFileSync(f.image, "changed");
        await expect(noteTree(f.config, { toolchain: "fixture" })).rejects.toThrow();
    });
    it.each(["renamed", "gm"])(
        "revalidates the authoritative claimed note when it becomes %s",
        async (change) => {
            const f = fixture({ name: "Subject", primaryNote: "sample-note-being-subject" });
            await noteTree(f.config, { toolchain: "authority-fixture" });
            expect((await noteTree(f.config, { toolchain: "authority-fixture" })).cache.tree).toBe(
                "hit",
            );
            fs.writeFileSync(
                f.subject,
                note({
                    type: "being",
                    shortcode: "subject",
                    name: { full: change === "renamed" ? "Changed" : "Subject" },
                    ...(change === "gm" ? { tags: ["gm"] } : {}),
                    data: { icon: "image-portrait" },
                }),
            );
            await expect(noteTree(f.config, { toolchain: "authority-fixture" })).rejects.toThrow(
                /note|metadata/i,
            );
        },
    );
    it("invalidates the note cache for metadata-only and local-note edits", async () => {
        const f = fixture();
        await noteTree(f.config, { toolchain: "fixture" });
        expect((await noteTree(f.config, { toolchain: "fixture" })).cache.tree).toBe("hit");
        const indexPath = path.join(f.dir, "index.jsonl"),
            descriptorPath = path.join(f.dir, "artwork.json");
        const row = JSON.parse(fs.readFileSync(indexPath, "utf8").trim());
        row.asset.license = "CC-BY-4.0";
        const index = serializeContentIndex([decodeIndexAddresses(row, { package: "sample" })]);
        const descriptor = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
        descriptor.index.sha256 = sha(index);
        fs.writeFileSync(indexPath, index);
        fs.writeFileSync(descriptorPath, JSON.stringify(descriptor));
        const changed = await noteTree(f.config, { toolchain: "fixture" });
        expect(changed.cache.tree).toBe("miss");
        expect(changed.records.find((row: any) => row.asset)?.asset.license).toBe("CC-BY-4.0");
        expect((await noteTree(f.config, { toolchain: "fixture" })).cache.tree).toBe("hit");
        fs.writeFileSync(
            f.subject,
            note({
                type: "being",
                shortcode: "subject",
                name: { full: "Revised subject" },
                data: { icon: "image-portrait" },
            }),
        );
        const renamed = await noteTree(f.config, { toolchain: "fixture" });
        expect(renamed.cache.tree).toBe("miss");
        expect(renamed.records.find((row: any) => row.shortcode === "subject")?.name?.full).toBe(
            "Revised subject",
        );
    });
    it("rejects installed-image corruption before a session is returned", async () => {
        const f = fixture();
        fs.appendFileSync(f.image, "changed");
        await expect(createContentSession({ config: f.config })).rejects.toThrow();
    });
    it("accepts a current public note named in derivative metadata", async () => {
        const f = fixture({ name: "Subject", primaryNote: "sample-note-being-subject" });
        const session = await createContentSession({ config: f.config });
        session.dispose();
    });
    it.each(["removed", "renamed", "gm", "readdressed"])(
        "rejects %s authoritative notes",
        async (change) => {
            const f = fixture({ name: "Subject", primaryNote: "sample-note-being-subject" });
            if (change === "removed") fs.unlinkSync(f.subject);
            else
                fs.writeFileSync(
                    f.subject,
                    note({
                        type: "being",
                        shortcode: change === "readdressed" ? "other" : "subject",
                        name: { full: change === "renamed" ? "Other" : "Subject" },
                        ...(change === "gm" ? { tags: ["gm"] } : {}),
                        data: { icon: "image-portrait" },
                    }),
                );
            await expect(createContentSession({ config: f.config })).rejects.toThrow();
        },
    );
    it("refuses artwork naming a stale local note", async () => {
        const f = fixture({ name: "Old name", primaryNote: "sample-note-being-subject" });
        await expect(createContentSession({ config: f.config })).rejects.toThrow();
    });
});

it("stages the same verified installed screen asset in a book and refuses npm print", async () => {
    const f = fixture();
    const { buildPdf } = await import("../engine/pdf-build.mjs");
    const manifestPath = path.join(f.root, "package.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.homepage = "https://example.invalid/sample/";
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    fs.writeFileSync(
        f.subject,
        note(
            {
                type: "being",
                shortcode: "subject",
                name: { full: "Subject" },
                data: { icon: "image-portrait" },
            },
            "![Portrait](images/portrait.svg)",
        ),
    );
    fs.writeFileSync(
        path.join(f.root, "book.yaml"),
        "contents:\n  - sectionName: People\n    contents:\n      - filter: \"type = 'being'\"\n",
    );
    const configPath = path.join(f.root, "package-build.config.yaml");
    const data = YAML.parse(fs.readFileSync(configPath, "utf8"));
    data.pdf = {
        unprinted: "type = 'homepage'",
        books: [{ id: "core", title: "People", document: "book.yaml" }],
    };
    fs.writeFileSync(configPath, YAML.stringify(data));
    const config = configFromData(data, configPath);
    const result = await buildPdf({ config, edition: "screen", compile: false });
    expect(result.built, JSON.stringify(result.findings)).toBe(true);
    const outDir = path.join(f.root, "build", "dist");
    const files: string[] = [];
    function visit(dir: string) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) visit(file);
            else if (entry.name === "portrait.svg") files.push(file);
        }
    }
    visit(outDir);
    expect(files).toHaveLength(1);
    expect(fs.readFileSync(files[0])).toEqual(fs.readFileSync(f.image));
    await expect(buildPdf({ config, edition: "print", compile: false })).rejects.toThrow(
        /print.*artwork/i,
    );
});
