/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { buildWikilinkIndex, convertWikilinks } from "../engine/wikilinks.mjs";
import { convertNoteWikilinks } from "../engine/helpers.mjs";
import log from "loglevel";

/**
 * Two notes of one type claiming the same alias — the only way a link becomes
 * ambiguous within a compiling repository.
 */
const DOCS = [
    {
        type: "doc",
        id: "aaaaaaaaaaaaaaa1",
        shortcode: "coma",
        name: "Coma",
        aliases: ["Coma"],
    },
    {
        type: "doc",
        id: "aaaaaaaaaaaaaaa2",
        shortcode: "extshock",
        name: "Extreme Shock",
        aliases: ["Coma"],
    },
    {
        type: "doc",
        id: "aaaaaaaaaaaaaaa3",
        shortcode: "bleeding",
        name: "Bleeding",
        aliases: ["Bleeding"],
    },
];

const index = buildWikilinkIndex(DOCS, "sohl");
const from = { type: "doc", id: "aaaaaaaaaaaaaaa3", index, name: "Bleeding" };

afterEach(() => vi.restoreAllMocks());

describe("an ambiguous wikilink names its candidates (#13)", () => {
    it("reports every note claiming the alias", () => {
        const { unresolved } = convertWikilinks("a [[Coma]] state", {
            ...from,
            index,
        });
        expect(unresolved).toHaveLength(1);
        expect(unresolved[0]).toMatchObject({
            target: "Coma",
            reason: "ambiguous",
        });
        // The point of the change: the collision is nameable. Without this the
        // only thing reported is the *citing* note, which is innocent.
        expect(unresolved[0].candidates).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ shortcode: "coma" }),
                expect.objectContaining({ shortcode: "extshock" }),
            ]),
        );
    });

    it("still renders as an unresolved-link span", () => {
        const { markdown } = convertWikilinks("a [[Coma]] state", {
            ...from,
            index,
        });
        expect(markdown).toContain('class="sohl-unresolved-link"');
        expect(markdown).toContain("Coma");
    });
});

describe("an ambiguous wikilink fails the compile (#13)", () => {
    it("throws rather than warning", () => {
        expect(() => convertNoteWikilinks("a [[Coma]] state", from)).toThrow(
            /ambiguous/i,
        );
    });

    it("names the colliding notes, not just the citing one", () => {
        // The attribution fix. Whoever added the second "Coma" broke every
        // existing [[Coma]] in the corpus; a message naming only "Bleeding"
        // points at a note whose author did nothing wrong.
        let message = "";
        try {
            convertNoteWikilinks("a [[Coma]] state", from);
        } catch (err) {
            message = (err as Error).message;
        }
        expect(message).toContain("Coma");
        expect(message).toContain("Extreme Shock");
        expect(message).toMatch(/doc-coma|coma/);
        expect(message).toMatch(/doc-extshock|extshock/);
    });

    it("does not throw for a bare alias that simply resolves nowhere", () => {
        // Unchanged, and deliberately: an unresolved bare alias may be ordinary
        // prose or a worldbuilding placeholder. It warns and renders marked.
        // The warning goes to the console unprefixed, in compiler form (#17).
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const result = convertNoteWikilinks("a [[Nowhere At All]] place", from);
        expect(result.markdown).toContain('class="sohl-unresolved-link"');
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining(
                "warning: unresolved wikilink [[Nowhere At All]]",
            ),
        );
        warn.mockRestore();
    });

    it("does not throw when nothing is ambiguous", () => {
        expect(() =>
            convertNoteWikilinks("plain prose, no links", from),
        ).not.toThrow();
    });
});
