/* SPDX-License-Identifier: GPL-3.0-or-later */
import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { zipSync } from "fflate";
import { configFromData } from "../engine/pack-config.mjs";
import { resolvePackageBuildConfig } from "../config.mjs";
import {
    indexRecordsFor,
    prepareContentIndex,
    emitContentIndex,
} from "../engine/content-index.mjs";
import { loadPinnedArt, fetchPublicArt, reproducePinnedArt } from "../engine/art-lock.mjs";
import { writeDerivativeProvenance } from "../engine/art-provenance.mjs";
import { createContentSession } from "../engine/content-session.mjs";
import { renderAddress } from "../engine/address.mjs";
import { noteTree } from "../engine/note-cache.mjs";
import { stagePackageBuildAssets } from "../engine/build-assets.mjs";
import { buildCompileCorpus } from "../engine/compile-corpus.mjs";
import { buildSite } from "../engine/site-build.mjs";
import { buildPackageSite } from "../engine/site-render.mjs";
import { buildPdf } from "../engine/pdf-build.mjs";
import * as stage from "../stage.mjs";
import * as renderer from "../engine/art-master-render.mjs";
import { note, write, outputBytes } from "./content-session-fixture.js";
import { subprocessTimeout } from "./subprocess-timeout.js";

const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const address = "sample-none-image-example";
const primary = "sample-sohl-being-subject";
const remedy = /new archive.*art\.lock/;
async function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-art-boundary-"));
    roots.push(root);
    write(
        path.join(root, "package.json"),
        JSON.stringify({
            name: "sample",
            version: "1.0.0",
            homepage: "https://example.invalid/sample/",
        }),
    );
    const data = {
        contentPackage: "sample",
        packageKind: "modules",
        compatibility: { minimum: "14", verified: "14" },
        stats: { lastModifiedBy: "samplebuilder000" },
        packs: [],
        pdf: { books: [{ id: "core", title: "Sample", document: "book.yaml" }] },
        site: { assets: "https://assets.example.invalid" },
        packageBuild: { assets: [] },
    };
    const configFile = path.join(root, "package-build.config.yaml");
    write(configFile, YAML.stringify(data));
    const config = configFromData(data, configFile);
    const subject = path.join(config.paths.content, "Subject.md");
    const fm = {
        type: "being",
        shortcode: "subject",
        name: { full: "Original subject" },
        tags: [] as string[],
    };
    const saveNote = () =>
        write(subject, note(fm, "![Portrait](image-example)\n\n[[lore-missing]]"));
    saveNote();
    write(
        path.join(config.paths.content, "Home.md"),
        note({ type: "homepage", shortcode: "root", name: { full: "Sample" } }),
    );
    const asset = path.join(config.paths.assets, "images/example.svg");
    write(asset, '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');
    const provenance = { attribution: "Artist", license: "CC-BY-SA-4.0", ai: false };
    const sidecar = `${asset}.yaml`;
    write(sidecar, YAML.stringify(provenance));
    const records = indexRecordsFor({ config, pinnedArt: false });
    const rendered = writeDerivativeProvenance(
        fs.readFileSync(asset),
        {
            address,
            creator: "Artist",
            rights: "Terms",
            derivedFrom: address,
            primaryNote: primary,
            name: fm.name.full,
        },
        { repeat: ["derivedFrom", "primaryNote", "name"], notePublic: true },
    ).bytes;
    const zip = zipSync({ "public/image.svg": rendered });
    const lock = {
        version: 1,
        package: "sample",
        source: { repository: "https://forge.example/art.git", revision: "a".repeat(40) },
        rendered: {
            url: "https://public.example/art.zip",
            sha256: crypto.createHash("sha256").update(zip).digest("hex"),
        },
    };
    write(path.join(root, "art.lock"), JSON.stringify(lock));
    const from = path.join(root, "input.zip");
    fs.writeFileSync(from, zip);
    const cache = await fetchPublicArt(config, { from, records });
    return {
        root,
        config,
        configFile,
        records,
        cache,
        from,
        asset,
        sidecar,
        fm,
        saveNote,
        provenance,
    };
}
type Change = "rename" | "gm" | "attribution" | "removal" | "readdress";
function change(f: Awaited<ReturnType<typeof fixture>>, kind: Change) {
    if (kind === "rename") f.fm.name.full = "Current subject";
    if (kind === "gm") f.fm.tags = ["gm"];
    if (kind === "attribution") {
        f.provenance.attribution = "Current artist";
        write(f.sidecar, YAML.stringify(f.provenance));
    }
    if (kind === "removal") fs.unlinkSync(f.asset);
    if (kind === "readdress") {
        fs.renameSync(f.asset, path.join(path.dirname(f.asset), "other.svg"));
        fs.renameSync(f.sidecar, path.join(path.dirname(f.asset), "other.svg.yaml"));
    }
    f.saveNote();
}
function diagnostics(findings: any[]) {
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
        file: expect.stringContaining("public/image.svg"),
        severity: "error",
        message: expect.stringMatching(remedy),
    });
    expect(findings[0].line).toBeUndefined();
    expect(findings[0].column).toBeUndefined();
    const text = JSON.stringify(findings);
    expect(text).not.toContain("Original subject");
    expect(text).not.toContain(primary);
    expect(text).not.toContain("missing or invalid");
    return text;
}
function cli(f: Awaited<ReturnType<typeof fixture>>, args: string[]) {
    return spawnSync(process.execPath, [path.resolve("bin/package-build.mjs"), ...args], {
        cwd: f.root,
        encoding: "utf8",
        env: { ...process.env, PACKAGE_BUILD_CONFIG: f.configFile },
    });
}
it.each<Change>(["rename", "gm", "attribution", "removal", "readdress"])(
    "ordinary readers retain current records and lint continues after %s",
    async (kind) => {
        const f = await fixture();
        change(f, kind);
        const problems: object[] = [];
        const records = indexRecordsFor({ config: f.config, problems });
        diagnostics(problems);
        const loaded = loadPinnedArt(f.config, records);
        diagnostics(loaded.findings);
        expect(loaded.files.size).toBe(1);
        const indexed = records.find(
            (r: any) => renderAddress(r.address.canonical) === address,
        ) as any;
        if (["removal", "readdress"].includes(kind)) expect(indexed).toBeUndefined();
        else {
            expect(indexed.asset.attribution).toBe(f.provenance.attribution);
            expect(indexed.asset.license).toBe("CC-BY-SA-4.0");
            expect(indexed.asset.ai).toBe(false);
        }
        expect(indexRecordsFor({ config: f.config })).toEqual(records);
        expect((await noteTree(f.config, { cache: false })).records).toEqual(records);
        expect((await noteTree(f.config)).cache.tree).toBe("miss");
        expect((await noteTree(f.config)).cache.tree).toBe("hit");
        const lint = cli(f, ["lint"]);
        expect(lint.status, lint.stderr + lint.stdout).toBe(1);
        expect(lint.stderr).toMatch(remedy);
        expect(lint.stderr + lint.stdout).toContain("lore-missing");
        expect(lint.stderr).not.toContain("Original subject");
        expect(lint.stderr).not.toContain(primary);
    },
    subprocessTimeout(30),
);

