/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { coreReport } from "../engine/core-report.mjs";
import { anchorsOf } from "../engine/foundry-entries.mjs";
import { buildPages, journalPageId, splitPages } from "../engine/journals.mjs";
import { collectAnchors } from "../engine/anchors.mjs";
import {
    DICTIONARY_COLUMNS,
    TERM_COLUMNS,
    dictionaryAndTermRows,
    dictionaryEntryAnchor,
    serializeRows,
} from "../engine/dictionary-rows.mjs";
import { renderDictionary, renderGlossary } from "../engine/dictionary-layout.mjs";
import { lexiconsFromRecords, serializeLexicon } from "../engine/encoding-lexicon.mjs";
import { writingsOf } from "../engine/language-writings.mjs";
import { wordRows, pieceGlosses } from "../engine/word-rows.mjs";
import { wordIdentity } from "../engine/word-classes.mjs";

const key = (name: string) => `demo-note-skill-${name}`;
const word = (form: string, wordClass: string, gloss: string, text = "α") => ({
    form,
    class: wordClass,
    gloss,
    field: "Words",
    native: [{ enc: "demo-note-doc-letters", text }],
});
const language = (shortcode: string, data: object) => ({
    package: "demo",
    system: "note",
    type: "skill",
    subType: "language",
    shortcode,
    name: { full: shortcode },
    data,
});
const parent = language("parent", {
    words: [
        word("read", "n", "an ancestor's reading"),
        word("read", "v", "understand writing", "β"),
        word("unique", "adj", "one of a kind"),
    ],
});
const child = {
    ...language("child", { family: key("parent"), words: [word("read", "n", "a reading")] }),
    citations: [{ form: "read", notes: ["demo-note-lore-book"] }],
};
const culture = {
    package: "demo",
    system: "note",
    type: "lore",
    subType: "culture",
    shortcode: "folk",
    name: { full: "Folk" },
    data: {
        glossary: [
            { name: "read", language: key("child") },
            { name: "unique", language: key("child") },
        ],
    },
};
const records = [parent, child, culture];
const config = {
    contentPackage: "demo",
    languages: { child: { tag: "art-x-child", note: key("child") } },
};

