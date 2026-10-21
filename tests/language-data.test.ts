/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A language note states its register, tongues, retired forms, scope,
 * sounds, sound changes, elements, roots and cognates in frontmatter**, and
 * the lint holds each entry to its shape and to what it names. Every wrong
 * entry is one finding, located at the key at fault and read back from the
 * file.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { collectContentIndex } from "../engine/content-index.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
import { EDGE_KINDS, ELEMENT_POSITIONS, LANGUAGE_DATA_KEYS } from "../engine/language-terms.mjs";
import { tongueDeclared } from "../engine/language-data.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const roots: string[] = [];
afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

const SUPPORT: Record<string, string> = {
    "Skills/Sovidur.md":
        "---\nshortcode: sovidurlng\nname: {full: Sovidur}\ntype: skill\nsubType: language\n---\nA tongue.\n",
    "Skills/Vylari.md": [
        "---",
        "shortcode: vylarilng",
        "name: {full: Vylari}",
        "type: skill",
        "subType: language",
        "data:",
        "  tongues:",
        "    - {tag: vylari, meaning: a Vylari name, language: skill-vylarilng}",
        "  register:",
        "    - {name: Dunhara, tongue: vylari}",
        "    - {name: The Sands, tongue: translation}",
        "---",
        "A tongue.",
        "",
    ].join("\n"),
    "Skills/Riding.md":
        "---\nshortcode: riding\nname: {full: Riding}\ntype: skill\nsubType: physical\n---\nA skill.\n",
    "Lore/Dunhari.md":
        "---\nshortcode: dunhariclt\nname: {full: The Dunhari}\ntype: lore\nsubType: culture\ndata:\n  language: skill-dunharlng\n---\nA people.\n",
    "Places/Dunhara.md":
        "---\nshortcode: dunharargn\nname: {full: Dunhara}\ntype: place\nsubType: region\n---\nA desert.\n",
    "Folders/Dunhara.md":
        "---\nshortcode: dunhara\nname: {full: Dunhara}\ntype: folder\ndata:\n  parent: lore\n---\nThe Dunhara.\n",
};

