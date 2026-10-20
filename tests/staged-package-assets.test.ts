/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The staged package holds its pictures flat, ships only what its provenance
 * allows, and lists exactly that in its asset set, `asset-sets/default.json`.
 *
 * Driven through `package-build assets` against a throwaway repository, because
 * the stage is what a release zips: a unit test of the selection alone would
 * pass while the command copied the roots some other way.
 *
 * The fixture mixes per-folder records and per-file sidecars in one directory,
 * as every consuming repository does, so a stage that decided per folder fails
 * here. Three guards:
 *
 * 1. Every staged picture's path round-trips to its address, and to the bytes
 *    of the file that address names.
 * 2. No staged picture resolves to `ai: true`, an absent `ai`, or a licence off
 *    the shipping list.
 * 3. Every `asset-sets/default.json` `target` is exactly
 *    `<icons|images>/<basename>`, names a staged file, and no repository source
 *    path reaches it; every entry carries a `source` that resolves, against the
 *    set file's own URL, to that file.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

import { collectAssetRecords } from "../engine/asset-index.mjs";

import { subprocessTimeout } from "./subprocess-timeout.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(path.dirname(HERE), "bin", "package-build.mjs");

/** The licences the owner allows a package to ship, as provenance spells them. */
const SHIPPING_LICENSES = [
    "LicenseRef-PublicDomain",
    "CC0-1.0",
    "CC0",
    "CC-BY-3.0",
    "CC-BY-4.0",
    "CC-BY-SA-4.0",
    "LicenseRef-NounProject-Pro",
];

const PKG = "tpkg";
const ROOT_OF_TYPE: Record<string, string> = { icon: "icons", image: "images" };

/** Provenance as YAML text. */
const record = (license: string, ai: boolean) =>
    YAML.stringify({ attribution: "Someone", license, ai });

/**
 * Every source file, with per-folder records and per-file sidecars mixed in one
 * directory.
 */
const TREE: Record<string, string> = {
    "lang/en.json": "{}",
    "assets/icons/game/provenance.yaml": record("CC-BY-3.0", false),
    "assets/icons/game/anvil.svg": "<svg>anvil</svg>",
    "assets/icons/game/bolt.svg": "<svg>bolt</svg>",
    "assets/icons/game/bolt.svg.yaml": record("CC-BY-3.0", true),
    "assets/icons/game/deep/crown.svg": "<svg>crown</svg>",
    "assets/icons/other/provenance.yaml": record("CC-BY-4.0", true),
    "assets/icons/other/dagger.svg": "<svg>dagger</svg>",
    "assets/icons/other/eagle.svg": "<svg>eagle</svg>",
    "assets/icons/other/eagle.svg.yaml": record("CC0-1.0", false),
    "assets/icons/missing.svg": "<svg>missing</svg>",
    "assets/icons/missing.svg.yaml": record("LicenseRef-PublicDomain", false),
    "assets/images/provenance.yaml": record("LicenseRef-Proprietary", false),
    "assets/images/places/fort.png": "fort",
    "assets/images/places/gate.png": "gate",
    "assets/images/places/gate.png.yaml": record("CC-BY-SA-4.0", false),
    "assets/images/people/hero.png": "hero",
    "assets/images/people/hero.png.yaml": record("LicenseRef-NounProject-Pro", false),
};

/** What the fixture ships, by deployed path. */
const EXPECTED_STAGED = [
    "icons/anvil.svg",
    "icons/crown.svg",
    "icons/eagle.svg",
    "icons/missing.svg",
    "images/gate.png",
    "images/hero.png",
];

let repo: string;
let stage: string;
let records: Record<string, any>[];
let run: ReturnType<typeof spawnSync>;

/** Every file under a directory, `/`-separated and relative to it. */
function listed(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const out: string[] = [];
    const walk = (rel: string) => {
        for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
            const name = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) walk(name);
            else out.push(name);
        }
    };
    walk("");
    return out.sort();
}

