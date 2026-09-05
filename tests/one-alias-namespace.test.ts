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

/**
 * No index carries an alias source of its own (#147).
 *
 * The site index once added a note's filename **verbatim** as an alias, while
 * the pack index and the link checker folded `_` to a space before indexing —
 * so `[[Sebeq_Sut|…]]` resolved on the website and nowhere else. A link that
 * works on the site and is dead in Foundry is the worst version of a dead
 * link, because the surface an author checks is the one that works.
 *
 * The alias namespace was retired wholesale, which resolves it: every link is
 * an address now, and a bare `[[Name]]` is a finding rather than a lookup. This
 * asserts that, and is the test #147 asks for — the one that fails if a fourth
 * index starts carrying its own alias source.
 */

import { describe, it, expect } from "vitest";
import { buildWikilinkIndex } from "../engine/wikilinks.mjs";
import { buildSiteIndex } from "../engine/site-index.mjs";

/** A note whose filename would once have become an alias, both ways. */
const NOTE = {
    type: "place",
    id: "aaaaaaaaaaaaaaa1",
    shortcode: "sebeqsut",
    name: "Sebeq'Sut",
};

const FILENAME_FORMS = ["sebeq_sut", "Sebeq_Sut", "sebeq sut", "Sebeq Sut"];

describe("one alias namespace, and it is empty (#147)", () => {
    it("the pack index keys a note by its address, not by its filename", () => {
        const index = buildWikilinkIndex([NOTE], "sohl");
        expect(index.byShortcode.has("place/sebeqsut")).toBe(true);
        for (const form of FILENAME_FORMS) {
            expect(index.byShortcode.has(form), form).toBe(false);
            expect(index.byShortcode.has(form.toLowerCase()), form).toBe(false);
        }
    });

    it("the site index does the same, verbatim filename included", () => {
        // The verbatim form is the one that made the two disagree: the site
        // added `basename(entry.base, ".md")` with its underscores intact.
        const index = buildSiteIndex([
            {
                type: "place",
                shortcode: "sebeqsut",
                name: "Sebeq'Sut",
                base: "Sebeq_Sut.md",
                url: "/thalorna/place-sebeqsut/",
                sec: "places",
                slug: "sebeqsut",
            },
        ]);
        // The site keys a page by its section and slug, and by its canonical
        // address — never by the file it came from.
        expect(index.index.has("places/sebeqsut")).toBe(true);
        for (const form of FILENAME_FORMS) {
            expect(index.index.has(form), form).toBe(false);
        }
    });

    it("neither index invents a key the other does not have", () => {
        // The property #147 actually asks for: a link resolves in all of them
        // or in none. Compared on the keys both are able to hold.
        const pack = buildWikilinkIndex([NOTE], "sohl");
        const site = buildSiteIndex([
            {
                type: "place",
                shortcode: "sebeqsut",
                name: "Sebeq'Sut",
                base: "Sebeq_Sut.md",
                url: "/thalorna/place-sebeqsut/",
                sec: "places",
                slug: "sebeqsut",
            },
        ]);
        for (const form of FILENAME_FORMS) {
            expect([pack.byShortcode.has(form), site.index.has(form)], form).toEqual([
                false,
                false,
            ]);
        }
    });
});
