/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A culture or an affiliation states its own glossary terms** in
 * `data.glossary`. An entry with a definition creates a term; an entry without
 * one only marks a term the note already has — a word of a language that
 * reaches it, or a rank or office — and one that marks nothing is a finding at
 * its name.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { collectContentIndex } from "../engine/content-index.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { GLOSSARY_ENTRY_KEYS } from "../engine/word-terms.mjs";
import { NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

/** The configured languages the tree's notes state in `data.lang`. */
const LANGUAGES = {
    sinale: { tag: "art-x-sinale", note: "skill-sinalelng" },
    trade: { tag: "art-x-trade", note: "skill-tradelng" },
};

const roots: string[] = [];
afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

const SUPPORT: Record<string, string> = {
    "Skills/Sinale.md": [
        "---",
        "shortcode: sinalelng",
        "name: {full: Sinalë}",
        "type: skill",
        "subType: language",
        "data:",
        "  family: skill-oldlng",
        "  fields:",
        "    - {name: Spirit, holds: The spirit world.}",
        "  words:",
        "    - {form: síladòr, class: n, field: Spirit, gloss: a spirit-walker}",
        "    - {form: wulf-, class: stem, field: Spirit, gloss: wolf}",
        "---",
        "A tongue.",
        "",
    ].join("\n"),
    "Skills/Old.md": [
        "---",
        "shortcode: oldlng",
        "name: {full: Old Sinalë}",
        "type: skill",
        "subType: language",
        "data:",
        "  fields:",
        "    - {name: Spirit, holds: The spirit world.}",
        "  words:",
        "    - {form: ursíl, class: n, field: Spirit, gloss: the first spirit}",
        "---",
        "The parent tongue.",
        "",
    ].join("\n"),
    "Skills/Trade.md": [
        "---",
        "shortcode: tradelng",
        "name: {full: Trade Cant}",
        "type: skill",
        "subType: language",
        "data:",
        "  fields:",
        "    - {name: Market, holds: The market.}",
        "  words:",
        "    - {form: zarq, class: n, field: Market, gloss: a fair price}",
        "---",
        "A cant.",
        "",
    ].join("\n"),
    "Affiliations/Wardens.md": [
        "---",
        "shortcode: wardens",
        "name: {full: The Wardens}",
        "type: affiliation",
        "subType: order",
        "data:",
        "  culture: lore-sinaleclt",
        "  lang: trade",
        "  governance:",
        "    ranks:",
        "      - {level: 0, title: Outcast, description: Cast out.}",
        "      - {level: 1, title: Knight-Captain, description: A captain of the order.}",
        "    offices:",
        "      Warden: Keeps the gate.",
        "---",
        "An order.",
        "",
    ].join("\n"),
    "Lore/Road.md":
        "---\nshortcode: road\nname: {full: The Road}\ntype: lore\nsubType: history\n---\nA road.\n",
    "Lore/Far.md":
        "---\nshortcode: farclt\nname: {full: The Far Folk}\ntype: lore\nsubType: culture\ndata:\n  lang: trade\n---\nA people.\n",
    "Affiliations/Marchers.md": [
        "---",
        "shortcode: marchers",
        "name: {full: The Marchers}",
        "type: affiliation",
        "subType: order",
        "data:",
        "  culture: lore-farclt",
        "  parents: [affiliation-wardens]",
        "  governance:",
        "    ranks:",
        "      - {level: 0, title: Outcast, description: Cast out.}",
        "      - {level: 1, title: Marcher-Lord, description: Holds a march.}",
        "---",
        "An order of the Far Folk sworn to the Wardens.",
        "",
    ].join("\n"),
};

const ENTRIES = [
    "    - {name: síladòr, common: true}",
    "    - {name: Knight-Captain, common: true}",
    "    - {name: Warden}",
    "    - {name: zarq, language: skill-tradelng, common: true}",
    '    - {name: blood-field, name_sort: bloodfield, definition: "ground where a battle tore the boundary", pronunciation: BLUD-feeld}',
];

/** A Sinalë culture note holding the given glossary entry lines. */
function culture(lines: string[], subType = "culture") {
    return [
        "---",
        "shortcode: sinaleclt",
        "name: {full: The Sinalë}",
        "type: lore",
        `subType: ${subType}`,
        "data:",
        "  lang: sinale",
        "  glossary:",
        ...lines,
        "---",
        "A people.",
        "",
    ].join("\n");
}

/** Lint a tree holding the support notes and `text` at `rel`, returning its findings. */
function lint(text: string, rel = "Lore/Sinale.md") {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "glossary-entries-"));
    roots.push(root);
    for (const [name, body] of Object.entries({
        "Lore/Sinale.md": culture([]),
        ...SUPPORT,
        [rel]: text,
    })) {
        const file = path.join(root, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, body);
    }
    const problems: any[] = [];
    const records = collectContentIndex(root, {
        languages: LANGUAGES,
        contentPackage: "sohl",
        skipDirectories: [],
        problems,
    });
    const index = buildLinkIndex(root, { records, skipDirectories: [] });
    const own = path.join(root, rel);
    return [
        ...problems,
        ...lintFrontmatter(index, { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY }).findings,
    ].filter((finding) => finding.file === own);
}

/** The text at a finding's position. */
function at(text: string, finding: { line?: number; column?: number }) {
    expect(finding.line).toBeTypeOf("number");
    expect(finding.column).toBeTypeOf("number");
    return text.split("\n")[finding.line! - 1].slice(finding.column! - 1);
}