describe("class-qualified headwords", () => {
    it("normalizes the form and the complete class, including modifier order", () => {
        expect(wordIdentity("e\u0301", " n   f I ")).toBe(wordIdentity("é", "n I f"));
        expect(wordIdentity("read", "n")).not.toBe(wordIdentity("read", "v"));
        expect(wordIdentity("Read", "n")).not.toBe(wordIdentity("read", "n"));
    });

    it("serializes every class and inherits the nearest entry of each class", () => {
        const { dictionary } = dictionaryAndTermRows(records);
        const rows = dictionary.filter(
            (row) => row.language === key("child") && row.name === "read",
        );
        expect(rows.map((row) => [row.class, row.depth, row.senses[0].text])).toEqual([
            ["n", 0, "a reading"],
            ["v", 1, "understand writing"],
        ]);
        expect(JSON.parse(serializeRows(rows).trim().split("\n")[1]).class).toBe("v");
        expect(
            wordRows([parent])
                .filter((row) => row.form === "read")
                .map((row) => row.class),
        ).toEqual(["n", "v"]);
        const indexed = serializeLexicon(lexiconsFromRecords(records, config).get("child"));
        expect(
            indexed.data.words
                .filter((row) => row.form === "read")
                .map((row) => [row.class, row.gloss]),
        ).toEqual([
            ["n", "a reading"],
            ["v", "understand writing"],
        ]);
    });

    it("renders all meanings with distinct anchors and one spelling target", () => {
        const { dictionary, terms } = dictionaryAndTermRows(records);
        const rows = dictionary.filter((row) => row.language === key("child"));
        const body = renderDictionary({ columns: [...DICTIONARY_COLUMNS], rows });
        const anchors = collectAnchors(body).map((anchor) => anchor.slug);
        const bare = dictionaryEntryAnchor(key("child"), "read");
        expect(anchors.filter((anchor) => anchor === bare)).toHaveLength(1);
        for (const wordClass of ["n", "v"])
            expect(anchors).toContain(dictionaryEntryAnchor(key("child"), "read", wordClass));
        expect(new Set(anchors).size).toBe(anchors.length);
        const glossary = renderGlossary(
            { columns: [...TERM_COLUMNS], rows: terms },
            { pageLanguage: key("child") },
        );
        expect(glossary).toContain("A reading.");
        expect(glossary).toContain("Understand writing.");
        expect(glossary).toContain("_n._");
        expect(glossary).toContain("_v._");
        expect(terms.filter((row) => row.name === "read").map((row) => row.word)).toEqual([
            `${key("child")}#${bare}`,
            `${key("child")}#${bare}`,
        ]);
        const unique = `word-${createHash("sha256")
            .update(JSON.stringify([key("child"), "unique"]))
            .digest("hex")}`;
        expect(anchors).toContain(unique);
        expect(terms.find((row) => row.name === "unique")?.word).toBe(`${key("child")}#${unique}`);
    });

    it("sets a shared definition or title description once without assigning a class", () => {
        const defined = {
            ...culture,
            data: {
                glossary: [
                    { name: "read", language: key("child"), definition: "A shared definition." },
                    { name: "unique", language: key("child"), definition: "One definition." },
                ],
            },
        };
        const order = {
            package: "demo",
            system: "note",
            type: "affiliation",
            subType: "order",
            shortcode: "order",
            name: { full: "Order" },
            data: {
                lang: "child",
                glossary: [{ name: "read", language: key("child") }],
                governance: {
                    ranks: [{ level: 1, title: "read", description: "A rank." }],
                    offices: { read: "An office." },
                },
            },
        };
        const { terms } = dictionaryAndTermRows([parent, child, defined, order]);
        const rows = terms.filter((row) => row.name === "read");
        expect(rows).toHaveLength(2);
        for (const row of rows) {
            expect(row.class).toBeNull();
            expect(row.word).toBe(`${key("child")}#${dictionaryEntryAnchor(key("child"), "read")}`);
        }
        expect(
            rows.find((row) => row.owner.includes("folk"))?.senses.map((sense) => sense.text),
        ).toEqual(["A shared definition."]);
        expect(
            rows.find((row) => row.owner.includes("order"))?.senses.map((sense) => sense.text),
        ).toEqual(
            expect.arrayContaining(["A rank.", "An office.", "a reading", "understand writing"]),
        );
        expect(terms.find((row) => row.name === "unique")?.class).toBe("adj");
    });

    it("links an empty daughter's inherited homographs to one complete ancestor group", () => {
        const root = language("root", {
            words: [
                word("read", "v", "understand writing"),
                word("unique", "adj", "one of a kind"),
            ],
        });
        const middle = language("middle", {
            family: key("root"),
            words: [word("read", "n", "a reading")],
        });
        const empty = language("child", { family: key("middle"), words: [] });
        const all = [root, middle, empty, culture];
        const { dictionary, terms } = dictionaryAndTermRows(all);
        const group = dictionaryEntryAnchor(key("middle"), "read");
        expect(terms.filter((row) => row.name === "read").map((row) => row.word)).toEqual([
            `${key("middle")}#${group}`,
            `${key("middle")}#${group}`,
        ]);
        expect(terms.find((row) => row.name === "unique")?.word).toBe(
            `${key("root")}#${dictionaryEntryAnchor(key("root"), "unique")}`,
        );
        const body = `# Words {#dictionary}\n\n${renderDictionary({ columns: [...DICTIONARY_COLUMNS], rows: dictionary.filter((row) => row.language === key("middle")) })}`;
        expect(body).toContain("A reading.");
        expect(body).toContain("Understand writing.");
        const id = "abcdefghijklmnop";
        const uuid = `Compendium.demo.journals.JournalEntry.${id}`;
        const pages = splitPages(body, "Middle");
        const targets = anchorsOf(uuid, id, body, "Middle");
        const containing = `${uuid}.JournalEntryPage.${journalPageId(id, pages[0])}`;
        const html = buildPages(pages, id, "Middle")[0].text?.content ?? "";
        for (const wordClass of [undefined, "n", "v"]) {
            const anchor = dictionaryEntryAnchor(key("middle"), "read", wordClass);
            expect(targets[anchor]).toBe(`${containing}#${anchor}`);
            expect(html).toContain(`id="${anchor}"`);
        }
        const hidden = dictionaryAndTermRows([root, empty, culture], all).terms;
        expect(
            hidden.filter((row) => row.name === "read").map((row) => [row.class, row.word]),
        ).toEqual([["v", `${key("root")}#${dictionaryEntryAnchor(key("root"), "read")}`]]);
    });

    it("applies spelling citations to every matching class", () => {
        const source = { ...parent, citations: [{ form: "read", notes: ["demo-note-lore-book"] }] };
        const { dictionary } = dictionaryAndTermRows([source]);
        expect(dictionary.filter((row) => row.name === "read").map((row) => row.usage)).toEqual([
            ["demo-note-lore-book"],
            ["demo-note-lore-book"],
        ]);
    });

    it("counts inherited concepts per class without borrowing a shadowed meaning", () => {
        const ancestor = language("parent", {
            words: [
                { ...word("read", "v", "understand writing"), concept: "read-verb" },
                { ...word("read", "n", "an ancestor's reading"), concept: "read-noun" },
            ],
        });
        const concepts = {
            package: "demo",
            type: "doc",
            shortcode: "concepts",
            data: {
                concepts: [
                    { id: "read-verb", gloss: "understand writing", group: "Words" },
                    { id: "read-noun", gloss: "a reading", group: "Words" },
                ],
            },
        };
        const result = coreReport([ancestor, child, concepts], { language: "child" });
        expect(result.languages[0].covered).toBe(1);
        expect(result.languages[0].missing[0].concepts.map((entry) => entry.id)).toEqual([
            "read-noun",
        ]);
    });

    it.each(["é", "e\u0301"])("compares every NFC-equivalent native candidate for %s", (form) => {
        for (const agree of [false, true]) {
            const ancestor = language("parent", {
                words: [word("é", "v", "verb meaning", agree ? "α" : "β")],
            });
            const daughter = language("child", {
                family: key("parent"),
                words: [
                    word("e\u0301", "n", "noun meaning"),
                    word("É", "n", "capital meaning", "γ"),
                    { form: "built", class: "n", gloss: "built meaning", built: [form] },
                    { form: "joined", class: "n", gloss: "joined meaning", built: [`-${form}-`] },
                ],
            });
            const lexicon = lexiconsFromRecords([ancestor, daughter], config).get("child");
            const writing = writingsOf(lexicon.data, "demo-note-doc-letters", undefined);
            const ambiguous = (written) => ({
                ambiguous: { form: written, glosses: ["noun meaning", "verb meaning"] },
            });
            expect(writing.word(form)).toEqual(
                agree ? { text: "α", source: "own" } : ambiguous(form),
            );
            expect(writing.word("built")).toEqual(
                agree ? { text: "α", source: "parts" } : ambiguous(form),
            );
            expect(writing.word("joined")).toEqual(
                agree ? { text: "α", source: "parts" } : ambiguous(`-${form}-`),
            );
            expect(writing.word("É")).toEqual({ text: "γ", source: "own" });
        }
    });

    it("compares variants and affix pieces in NFC with their existing precedence", () => {
        const words = [
            { ...word("first", "n", "first meaning"), variants: ["e\u0301"] },
            { ...word("second", "v", "second meaning", "β"), variants: ["é"] },
            { form: "built", class: "n", gloss: "built meaning", built: ["é-"] },
        ];
        const affixes = [
            {
                form: "e\u0301-",
                gloss: "affix meaning",
                native: [{ enc: "demo-note-doc-letters", text: "γ" }],
            },
        ];
        const writing = writingsOf({ words, affixes }, "demo-note-doc-letters", undefined);
        for (const form of ["é", "e\u0301"])
            expect(writing.word(form)).toEqual({
                ambiguous: { form, glosses: ["first meaning", "second meaning"] },
            });
        expect(writing.word("built")).toEqual({ text: "γ", source: "parts" });
        const exact = writingsOf(
            { words: [...words, word("é", "n", "exact meaning", "δ")], affixes },
            "demo-note-doc-letters",
            undefined,
        );
        expect(exact.word("e\u0301")).toEqual({ text: "δ", source: "own" });
    });

    it("keeps native-writing ambiguity explicit across inherited classes", () => {
        const lexicon = lexiconsFromRecords(records, config).get("child");
        expect(writingsOf(lexicon.data, "demo-note-doc-letters", undefined).word("read")).toEqual({
            ambiguous: { form: "read", glosses: ["a reading", "understand writing"] },
        });
        expect(pieceGlosses(child.data, parent.data)("read")).toBe("a reading; understand writing");
    });
});
