/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A daughter language names its parent in `data.family`**, and reads the
 * parent's words as its own. The lint holds the key to a language note, at the
 * value, and refuses a chain that returns to where it started. The
 * `language_lineage` relation lists each language with itself and every
 * ancestor, so a query joins it to `words` for a language's words including
 * inherited ones, while `words` keeps one row per authored word.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectContentIndex } from "../engine/content-index.mjs";
import { checkLanguageAbbreviation } from "../engine/language-words.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
import { openNotesDatabase, runSqlQuery } from "../engine/sql-tables.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const roots: string[] = [];
afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

const skill = (shortcode: string, subType: string, data: string[] = []) =>
    [
        "---",
        `shortcode: ${shortcode}`,
        `name: {full: ${shortcode}}`,
        "type: skill",
        `subType: ${subType}`,
        ...(data.length ? ["data:", ...data.map((line) => `  ${line}`)] : []),
        "---",
        "A tongue.",
        "",
    ].join("\n");

const words = (...forms: string[]) => [
    "fields:",
    "  - {name: All, holds: Everything.}",
    "words:",
    ...forms.map((form) => `  - {form: ${form}, class: n, field: All, gloss: ${form}}`),
];

const WORLD: Record<string, string> = {
    "Skills/Old.md": skill("oldlng", "language", words("ur")),
    "Skills/Helonic.md": skill("helonclng", "language", [
        "family: skill-oldlng",
        ...words("thalass"),
    ]),
    "Skills/Byzarian.md": skill("byzarlng", "language", [
        "family: skill-helonclng",
        ...words("kyma"),
    ]),
    "Skills/Bethuan.md": skill("bethunlng", "language", ["family: skill-helonclng"]),
    "Lore/Road.md":
        "---\nshortcode: road\nname: {full: The Road}\ntype: lore\nsubType: history\n---\nA road.\n",
};

function tree(files: Record<string, string>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "language-family-"));
    roots.push(root);
    for (const [rel, text] of Object.entries(files)) {
        const file = path.join(root, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    }
    return root;
}

/** Lint a tree, returning every finding with its file relative to the root. */
function lint(files: Record<string, string>) {
    const root = tree(files);
    const problems: any[] = [];
    const records = collectContentIndex(root, {
        contentPackage: "sohl",
        skipDirectories: [],
        problems,
    });
    const index = buildLinkIndex(root, { records, skipDirectories: [] });
    return [
        ...problems,
        ...lintFrontmatter(index, { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY }).findings,
    ].map((finding) => ({ ...finding, file: path.relative(root, finding.file) }));
}

const at = (text: string, finding: { line?: number; column?: number }) => {
    expect(finding.line, "a finding is located on its line").toBeTypeOf("number");
    expect(finding.column, "a finding is located on its column").toBeTypeOf("number");
    return text.split("\n")[finding.line! - 1].slice(finding.column! - 1);
};

/** The findings on one file. */
const on = (files: Record<string, string>, rel: string) =>
    lint(files).filter((finding) => finding.file === rel);

