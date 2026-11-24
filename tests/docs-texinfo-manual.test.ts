/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The Texinfo manual covers every documentation page exactly once, and the
 * documentation converts with nothing left unmapped.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { convertDocs, formatFinding, infoText } from "../scripts/docs-texinfo/convert.mjs";
import { resolvePackageBuildConfig } from "../config.mjs";
import { readPackConfig } from "../engine/pack-config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DOCS = path.join(ROOT, "docs");

function pages(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry: fs.Dirent) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return pages(full);
        return entry.isFile() && entry.name.endsWith(".md") ?
                [path.relative(DOCS, full).split(path.sep).join("/")]
            :   [];
    });
}

const CONFIGURED = resolvePackageBuildConfig(
    readPackConfig(path.join(ROOT, "package-build.config.yaml")),
).texinfo;

describe("the declared manuals", () => {
    it("start at the documentation home", () => {
        expect(CONFIGURED[0].page).toBe("index.md");
    });

    it("reach every page under docs/", () => {
        const { findings } = convertDocs({ root: ROOT, manuals: CONFIGURED });
        expect(findings.map(formatFinding)).toEqual([]);
    });
});

describe("the documentation as a manual", () => {
    const result = convertDocs({ root: ROOT, manuals: CONFIGURED });
    const { findings } = result;
    const texinfo = result.manuals[0].texinfo;

    it("converts with no unmapped construct", () => {
        expect(findings.map(formatFinding)).toEqual([]);
    });

    it("has one chapter per page but the top page", () => {
        const chapters = pages(DOCS).length - 1;
        expect(texinfo.match(/^@chapter /gm)).toHaveLength(chapters);
        const version = JSON.parse(
            fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
        ).version;
        expect(texinfo).toContain(`@set VERSION ${version}\n`);
    });

    it("declares every node it refers to", () => {
        const declared = new Set(
            [...texinfo.matchAll(/^@node (.+)$|^@anchor\{(.+)\}$/gm)].map((m) => m[1] ?? m[2]),
        );
        const referenced = [...texinfo.matchAll(/@ref\{((?:[^,{}@]|@.)+?)(?:,|\})/g)].map(
            (m) => m[1],
        );
        expect(referenced.filter((name) => !declared.has(name))).toEqual([]);
    });

    it("gives Info no period in a node name and no colon in a reference label", () => {
        // makeinfo warns on both, and an Info reader ends the reference there.
        const named = [...texinfo.matchAll(/^@node (.+)$|^@anchor\{(.+)\}$/gm)].map(
            (m) => m[1] ?? m[2],
        );
        expect(named.filter((name) => name.includes("."))).toEqual([]);
        const labels = [
            ...texinfo.matchAll(/@ref\{(?:[^,{}@]|@.)+?,,((?:[^{}]|\{[^{}]*\})*)\}/g),
        ].map((m) => m[1]);
        expect(labels.filter((label) => label.includes(":"))).toEqual([]);
        expect(texinfo).not.toMatch(/@strong\{note\s/i);
    });

    it("makes no multitable column narrower than its longest word", () => {
        const tables = [
            ...texinfo.matchAll(/@multitable @columnfractions (.+)\n([\s\S]*?)@end multitable/g),
        ];
        expect(tables.length).toBeGreaterThan(0);
        const narrow = tables.flatMap(([, fractions, body]) => {
            const sizes = fractions.split(" ").map((f) => Math.round(Number(f) * 72));
            return body
                .split(/\n@(?:item|headitem) /)
                .flatMap((row) =>
                    row
                        .replace(/^@(?:item|headitem) /, "")
                        .split(" @tab ")
                        .map((cell, i) => ({ cell, size: sizes[i] })),
                )
                .filter(({ cell, size }) =>
                    infoText(cell)
                        .split(/[ \t\n]+/)
                        .some((word) => [...word].length + 2 > size),
                );
        });
        expect(narrow).toEqual([]);
    });
});

describe("node scripts/docs-texinfo.mjs", () => {
    it("writes the manuals and the Info dir file where --out names", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-texinfo-"));
        try {
            const out = dir;
            const run = spawnSync(process.execPath, ["scripts/docs-texinfo.mjs", "--out", out], {
                cwd: ROOT,
                encoding: "utf8",
            });
            expect(run.stderr).toBe("");
            expect(run.status).toBe(0);
            expect(
                fs
                    .readFileSync(path.join(out, "package-build.texi"), "utf8")
                    .startsWith("\\input texinfo\n"),
            ).toBe(true);
            expect(fs.readFileSync(path.join(out, "dir"), "utf8")).toContain("(package-build)");
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("writes a dir file Info reads: a node separator, then the Top node", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-texinfo-"));
        try {
            const run = spawnSync(process.execPath, ["scripts/docs-texinfo.mjs", "--out", dir], {
                cwd: ROOT,
                encoding: "utf8",
            });
            expect(run.status).toBe(0);
            const bytes = fs.readFileSync(path.join(dir, "dir"));
            const text = bytes.toString("latin1");
            expect(bytes.filter((b) => b === 0x1f).length).toBe(1);
            expect(text).toMatch(/\n\x1f\nFile: dir,\tNode: Top\t[^\n]*\n\n\* Menu:\n/);
            expect(text.indexOf("\x1f")).toBeLessThan(text.indexOf("* Menu:"));

            const info = spawnSync("info", ["-d", dir, "-o", "-", "(dir)"], {
                encoding: "utf8",
                env: { ...process.env, INFOPATH: "" },
            });
            if (!info.error && info.status === 0) {
                expect(info.stdout).toContain("(package-build)");
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    describe("with a configuration it cannot accept", () => {
        const run = (config: string, docs: Record<string, string> = { "index.md": "# T\n" }) => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-texinfo-root-"));
            try {
                fs.mkdirSync(path.join(root, "docs"));
                fs.writeFileSync(path.join(root, "package.json"), '{"name":"p","version":"1.0.0"}');
                fs.writeFileSync(path.join(root, "package-build.config.yaml"), config);
                for (const [name, body] of Object.entries(docs))
                    fs.writeFileSync(path.join(root, "docs", name), body);
                return spawnSync(
                    process.execPath,
                    [path.join(ROOT, "scripts/docs-texinfo.mjs"), "--root", root, "--check"],
                    { cwd: root, encoding: "utf8" },
                );
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        };

        it("positions a bad entry, exits 1 and prints no stack trace", () => {
            const result = run(
                "contentPackage: p\npackageKind: documentation\nauthors:\n  - name: A\npackageBuild:\n  texinfo:\n    - page: ../index.md\n",
            );
            expect(result.status).toBe(1);
            expect(result.stderr).toMatch(
                /^package-build\.config\.yaml:7:\d+: error: .*packageBuild\.texinfo\[0\]\.page/m,
            );
            expect(result.stderr).not.toMatch(/\n\s+at /);
        });

        it("positions an empty list at the configuration file", () => {
            const result = run(
                "contentPackage: p\npackageKind: documentation\nauthors:\n  - name: A\npackageBuild:\n  texinfo: []\n",
            );
            expect(result.status).toBe(1);
            expect(result.stderr).toMatch(
                /^package-build\.config\.yaml:1:1: error: packageBuild\.texinfo declares no manual/m,
            );
        });
    });

    it("prints its usage, options, and exit status for --help", () => {
        const run = spawnSync(process.execPath, ["scripts/docs-texinfo.mjs", "--help"], {
            cwd: ROOT,
            encoding: "utf8",
        });
        expect(run.status).toBe(0);
        for (const text of [
            "usage: node scripts/docs-texinfo.mjs",
            "--root <dir>",
            "--out <dir>",
            "--check",
            "Exit status:",
        ])
            expect(run.stdout).toContain(text);
    });

    it("refuses an unknown option", () => {
        const run = spawnSync(process.execPath, ["scripts/docs-texinfo.mjs", "--nope"], {
            cwd: ROOT,
            encoding: "utf8",
        });
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("usage: node scripts/docs-texinfo.mjs");
    });
});
