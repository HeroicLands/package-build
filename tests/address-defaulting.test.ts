/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE.md file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";

import { expandAddress, blockSystem } from "../engine/content-address.mjs";
import { NOTE_SYSTEM } from "../engine/systems.mjs";

describe("readable and Foundry document Addresses", () => {
    const prose = { package: "foo", system: NOTE_SYSTEM };

    it("uses note for an Item or Actor's readable document", () => {
        expect(expandAddress({ type: "being", shortcode: "camel" }, prose)).toBe(
            "foo-note-being-camel",
        );
        expect(expandAddress({ type: "skill", shortcode: "climb" }, prose)).toBe(
            "foo-note-skill-climb",
        );
    });

    it("uses none for a Macro or Scene and note for its readable document", () => {
        expect(expandAddress({ type: "macro", shortcode: "attack" }, prose)).toBe(
            "foo-note-macro-attack",
        );
        expect(expandAddress({ type: "macro", shortcode: "attack", system: "none" }, prose)).toBe(
            "foo-none-macro-attack",
        );
        expect(expandAddress({ type: "map", shortcode: "hearth" }, prose)).toBe(
            "foo-note-map-hearth",
        );
        expect(expandAddress({ type: "map", shortcode: "hearth", system: "none" }, prose)).toBe(
            "foo-none-map-hearth",
        );
    });
});

/**
 * An omitted address segment **defaults from where the link is written**.
 * It is not a wildcard and not a search: every short form expands to exactly one
 * canonical address before anything is looked up.
 *
 * - package omitted → the current package.
 * - system omitted → the system block the link sits under; `none` everywhere
 *   else, including top-level frontmatter, `data:` and body prose.
 */
describe("expandAddress", () => {
    const here = { package: "thalorna", system: "sohl" };

    it("defaults both segments from the context", () => {
        expect(expandAddress({ type: "skill", shortcode: "zanth" }, here)).toBe(
            "thalorna-sohl-skill-zanth",
        );
    });

    it("takes a stated system over the context's", () => {
        expect(expandAddress({ type: "skill", shortcode: "zanth", system: "hm3" }, here)).toBe(
            "thalorna-hm3-skill-zanth",
        );
    });

    it("takes a stated package over the context's", () => {
        expect(
            expandAddress(
                { type: "skill", shortcode: "dge", package: "sohl", system: "sohl" },
                here,
            ),
        ).toBe("sohl-sohl-skill-dge");
    });

    it("is idempotent on an already-full address", () => {
        const full = { package: "sohl", system: "sohl", type: "weapongear", shortcode: "clb" };
        expect(expandAddress(full, here)).toBe("sohl-sohl-weapongear-clb");
    });

    it("lowercases, so an authored `Clb` keys the index as `clb`", () => {
        expect(expandAddress({ type: "weapongear", shortcode: "Clb" }, here)).toBe(
            "thalorna-sohl-weapongear-clb",
        );
    });

    describe("an omitted system names readable note content", () => {
        const prose = { package: "thalorna", system: NOTE_SYSTEM };

        it("resolves a bare prose link to the note's page", () => {
            expect(expandAddress({ type: "affiliation", shortcode: "sirvadar" }, prose)).toBe(
                "thalorna-note-affiliation-sirvadar",
            );
            expect(expandAddress({ type: "being", shortcode: "elowyrnimavren" }, prose)).toBe(
                "thalorna-note-being-elowyrnimavren",
            );
        });

        it("uses note for journal-only types", () => {
            for (const type of ["lore", "place", "scenario", "doc"]) {
                expect(expandAddress({ type, shortcode: "x" }, prose)).toBe(
                    `thalorna-note-${type}-x`,
                );
            }
        });

        it("reads a virtual documentation qualifier as the note Address", () => {
            expect(expandAddress({ type: "skill", shortcode: "melee", itemDoc: true }, prose)).toBe(
                "thalorna-note-skill-melee",
            );
        });

        it("keeps the Item reachable from prose via the full form", () => {
            // "and if not, then we should be using the full format" — a prose
            // link that means the Item states the system and gets it.
            expect(
                expandAddress(
                    { type: "skill", shortcode: "melee", package: "sohl", system: "sohl" },
                    prose,
                ),
            ).toBe("sohl-sohl-skill-melee");
        });
    });

    it("sends an explicit virtual documentation qualifier to note in a system block", () => {
        expect(expandAddress({ type: "skill", shortcode: "melee", itemDoc: true }, here)).toBe(
            "thalorna-note-skill-melee",
        );
    });
});

/**
 * Which system a frontmatter key path is written under — the other half of the
 * rule, and the only thing the resolver needs to be told.
 */
describe("blockSystem", () => {
    it("reads the system from the block a key sits under, at any depth", () => {
        expect(blockSystem("sohl.items.0.model")).toBe("sohl");
        expect(blockSystem("sohl.system.body.structure")).toBe("sohl");
        expect(blockSystem("hm3.items.3.model")).toBe("hm3");
        expect(blockSystem("sohl")).toBe("sohl");
    });

    it("is `note` everywhere else", () => {
        // Top-level frontmatter, the shared `data:` container, and body prose
        // (which has no key path at all) belong to no system block.
        expect(blockSystem("data.affiliations.0")).toBe(NOTE_SYSTEM);
        expect(blockSystem("name.full")).toBe(NOTE_SYSTEM);
        expect(blockSystem("shortcode")).toBe(NOTE_SYSTEM);
        expect(blockSystem("")).toBe(NOTE_SYSTEM);
        expect(blockSystem(undefined)).toBe(NOTE_SYSTEM);
    });

    it("is not fooled by a key that merely looks like a system", () => {
        // The segment has to *be* a declared system, not just any first key.
        expect(blockSystem("sohlish.items.0")).toBe(NOTE_SYSTEM);
        expect(blockSystem("notes.sohl.thing")).toBe(NOTE_SYSTEM);
    });
});
