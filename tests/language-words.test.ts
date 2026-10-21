/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A language note states its words in frontmatter**, and the lint holds every
 * row to the master word classes and to what the note itself declares. Each
 * wrong shape is one finding, located at the key at fault, read back from the
 * file so a column that drifts off the key fails here. A key the vocabulary
 * does not declare is refused by the ordinary frontmatter check, and the words
 * stay out of the compiled Item.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { collectContentIndex } from "../engine/content-index.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
import { WORD_KEYS } from "../engine/word-terms.mjs";
import { loadPackConfig } from "../engine/pack-config.mjs";
import { Items } from "../sohl/items.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const roots: string[] = [];
afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

const SUPPORT: Record<string, string> = {
    "Skills/Vedyari.md":
        "---\nshortcode: vedyarlng\nname: {full: Vedyari}\ntype: skill\nsubType: language\n---\nA tongue.\n",
    "Skills/Byzarian.md":
        "---\nshortcode: byzarlng\nname: {full: Byzarian}\ntype: skill\nsubType: language\n---\nA tongue.\n",
    "Lore/Osket.md":
        "---\nshortcode: osketclt\nname: {full: The Ösket}\ntype: lore\nsubType: culture\ndata:\n  language: skill-osketlng\n---\nA people.\n",
    "Lore/Vedyari.md":
        "---\nshortcode: vedclt\nname: {full: The Vedyari}\ntype: lore\nsubType: culture\ndata:\n  language: skill-vedyarlng\n---\nA people.\n",
    "Lore/Helonic.md":
        "---\nshortcode: helclt\nname: {full: The Helonites}\ntype: lore\nsubType: culture\ndata:\n  language: skill-helonclng\n---\nA people.\n",
    "Lore/Byzarian.md":
        "---\nshortcode: byzclt\nname: {full: The Byzarians}\ntype: lore\nsubType: culture\ndata:\n  language: skill-byzarlng\n---\nA people.\n",
    "Lore/Road.md":
        "---\nshortcode: road\nname: {full: The Road}\ntype: lore\nsubType: history\n---\nA road.\n",
};

/** A language note with every key its words are written in. */
const OSKET = [
    "---",
    "shortcode: osketlng",
    "name: {full: Ösket}",
    "type: skill",
    "subType: language",
    "data:",
    "  classModifiers: [f, m]",
    "  fields:",
    "    - {name: The road, holds: The crossings.}",
    "    - {name: The hearth, holds: The hearth and herd.}",
    "  affixes:",
    "    - {form: -wugh, gloss: cord, attaches: added, examples: [ghaukwugh]}",
    "  words:",
    "    - {form: ghauk, class: n f, field: The road, gloss: a road held by descent, pronunciation: GHAUK}",
    "    - {form: göich, name_sort: goich, class: n m, field: The hearth, gloss: the hearth, source: {kind: borrowed, language: skill-vedyarlng, form: göch}, tones: LH, root: g-ch, frame: plain}",
    "    - {form: ghaukwugh, class: n f, field: The road, gloss: the guide-cord, built: [ghauk, -wugh]}",
    "    - {form: pöich, class: n m, field: The hearth, gloss: the yak}",
    "  sounds:",
    "    frames:",
    "      - {frame: plain, shape: K1aK2, class: [n], makes: the thing itself}",
    "---",
    "",
    "The tongue of the high steppe.",
    "",
].join("\n");

/** A second language note, whose words hold no class modifier. */
const HELONIC = [
    "---",
    "shortcode: helonclng",
    "name: {full: Helonic}",
    "type: skill",
    "subType: language",
    "data:",
    "  fields:",
    "    - {name: Sea, holds: The sea.}",
    "  words:",
    "    - {form: thalass, class: n, field: Sea, gloss: the sea}",
    "    - {form: kyma, class: n, field: Sea, gloss: a wave}",
    "---",
    "",
    "The old tongue of the coast.",
    "",
].join("\n");

