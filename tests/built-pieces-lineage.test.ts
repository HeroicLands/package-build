/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A daughter language resolves a word's built pieces through its lineage**:
 * its own words, affixes and elements first, then each ancestor's in `data.family`
 * order. The lint, the `words` relation and the dictionary etymology agree.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectContentIndex } from "../engine/content-index.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { openNotesDatabase, runSqlQuery } from "../engine/sql-tables.mjs";
import { pieceGlosses } from "../engine/word-rows.mjs";
import { renderDictionary } from "../engine/dictionary-layout.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const language = (shortcode: string, data: string[]) =>
    [
        "---",
        `shortcode: ${shortcode}`,
        `name: {full: ${shortcode}}`,
        "type: skill",
        "subType: language",
        "data:",
        ...data.map((line) => `  ${line}`),
        "---",
        "A tongue.",
        "",
    ].join("\n");

const TREE: Record<string, string> = {
    "Skills/Parent.md": language("parentlng", [
        "fields:",
        "  - {name: Sea, holds: The sea.}",
        "affixes:",
        "  - {form: -ei, gloss: small}",
        "  - {form: -oo, gloss: parent sense}",
        "words:",
        "  - {form: thalass, class: n, field: Sea, gloss: the sea}",
        "  - {form: shared, class: n, field: Sea, gloss: parent word}",
        "elements:",
        "  - {form: stone, variants: [STONE], sense: old stone}",
    ]),
    "Skills/Daughter.md": language("daughterlng", [
        "family: skill-parentlng",
        "fields:",
        "  - {name: Sea, holds: The sea.}",
        "affixes:",
        "  - {form: -oo, gloss: daughter sense}",
        "  - {form: -suffix, front: -frontsuffix, gloss: affix wins}",
        "  - {form: rootword, gloss: hidden affix}",
        "elements:",
        "  - {form: rootword, sense: hidden element}",
        "  - {form: -suffix, sense: hidden suffix}",
        "  - {form: -frontsuffix, sense: hidden front form}",
        "  - {form: reed, variants: [Reedlong], sense: river reed}",
        "  - {form: shared, sense: daughter element}",
        "words:",
        "  - {form: thalassei, class: n, field: Sea, gloss: a pool, built: [thalass, -ei, -oo, -zz]}",
        "  - {form: rootword, class: n, field: Sea, gloss: word wins}",
        "  - {form: reedstone, class: n, field: Sea, gloss: a river marker, built: [rootword, -suffix, -frontsuffix, Reedlong, stone-, STONE, shared]}",
    ]),
};

let dir: string;
let root: string;

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "built-lineage-"));
    root = path.join(dir, "tree");
    for (const [rel, text] of Object.entries(TREE)) {
        const file = path.join(root, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    }
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("a daughter's built pieces", () => {
    it("lint against the daughter's own entries and its ancestors', warning only on a piece neither has", () => {
        const problems: any[] = [];
        const records = collectContentIndex(root, {
            contentPackage: "sohl",
            skipDirectories: [],
            problems,
        });
        const index = buildLinkIndex(root, { records, skipDirectories: [] });
        const { findings } = lintFrontmatter(index, {
            schemas: NOTE_SCHEMAS,
            vocabulary: NOTE_VOCABULARY,
        });
        const pieces = [...problems, ...findings]
            .map((finding: any) => finding.message as string)
            .filter((message) => /matches no word, affix or element/.test(message));
        expect(pieces).toHaveLength(1);
        expect(pieces[0]).toContain("`-zz`");
    });

    it("gloss in the words relation and the dictionary etymology, the daughter's entry first", async () => {
        const records = collectContentIndex(root, { contentPackage: "demo", skipDirectories: [] });
        const db = await openNotesDatabase(records, { dir: path.join(dir, "db") });
        try {
            const words = await runSqlQuery(
                db,
                "SELECT built_parts FROM words WHERE form = 'thalassei'",
            );
            expect(words.rows[0].built_parts).toEqual([
                { form: "thalass", gloss: "the sea" },
                { form: "-ei", gloss: "small" },
                { form: "-oo", gloss: "daughter sense" },
                { form: "-zz", gloss: null },
            ]);
            const dictionary = await runSqlQuery(
                db,
                "SELECT etymology FROM dictionary WHERE name = 'thalassei' AND depth = 0",
            );
            expect(dictionary.rows[0].etymology.parts).toEqual([
                { form: "thalass", gloss: "the sea" },
                { form: "-ei", gloss: "small" },
                { form: "-oo", gloss: "daughter sense" },
                { form: "-zz", gloss: null },
            ]);
        } finally {
            await db.close();
        }
    });
});

describe("built elements", () => {
    it("uses declared variant spelling without folding case or accents", () => {
        const glossOf = pieceGlosses({
            elements: [{ form: "él", variants: ["Él"], sense: "star" }],
        });
        expect(glossOf("él")).toBe("star");
        expect(glossOf("Él-")).toBe("star");
        expect(glossOf("EL")).toBeNull();
        expect(glossOf("El")).toBeNull();
    });

    it("checks exact spellings across the lineage before joining-hyphen fallbacks", () => {
        const glossOf = pieceGlosses(
            { words: [{ form: "stone", gloss: "local word" }] },
            { elements: [{ form: "stone-", sense: "parent exact" }] },
        );
        expect(glossOf("stone")).toBe("local word");
        expect(glossOf("stone-")).toBe("parent exact");
        expect(glossOf("-stone-")).toBe("local word");
    });

    it("prints element senses in both SQL relations and the rendered dictionary body", async () => {
        const records = collectContentIndex(root, { contentPackage: "demo", skipDirectories: [] });
        const db = await openNotesDatabase(records);
        try {
            const expected = [
                { form: "rootword", gloss: "word wins" },
                { form: "-suffix", gloss: "affix wins" },
                { form: "-frontsuffix", gloss: "affix wins" },
                { form: "Reedlong", gloss: "river reed" },
                { form: "stone-", gloss: "old stone" },
                { form: "STONE", gloss: "old stone" },
                { form: "shared", gloss: "daughter element" },
            ];
            const words = await runSqlQuery(
                db,
                "SELECT built_parts FROM words WHERE form = 'reedstone'",
            );
            expect(words.rows[0].built_parts).toEqual(expected);
            const dictionary = await runSqlQuery(
                db,
                "SELECT * FROM dictionary WHERE name = 'reedstone' AND depth = 0",
            );
            expect(dictionary.rows[0].etymology.parts).toEqual(expected);
            const body = renderDictionary(dictionary);
            for (const gloss of new Set(expected.map((part) => part.gloss)))
                expect(body).toContain(gloss);
            expect(body).not.toMatch(
                /hidden element|hidden suffix|hidden affix|hidden front form|parent word/,
            );
        } finally {
            await db.close();
        }
    });
});
