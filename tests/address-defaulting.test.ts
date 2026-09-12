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
import { NO_SYSTEM } from "../engine/systems.mjs";

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

    describe("under `none`, a system-bearing type addresses its documentation", () => {
        const prose = { package: "thalorna", system: NO_SYSTEM };

        it("resolves a bare prose link to the note's page", () => {
            // A note's `none` address IS its `doc<type>` journal, so this is the
            // defaulting rule rather than an exception to it. From prose it is
            // almost always the page a reader wants.
            expect(expandAddress({ type: "affiliation", shortcode: "sirvadar" }, prose)).toBe(
                "thalorna-none-docaffiliation-sirvadar",
            );
            expect(expandAddress({ type: "being", shortcode: "elowyrnimavren" }, prose)).toBe(
                "thalorna-none-docbeing-elowyrnimavren",
            );
        });

        it("leaves a system-less type alone — it has no `doc` form", () => {
            for (const type of ["lore", "place", "scenario", "doc", "folder"]) {
                expect(expandAddress({ type, shortcode: "x" }, prose)).toBe(
                    `thalorna-none-${type}-x`,
                );
            }
        });

        it("does not double the prefix on an explicit `doc<type>`", () => {
            expect(expandAddress({ type: "skill", shortcode: "melee", itemDoc: true }, prose)).toBe(
                "thalorna-none-docskill-melee",
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

    it("sends a `doc<type>` to `none` even from inside a system block", () => {
        // A documentation journal is a core document; no game system defines
        // one. So the explicit form means `none` wherever it is written, and
        // cannot be dragged into a system by its surroundings.
        expect(expandAddress({ type: "skill", shortcode: "melee", itemDoc: true }, here)).toBe(
            "thalorna-none-docskill-melee",
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

    it("is `none` everywhere else", () => {
        // Top-level frontmatter, the shared `data:` container, and body prose
        // (which has no key path at all) belong to no system block.
        expect(blockSystem("data.affiliations.0")).toBe(NO_SYSTEM);
        expect(blockSystem("name.full")).toBe(NO_SYSTEM);
        expect(blockSystem("shortcode")).toBe(NO_SYSTEM);
        expect(blockSystem("")).toBe(NO_SYSTEM);
        expect(blockSystem(undefined)).toBe(NO_SYSTEM);
    });

    it("is not fooled by a key that merely looks like a system", () => {
        // The segment has to *be* a declared system, not just any first key.
        expect(blockSystem("sohlish.items.0")).toBe(NO_SYSTEM);
        expect(blockSystem("notes.sohl.thing")).toBe(NO_SYSTEM);
    });
});