/** A language note stating every key of its register, sounds and history, each entry well formed. */
const DUNHARI = [
    "---",
    "shortcode: dunharlng",
    "name: {full: Dunhari}",
    "type: skill",
    "subType: language",
    "data:",
    "  tongues:",
    "    - {tag: dunhari, meaning: a Dunhari name}",
    "    - {tag: sovidur, meaning: a Sovidur name, language: skill-sovidurlng}",
    '    - {tag: "exonym:<tongue>", meaning: "a name another people gives, in the tongue named"}',
    "  register:",
    "    - {name: Belgogâr, tongue: dunhari, built: [belg-, -ogâr]}",
    "    - {name: Bondsman, tongue: translation}",
    '    - {name: Aldous, kind: given, why: "a short name no element builds"}',
    "    - {name: Dunhara, tongue: exonym:vylari}",
    "  retired:",
    "    - {form: Qadi, instead: Vazhmadêr, why: an Earth word}",
    "    - {form: Khalid, instead: [Kheldûn, Bezdûn], why: an Earth given name}",
    "    - {form: Morwenna, why: an Earth name}",
    "  scope:",
    "    folders: [dunhara]",
    "    cultures: [dunhariclt]",
    "    lore: [dunhariclt]",
    "    parents: [dunharargn]",
    "    addresses: [lore-dunhariclt, skill-dunharlng]",
    "    paths: [Places/]",
    "    types: [place, being]",
    "    skip: [place-dunharargn]",
    "  sounds:",
    "    letters:",
    "      - {letters: [p, b, t, d], kind: consonant, like: the plain stops}",
    "      - {letters: [â, ê], kind: long vowel, like: father and fête, tongue: dunhari}",
    "      - {letters: [q], kind: consonant, like: a k far back, tongue: [dunhari, sovidur]}",
    "    edges:",
    "      - {edge: closeConsonant, sounds: [n, r, d]}",
    "      - {edge: closeCluster, sounds: [nd, rd]}",
    "      - {edge: vowelPair, sounds: [ai, au]}",
    "      - {edge: openCluster, sounds: []}",
    "      - {edge: syllabic, sounds: any}",
    "    clusters: {max: 2}",
    "    stress: penultimate or final",
    "    finals:",
    '      - {final: ang, like: "the a of father, then ng"}',
    "    syllables:",
    "      onsets: single",
    "      codas: [b, d, sh]",
    "      finals: any",
    "      doubled: []",
    "      vowelPairs: [aa, ee]",
    "      initialVowel: true",
    "      finalVowel: false",
    "      neverInitial: [r]",
    "      signature: [q, gh]",
    "      harmony: {back: [a, o, u], front: [e, ö, ü], neutral: [i], neutralAs: front}",
    "    joining:",
    '      - {first: [a, â], second: [a, â], written: â, example: "méga + andáhr = mégândáhr"}',
    "      - {first: [i], second: [a, u], written: y+}",
    "    joins:",
    "      - {meeting: V+V, rule: insert, letters: [y]}",
    "      - {meeting: V+C, rule: double, letters: [p, t], where: between stems}",
    "    marks:",
    "      - {mark: acute, letters: [á, é], kind: stress, limit: one}",
    "      - {mark: macron, letters: [ā, ē], kind: length, limit: any}",
    "    skeleton:",
    '      - {second: [l, r, m], between: ""}',
    "      - {second: any, between: a}",
    "    frames:",
    "      - {frame: bare, shape: K1aK2K3, class: [n], makes: the thing itself, examples: {d-l-k: dalk}}",
    "      - {frame: deed, shape: K1uK2áK3, class: [v, n], makes: the doing of it}",
    "    readPast:",
    '      - {written: á, readAs: a, what: "the acute, a stress mark"}',
    '      - {written: "\'", what: the seam between two stems}',
    "  soundChanges:",
    "    - name: From Dunhari to Sovidur",
    "      from: skill-dunharlng",
    "      to: skill-sovidurlng",
    "      steps:",
    '        - {step: A1, change: "`p ph` > `—`", where: anywhere}',
    '        - {step: A2, change: "like vowels merge, long"}',
    "    - name: Sovidur loans",
    "      steps:",
    '        - {step: A1, change: "`q` > `k`"}',
    "  elements:",
    "    - {form: ald-, variants: [aldr-, aldar-], position: opening, sense: an age}",
    "    - {form: arn-, position: opening, sense: an eagle, examples: [Arnthúl, Arnhelm]}",
    "    - {form: s, position: link, sense: of}",
    "    - {form: áel, sense: first light}",
    "  roots:",
    "    - {root: d-l-k, sense: stone, field: stone}",
    "    - {root: r-m-k, sense: to lay a course}",
    "  cognates:",
    "    - {forms: {skill-dunharlng: zevr, skill-sovidurlng: zever}, proto: zevrâ, gloss: wind}",
    "  callingNames:",
    "    minSyllables: 4",
    "    closings:",
    "      - {form: -u, usual: man}",
    "      - {doubled: true, usual: either}",
    "---",
    "",
    "The poetic tongue of the desert.",
    "",
].join("\n");

/** Lint a tree holding the support notes and the given notes. */
function lint(notes: Record<string, string>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "language-data-"));
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
    return findings.filter((finding) => files.has(finding.file));
}

/** The findings on the Dunhari language note written as `text`. */
const dunhari = (text: string) => lint({ "Skills/Dunhari.md": text });

/** The text at a finding's position, read from the note it was raised on. */
function at(text: string, finding: { line?: number; column?: number }) {
    expect(finding.line, "a finding is located on its line").toBeTypeOf("number");
    expect(finding.column, "a finding is located on its column").toBeTypeOf("number");
    return text.split("\n")[finding.line! - 1].slice(finding.column! - 1);
}

/** Exactly one finding, of the given severity, saying `message`, located at `where`. */
function one(text: string, message: RegExp, where: string, severity = "error") {
    const findings = dunhari(text);
    expect(findings, JSON.stringify(findings)).toHaveLength(1);
    const [finding] = findings;
    expect(finding.severity).toBe(severity);
    expect(finding.message).toMatch(message);
    expect(at(text, finding).startsWith(where), `located at ${where}`).toBe(true);
}

/** `DUNHARI` with one line replaced, the replacement required to apply. */
function edit(from: string, to: string) {
    expect(DUNHARI, `the note holds ${from}`).toContain(from);
    return DUNHARI.replace(from, to);
}

