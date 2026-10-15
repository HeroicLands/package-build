/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    WORD_CLASS_BASES,
    WORD_CLASS_MODIFIERS,
    abbreviateWordClass,
    expandWordClass,
    parseWordClass,
} from "../engine/word-classes.mjs";

const REFERENCE = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../docs/reference/format-details.md",
);

/** Every class string the setting's words use, with `n-coll` written `n coll`. */
const MEASURED = [
    "n",
    "v",
    "adj",
    "n f",
    "n m",
    "stem",
    "n n",
    "n in",
    "num",
    "n I m",
    "name",
    "n I f",
    "n an",
    "part",
    "n II n",
    "n II m",
    "pron",
    "n coll",
    "v â",
    "call",
    "art",
    "adv",
    "n III m",
    "n hal",
    "dem",
    "conj",
    "v dep",
    "rel",
    "n III n",
    "adj III",
    "n II f",
    "v c",
    "v ê",
    "v i",
    "n V f",
    "n IV m",
    "pref",
];

/** The cells of every table row in `text`, trimmed. */
function rows(text: string): string[][] {
    return text
        .split("\n")
        .filter((line) => line.startsWith("|"))
        .map((line) =>
            line
                .slice(1, -1)
                .split("|")
                .map((cell) => cell.trim()),
        );
}

/** The reference's "Word classes" section, up to the next heading of its level. */
function section(): string {
    const text = fs.readFileSync(REFERENCE, "utf8");
    const start = text.indexOf("\n### Word classes\n");
    expect(start, "format-details.md has no `### Word classes` section").toBeGreaterThan(-1);
    const rest = text.slice(start + 1);
    const next = rest.slice(5).search(/\n#{1,3} /);
    return next === -1 ? rest : rest.slice(0, next + 5);
}

describe("the word class lists", () => {
    it("give every base a token, an expansion and a glossary flag", () => {
        for (const base of WORD_CLASS_BASES) {
            expect(base.token, "token").toMatch(/\S/);
            expect(base.expansion, `${base.token} expansion`).toMatch(/\S/);
            expect(typeof base.glossary, `${base.token} glossary`).toBe("boolean");
            if (base.glossary)
                expect(base.abbreviation, `${base.token} abbreviation`).toMatch(/\S/);
        }
    });

    it("give every modifier a token, a group, an abbreviation and an expansion", () => {
        for (const mod of WORD_CLASS_MODIFIERS) {
            expect(mod.token, "token").toMatch(/\S/);
            expect(mod.group, `${mod.token} group`).toMatch(/\S/);
            expect(mod.abbreviation, `${mod.token} abbreviation`).toMatch(/\S/);
            expect(mod.expansion, `${mod.token} expansion`).toMatch(/\S/);
        }
    });

    it("keep tokens and abbreviations unique within each list", () => {
        for (const list of [WORD_CLASS_BASES, WORD_CLASS_MODIFIERS]) {
            const tokens = list.map((item) => item.token);
            expect(new Set(tokens).size).toBe(tokens.length);
            const abbreviations = list.map((item) => item.abbreviation).filter((a) => a != null);
            expect(new Set(abbreviations).size).toBe(abbreviations.length);
        }
    });
});

describe("parseWordClass", () => {
    it.each(MEASURED)("accepts %s", (text) => {
        const parsed = parseWordClass(text);
        expect(parsed.reason).toBeUndefined();
        expect(parsed.base).toBe(text.split(" ")[0]);
    });

    it("measures 37 class strings", () => {
        expect(MEASURED).toHaveLength(37);
    });

    it.each(["n-coll", "xyz", "n zz", "", "   ", "f"])("refuses %j", (text) => {
        const parsed = parseWordClass(text);
        expect(typeof parsed.reason).toBe("string");
        expect(parsed.base).toBeUndefined();
    });

    it("reads n n as a neuter noun", () => {
        expect(parseWordClass("n n")).toEqual({ base: "n", modifiers: ["n"] });
    });

    it("reads a bare base with no modifiers", () => {
        expect(parseWordClass("adj")).toEqual({ base: "adj", modifiers: [] });
    });
});

describe("abbreviating and expanding", () => {
    it.each([
        ["n I f", "n. I f.", "noun of class I, feminine"],
        ["n n", "n. nt.", "noun, neuter"],
        ["n coll", "n. coll.", "noun, collective"],
        ["v â", "v. â", "verb of the first conjugation"],
        ["v dep", "v. dep.", "verb, deponent"],
        ["n hal m", "n. hal. m.", "noun of the hallowed class, masculine"],
        ["n an", "n. anim.", "noun, animate"],
        ["adj", "adj.", "adjective"],
        ["call", "call", "call"],
        ["name", "name", "proper name"],
    ])("%s", (text, abbreviation, expansion) => {
        const parsed = parseWordClass(text);
        expect(abbreviateWordClass(parsed)).toBe(abbreviation);
        expect(expandWordClass(parsed)).toBe(expansion);
    });
});

describe("the reference", () => {
    it("names every base and modifier with its abbreviation and expansion", () => {
        const text = section();
        for (const base of WORD_CLASS_BASES) {
            const row = rows(text).find((cells) => cells[0] === `\`${base.token}\``);
            expect(row, `base ${base.token} has no row`).toBeDefined();
            expect(row).toEqual([
                `\`${base.token}\``,
                base.abbreviation ?? "—",
                base.expansion,
                base.glossary ? "yes" : "no",
            ]);
        }
        for (const mod of WORD_CLASS_MODIFIERS) {
            const row = rows(text).find(
                (cells) => cells[0] === `\`${mod.token}\`` && cells[1] === mod.group,
            );
            expect(row, `modifier ${mod.token} has no row`).toBeDefined();
            expect(row).toEqual([`\`${mod.token}\``, mod.group, mod.abbreviation, mod.expansion]);
        }
    });
});
