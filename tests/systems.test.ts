/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **The closed registry of system ids**.
 *
 * The `<system>` segment of a canonical address is filled from a vocabulary,
 * and the issue is specific about where that vocabulary comes from: "known
 * system ids come from a closed registry, not a hardcoded set; an unknown value
 * is an error. Adding a system is a data change."
 *
 * Two things follow, and they are what these cases hold:
 *
 * - The registry is the **only** list. So it has to agree with the maps that
 *   make each system real — a system this toolchain compiles but the registry
 *   has not heard of would be refused by the very grammar that has to address
 *   its documents.
 * - `none` is a **word**, not a null and not a wildcard. That distinction is
 *   load-bearing rather than stylistic: a null cannot occupy a positional
 *   segment, and "answered as none" has to stay distinguishable from "nobody
 *   filled this in".
 */

import { describe, it, expect } from "vitest";

import {
    NO_SYSTEM,
    SYSTEM_IDS,
    SYSTEM_SEGMENTS,
    assertSystemCharset,
    assertSystemSegment,
    isSystemId,
    isSystemSegment,
    unknownSystemMessage,
} from "../engine/systems.mjs";
import { isAddressSegment } from "../engine/address-charset.mjs";
import { KNOWN_DOCUMENT_SUBTYPE_MAPS } from "../engine/note-claims.mjs";

describe("the registry", () => {
    it("declares every system this toolchain ships a map for", () => {
        // The agreement the registry cannot check for itself: `systems.mjs` is
        // a leaf and deliberately does not import `sohl/` or `hm3/` to derive
        // this list, so *this* is what keeps a new system half from shipping
        // with an id no address may name.
        for (const map of KNOWN_DOCUMENT_SUBTYPE_MAPS) {
            expect(SYSTEM_IDS.has(map.system), `map declares \`${map.system}\``).toBe(true);
        }
    });

    it("declares nothing the maps do not, so the list is not aspirational", () => {
        // The other direction. An id nobody compiles would be accepted in an
        // address, resolve to no document, and report nothing about why.
        const mapped = new Set(KNOWN_DOCUMENT_SUBTYPE_MAPS.map((map) => map.system));
        expect([...SYSTEM_IDS].filter((id) => !mapped.has(id))).toEqual([]);
    });

    it("is frozen, so a caller cannot add a system by writing to the set", () => {
        // "Adding a system is a data change" means an edit to the declaration,
        // reviewable in a diff — not a `SYSTEM_IDS.add()` somewhere in a build.
        expect(Object.isFrozen(SYSTEM_IDS)).toBe(true);
        expect(Object.isFrozen(SYSTEM_SEGMENTS)).toBe(true);
    });

    it("holds every id to the address charset", () => {
        // A system id is a segment of every address that names it, so a
        // hyphenated one would be read back as two segments — the failure
        // `harn-adventures` was.
        for (const id of SYSTEM_SEGMENTS) expect(isAddressSegment(id)).toBe(true);
    });
});

describe("`none`", () => {
    it("is the word `none`, and is a segment but not a system", () => {
        expect(NO_SYSTEM).toBe("none");
        expect(isSystemSegment(NO_SYSTEM)).toBe(true);
        // The two questions differ, and conflating them is how `none` ends up
        // keying a pack table or a document-subtype map that has no such row.
        expect(isSystemId(NO_SYSTEM)).toBe(false);
        expect(SYSTEM_IDS.has(NO_SYSTEM)).toBe(false);
    });

    it("is not spelled as a YAML null, in any of the spellings", () => {
        // `null`, `~` and a key written with no value all reach a reader as an
        // absence, and an absence cannot occupy a positional segment — the
        // address would lose a field rather than say "no system".
        for (const value of [null, undefined, ""]) {
            expect(isSystemSegment(value)).toBe(false);
        }
        // The literal strings a YAML author might reach for are not it either.
        for (const value of ["null", "~", "nil"]) {
            expect(isSystemSegment(value)).toBe(false);
        }
    });

    it("is not `any`, which would read as a wildcard", () => {
        // A note outside every system compiles into a Foundry core document —
        // one document, belonging to no system — rather than into one document
        // per system, which is what `any` invites a reader to assume.
        expect(isSystemSegment("any")).toBe(false);
        expect(isSystemSegment("all")).toBe(false);
        expect(isSystemSegment("*")).toBe(false);
    });
});

describe("the predicates", () => {
    it("accept the declared systems and nothing else", () => {
        expect(isSystemId("sohl")).toBe(true);
        expect(isSystemId("hm3")).toBe(true);
        expect(isSystemId("harnmaster")).toBe(false);
        expect(isSystemId("SOHL")).toBe(false);
    });

    it("answer `false` for a non-string rather than throwing", () => {
        // They are asked about whatever a note or a configuration file
        // happened to carry, which is not necessarily a string.
        for (const value of [42, true, {}, [], null, undefined]) {
            expect(isSystemId(value)).toBe(false);
            expect(isSystemSegment(value)).toBe(false);
        }
    });
});

describe("an unknown value is an error", () => {
    it("throws, naming the value and the whole known vocabulary", () => {
        // A reader who wrote the wrong word needs the right words, not a
        // restatement that the wrong one is wrong.
        let message = "";
        try {
            assertSystemSegment("harnmaster", "sohl-harnmaster-skill-clmb");
        } catch (err) {
            message = (err as Error).message;
        }
        expect(message).toContain("harnmaster");
        expect(message).toContain("sohl-harnmaster-skill-clmb");
        for (const id of SYSTEM_SEGMENTS) expect(message).toContain(`\`${id}\``);
    });

    it("says why `any` is not among them, since that is the likely guess", () => {
        expect(unknownSystemMessage("any")).toMatch(/wildcard/);
    });

    it("reports an absent value as an absent value, not as an unknown word", () => {
        // `undefined` interpolated into "names `undefined`" sends a reader
        // looking for a word that is not in their file.
        const message = unknownSystemMessage(undefined, "the note");
        expect(message).toContain(`\`${NO_SYSTEM}\``);
        expect(message).not.toContain("`undefined`");
    });

    it("returns the value when it is known, so a caller can validate inline", () => {
        expect(assertSystemSegment("sohl")).toBe("sohl");
        expect(assertSystemSegment(NO_SYSTEM)).toBe(NO_SYSTEM);
    });
});

describe("the registry's own charset guard", () => {
    it("refuses a declaration that could not be an address segment", () => {
        // Run over the shipped registry as the module loads, so this can only
        // be exercised with a registry posed by hand. A bad *declaration* is
        // worse than a bad note: it makes every address naming that system
        // unreadable, rather than one.
        expect(() => assertSystemCharset(["sohl", "harn-master"], "a registry")).toThrow(
            /harn-master/,
        );
    });

    it("names every offender at once, since a reader is fixing a list", () => {
        let message = "";
        try {
            assertSystemCharset(["harn-master", "kéthira"]);
        } catch (err) {
            message = (err as Error).message;
        }
        expect(message).toContain("harn-master");
        expect(message).toContain("kéthira");
    });

    it("accepts the shipped registry, which is why importing it works", () => {
        expect(() => assertSystemCharset(SYSTEM_SEGMENTS)).not.toThrow();
    });
});