describe("a language note's register, sounds and history", () => {
    it("are declared on skill", () => {
        const names = dataFields("skill").map((field: { name: string }) => field.name);
        for (const name of LANGUAGE_DATA_KEYS) expect(names).toContain(name);
    });

    it("close their vocabularies to the labels the setting's tables use", () => {
        expect(EDGE_KINDS).toEqual([
            "openConsonant",
            "openCluster",
            "closeConsonant",
            "closeCluster",
            "innerCluster",
            "vowelPair",
            "glide",
            "syllabic",
        ]);
        expect(ELEMENT_POSITIONS).toEqual(["opening", "closing", "either", "link"]);
    });

    it("accept every key, each entry well formed", () => {
        expect(dunhari(DUNHARI)).toEqual([]);
    });

    it("refuse each key on a skill of another subType, at the key", () => {
        const text = DUNHARI.replace("subType: language", "subType: lore");
        const findings = [...dunhari(text)].sort((a: any, b: any) => a.line - b.line);
        expect(findings.map((finding: any) => at(text, finding).split(":")[0])).toEqual(
            LANGUAGE_DATA_KEYS.filter((key) => new RegExp(`^  ${key}:`, "m").test(text)),
        );
        for (const finding of findings) expect(finding.severity).toBe("error");
    });
});

describe("tongues", () => {
    it("refuse a tag of the wrong shape, at the tag", () => {
        const text = edit(
            "    - {tag: dunhari, meaning: a Dunhari name}",
            "    - {tag: dunhari, meaning: a Dunhari name}\n    - {tag: Ashaian, meaning: a faith's name}",
        );
        one(text, /the tag `Ashaian` is not lowercase/, "Ashaian");
    });

    it("refuse a tag stated twice, at the second", () => {
        const text = edit(
            "    - {tag: dunhari, meaning: a Dunhari name}",
            "    - {tag: dunhari, meaning: a Dunhari name}\n    - {tag: dunhari, meaning: again}",
        );
        one(
            text,
            /`dunhari` stands twice, first at `data\.tongues\[0\]`/,
            "dunhari, meaning: again",
        );
    });

    it("refuse a language that is no language note, at the value", () => {
        one(
            edit("language: skill-sovidurlng}", "language: skill-riding}"),
            /names sohl-note-skill-riding, which is not a skill whose subType is language/,
            "skill-riding",
        );
    });

    it("refuse an unknown key in an entry, at the key", () => {
        one(
            edit(
                "{tag: dunhari, meaning: a Dunhari name}",
                "{tag: dunhari, meaning: a Dunhari name, note: x}",
            ),
            /"note" is not a key of `data\.tongues\[0\]`/,
            "note",
        );
    });

    it("declare a family of tags by closing on `:<tongue>`", () => {
        const declared = new Set(["dunhari", "exonym:<tongue>", "other"]);
        expect(tongueDeclared("dunhari", declared)).toBe(true);
        expect(tongueDeclared("translation", declared)).toBe(true);
        expect(tongueDeclared("exonym:vylari", declared)).toBe(true);
        expect(tongueDeclared("exonym", declared)).toBe(false);
        expect(tongueDeclared("other:vylari", declared)).toBe(false);
        expect(tongueDeclared("ashaian", declared)).toBe(false);
    });
});