/** Lint a tree holding the support notes and the given notes. */
function lint(notes: Record<string, string>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "language-words-"));
    roots.push(root);
    for (const [rel, text] of Object.entries({ ...SUPPORT, ...notes })) {
        const file = path.join(root, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    }
    const problems: any[] = [];
    const records = collectContentIndex(root, {
        contentPackage: "sohl",
        skipDirectories: [],
        problems,
    });
    const index = buildLinkIndex(root, { records, skipDirectories: [] });
    const findings = [
        ...problems,
        ...lintFrontmatter(index, { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY }).findings,
    ];
    const files = new Set(Object.keys(notes).map((rel) => path.join(root, rel)));
    return {
        findings: findings.filter((finding) => files.has(finding.file)),
        all: findings,
    };
}

/** The findings on the Ösket language note written as `text`. */
const osket = (text: string) => lint({ "Skills/Osket.md": text, "Skills/Helonic.md": HELONIC });

/** The text at a finding's position, read from the note it was raised on. */
function at(text: string, finding: { line?: number; column?: number }) {
    expect(finding.line, "a finding is located on its line").toBeTypeOf("number");
    expect(finding.column, "a finding is located on its column").toBeTypeOf("number");
    return text.split("\n")[finding.line! - 1].slice(finding.column! - 1);
}

/** Exactly one finding, of the given severity, saying `message`, located at `where`. */
function one(text: string, message: RegExp, where: string, severity = "error") {
    const { findings } = osket(text);
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding.severity).toBe(severity);
    expect(finding.message).toMatch(message);
    expect(at(text, finding).startsWith(where), `located at ${where}`).toBe(true);
}

describe("a language note's words", () => {
    it("are declared on skill", () => {
        const names = dataFields("skill").map((field: { name: string }) => field.name);
        for (const name of ["classModifiers", "fields", "words", "affixes"])
            expect(names).toContain(name);
    });

    it("declares every word key the reference names", () => {
        expect(WORD_KEYS).toEqual([
            "form",
            "variants",
            "name_sort",
            "class",
            "plural",
            "field",
            "gloss",
            "concept",
            "source",
            "built",
            "note",
            "pronunciation",
            "tones",
            "root",
            "frame",
            "native",
        ]);
    });

    it("accept a tone on an affix, and refuse one that is not a string", () => {
        expect(
            osket(OSKET.replace("examples: [ghaukwugh]}", "examples: [ghaukwugh], tones: L}"))
                .findings,
        ).toEqual([]);
        const text = OSKET.replace("examples: [ghaukwugh]}", "examples: [ghaukwugh], tones: [L]}");
        const findings = osket(text).findings;
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toMatch(/`data\.affixes\[0\]\.tones` should be a tone pattern/);
        expect(at(text, findings[0]).startsWith("[L]")).toBe(true);
    });

    it("never reach the compiled Item, which takes only the `sohl` block", () => {
        const config = loadPackConfig();
        const compiler = new Items({
            skipDirectories: [],
            contentBase: path.join(os.tmpdir()),
            dest: config.paths.packJson,
        });
        const entry = compiler.buildEntry(
            {
                id: "LLLLLLLLLLLLLLLL",
                type: "skill",
                subType: "language",
                shortcode: "osketlng",
                name: { full: "Ösket" },
                data: {
                    classModifiers: ["f"],
                    fields: [{ name: "The road", holds: "The crossings." }],
                    words: [{ form: "ghauk", class: "n f", field: "The road", gloss: "a road" }],
                    affixes: [{ form: "-wugh", gloss: "cord" }],
                },
                sohl: { subType: "language", templatePriority: 0 },
            },
            "",
        );
        const text = JSON.stringify(entry);
        for (const needle of ["classModifiers", "The crossings", "ghauk", "-wugh", "a road"])
            expect(text, needle).not.toContain(needle);
    });
});

