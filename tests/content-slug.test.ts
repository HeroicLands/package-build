/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The one normalisation this build makes (#181).
 *
 * `slugify` reduces prose to a URL-safe token for a **heading anchor** and a
 * **pack filename**. It no longer addresses anything: a page's URL is its
 * `type-shortcode` address, so `contentSlug` — the name-derived, abbreviated,
 * collision-checked page slug — and `findSlugCollisions` are gone, along with
 * the abbreviation table that existed only to keep a name-derived URL short.
 */

import { describe, it, expect } from "vitest";
// Build-time content helper (plain ESM, no Foundry). Imported by relative path
// because the build scripts live outside the `@src` alias tree.
import * as contentSlugModule from "../engine/content-slug.mjs";

const { slugify } = contentSlugModule;

describe("slugify", () => {
    it("is the text, lowercased and hyphenated", () => {
        expect(slugify("Mail Byrnie")).toBe("mail-byrnie");
        expect(slugify("Russet Robe")).toBe("russet-robe");
    });

    it("drops apostrophes rather than turning them into separators", () => {
        // `armorers-kit`, never `armorer-s-kit` — an apostrophe marks a
        // pronunciation break inside one word.
        expect(slugify("Armorer's Kit")).toBe("armorers-kit");
        expect(slugify("Dye, Dragon’s Blood")).toBe("dye-dragons-blood");
    });

    it("transliterates accented characters instead of dropping them", () => {
        // Stripping reduced these to `n-sv-rroth` / `lverrik-t-rvallor`, which
        // is how one note's page, its pack file and a link to its heading came
        // to disagree about its own name.
        expect(slugify("Nüsvōrroth")).toBe("nusvorroth");
        expect(slugify("Ālverrik Tārvallor")).toBe("alverrik-tarvallor");
        expect(slugify("Tānvüran Elephant")).toBe("tanvuran-elephant");
    });

    it("spells out ligatures the way a reader would", () => {
        expect(slugify("Þorn Þegn")).toBe("thorn-thegn");
        expect(slugify("Ærik Ælfwine")).toBe("aerik-aelfwine");
        expect(slugify("Œuvre")).toBe("oeuvre");
        expect(slugify("Straße")).toBe("strasse");
        expect(slugify("ĲsseImeer")).toBe("ijsseimeer");
        expect(slugify("Ŋara")).toBe("ngara");
        // Eth follows the Icelandic convention of a bare `d`.
        expect(slugify("Óðinn")).toBe("odinn");
        // Slashed and ringed vowels reduce to their base letter.
        expect(slugify("Ølrún Åsa")).toBe("olrun-asa");
    });

    it("keeps a fraction's digits together", () => {
        // `¾` transliterates to `3/4`; the solidus must not split it into `3-4`.
        expect(slugify("Kûrbúl ¾-Helm")).toBe("kurbul-34-helm");
        expect(slugify("Plate ½-Helm")).toBe("plate-12-helm");
        // A slash that is not between digits is still a separator.
        expect(slugify("Armor/Clothing")).toBe("armor-clothing");
    });

    it("collapses punctuation and trims stray separators", () => {
        expect(slugify("Flask, glass (1 pint)")).toBe("flask-glass-1-pint");
        expect(slugify("  Spaced  Out  ")).toBe("spaced-out");
        expect(slugify("-Trim-")).toBe("trim");
    });

    it("returns the empty string rather than throwing", () => {
        // It addresses nothing, so there is no document to refuse to place: an
        // anchor that reduces to nothing is the caller's to judge.
        expect(slugify("")).toBe("");
        expect(slugify("   ")).toBe("");
        expect(slugify(undefined as never)).toBe("");
        expect(slugify("!!!")).toBe("");
    });

    it("never abbreviates", () => {
        // The abbreviation table shortened a name-derived URL and nothing else;
        // with the URL derived from the address there is nothing left to
        // shorten, and an author's hand-written anchor key (`stair-foot`) is
        // the thing abbreviating it would have broken.
        expect(slugify("Kurbul Helm")).toBe("kurbul-helm");
        expect(slugify("Stair Foot")).toBe("stair-foot");
        expect(slugify("Tribunus Militum")).toBe("tribunus-militum");
    });
});

describe("what a name no longer decides", () => {
    it("exports no page slug and no collision check", () => {
        // Both existed only to make a display name serve as an address (#181).
        expect(Object.keys(contentSlugModule).sort()).toEqual(["slugify"]);
    });
});