/** The staged pictures, by deployed path. */
function stagedPictures(): string[] {
    return listed(stage).filter((file) => /^(icons|images)\//.test(file));
}

/** The record a deployed path names, by the address it round-trips to. */
function recordForDeployed(file: string) {
    const [root, basename] = file.split("/");
    const type = Object.keys(ROOT_OF_TYPE).find((t) => ROOT_OF_TYPE[t] === root);
    const shortcode = basename.slice(0, basename.length - path.extname(basename).length);
    return records.find((r) => r.address.canonical === `${PKG}-none-${type}-${shortcode}`);
}

beforeAll(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "package-build-pictures-")));
    for (const [rel, body] of Object.entries(TREE)) {
        const full = path.join(repo, ...rel.split("/"));
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, body, "utf8");
    }
    fs.writeFileSync(
        path.join(repo, "package.json"),
        JSON.stringify({ name: PKG, version: "1.0.0", private: true }),
    );
    fs.writeFileSync(
        path.join(repo, "package-build.config.yaml"),
        YAML.stringify({
            contentPackage: PKG,
            packageKind: "modules",
            compatibility: { minimum: "14.359", verified: "14.359" },
            stats: { lastModifiedBy: "tpkgbuild0000000" },
            packs: [],
            packageBuild: {
                baseStyles: false,
                manifest: { title: "Test Package" },
                assets: [{ from: "lang", to: "lang" }],
            },
        }),
    );
    run = spawnSync(process.execPath, [CLI, "assets"], {
        cwd: repo,
        env: { ...process.env, PACKAGE_BUILD_CONFIG: path.join(repo, "package-build.config.yaml") },
        encoding: "utf8",
    });
    stage = path.join(repo, "build", "stage");
    records = collectAssetRecords(path.join(repo, "assets"), { contentPackage: PKG });
}, subprocessTimeout(1));

describe("the stage lays pictures out flat", () => {
    it("stages without a finding", () => {
        expect(run.stderr).toBe("");
        expect(run.status).toBe(0);
    });

    it("stages exactly the pictures provenance allows, flat at the package root", () => {
        expect(stagedPictures()).toEqual(EXPECTED_STAGED);
    });

    it("leaves nothing under assets/ in the stage", () => {
        expect(listed(path.join(stage, "assets"))).toEqual([]);
    });

    it("round-trips every staged path to its address and to that address's file", () => {
        const pictures = stagedPictures();
        expect(pictures.length).toBeGreaterThan(0);
        for (const file of pictures) {
            expect(file.split("/")).toHaveLength(2);
            const hit = recordForDeployed(file);
            expect(hit, file).toBeDefined();
            expect(path.basename(hit.asset.path)).toBe(path.basename(file));
            const source = fs.readFileSync(path.join(repo, "assets", ...hit.asset.path.split("/")));
            expect(fs.readFileSync(path.join(stage, file)).equals(source), file).toBe(true);
        }
    });
});

describe("no staged picture is one a package may not ship", () => {
    it("resolves every staged picture to `ai: false` and a shipping licence", () => {
        const pictures = stagedPictures();
        expect(pictures.length).toBeGreaterThan(0);
        for (const file of pictures) {
            const hit = recordForDeployed(file);
            expect(hit.asset.ai, file).toBe(false);
            expect(SHIPPING_LICENSES, file).toContain(hit.asset.license);
        }
    });

    it("decides per file, so a sidecar overrides its folder in either direction", () => {
        const pictures = stagedPictures();
        expect(pictures).not.toContain("icons/bolt.svg");
        expect(pictures).not.toContain("icons/dagger.svg");
        expect(pictures).toContain("icons/eagle.svg");
        expect(pictures).not.toContain("images/fort.png");
        expect(pictures).toContain("images/gate.png");
    });
});

describe("asset-sets/default.json lists the stage in the deployed layout", () => {
    const set = () =>
        JSON.parse(fs.readFileSync(path.join(stage, "asset-sets", "default.json"), "utf8")) as {
            name: string;
            package: string;
            assets: { address: string; source: string; target: string; size: number }[];
        };
    const manifest = () => set().assets;

    it("is written under asset-sets/ at the package root", () => {
        expect(fs.existsSync(path.join(stage, "asset-sets", "default.json"))).toBe(true);
        expect(fs.existsSync(path.join(stage, "assets.json"))).toBe(false);
    });

    it("is a named set for the content package, named after the manifest title", () => {
        expect(Object.keys(set()).sort()).toEqual(["assets", "name", "package"]);
        expect(set().package).toBe(PKG);
        expect(set().name).toBe("Test Package — shipped art");
    });

    it("carries exactly `address`, `source`, `target` and `size` on every entry", () => {
        for (const entry of manifest()) {
            expect(Object.keys(entry).sort()).toEqual(["address", "size", "source", "target"]);
        }
    });

    it("names each target as exactly `<icons|images>/<basename>`, naming a staged file", () => {
        for (const entry of manifest()) {
            expect(entry.target).toMatch(/^(icons|images)\/[^/]+$/);
            const staged = path.join(stage, entry.target);
            expect(fs.existsSync(staged), entry.target).toBe(true);
            expect(entry.size).toBe(fs.statSync(staged).size);
            expect(recordForDeployed(entry.target)?.address.canonical).toBe(entry.address);
        }
    });

    it("gives each file a source that resolves, against the set file's URL, to the staged file", () => {
        const list = "https://host.example/modules/tpkg/asset-sets/default.json";
        for (const entry of manifest()) {
            expect(typeof entry.source).toBe("string");
            expect(new URL(entry.source, list).href).toBe(
                `https://host.example/modules/tpkg/${entry.target}`,
            );
        }
    });

    it("lists exactly the staged files", () => {
        expect(
            manifest()
                .map((entry) => entry.target)
                .sort(),
        ).toEqual(stagedPictures());
    });

    it("carries no repository source path", () => {
        const sources = new Set(
            records.map((r) => r.asset.path).filter((p) => p.split("/").length > 2),
        );
        expect(sources.size).toBeGreaterThan(0);
        for (const entry of manifest()) {
            expect(sources.has(entry.target)).toBe(false);
            expect(sources.has(entry.source)).toBe(false);
        }
    });
});

