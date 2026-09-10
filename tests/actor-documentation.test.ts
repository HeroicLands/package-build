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

import { docEntryTypes, hasDocEntry, itemTypes } from "../engine/item-docs.mjs";
import { KNOWN_DOCUMENT_SUBTYPE_MAPS } from "../engine/subtype-registry.mjs";

/**
 * #337 — an actor note publishes documentation like every other system-bearing
 * note, so its prose has a `none` address a prose link can land on.
 *
 * The Actor keeps its own inline `appearance` / `dossier`: an item's pointer is
 * a compendium-bloat measure, paid because one item is embedded across hundreds
 * of beings, and an actor is singular so the indirection buys nothing.
 */
describe("an actor note carries a documentation journal (#337)", () => {
    it("counts `being` among the doc-carrying types", () => {
        expect(hasDocEntry("being")).toBe(true);
        expect(docEntryTypes().has("being")).toBe(true);
    });

    it("counts every type any shipped map compiles into an Actor", () => {
        const actorTypes = new Set<string>();
        for (const map of KNOWN_DOCUMENT_SUBTYPE_MAPS) {
            for (const [type, row] of Object.entries(
                (map as unknown as { types: Record<string, { document?: string }> }).types,
            )) {
                if (row?.document === "Actor") actorTypes.add(type);
            }
        }
        // Guard the guard: a map that declared no actor at all would make the
        // loop below vacuous and the test green for the wrong reason.
        expect(actorTypes.size).toBeGreaterThan(0);
        for (const type of actorTypes) {
            expect(hasDocEntry(type), type).toBe(true);
        }
    });

    it("still excludes `doc`, whose single document is the prose itself", () => {
        expect(hasDocEntry("doc")).toBe(false);
        expect(docEntryTypes().has("doc")).toBe(false);
    });

    it("compiles no entry for a being with no prose, as for an item with none", () => {
        // `SystemJournalCompiler#skipNote` is `hasDocEntry(type) && !body`, so
        // widening the set widens the skip with it: a being that authors no
        // prose gets no journal, rather than an empty one nothing can read.
        const skipNote = (fm: { type: string }, body: string) =>
            hasDocEntry(fm.type) && !String(body).trim();

        expect(skipNote({ type: "being" }, "")).toBe(true);
        expect(skipNote({ type: "being" }, "   \n  ")).toBe(true);
        expect(skipNote({ type: "being" }, "Tall and scarred.")).toBe(false);
        // The same answers an item note has always got.
        expect(skipNote({ type: "weapongear" }, "")).toBe(true);
        expect(skipNote({ type: "weapongear" }, "A blade.")).toBe(false);
    });

    it("does not make an actor type an item type", () => {
        // `docEntryTypes` widens; the items pass's whitelist must not, or a
        // being note would be compiled into an Item as well as an Actor.
        expect(docEntryTypes().has("being")).toBe(true);
        expect(itemTypes().has("being")).toBe(false);
    });
});
