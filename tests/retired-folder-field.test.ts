/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `folder:` — the Foundry-id spelling, retired.
 *
 * It named a compendium folder by the raw Foundry id declared in a per-pack
 * `*-folders.yaml`. Both halves go together: the id spelling has nothing left
 * to resolve against once the YAML is gone, and the YAML has no reader once
 * the spelling is refused.
 *
 * Refused rather than ignored, on the pattern `package:` set. A retired field
 * left ignored reads to its author as though it still works — the note says
 * one thing and the build does another — so presence is the whole test, and
 * the message says what to write instead (`packFolder`, a folder note's
 * address) rather than which value to correct.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it, expect, afterAll } from "vitest";

import { folderField } from "../engine/helpers.mjs";
import { assertNoDeclaredFolder } from "../engine/folder-notes.mjs";
import { UNIVERSAL_KEYS, lintNote } from "../engine/frontmatter-lint.mjs";

const tmpdirs: string[] = [];
function tmpNote(body: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-retired-folder-"));
    tmpdirs.push(dir);
    const file = path.join(dir, "note.md");
    fs.writeFileSync(file, body);
    return file;
}
afterAll(() => {
    for (const dir of tmpdirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe("the retired `folder:` spelling", () => {
    it("is refused, naming `packFolder` as what to write instead", () => {
        expect(() => assertNoDeclaredFolder({ folder: "ONXsqZAIZr2qzxTb" })).toThrow(/packFolder/);
    });

    it("is refused on presence alone, even written empty", () => {
        // `folder:` with no value parses as null and is still the field.
        expect(() => assertNoDeclaredFolder({ folder: null })).toThrow(/retired/);
    });

    it("is refused inside the `sohl:` block, where notes also wrote it", () => {
        expect(() => assertNoDeclaredFolder({ sohl: { folder: "ONXsqZAIZr2qzxTb" } })).toThrow(
            /packFolder/,
        );
    });

    it("accepts a note that names no folder, and one that uses `packFolder`", () => {
        expect(() => assertNoDeclaredFolder({})).not.toThrow();
        expect(() => assertNoDeclaredFolder({ packFolder: "miscgear" })).not.toThrow();
    });

    it("carries the line the field is on, so the diagnostic opens on it", () => {
        const file = tmpNote(
            ["---", "type: item", "folder: ONXsqZAIZr2qzxTb", "---", ""].join("\n"),
        );
        try {
            assertNoDeclaredFolder({ folder: "ONXsqZAIZr2qzxTb" }, { absPath: file });
            throw new Error("expected a refusal");
        } catch (err: any) {
            expect(err.position?.line).toBe(3);
        }
    });
});

describe("`folderField`, once the id spelling is gone", () => {
    it("reads `packFolder` and always reports an address", () => {
        expect(folderField({ packFolder: "miscgear" })).toEqual({
            value: "miscgear",
            isAddress: true,
        });
    });

    it("reports no folder for a note that names none", () => {
        expect(folderField({})).toEqual({ value: null, isAddress: true });
    });

    it("no longer falls back to the id spelling", () => {
        // The refusal is raised where a note is read; this reader simply has
        // no second spelling left to fall back to.
        expect(folderField({ folder: "ONXsqZAIZr2qzxTb" }).value).toBeNull();
    });
});

describe("the universal-key list", () => {
    it("still admits `packFolder`", () => {
        expect(UNIVERSAL_KEYS.has("packFolder")).toBe(true);
    });

    it("no longer admits `folder`", () => {
        expect(UNIVERSAL_KEYS.has("folder")).toBe(false);
    });
});

describe("the frontmatter lint", () => {
    it("reports it as well as the compile refusing it", () => {
        // The compile stops at the first note it reaches; the lint is where an
        // author meets every one of them in the tree at once, which is what a
        // tree still to sweep needs.
        const raw = [
            "---",
            "type: doc",
            "shortcode: linted",
            "folder: ONXsqZAIZr2qzxTb",
            "---",
            "",
            "Prose.",
        ].join("\n");
        const findings = lintNote(
            {
                fm: { type: "doc", shortcode: "linted", folder: "ONXsqZAIZr2qzxTb" },
                file: "Rules/Linted.md",
                raw,
            } as any,
            { schemas: {} },
        );
        const hits = findings.filter((f: any) => /retired frontmatter field/.test(f.message));
        expect(hits).toHaveLength(1);
        expect(hits[0]).toMatchObject({ file: "Rules/Linted.md", line: 4, severity: "error" });
        expect(hits[0].message).toMatch(/packFolder/);
    });

    it("reports the `sohl:` block spelling too, not merely as unrecognized", () => {
        const raw = [
            "---",
            "type: doc",
            "shortcode: linted",
            "sohl:",
            "  folder: ONXsqZAIZr2qzxTb",
            "---",
            "",
        ].join("\n");
        const findings = lintNote(
            {
                fm: { type: "doc", shortcode: "linted", sohl: { folder: "ONXsqZAIZr2qzxTb" } },
                file: "Rules/Linted.md",
                raw,
            } as any,
            { schemas: {} },
        );
        const hits = findings.filter((f: any) => /retired frontmatter field/.test(f.message));
        expect(hits).toHaveLength(1);
        expect(hits[0].message).toMatch(/packFolder/);
    });
});

/**
 * The specification is the other place the model is stated, and prose is
 * checked by nothing.
 *
 * The epic's argument against `*-folders.yaml` was that a second, unchecked
 * statement of one fact drifts from the first. These assertions point that
 * argument at `docs/content-format.md`, which had drifted in both of the ways
 * a retired spelling can: it offered `folder` beside `packFolder` as a live
 * source, and it still called `packFolder` a path.
 *
 * They deliberately do not test the engine's docblocks. A sentence describing
 * `folder:` as **retired** is correct and must survive, and no assertion can
 * separate that from one describing it as live without reading the prose — so
 * the docblocks are held to review, and only the two mechanical claims below
 * are pinned.
 */
describe("the specification states the address model", () => {
    const SPEC = fs.readFileSync(path.resolve(__dirname, "../docs/content-format.md"), "utf8");

    /** The shared-mappings rows — `| shared source | → sohl | → hm3 |`. */
    function sharedMappingSources(): string[] {
        const table = SPEC.match(/^\|\s*shared source.*\n\|[-\s|]+\n((?:\|.*\n)+)/m);
        return (table?.[1] ?? "")
            .trim()
            .split("\n")
            .map((row) => row.trim().replace(/^\|/, "").split("|")[0].trim())
            .filter(Boolean);
    }

    it("parses a shared-mappings table that still has rows to read", () => {
        // Guards the guard: reshaping the table would otherwise make the
        // assertions below vacuously pass.
        const sources = sharedMappingSources();
        expect(sources.length).toBeGreaterThan(4);
        expect(sources).toContain("`name.full`");
    });

    it("names `packFolder` alone as the compendium-folder source", () => {
        // `folder:` is refused at compile and reported by the lint, so offering
        // it here tells an author to write a value the build rejects.
        const named = sharedMappingSources().filter((s) => /folder/i.test(s));
        expect(named).toEqual(["`packFolder`"]);
    });

    it("never presents `packFolder` as holding a path", () => {
        // The placeholder form is a claim about live syntax. Prose about the
        // path form having existed ("`packFolder` was a path for one release")
        // is history, and is left alone.
        expect(SPEC).not.toMatch(/`packFolder: <path>`/);
    });
});