describe("data.family", () => {
    it("is a skill field naming a skill", () => {
        const field = dataFields("skill").find((f: { name: string }) => f.name === "family");
        expect(field).toMatchObject({ kind: "address", ref: "skill" });
    });

    it("lints clean on a chain of language notes", () => {
        expect(lint(WORLD)).toEqual([]);
    });

    it("is refused on a skill of another subType, at the key", () => {
        const text = skill("smithing", "craft", ["family: skill-oldlng"]);
        const findings = on({ ...WORLD, "Skills/Smithing.md": text }, "Skills/Smithing.md");
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].message).toMatch(/`data\.family`.*`language`/);
        expect(at(text, findings[0]).startsWith("family:")).toBe(true);
    });

    it("refuses a value that is not a skill, at the value", () => {
        const text = skill("lostlng", "language", ["family: lore-road"]);
        const findings = on({ ...WORLD, "Skills/Lost.md": text }, "Skills/Lost.md");
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].message).toMatch(/must name a skill Address, but names lore/);
        expect(at(text, findings[0]).startsWith("lore-road")).toBe(true);
    });

    it("refuses a skill that is not a language, at the value", () => {
        const text = skill("lostlng", "language", ["family: skill-smithing"]);
        const findings = on(
            { ...WORLD, "Skills/Lost.md": text, "Skills/Smithing.md": skill("smithing", "craft") },
            "Skills/Lost.md",
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].message).toMatch(/not a skill whose subType is language/);
        expect(at(text, findings[0]).startsWith("skill-smithing")).toBe(true);
    });

    it("refuses a value that resolves to nothing, at the value", () => {
        const text = skill("lostlng", "language", ["family: skill-nowhere"]);
        const findings = on({ ...WORLD, "Skills/Lost.md": text }, "Skills/Lost.md");
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].message).toMatch(/does not resolve/);
        expect(at(text, findings[0]).startsWith("skill-nowhere")).toBe(true);
    });

    it("refuses a chain that returns to its start, on every note in the cycle", () => {
        const a = skill("alng", "language", ["family: skill-blng"]);
        const b = skill("blng", "language", ["family: skill-alng"]);
        const findings = lint({ ...WORLD, "Skills/A.md": a, "Skills/B.md": b }).filter((f) =>
            /cycle/.test(f.message),
        );
        expect(findings.map((f) => f.file).sort()).toEqual(["Skills/A.md", "Skills/B.md"]);
        for (const finding of findings) expect(finding.severity).toBe("error");
        const onA = findings.find((f) => f.file === "Skills/A.md")!;
        expect(at(a, onA).startsWith("skill-blng")).toBe(true);
    });

    it("refuses a language naming itself", () => {
        const text = skill("selflng", "language", ["family: skill-selflng"]);
        const findings = on({ ...WORLD, "Skills/Self.md": text }, "Skills/Self.md");
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toMatch(/cycle/);
        expect(at(text, findings[0]).startsWith("skill-selflng")).toBe(true);
    });
});

describe("the `language_lineage` relation", () => {
    let db: any;

    beforeAll(async () => {
        const root = tree(WORLD);
        const records = collectContentIndex(root, { contentPackage: "sohl", skipDirectories: [] });
        db = await openNotesDatabase(records, { dir: path.join(root, "db") });
    }, 60_000);

    afterAll(async () => {
        await db?.close();
    });

    it("lists each language with itself at depth 0 and every ancestor above it", async () => {
        const result = await runSqlQuery(
            db,
            "SELECT ancestor, depth FROM language_lineage WHERE language = 'sohl-note-skill-byzarlng' ORDER BY depth",
        );
        expect(result.rows.map((row: any) => ({ ...row, depth: Number(row.depth) }))).toEqual([
            { ancestor: "sohl-note-skill-byzarlng", depth: 0 },
            { ancestor: "sohl-note-skill-helonclng", depth: 1 },
            { ancestor: "sohl-note-skill-oldlng", depth: 2 },
        ]);
    });

    it("joins to words for a language's words, inherited ones included", async () => {
        const result = await runSqlQuery(
            db,
            [
                "SELECT w.form, w.language, l.depth FROM words w",
                "JOIN language_lineage l ON w.language = l.ancestor",
                "WHERE l.language = 'sohl-note-skill-bethunlng' ORDER BY l.depth, w.position",
            ].join(" "),
        );
        expect(result.rows.map((row: any) => ({ ...row, depth: Number(row.depth) }))).toEqual([
            { form: "thalass", language: "sohl-note-skill-helonclng", depth: 1 },
            { form: "ur", language: "sohl-note-skill-oldlng", depth: 2 },
        ]);
    });

    it("keeps one words row per authored word", async () => {
        const result = await runSqlQuery(db, "SELECT count(*) AS n FROM words");
        expect(Number(result.rows[0].n)).toBe(3);
    });
});

describe("data.abbreviation", () => {
    const note = (subType: string, abbreviation: unknown) => {
        const raw = [
            "---",
            "type: skill",
            `subType: ${subType}`,
            "data:",
            `  abbreviation: ${JSON.stringify(abbreviation)}`,
            "---",
            "",
        ].join("\n");
        return {
            file: "Skills/One.md",
            raw,
            fm: { type: "skill", subType, data: { abbreviation } },
        };
    };

    it("is the tag a language states", () => {
        expect(checkLanguageAbbreviation(note("language", "Prov."))).toEqual([]);
    });

    it("is an error on a skill that is no language, at the key", () => {
        const [finding] = checkLanguageAbbreviation(note("craft", "Cr."));
        expect(finding).toMatchObject({ severity: "error", line: 5 });
        expect(finding.message).toMatch(/subType/);
    });

    it("is an error when blank, at the value", () => {
        const [finding] = checkLanguageAbbreviation(note("language", " "));
        expect(finding).toMatchObject({ severity: "error", line: 5 });
        expect(finding.message).toMatch(/blank/);
    });
});
