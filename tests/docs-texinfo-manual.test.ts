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
import { MANIFEST, manifestFiles } from "../scripts/docs-texinfo/manifest.mjs";

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

describe("the manual's manifest", () => {
    it("names every page under docs/ exactly once", () => {
        const listed = manifestFiles();
        const repeated = listed.filter((file, i) => listed.indexOf(file) !== i);
        expect(repeated, "pages the manifest names twice").toEqual([]);
        expect([...listed].sort()).toEqual(pages(DOCS).sort());
    });

    it("opens with the documentation home", () => {
        expect(MANIFEST[0]).toBe("index.md");
    });
});

describe("the documentation as a manual", () => {
    const { texinfo, findings } = convertDocs({ root: ROOT });

    it("converts with no unmapped construct", () => {
        expect(findings.map(formatFinding)).toEqual([]);
    });

    it("has one chapter per page that is not attached to another", () => {
        const chapters = MANIFEST.length - 1;
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
    it("writes the manual where --out names", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-texinfo-"));
        try {
            const out = path.join(dir, "manual.texi");
            const run = spawnSync(process.execPath, ["scripts/docs-texinfo.mjs", "--out", out], {
                cwd: ROOT,
                encoding: "utf8",
            });
            expect(run.stderr).toBe("");
            expect(run.status).toBe(0);
            expect(fs.readFileSync(out, "utf8").startsWith("\\input texinfo\n")).toBe(true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("prints its usage, options, and exit status for --help", () => {
        const run = spawnSync(process.execPath, ["scripts/docs-texinfo.mjs", "--help"], {
            cwd: ROOT,
            encoding: "utf8",
        });
        expect(run.status).toBe(0);
        for (const text of [
            "usage: node scripts/docs-texinfo.mjs",
            "--out <file>",
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