/** Exactly one finding, saying `message`, located at `where`. */
function one(text: string, message: RegExp, where: string, severity = "error", rel?: string) {
    const findings = lint(text, rel);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe(severity);
    expect(findings[0].message).toMatch(message);
    expect(at(text, findings[0]).startsWith(where), `located at ${where}`).toBe(true);
}

describe("data.glossary", () => {
    it("is a lore field of the entry keys the format names", () => {
        const field = dataFields("lore").find((f: { name: string }) => f.name === "glossary");
        expect(field).toMatchObject({ kind: "list" });
        expect(GLOSSARY_ENTRY_KEYS).toEqual([
            "name",
            "name_sort",
            "common",
            "definition",
            "pronunciation",
            "language",
        ]);
    });

    it("is an affiliation field of the same entry", () => {
        const field = dataFields("affiliation").find(
            (f: { name: string }) => f.name === "glossary",
        );
        expect(field).toMatchObject({ kind: "list" });
    });

    it("lints clean marking a word, a rank, an office and a word of a body's tongue, and creating a term", () => {
        expect(lint(culture(ENTRIES))).toEqual([]);
    });

    it("refuses an entry that names nothing and gives no definition, at its name", () => {
        one(
            culture([...ENTRIES, "    - {name: nothing, common: true}"]),
            /`nothing`.*names nothing/,
            "nothing",
        );
    });

    it("names a word its language inherits through data.family", () => {
        expect(lint(culture([...ENTRIES, "    - {name: ursíl, common: true}"]))).toEqual([]);
    });

    it("names a rank of an affiliation that reaches it through a parent", () => {
        expect(lint(culture([...ENTRIES, "    - {name: Marcher-Lord, common: true}"]))).toEqual([]);
    });

    it("inherits a word only from the entry's resolved language", () => {
        const text = culture(["    - {name: zarq, common: true}"]);
        one(text, /`zarq`.*names nothing/, "zarq");
        expect(
            lint(culture(["    - {name: zarq, language: skill-tradelng, common: true}"])),
        ).toEqual([]);
    });

    it("does not count a stem as a term", () => {
        one(culture([...ENTRIES, "    - {name: wulf-}"]), /`wulf-`.*names nothing/, "wulf-");
    });

    it("refuses two entries of one name, at the second", () => {
        const text = culture([...ENTRIES, "    - {name: síladòr, common: false}"]);
        const findings = lint(text);
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toMatch(/`síladòr` stands twice/);
        expect(findings[0].line).toBe(14);
        expect(at(text, findings[0]).startsWith("síladòr")).toBe(true);
    });

    it("compares names after NFC normalisation", () => {
        const decomposed = "síladòr".normalize("NFD");
        one(culture([...ENTRIES, `    - {name: ${decomposed}}`]), /stands twice/, decomposed);
    });

    it("refuses an entry with neither a name nor anything else", () => {
        one(culture([...ENTRIES, "    - {common: true}"]), /must state `name`/, "{common");
    });

    it("refuses data.glossary on lore that is not a culture, at the key", () => {
        const text = culture(ENTRIES, "history");
        const findings = lint(text).filter((f: any) => /glossary/.test(f.message));
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toMatch(/`data\.glossary`.*culture/);
        expect(at(text, findings[0]).startsWith("glossary:")).toBe(true);
    });

    it("warns of a definition that only repeats the gloss it replaces", () => {
        one(
            culture([...ENTRIES.slice(1), "    - {name: síladòr, definition: a spirit-walker}"]),
            /repeats/,
            "a spirit-walker",
            "warning",
        );
    });

    it("refuses a pronunciation that is not a respelling", () => {
        one(
            culture([...ENTRIES, "    - {name: kith, definition: kin, pronunciation: KITH-KIN}"]),
            /respelling/,
            "KITH-KIN",
        );
    });
});

/** The Wardens, holding the given glossary entry lines. */
function wardens(lines: string[]) {
    return SUPPORT["Affiliations/Wardens.md"].replace(
        "  governance:\n",
        ["  glossary:", ...lines, "  governance:", ""].join("\n"),
    );
}

describe("data.glossary on an affiliation", () => {
    const WARDENS = "Affiliations/Wardens.md";

    it("lints clean marking its rank, its office and a word of its language, and creating a term", () => {
        const text = wardens([
            "    - {name: Knight-Captain, common: true}",
            "    - {name: Warden}",
            "    - {name: zarq, common: true}",
            "    - {name: gate-oath, definition: the oath sworn at the gate}",
        ]);
        expect(lint(text, WARDENS)).toEqual([]);
    });

    it("refuses an entry that names nothing it holds, at its name", () => {
        one(
            wardens(["    - {name: síladòr, common: true}"]),
            /`síladòr`.*names nothing/,
            "síladòr",
            "error",
            WARDENS,
        );
    });
});

describe("data.glossary on any other type", () => {
    it("is an unknown key", () => {
        const text =
            "---\nshortcode: road2\nname: {full: Road}\ntype: place\nsubType: road\ndata:\n  glossary:\n    - {name: way, definition: a road}\n---\nA road.\n";
        const findings = lint(text, "Places/Road.md").filter((f: any) =>
            /glossary/.test(f.message),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].message).toMatch(/"glossary" is not a `data:` property/);
    });
});