it.each<Change>(["rename", "gm", "attribution", "removal", "readdress"])(
    "every publication boundary refuses %s before output",
    async (kind) => {
        const f = await fixture();
        change(f, kind);
        const buildConfig = resolvePackageBuildConfig(f.config);
        const out = path.join(f.root, "published");
        const stageDir = path.resolve(f.root, buildConfig.stageDir);
        write(path.join(out, "sentinel"), "published bytes");
        write(path.join(stageDir, "sentinel"), "staged bytes");
        const before = outputBytes(out),
            staged = outputBytes(stageDir);
        const writes = vi.spyOn(fs, "writeFileSync");
        const mkdir = vi.spyOn(fs, "mkdirSync");
        const stageSpy = vi.spyOn(stage, "stageAssets");
        const render = vi.spyOn(renderer, "renderArtMasters");
        await expect(prepareContentIndex({ config: f.config })).rejects.toThrow(remedy);
        expect(() => emitContentIndex({ config: f.config, outDir: out })).toThrow(remedy);
        expect(() => buildSite({ config: f.config })).toThrow(remedy);
        await expect(buildPackageSite({ config: f.config, out })).rejects.toThrow(remedy);
        await expect(
            buildCompileCorpus({ config: f.config, contentBase: f.config.paths.content }),
        ).rejects.toThrow(remedy);
        await expect(
            stagePackageBuildAssets({ config: buildConfig, packConfig: f.config }),
        ).rejects.toThrow(remedy);
        await expect(
            reproducePinnedArt(f.config, { records: indexRecordsFor({ config: f.config }) }),
        ).rejects.toThrow(remedy);
        const pdf = await buildPdf({ config: f.config, compile: false, out });
        expect(pdf.built).toBe(false);
        diagnostics(pdf.findings);
        expect(writes).not.toHaveBeenCalled();
        expect(mkdir).not.toHaveBeenCalled();
        expect(stageSpy).not.toHaveBeenCalled();
        expect(render).not.toHaveBeenCalled();
        const session = await createContentSession({ config: f.config });
        try {
            diagnostics(session.problems);
            await expect(session.compileCorpus()).rejects.toThrow(remedy);
            await expect(buildCompileCorpus({ config: f.config, session })).rejects.toThrow(remedy);
            await expect(prepareContentIndex({ config: f.config, session })).rejects.toThrow(
                remedy,
            );
            await expect(
                stagePackageBuildAssets({ config: buildConfig, packConfig: f.config, session }),
            ).rejects.toThrow(remedy);
        } finally {
            session.dispose();
        }
        expect(outputBytes(out)).toEqual(before);
        expect(outputBytes(stageDir)).toEqual(staged);
        const cdn = cli(f, ["cdn", "publish", "--dry-run"]);
        expect(cdn.status, cdn.stderr + cdn.stdout).toBe(1);
        expect(cdn.stderr).toMatch(remedy);
        expect(cdn.stdout).not.toMatch(/would upload|uploading/i);
    },
    subprocessTimeout(30),
);