describe("a register row in another tongue", () => {
    /** `DUNHARI` declaring the tags these tests use, its `exonym:vylari` row replaced by `row`. */
    const foreign = (row: string) =>
        edit(
            '    - {tag: "exonym:<tongue>", meaning: "a name another people gives, in the tongue named"}',
            [
                '    - {tag: "exonym:<tongue>", meaning: "a name another people gives, in the tongue named"}',
                '    - {tag: "other:<tongue>", meaning: "a name in another tongue of the setting"}',
                "    - {tag: other, meaning: a name in no tongue these pages name}",
                "    - {tag: kept, meaning: a loanword kept in its source spelling}",
                "    - {tag: ancient, meaning: a name of the old tongue}",
            ].join("\n"),
        ).replace("    - {name: Dunhara, tongue: exonym:vylari}", row);

    it("passes a name the tongue's own register lists under that tongue, case folded", () => {
        expect(dunhari(foreign("    - {name: Dunhara, tongue: exonym:vylari}"))).toEqual([]);
        expect(dunhari(foreign("    - {name: dunhara, tongue: other:vylari}"))).toEqual([]);
    });

    it("refuses a name the tongue's register does not list, at the name", () => {
        one(
            foreign("    - {name: Dunharra, tongue: other:vylari}"),
            /^`Dunharra` is registered as `other:vylari`, but the register of Vylari \(skill-vylarilng\) lists no `vylari` name `Dunharra`; correct the spelling, or register the name there first$/,
            "Dunharra",
            "error",
        );
    });

    it("refuses a name the tongue's register lists only under another tongue", () => {
        one(
            foreign("    - {name: The Sands, tongue: exonym:vylari}"),
            /lists no `vylari` name `The Sands`/,
            "The Sands",
            "error",
        );
    });

    it("refuses a tongue no tongue declaration links to a language note, at the tongue", () => {
        one(
            foreign("    - {name: Dunhara, tongue: exonym:nordmal}"),
            /^the tongue `nordmal` in `exonym:nordmal` names no language note: no language note's `data\.tongues` tags `nordmal` with a `language`$/,
            "exonym:nordmal",
            "error",
        );
    });

    it("does not check bare `other`, `kept`, `ancient` or `translation`", () => {
        for (const tongue of ["other", "kept", "ancient", "translation"])
            expect(dunhari(foreign(`    - {name: Qazzurath, tongue: ${tongue}}`)), tongue).toEqual(
                [],
            );
    });
});

describe("the register", () => {
    it("refuses a tongue `data.tongues` does not declare, at the tongue", () => {
        one(
            edit("{name: Bondsman, tongue: translation}", "{name: Bondsman, tongue: ashaian}"),
            /the tongue `ashaian` is not declared in `data\.tongues`/,
            "ashaian",
        );
    });

    it("refuses a qualified tag whose family is not declared, at the tongue", () => {
        one(
            edit("tongue: exonym:vylari}", "tongue: other:vylari}"),
            /the tongue `other:vylari` is not declared/,
            "other:vylari",
        );
    });

    it("refuses a row with neither a tongue nor a kind, at the row", () => {
        one(
            edit("{name: Bondsman, tongue: translation}", "{name: Bondsman}"),
            /`data\.register\[1\]` states neither a `tongue` nor a `kind`/,
            "{name: Bondsman}",
        );
    });

    it("refuses a kind outside the closed list, at the value", () => {
        one(
            edit("kind: given,", "kind: clan,"),
            /`data\.register\[2\]\.kind` should be `byname` or `given` or `place`/,
            "clan",
        );
    });

    it("refuses built pieces that are not a list, at the value", () => {
        one(
            edit("built: [belg-, -ogâr]}", "built: belg- + -ogâr}"),
            /`data\.register\[0\]\.built` should be a list of pieces/,
            "belg- + -ogâr",
        );
    });
});

describe("retired forms", () => {
    it("refuse a row with no reason, at the row", () => {
        one(
            edit("{form: Morwenna, why: an Earth name}", "{form: Morwenna}"),
            /`data\.retired\[2\]` must state `why`/,
            "{form: Morwenna}",
        );
    });

    it("refuse an instead that is neither a form nor a list of them, at the value", () => {
        one(
            edit("instead: Vazhmadêr,", "instead: {a: b},"),
            /`data\.retired\[0\]\.instead` should be a string, or a list of them/,
            "{a: b}",
        );
    });
});

describe("the scope", () => {
    it("refuses a kind it does not declare, at the key", () => {
        one(
            edit("    paths: [Places/]", "    path: [Places/]"),
            /"path" is not a key of `data\.scope`.*Did you mean "paths"\?/,
            "path",
        );
    });

    it("refuses an Address that resolves to nothing, at the value", () => {
        one(
            edit(
                "addresses: [lore-dunhariclt, skill-dunharlng]",
                "addresses: [lore-dunhariclt, lore-nowhere]",
            ),
            /`data\.scope\.addresses\[1\]` names sohl-note-lore-nowhere, which does not resolve/,
            "lore-nowhere",
        );
    });

    it("refuses a type that is no note type, at the value", () => {
        one(
            edit("types: [place, being]", "types: [place, person]"),
            /`person` is not a note type/,
            "person",
        );
    });
});

