/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The map a pack declaring no system compiles against.
 *
 * `DEFAULT_DOCUMENT_SUBTYPES` is the one place outside `compilerFor` that says
 * whose data a systemless pack's documents are, and it exists because the
 * infobox cannot reach a compiler class: `engine/item-compiler.mjs` imports the
 * journals pass, which draws infoboxes, so importing a pass from the infobox
 * closes a cycle on a `class … extends` and breaks module evaluation.
 *
 * That makes it a statement of a fact decided elsewhere, and this is what keeps
 * the two from disagreeing in silence. Both halves are derived at runtime — the
 * document classes from the shipped subtype maps, the answer from `compilerFor`
 * — so a system added, a fallback changed or a class retargeted fails here
 * rather than quietly making every infobox in a single-system package claim the
 * wrong system.
 */

import { describe, it, expect } from "vitest";

import { compilerFor } from "../engine/generate.mjs";
import {
    DEFAULT_DOCUMENT_SUBTYPES,
    KNOWN_DOCUMENT_SUBTYPE_MAPS,
} from "../engine/subtype-registry.mjs";

/** Every Foundry document class some shipped map carries a row for. */
function systemDocumentClasses(): string[] {
    const classes = new Set<string>();
    for (const map of KNOWN_DOCUMENT_SUBTYPE_MAPS) {
        for (const row of Object.values(
            (map as { types: Record<string, { document: string }> }).types,
        )) {
            if (row?.document) classes.add(row.document);
        }
    }
    return [...classes].sort();
}

describe("a pack declaring no system", () => {
    it("carries a row for at least one document class", () => {
        // The loops below assert nothing over an empty list.
        expect(systemDocumentClasses().length).toBeGreaterThan(0);
    });

    it("is compiled against the map the registry names", () => {
        for (const docType of systemDocumentClasses()) {
            const pass = compilerFor(docType, null) as
                { documentSubtypes?: { system?: string } } | undefined;
            expect(pass, `no compiler for ${docType}`).toBeTruthy();
            expect(
                pass?.documentSubtypes,
                `the fallback pass for ${docType} declares no \`documentSubtypes\``,
            ).toBe(DEFAULT_DOCUMENT_SUBTYPES);
        }
    });

    it("needs no block, because its pass is the only one writing that pack", () => {
        // The infobox reads a systemless pack as compiling every note its map
        // claims. That is `eligibleFor`'s own short-circuit — `!this.packSystem`
        // — and it holds whatever the pass says about `requiresSystemBlock`.
        for (const docType of systemDocumentClasses()) {
            const pass = compilerFor(docType, null) as { requiresSystemBlock?: boolean };
            expect(
                pass.requiresSystemBlock,
                `${docType}'s pass no longer declares itself a system's data`,
            ).toBe(true);
        }
    });

    it("answers for one system, the one its map declares", () => {
        expect(
            KNOWN_DOCUMENT_SUBTYPE_MAPS.map((map) => (map as { system: string }).system),
        ).toContain((DEFAULT_DOCUMENT_SUBTYPES as { system: string }).system);
    });
});
