/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A daughter language resolves a word's built pieces through its lineage**:
 * its own words and affixes first, then each ancestor's in `data.family`
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
    ]),
    "Skills/Daughter.md": language("daughterlng", [
        "family: skill-parentlng",
        "fields:",
        "  - {name: Sea, holds: The sea.}",
        "affixes:",
        "  - {form: -oo, gloss: daughter sense}",
        "words:",
        "  - {form: thalassei, class: n, field: Sea, gloss: a pool, built: [thalass, -ei, -oo, -zz]}",
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
            .filter((message) => /matches no word or affix/.test(message));
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
