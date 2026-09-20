/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `content-build docs item-fields --check` reports a stale generated page
 * against the diagnostics contract every other located failure in this
 * binary follows: `file: severity: message`, the path starting the line,
 * unprefixed by `loglevel`'s `[timestamp] [LEVEL]:` banner.
 *
 * Driven as a subprocess, like the other CLI-contract suites, because what is
 * under test is exactly what reaches stderr — a call that goes through
 * `log.error` instead of `reportFailure`/`emitDiagnostic` still fails the
 * build, so only the literal bytes on the line tell the two apart.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(PKG_ROOT, "bin", "content-build.mjs");

let root: string;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-check-"));
    fs.mkdirSync(path.join(root, "assets", "content"), { recursive: true });
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sohl", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(root, "package-build.config.yaml"),
        `contentPackage: sohl
packageKind: systems
compatibility:
    minimum: "14"
    verified: "14.367"
stats:
    lastModifiedBy: docscheckbuild0000
systems:
    sohl:
        compatibility: { verified: "0.9.0" }
itemBuilders: [sohl]
packs:
    - { name: items, label: Items, type: Item, system: sohl, default: true }
    - { name: journals, label: Journals, type: JournalEntry }
`,
    );
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** Run `docs item-fields --check` against a destination, real binary. */
function runCheck(destination: string): { code: number; out: string; err: string } {
    const r = spawnSync(
        process.execPath,
        [CLI, "docs", "item-fields", "--check", "--out", destination],
        {
            cwd: root,
            env: {
                ...process.env,
                PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
            },
            encoding: "utf8",
        },
    );
    return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

/** Run `docs item-fields` (writing) against a destination, real binary. */
function runWrite(
    destination: string,
    extraArgs: string[] = [],
): { code: number; out: string; err: string } {
    const r = spawnSync(
        process.execPath,
        [CLI, "docs", "item-fields", "--out", destination, ...extraArgs],
        {
            cwd: root,
            env: {
                ...process.env,
                PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
            },
            encoding: "utf8",
        },
    );
    return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

describe("`content-build docs item-fields --check` against a stale page", () => {
    let destination: string;

    beforeAll(() => {
        destination = path.join(root, "item-fields.md");
        fs.writeFileSync(destination, "this is not the generated page\n");
    });

    it("starts the line with the path, not a loglevel timestamp", () => {
        const { err } = runCheck(destination);
        const located = err.split("\n").find((line) => line.includes("out of date"));

        expect(located).toBeDefined();
        // The defect this guards: `[2026-...] [ERROR]: item-fields.md: ...`
        // buries the path mid-line where no parser reads it from.
        expect(located).not.toMatch(/^\[/);
        expect(located).toMatch(/^item-fields\.md: error: out of date/);
    });

    it("still drops the line field rather than guessing one", () => {
        const { err } = runCheck(destination);
        const located = err.split("\n").find((line) => line.includes("out of date"));

        // Staleness is a property of the whole file: no `:1:1`, no line at all
        // between the path and the severity.
        expect(located).toMatch(/^item-fields\.md: error: /);
    });

    it("still fails the run", () => {
        const { code } = runCheck(destination);
        expect(code).not.toBe(0);
    });
});

describe("`content-build docs item-fields` with `--out` inside the content tree", () => {
    it("writes a complete note, envelope and all", () => {
        const destination = path.join(root, "assets/content/item-frontmatter.md");
        try {
            const { code } = runWrite(destination, ["--title", "Item Note Frontmatter"]);
            expect(code).toBe(0);
            const written = fs.readFileSync(destination, "utf8");
            expect(written.startsWith("---\n")).toBe(true);
            expect(written).toMatch(/^type: doc$/m);
            expect(written).toMatch(/^subType: reference$/m);
            expect(written).toMatch(/^shortcode: itemfrontmatter$/m);
            expect(written).toMatch(/^ {2}full: Item Note Frontmatter$/m);
            expect(written).toMatch(/^pack: none$/m);
            expect(written).toContain("# Item Note Frontmatter");
        } finally {
            fs.rmSync(destination, { force: true });
        }
    });

    it("passes `--check` right after writing, and fails against a stale body", () => {
        const destination = path.join(root, "assets/content/item-frontmatter.md");
        try {
            expect(runWrite(destination, ["--title", "Item Note Frontmatter"]).code).toBe(0);
            expect(runCheck(destination).code).toBe(0);

            // A stale body — the envelope is exactly what was just written, but
            // the tables underneath it are not.
            const current = fs.readFileSync(destination, "utf8");
            fs.writeFileSync(destination, current.replace("# Item Note Frontmatter", "# Stale"));
            const { code, err } = runCheck(destination);
            expect(code).not.toBe(0);
            expect(err).toContain("out of date");
        } finally {
            fs.rmSync(destination, { force: true });
        }
    });

    it("writes the body alone with `--out` outside the content tree", () => {
        // The control: the same command, a destination one level up, gets no
        // envelope — exactly the behaviour before this file lived in the
        // content tree.
        const destination = path.join(root, "item-frontmatter.md");
        try {
            expect(runWrite(destination, ["--title", "Item Note Frontmatter"]).code).toBe(0);
            const written = fs.readFileSync(destination, "utf8");
            expect(written.startsWith("---\n")).toBe(false);
            expect(written.startsWith("# Item Note Frontmatter")).toBe(true);
        } finally {
            fs.rmSync(destination, { force: true });
        }
    });
});
