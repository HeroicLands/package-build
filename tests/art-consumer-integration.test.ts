/* SPDX-License-Identifier: GPL-3.0-or-later */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { configFromData } from "../engine/pack-config.mjs";
import { createContentSession } from "../engine/content-session.mjs";
import { noteTree } from "../engine/note-cache.mjs";
import { serializeContentIndex } from "../engine/content-index.mjs";
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
            attribution: "Artist",
            license: "CC0-1.0",
            ai: options.ai === undefined ? false : options.ai,
        },
    };
    const index = serializeContentIndex([decodeIndexAddresses(record, { package: "sample" })]);
    fs.writeFileSync(path.join(dir, "index.jsonl"), index);
    const metadata = {
        address,
        creator: "Artist",
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

describe("installed artwork in the content session", () => {
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
        const original = JSON.parse(
            fs.readFileSync(path.join(f.dir, "index.jsonl"), "utf8").trim(),
        );
        original.asset.ai = true;
        original.asset.nonAiAlternative = "sample-none-icon-standin";
        const replacement = {
            package: "sample",
            type: "icon",
            shortcode: "standin",
            address: { canonical: "sample-none-icon-standin" },
            asset: {
                path: "icons/standin.svg",
                attribution: "Artist",
                license: "CC0-1.0",
                ai: false,
            },
        };
        const alternativeBytes = writeDerivativeProvenance(
            svg,
            {
                address: "sample-none-icon-standin",
                creator: "Artist",
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