describe("the ordinary frontmatter check", () => {
    it("refuses a data key no type declares, on a language note", () => {
        const text = OSKET.replace(
            "  fields:\n",
            "  lexicon:\n    - {tag: byzarian, language: skill-byzarlng}\n  fields:\n",
        );
        const { findings } = osket(text);
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].message).toMatch(/lexicon/);
        expect(at(text, findings[0]).startsWith("lexicon")).toBe(true);
    });

    it("refuses a word key the word does not declare", () => {
        const text = OSKET.replace("gloss: the yak}", "gloss: the yak, tongue: byzarian}");
        const { findings } = osket(text);
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].message).toMatch(/"tongue" is not a key/);
        expect(at(text, findings[0]).startsWith("tongue")).toBe(true);
    });

    it("refuses a doc subType outside the genres, and the word keys on a doc", () => {
        const text = OSKET.replace("type: skill", "type: doc")
            .replace("subType: language", "subType: lexicon")
            .replace("data:\n", "data:\n  language: skill-osketlng\n");
        const { findings } = osket(text);
        const keys = findings.map((finding: any) => at(text, finding).split(/[:\s]/)[0]);
        for (const key of ["subType", "language", "classModifiers", "fields", "affixes", "words"])
            expect(keys, key).toContain(key);
        expect(findings.map((finding: any) => finding.message).join("\n")).toMatch(
            /"lexicon" is not one of the subtypes doc declares/,
        );
        for (const finding of findings) expect(finding.severity).toBe("error");
    });
});

