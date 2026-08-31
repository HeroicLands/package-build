/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";

import { ABBREVIATIONS, abbreviateTokens } from "../engine/abbreviations.mjs";
import { contentSlug, slugify } from "../engine/content-slug.mjs";

/** Abbreviate a name the way a slug does, for readability in these cases. */
const abbrev = (name: string) =>
    abbreviateTokens(
        name
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(Boolean),
    );

describe("abbreviateTokens", () => {
    it("replaces a whole word", () => {
        expect(abbrev("Kurbul Helm")).toEqual(["kbl", "helm"]);
        expect(abbrev("Mountain Fort")).toEqual(["mt", "ft"]);
    });

    it("abbreviates the common arms-and-armour words", () => {
        expect(abbrev("Round Shield")).toEqual(["rnd", "shld"]);
        expect(abbrev("Long Sword")).toEqual(["long", "swd"]);
        expect(abbrev("Battle Axe")).toEqual(["btl", "axe"]);
    });

    // Whole words only: `broadsword` is one word, so `sword`'s rule does not
    // reach inside it.
    it("does not abbreviate a word that merely ends in one", () => {
        expect(abbrev("Broadsword")).toEqual(["broadsword"]);
    });

    it("leaves a word with no entry alone", () => {
        expect(abbrev("Broadsword")).toEqual(["broadsword"]);
        expect(abbrev("Wolf of the North")).toEqual(["wolf", "of", "the", "north"]);
    });

    // `countess` has its own entry; `count`'s rule must not reach inside it.
    it("does not abbreviate part of a longer word", () => {
        expect(abbrev("Countess")).toEqual(["ctss"]);
        expect(abbrev("Count")).toEqual(["ct"]);
        expect(abbrev("Baroness")).toEqual(["bnss"]);
        expect(abbrev("Baron")).toEqual(["bn"]);
        expect(abbrev("Prioress")).toEqual(["prr"]);
        expect(abbrev("Viscountess")).toEqual(["vctss"]);
    });

    // Longest-first: a phrase beats its own first word.
    it("prefers a multi-word phrase over its first word", () => {
        expect(abbrev("Tribunus Militum")).toEqual(["tribmil"]);
        expect(abbrev("Tribunus")).toEqual(["trib"]);
        expect(abbrev("Free Company")).toEqual(["fc"]);
        expect(abbrev("High King")).toEqual(["hk"]);
        expect(abbrev("King")).toEqual(["k"]);
    });

    // A hyphenated entry tokenises the same way a hyphenated name does.
    it("matches a hyphenated phrase", () => {
        expect(abbrev("Shire-Reeve")).toEqual(["shf"]);
        expect(abbrev("Sheriff")).toEqual(["shf"]);
    });

    it("abbreviates each occurrence, anywhere in the name", () => {
        expect(abbrev("Lord Mayor and Lord Steward")).toEqual(["ld", "myr", "and", "ld", "stw"]);
    });

    it("is case-insensitive by way of the caller's lowercasing", () => {
        expect(abbrev("KURBUL")).toEqual(["kbl"]);
        expect(abbrev("Villein")).toEqual(["vll"]);
    });

    it("handles an empty token list", () => {
        expect(abbreviateTokens([])).toEqual([]);
    });
});

describe("slugify with abbreviations", () => {
    it("abbreviates through the whole slug pipeline", () => {
        expect(contentSlug("Kûrbúl Helm")).toBe("kbl-helm");
        expect(contentSlug("Tribunus Militum")).toBe("tribmil");
        expect(contentSlug("Free Company of the Wolf")).toBe("fc-of-the-wolf");
    });

    // Transliteration runs first, so an accented spelling still matches.
    it("abbreviates a transliterated word", () => {
        expect(contentSlug("Kûrbúl Cuirass")).toBe("kbl-cuirass");
    });

    it("leaves an unlisted name untouched", () => {
        expect(contentSlug("Mail Byrnie")).toBe("mail-byrnie");
    });

    // Abbreviation is document identity's, not the normalisation's. An author
    // writes an anchor key by hand — a map pins `locations.stair-foot` at a
    // heading called "Stair Foot" — so abbreviating it would break a reference
    // nobody could have predicted. That is not hypothetical: it failed the
    // real pack compile when abbreviation was applied to every slug.
    it("does not reach anchors, filenames, or any other slug", () => {
        expect(slugify("Kurbul Helm")).toBe("kurbul-helm");
        expect(slugify("Stair Foot")).toBe("stair-foot");
        expect(contentSlug("Stair Foot")).toBe("stair-ft");
        expect(slugify("")).toBe("");
    });
});

describe("the table itself", () => {
    it("is frozen, so nothing edits it at runtime", () => {
        expect(Object.isFrozen(ABBREVIATIONS)).toBe(true);
    });

    it("maps every entry to a non-empty alphanumeric token", () => {
        for (const [word, short] of Object.entries(ABBREVIATIONS)) {
            expect(short, `${word} → ${short}`).toMatch(/^[a-z0-9]+$/);
        }
    });

    // A key is matched after the name is lowercased and split, so a key that
    // does not survive that treatment could never match anything.
    it("has keys that tokenise to themselves", () => {
        for (const word of Object.keys(ABBREVIATIONS)) {
            const tokens = word
                .toLowerCase()
                .split(/[^a-z0-9]+/)
                .filter(Boolean);
            expect(tokens.length, `${word} tokenises to nothing`).toBeGreaterThan(0);
        }
    });

    // Several words deliberately share an abbreviation (abbess/abbot → abb).
    // That is allowed, and the slug-collision guard is what catches the case
    // where it actually costs something.
    it("permits two words to share an abbreviation", () => {
        expect(ABBREVIATIONS.abbess).toBe(ABBREVIATIONS.abbot);
        expect(ABBREVIATIONS.monk).toBe(ABBREVIATIONS.brother);
        expect(ABBREVIATIONS.emperor).toBe(ABBREVIATIONS.empress);
    });
});
