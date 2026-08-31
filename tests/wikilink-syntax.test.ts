/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";

import { WIKILINK, isSamePage, parseWikilink } from "../engine/wikilink-syntax.mjs";

/** Every wikilink interior the shared pattern finds in a body. */
const found = (body: string) =>
    [...body.matchAll(new RegExp(WIKILINK.source, "g"))].map((m) => m[1]);

describe("WIKILINK — what counts as a link", () => {
    it("finds a link in prose", () => {
        expect(found("See [[skill-climbing]] and [[a|B]].")).toEqual(["skill-climbing", "a|B"]);
    });

    // The divergence this module exists to end. The web resolver's pattern
    // omitted `\n`, so an unclosed bracket consumed everything up to the next
    // `]]` anywhere in the document — two paragraphs, in the case that found it.
    it("does not let an unclosed bracket swallow the document", () => {
        const body = "Prose with [[ an unclosed bracket\n\nand a later [[skill-climbing]] link.";
        expect(found(body)).toEqual(["skill-climbing"]);
    });

    it("does not match across a line break", () => {
        expect(found("| [[weapongear-bsw\n]] | x |")).toEqual([]);
    });

    it("finds nothing in a body with no links", () => {
        expect(found("Just prose, and a [single] bracket.")).toEqual([]);
    });
});

describe("parseWikilink", () => {
    it("reads a bare target", () => {
        expect(parseWikilink("skill-climbing")).toEqual({
            inner: "skill-climbing",
            target: "skill-climbing",
            anchor: "",
            display: null,
            labelled: false,
        });
    });

    it("splits a label at the first bar", () => {
        const p = parseWikilink("skill-climbing|Climbing");
        expect(p.target).toBe("skill-climbing");
        expect(p.display).toBe("Climbing");
        expect(p.labelled).toBe(true);
    });

    it("splits an anchor off the target", () => {
        const p = parseWikilink("docskill-wpnc#crafting|Crafting");
        expect(p.target).toBe("docskill-wpnc");
        expect(p.anchor).toBe("crafting");
        expect(p.display).toBe("Crafting");
    });

    it("reads a same-page link", () => {
        const p = parseWikilink("#some-heading");
        expect(p.target).toBe("");
        expect(p.anchor).toBe("some-heading");
        expect(isSamePage(p)).toBe(true);
    });

    // A table cell escapes its own pipes; reading the escape as the label
    // separator would truncate the target at the cell boundary.
    it("unescapes a table-escaped pipe before splitting", () => {
        const p = parseWikilink("skill-climbing\\|Climbing");
        expect(p.target).toBe("skill-climbing");
        expect(p.display).toBe("Climbing");
    });

    it("trims each part", () => {
        const p = parseWikilink("  skill-climbing # crafting | Climbing  ");
        expect(p.target).toBe("skill-climbing");
        expect(p.anchor).toBe("crafting");
        expect(p.display).toBe("Climbing");
    });

    // `null` and `""` differ: an author may write an empty label deliberately.
    it("distinguishes an absent label from an empty one", () => {
        expect(parseWikilink("a").display).toBeNull();
        expect(parseWikilink("a|").display).toBe("");
        expect(parseWikilink("a|").labelled).toBe(true);
    });

    // `inner` is what an unlabelled link displays, anchor included.
    it("keeps the whole interior for an unlabelled link", () => {
        expect(parseWikilink("a#b").inner).toBe("a#b");
        expect(parseWikilink("#b").inner).toBe("#b");
    });

    it("survives an absent interior", () => {
        expect(parseWikilink(undefined as never)).toMatchObject({
            target: "",
            anchor: "",
            display: null,
            labelled: false,
        });
    });
});

describe("isSamePage", () => {
    it("is true only for an anchor with no target", () => {
        expect(isSamePage({ target: "", anchor: "x" } as never)).toBe(true);
        expect(isSamePage({ target: "a", anchor: "x" } as never)).toBe(false);
        expect(isSamePage({ target: "", anchor: "" } as never)).toBe(false);
    });
});