it("verifies the archive once per session and fingerprints its retained paths", async () => {
    const f = await fixture();
    const read = vi.spyOn(fs, "readFileSync");
    const session = await createContentSession({ config: f.config, trackChanges: true });
    try {
        expect(
            read.mock.calls.filter(([file]) => String(file) === path.join(f.cache, "archive.zip")),
        ).toHaveLength(1);
        expect(session.problems).toEqual([]);
        expect(session.pinnedArt.size).toBe(1);
        session.assertUnchanged();
        fs.writeFileSync(session.pinnedArt.get(address)!, "changed");
        expect(() => session.assertUnchanged()).toThrow(/Content sources changed/);
    } finally {
        session.dispose();
    }
});

it("fetch refuses stale publication metadata without replacing verified cache", async () => {
    const f = await fixture();
    change(f, "gm");
    const records = indexRecordsFor({ config: f.config, pinnedArt: false });
    const before = outputBytes(f.cache);
    await expect(fetchPublicArt(f.config, { from: f.from, records })).rejects.toThrow(remedy);
    expect(outputBytes(f.cache)).toEqual(before);
});

it(
    "missing cache stops real package build orchestration with the fetch remedy",
    async () => {
        const f = await fixture();
        fs.rmSync(f.cache, { recursive: true });
        const result = cli(f, ["content", "build", "--calendaria-version", "1.4.2"]);
        expect(result.status, result.stderr + result.stdout).toBe(1);
        expect(result.stderr).toMatch(/run package-build art fetch/);
        expect(fs.existsSync(f.config.paths.contentIndex)).toBe(false);
    },
    subprocessTimeout(30),
);
