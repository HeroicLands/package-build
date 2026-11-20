/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE.md file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import YAML from "yaml";

const { notePath } = await import(pathToFileURL(path.resolve("utils/note-index.mjs")).href);
const file = notePath("skill-aelwthlng");
const replacements = [
    ["sea", "sii", "n"],
    ["right", "rait", "adj"],
    ["due", "duu", "adj"],
];
const expected = [
    [
        "sii",
        [
            ["n", "sea"],
            ["v", "to see"],
        ],
    ],
    [
        "rait",
        [
            ["adj", "correct; free from error"],
            ["adj", "morally acceptable"],
            ["v", "mark words or letters on a surface"],
        ],
    ],
    [
        "duu",
        [
            ["adj", "owed or required"],
            ["v", "to do"],
        ],
    ],
];

if (process.argv[2] === "prepare") {
    const source = fs.readFileSync(file, "utf8");
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n)/);
    assert.ok(match, `${file}: expected frontmatter`);
    const document = YAML.parseDocument(match[1]);
    assert.equal(document.errors.length, 0);
    const entries = document.getIn(["data", "words"], true).items;
    for (const [old, form, wordClass] of replacements) {
        const hits = entries.filter(
            (entry) => entry.get("form") === old && entry.get("class") === wordClass,
        );
        assert.equal(hits.length, 1, old);
        hits[0].set("form", form);
    }
    fs.writeFileSync(
        file,
        `---\n${document.toString()}---${match[2]}${source.slice(match[0].length)}`,
    );
    console.log("Prepared the three disposable headword replacements.");
} else if (process.argv[2] === "verify") {
    const { DICTIONARY_COLUMNS, dictionaryEntryAnchor } =
        await import("@heroiclands/package-build/engine/dictionary-rows");
    const { renderDictionary } =
        await import("@heroiclands/package-build/engine/dictionary-layout");
    const rows = fs
        .readFileSync("build/content-index/thalorna-dictionary.jsonl", "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse);
    const language = "thalorna-note-skill-aelwthlng";
    for (const [form, senses] of expected) {
        const matching = rows.filter(
            (row) => row.language === language && row.name === form && row.depth === 0,
        );
        assert.deepEqual(matching.map((row) => row.class).sort(), [senses[0][0], "v"].sort(), form);
        for (const [wordClass, text] of senses) {
            const row = matching.find((entry) => entry.class === wordClass);
            assert.ok(
                row.senses.some((sense) => sense.text === text),
                `${form}: ${wordClass} ${text}`,
            );
        }
        const rendered = renderDictionary({ columns: [...DICTIONARY_COLUMNS], rows: matching });
        for (const wordClass of [undefined, senses[0][0], "v"])
            assert.ok(
                rendered.includes(dictionaryEntryAnchor(language, form, wordClass)),
                `${form}: anchor ${wordClass}`,
            );
        for (const [, text] of senses) assert.ok(rendered.includes(text), `${form}: ${text}`);
    }
    console.log(
        "All three spellings retain their classes and meanings in the dictionary and its rendering.",
    );
} else {
    throw new Error("Expected prepare or verify");
}