describe("a row cannot stage a picture root around the filter", () => {
    it(
        "refuses `packageBuild.assets` copying a picture root, at the row",
        () => {
            const config = path.join(repo, "refusing.config.yaml");
            fs.writeFileSync(
                config,
                YAML.stringify({
                    contentPackage: PKG,
                    packageKind: "modules",
                    compatibility: { minimum: "14.359", verified: "14.359" },
                    stats: { lastModifiedBy: "tpkgbuild0000000" },
                    packs: [],
                    packageBuild: {
                        baseStyles: false,
                        stageDir: "build/refused",
                        assets: [{ from: "assets/images", to: "assets/images" }],
                    },
                }),
            );
            const refused = spawnSync(process.execPath, [CLI, "assets"], {
                cwd: repo,
                env: { ...process.env, PACKAGE_BUILD_CONFIG: config },
                encoding: "utf8",
            });
            expect(refused.status).not.toBe(0);
            expect(refused.stderr).toMatch(
                /^refusing\.config\.yaml:\d+:\d+: error: `packageBuild\.assets\[0\]` copies `assets\/images`/m,
            );
            expect(fs.existsSync(path.join(repo, "build", "refused", "assets"))).toBe(false);
        },
        subprocessTimeout(1),
    );
});

describe("a row that copies into a picture root keeps what it staged", () => {
    /** Run `assets` with one extra row, into its own stage directory. */
    function runWithRow(name: string, files: Record<string, string>, row: object) {
        for (const [rel, body] of Object.entries(files)) {
            const full = path.join(repo, ...rel.split("/"));
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, body, "utf8");
        }
        const config = path.join(repo, `${name}.config.yaml`);
        fs.writeFileSync(
            config,
            YAML.stringify({
                contentPackage: PKG,
                packageKind: "modules",
                compatibility: { minimum: "14.359", verified: "14.359" },
                stats: { lastModifiedBy: "tpkgbuild0000000" },
                packs: [],
                packageBuild: {
                    baseStyles: false,
                    stageDir: `build/${name}`,
                    manifest: { title: "Test Package" },
                    assets: [row],
                },
            }),
        );
        return spawnSync(process.execPath, [CLI, "assets"], {
            cwd: repo,
            env: { ...process.env, PACKAGE_BUILD_CONFIG: config },
            encoding: "utf8",
        });
    }

    it(
        "ships a row's files beside the staged pictures",
        () => {
            const result = runWithRow(
                "kept",
                { "legacy/help/x.jpg": "help" },
                { from: "legacy/help", to: "images/help" },
            );
            expect(result.status).toBe(0);
            const kept = listed(path.join(repo, "build", "kept"));
            expect(kept).toContain("images/help/x.jpg");
            for (const file of EXPECTED_STAGED) expect(kept).toContain(file);
        },
        subprocessTimeout(1),
    );

    it(
        "refuses a picture whose deployed path a row already staged, and keeps the row's file",
        () => {
            const result = runWithRow(
                "collided",
                { "legacy/flat/gate.png": "from the row" },
                { from: "legacy/flat", to: "images" },
            );
            expect(result.status).not.toBe(0);
            const lines = result.stderr
                .split("\n")
                .filter((line: string) =>
                    /^build\/collided\/images\/gate\.png: error: /.test(line),
                );
            expect(lines).toHaveLength(1);
            expect(lines[0]).toContain("assets/images/places/gate.png");
            expect(lines[0]).toContain("was not staged over it");
            expect(
                fs.readFileSync(path.join(repo, "build", "collided", "images", "gate.png"), "utf8"),
            ).toBe("from the row");
        },
        subprocessTimeout(1),
    );
});