describe("the sounds", () => {
    it("refuse an edge outside the closed list, naming the nearest", () => {
        one(
            edit("{edge: vowelPair,", "{edge: vowelPairs,"),
            /`data\.sounds\.edges\[2\]\.edge` should be `openConsonant` or .*Did you mean "vowelPair"\?/,
            "vowelPairs",
        );
    });

    it("refuse an edge stated twice, at the second", () => {
        one(
            edit("{edge: closeCluster,", "{edge: closeConsonant,"),
            /the edge `closeConsonant` stands twice/,
            "closeConsonant, sounds: [nd",
        );
    });

    it("refuse a single word for sounds other than `any`, at the value", () => {
        one(
            edit("sounds: any}", "sounds: all}"),
            /`data\.sounds\.edges\[4\]\.sounds` should be `any`, but reads "all"/,
            "all",
        );
    });

    it("refuse a cluster limit that is not a whole number, at the value", () => {
        one(
            edit("clusters: {max: 2}", "clusters: {max: two}"),
            /`data\.sounds\.clusters\.max` should be a whole number/,
            "two",
        );
    });

    it("refuse a letter's tongue `data.tongues` does not declare, at the tag", () => {
        one(
            edit("tongue: [dunhari, sovidur]}", "tongue: [dunhari, khazri]}"),
            /the tongue `khazri` is not declared/,
            "khazri",
        );
    });

    it("refuse a spelling read past with nothing said of it, at the row", () => {
        one(
            edit(
                '{written: á, readAs: a, what: "the acute, a stress mark"}',
                "{written: á, readAs: a}",
            ),
            /`data\.sounds\.readPast\[0\]` must state `what`/,
            "{written: á",
        );
    });

    it("refuse a key the sounds do not declare, at the key", () => {
        one(
            edit("    clusters: {max: 2}", "    clusters: {max: 2}\n    tones: level"),
            /"tones" is not a key of `data\.sounds`/,
            "tones",
        );
    });
});

describe("sound changes, elements and roots", () => {
    it("refuse a step written as a number, at the value", () => {
        one(
            edit("{step: A2,", "{step: 1,"),
            /`data\.soundChanges\[0\]\.steps\[1\]\.step` should be a string/,
            "1,",
        );
    });

    it("refuse an element position outside the closed list, at the value", () => {
        one(
            edit("position: link,", "position: middle,"),
            /`data\.elements\[2\]\.position` should be `opening` or `closing` or `either` or `link`/,
            "middle",
        );
    });

    it("refuse a root with no sense, at the row", () => {
        one(
            edit("{root: r-m-k, sense: to lay a course}", "{root: r-m-k}"),
            /`data\.roots\[1\]` must state `sense`/,
            "{root: r-m-k}",
        );
    });
});

describe("cognates", () => {
    it("refuse a form whose language is no language note, at its key", () => {
        one(
            edit("skill-sovidurlng: zever}", "skill-riding: zever}"),
            /`data\.cognates\[0\]\.forms\.skill-riding` names sohl-note-skill-riding, which is not a skill whose subType is language/,
            "skill-riding",
        );
    });

    it("refuse a form whose language resolves to nothing, at its key", () => {
        one(
            edit("skill-sovidurlng: zever}", "skill-nowhere: zever}"),
            /does not resolve/,
            "skill-nowhere",
        );
    });

    it("refuse a set with no gloss, at the row", () => {
        one(edit(", gloss: wind}", "}"), /`data\.cognates\[0\]` must state `gloss`/, "{forms:");
    });
});

