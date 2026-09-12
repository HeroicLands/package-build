/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `system` keys a note may never author, because the compiler writes them from
 * the note itself.
 *
 * The defect these pin: SoHL writes `system.docHtml` on every item, holding the
 * `@UUID` of the JournalEntry the note's prose compiled into. Nothing refused a
 * note that authored the key anyway, so a note could carry paragraphs of prose
 * in a field whose every reader expects a pointer — the wrong type in a shipped
 * document, with nothing to report it.
 *
 * The rule is the general one: a field the compiler derives is not a field a
 * note authors. Each pass declares its own keys, and the refusal names none.
 */

import { describe, it, expect } from "vitest";

import {
    assertNoDerivedFields,
    authoredDerivedKeys,
    derivedIn,
    derivedMessage,
} from "../engine/derived-fields.mjs";
import { Items } from "../sohl/items.mjs";
import { Hm3Items } from "../hm3/items.mjs";

/** What a pass derives, in the shape a compiler declares. */
const DERIVED = [
    { key: "docHtml", from: "the note's own body" },
    { key: "notes", from: "the note's own body" },
] as const;

describe("authoredDerivedKeys", () => {
    it("finds a derived key a note writes under its system block", () => {
        const fm = { sohl: { system: { docHtml: "<p>A blue powder.</p>" } } };

        expect(authoredDerivedKeys(fm, DERIVED, { block: "sohl" })).toEqual([DERIVED[0]]);
    });

    it("says nothing about a note that authors none", () => {
        const fm = { sohl: { system: { levelBase: 3 } } };

        expect(authoredDerivedKeys(fm, DERIVED, { block: "sohl" })).toEqual([]);
    });

    it("reads presence, not usability — an empty string is still a claim", () => {
        // The same rule every retirement uses. An authored `docHtml: ""` says
        // the author believes the key is theirs to write, which is exactly the
        // belief the message corrects.
        const fm = { sohl: { system: { docHtml: "" } } };

        expect(authoredDerivedKeys(fm, DERIVED, { block: "sohl" })).toEqual([DERIVED[0]]);
    });

    it("looks only in the block it is given", () => {
        const fm = { hm3: { system: { docHtml: "x" } } };

        expect(authoredDerivedKeys(fm, DERIVED, { block: "sohl" })).toEqual([]);
    });

    it("answers for a bare system block, as an actor's embedded entry carries", () => {
        // An actor note's `items:` entries deep-merge a `system:` overlay onto
        // the template with no field declaration in the path, so a key written
        // there ships exactly as one on the item's own note.
        expect(derivedIn({ docHtml: "x" }, DERIVED)).toEqual([DERIVED[0]]);
        expect(derivedIn({ levelBase: 1 }, DERIVED)).toEqual([]);
        expect(derivedIn(null, DERIVED)).toEqual([]);
    });

    it("passes a pass that derives nothing", () => {
        expect(
            authoredDerivedKeys({ sohl: { system: { docHtml: "x" } } }, [], { block: "sohl" }),
        ).toEqual([]);
        expect(
            authoredDerivedKeys({ sohl: { system: { docHtml: "x" } } }, undefined, {
                block: "sohl",
            }),
        ).toEqual([]);
    });
});

describe("the message", () => {
    it("names the correction, not only the fault", () => {
        const message = derivedMessage("sohl.system.docHtml", "the note's own body");

        expect(message).toContain("`sohl.system.docHtml:`");
        expect(message).toContain("written by the compiler, not authored");
        // The whole point: the text is wanted, and there is somewhere it goes.
        expect(message).toContain("Move the text to the note's own body");
    });

    it("names the file only when the caller has no locator of its own", () => {
        expect(derivedMessage("sohl.system.docHtml", "the body", "N.md")).toContain("N.md");
        expect(derivedMessage("sohl.system.docHtml", "the body")).not.toContain("N.md");
    });
});

describe("assertNoDerivedFields", () => {
    it("refuses a note that authors one", () => {
        const fm = { sohl: { system: { docHtml: "<p>A blue powder.</p>" } } };

        expect(() => assertNoDerivedFields(fm, DERIVED, { block: "sohl" })).toThrow(
            /written by the compiler, not authored/,
        );
    });

    it("throws on the first, because two are one mistake with one fix", () => {
        const fm = { sohl: { system: { docHtml: "a", notes: "b" } } };

        expect(() => assertNoDerivedFields(fm, DERIVED, { block: "sohl" })).toThrow(/docHtml/);
    });

    it("passes a note that authors none", () => {
        expect(() =>
            assertNoDerivedFields({ sohl: { system: { levelBase: 3 } } }, DERIVED, {
                block: "sohl",
            }),
        ).not.toThrow();
    });

    it("passes unparsed frontmatter rather than throwing on it", () => {
        expect(() => assertNoDerivedFields(null, DERIVED, { block: "sohl" })).not.toThrow();
    });
});

describe("what the shipped passes declare", () => {
    it("SoHL derives docHtml and notes, and says where each comes from", () => {
        const keys = Items.derivedSystemKeys.map((entry) => entry.key);

        expect(keys).toContain("docHtml");
        expect(keys).toContain("notes");
        for (const entry of Items.derivedSystemKeys) expect(entry.from).toBeTruthy();
    });

    it("HM3 derives its own, which is what makes the rule general", () => {
        // The refusal names no key. A second system declaring a different one
        // is the whole evidence that it does not.
        const keys = Hm3Items.derivedSystemKeys.map((entry) => entry.key);

        expect(keys).toEqual(["description"]);
        expect(keys).not.toContain("docHtml");
    });
});