describe("a language note's words, checked", () => {
    it("lints clean with every key", () => {
        expect(osket(OSKET).findings).toEqual([]);
    });

    it("refuses an unknown word key at the key", () => {
        one(
            OSKET.replace("gloss: the hearth,", "gloss: the hearth, colour: red,"),
            /"colour" is not a key/,
            "colour:",
        );
    });

    it("requires each word's form, class, field and gloss", () => {
        for (const key of [
            "form: göich, ",
            "class: n m, ",
            "field: The hearth, ",
            "gloss: the hearth, ",
        ]) {
            const text = OSKET.replace(key, "");
            const { findings } = osket(text);
            expect(findings, key).toHaveLength(1);
            expect(findings[0].message).toMatch(new RegExp(`must state \`${key.split(":")[0]}\``));
            expect(findings[0].line).toBe(15);
        }
    });

    it("refuses a class base outside the master set", () => {
        one(
            OSKET.replace("class: n f,", "class: noun f,"),
            /`noun` is not a word class base/,
            "noun f",
        );
    });

    it("refuses a modifier outside the master set", () => {
        one(
            OSKET.replace("class: n f,", "class: n zz,"),
            /`zz` is not a word class modifier/,
            "n zz",
        );
    });

    it("refuses a modifier the note does not declare", () => {
        one(
            OSKET.replace("class: n m,", "class: n an,"),
            /`an`.*not declared in `data\.classModifiers`/,
            "n an",
        );
    });

    it("refuses an unknown token in classModifiers at the token", () => {
        one(
            OSKET.replace("classModifiers: [f, m]", "classModifiers: [f, m, zz]"),
            /should be/,
            "zz]",
        );
    });

    it("warns of a declared modifier no word uses, at the modifier", () => {
        one(
            OSKET.replace("classModifiers: [f, m]", "classModifiers: [f, m, n]"),
            /`n`.*no word uses/,
            "n]",
            "warning",
        );
    });

    it("refuses a field the note does not name", () => {
        one(
            OSKET.replace("field: The road, gloss: a road", "field: Nowhere, gloss: a road"),
            /`Nowhere`.*data\.fields/,
            "Nowhere",
        );
    });

    it("refuses a borrowed word that names no source language", () => {
        one(
            OSKET.replace("language: skill-vedyarlng, form: göch", "form: göch"),
            /borrowed.*`language`/,
            "{kind: borrowed",
        );
    });

    it("refuses a source kind outside the closed set", () => {
        one(OSKET.replace("kind: borrowed", "kind: stolen"), /should be/, "stolen");
    });

    it("refuses a source language that names nothing", () => {
        one(
            OSKET.replace("language: skill-vedyarlng", "language: skill-nowhere"),
            /does not resolve/,
            "skill-nowhere",
        );
    });

    it("refuses a form standing twice in one language, at the second", () => {
        const text = OSKET.replace(
            "    - {form: ghaukwugh,",
            "    - {form: ghauk, class: n, field: The road, gloss: again}\n    - {form: ghaukwugh,",
        );
        const { findings } = osket(text);
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toMatch(/`ghauk` stands twice/);
        expect(findings[0].line).toBe(16);
        expect(at(text, findings[0]).startsWith("ghauk")).toBe(true);
    });

    it("keeps one form in two languages apart", () => {
        const text = HELONIC.replace("form: kyma", "form: ghauk");
        expect(lint({ "Skills/Osket.md": OSKET, "Skills/Helonic.md": text }).findings).toEqual([]);
    });

    it("refuses an authored attested key, which the index derives from prose", () => {
        one(
            OSKET.replace("pronunciation: GHAUK}", "pronunciation: GHAUK, attested: [lore-road]}"),
            /"attested" is not a key of `data\.words\[0\]`/,
            "attested",
        );
    });

    it("accepts a gloss of several senses, variants and a note", () => {
        const text = OSKET.replace(
            "gloss: the yak}",
            "gloss: [the yak, a herd of them], variants: [pöichu], note: a cognate of the Vedyari}",
        );
        expect(osket(text).findings).toEqual([]);
    });

    it("refuses a gloss list with no sense, at the gloss", () => {
        one(OSKET.replace("gloss: the yak}", "gloss: []}"), /at least one sense/, "[]");
    });

    it("refuses a sense that is not a string, at the sense", () => {
        one(
            OSKET.replace("gloss: the yak}", "gloss: [the yak, {a: b}]}"),
            /`data\.words\[3\]\.gloss\[1\]` should be a sense/,
            "{a: b}",
        );
    });

    it("refuses a frame its language's `sounds.frames` does not name, at the frame", () => {
        one(
            OSKET.replace("frame: plain}", "frame: crooked}"),
            /the frame `crooked` of `göich` is not one of this language's `data\.sounds\.frames`/,
            "crooked",
        );
    });

    it("refuses a frame on a word of a language stating no frames, at the frame", () => {
        const text = OSKET.replace(
            "  sounds:\n    frames:\n      - {frame: plain, shape: K1aK2, class: [n], makes: the thing itself}\n",
            "",
        );
        one(text, /the frame `plain` of `göich` is not one of this language's/, "plain");
    });

    it("accepts an affix that lengthens the stem's last vowel", () => {
        const text = OSKET.replace(
            "examples: [ghaukwugh]}",
            "examples: [ghaukwugh], lengthens: true}",
        );
        expect(osket(text).findings).toEqual([]);
    });

    it("refuses a lengthens that is not true or false, at the value", () => {
        one(
            OSKET.replace(
                "examples: [ghaukwugh]}",
                "examples: [ghaukwugh], lengthens: yes please}",
            ),
            /`data\.affixes\[0\]\.lengthens` should be `true` or `false`/,
            "yes please",
        );
    });

    it("refuses an affix that both lengthens and replaces the stem's close, at lengthens", () => {
        one(
            OSKET.replace(
                "examples: [ghaukwugh]}",
                "examples: [ghaukwugh], replaces: vowel, lengthens: true}",
            ),
            /an affix that replaces the stem's close does not also lengthen its last vowel/,
            "lengthens",
        );
    });

    it("refuses a pronunciation that is not a respelling", () => {
        one(OSKET.replace("pronunciation: GHAUK", "pronunciation: GHA-UK"), /respelling/, "GHA-UK");
        one(OSKET.replace("pronunciation: GHAUK", "pronunciation: ghauk!"), /respelling/, "ghauk!");
    });

    it("warns of a built piece no word, affix or element glosses", () => {
        one(
            OSKET.replace("built: [ghauk, -wugh]", "built: [ghauk, -zz]"),
            /`-zz`.*no word, affix or element/,
            "-zz",
            "warning",
        );
    });

    it("refuses the word keys on a skill of another subType, each at its key", () => {
        const text = OSKET.replace("subType: language", "subType: lore");
        const findings = [...osket(text).findings].sort((a: any, b: any) => a.line - b.line);
        expect(findings.map((finding: any) => at(text, finding).split(":")[0])).toEqual([
            "classModifiers",
            "fields",
            "affixes",
            "words",
            "sounds",
        ]);
        for (const finding of findings) expect(finding.severity).toBe("error");
    });
});