describe("sound-change sets", () => {
    it("refuse a set name stated twice, at the second", () => {
        one(
            edit("    - name: Sovidur loans", "    - name: From Dunhari to Sovidur"),
            /the set `From Dunhari to Sovidur` stands twice, first at `data\.soundChanges\[0\]`/,
            "From Dunhari to Sovidur",
        );
    });

    it("refuse a step label stated twice in one set, at the second", () => {
        one(
            edit("{step: A2,", "{step: A1,"),
            /the step `A1` stands twice in its set, first at `data\.soundChanges\[0\]\.steps\[0\]`/,
            'A1, change: "like',
        );
    });

    it("keep one step label apart in two sets", () => {
        expect(dunhari(DUNHARI)).toEqual([]);
    });

    it("refuse a `from` that is no language note, at the value", () => {
        one(
            edit("      from: skill-dunharlng", "      from: skill-riding"),
            /`data\.soundChanges\[0\]\.from` names sohl-note-skill-riding, which is not a skill whose subType is language/,
            "skill-riding",
        );
    });

    it("refuse a set with no steps, at the set", () => {
        one(
            edit(
                '    - name: Sovidur loans\n      steps:\n        - {step: A1, change: "`q` > `k`"}',
                "    - name: Sovidur loans",
            ),
            /`data\.soundChanges\[1\]` must state `steps`/,
            "name: Sovidur loans",
        );
    });
});

describe("the sound rules beside the letters", () => {
    it("refuse a stress rule outside the closed list, at the value", () => {
        one(
            edit("stress: penultimate or final", "stress: last syllable"),
            /`data\.sounds\.stress` should be `first syllable` or `penultimate or final` or `by weight` or `as marked`/,
            "last syllable",
        );
    });

    it("refuse a join outside the closed meetings and rules, at the value", () => {
        one(
            edit("{meeting: V+V,", "{meeting: V+X,"),
            /`data\.sounds\.joins\[0\]\.meeting` should be/,
            "V+X",
        );
        one(
            edit("rule: insert,", "rule: add,"),
            /`data\.sounds\.joins\[0\]\.rule` should be/,
            "add",
        );
    });

    it("refuse a mark's kind or limit outside the closed lists, at the value", () => {
        one(
            edit("kind: stress, limit: one", "kind: tone, limit: one"),
            /`data\.sounds\.marks\[0\]\.kind` should be `stress` or `length`/,
            "tone",
        );
        one(
            edit("kind: stress, limit: one", "kind: stress, limit: two"),
            /`data\.sounds\.marks\[0\]\.limit` should be `one` or `any`/,
            "two",
        );
    });

    it("refuse a syllable rule of the wrong shape, at the value", () => {
        one(
            edit("      onsets: single", "      onsets: a single consonant"),
            /`data\.sounds\.syllables\.onsets` should be `single`/,
            "a single consonant",
        );
        one(
            edit("      finals: any", "      finals: all"),
            /`data\.sounds\.syllables\.finals` should be `any`/,
            "all",
        );
        one(
            edit("      initialVowel: true", "      initialVowel: yes please"),
            /`data\.sounds\.syllables\.initialVowel` should be/,
            "yes please",
        );
        one(
            edit("neutralAs: front}", "neutralAs: middle}"),
            /`data\.sounds\.syllables\.harmony\.neutralAs` should be `back` or `front`/,
            "middle",
        );
    });

    it("refuse a frame class that is no word class base, at the class", () => {
        one(
            edit("class: [v, n],", "class: [v, noun],"),
            /`noun` is not a base of the master word classes/,
            "noun",
        );
    });

    it("refuse a skeleton row holding for nothing, at the row", () => {
        one(
            edit("      - {second: any, between: a}", "      - {between: a}"),
            /`data\.sounds\.skeleton\[1\]` must state `second`/,
            "{between: a}",
        );
    });
});

describe("calling names", () => {
    it("refuse a closing stating both a form and doubled, at the row", () => {
        one(
            edit("{doubled: true, usual: either}", "{form: -a, doubled: true, usual: either}"),
            /`data\.callingNames\.closings\[1\]` states both a `form` and `doubled: true`/,
            "{form: -a",
        );
    });

    it("refuse a closing stating neither, at the row", () => {
        one(
            edit("{doubled: true, usual: either}", "{usual: either}"),
            /states neither a `form` and `doubled: true`/,
            "{usual: either}",
        );
    });

    it("refuse a use outside the closed list, at the value", () => {
        one(
            edit("{form: -u, usual: man}", "{form: -u, usual: child}"),
            /`data\.callingNames\.closings\[0\]\.usual` should be `man` or `woman` or `either`/,
            "child",
        );
    });

    it("refuse calling names with no fewest syllables, at the key", () => {
        one(
            edit("    minSyllables: 4\n", ""),
            /`data\.callingNames` must state `minSyllables`/,
            "callingNames",
        );
    });
});
