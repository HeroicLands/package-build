/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";

import {
    RENAMED_TYPES,
    RETIRED_TYPES,
    assertTypeNotRetired,
    currentType,
    packForType,
    renamedTypeMessage,
} from "../engine/ids.mjs";
import { documentSubtype, referencedSubtype, subtypeRow } from "../engine/document-subtypes.mjs";
import { SOHL_DOCUMENT_SUBTYPES } from "../sohl/document-subtypes.mjs";
import { HM3_DOCUMENT_SUBTYPES } from "../hm3/document-subtypes.mjs";
import { NOTE_VOCABULARY, dataFields, subTypes } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { ITEM_FIELDS } from "../sohl/item-fields.mjs";
import { HM3_ITEM_FIELDS } from "../hm3/item-fields.mjs";
import { GEAR_TYPE_TO_KEY, deriveBeingInfo } from "../sohl/being-info.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";

/**
 * Three note types are renamed off the `…gear` spellings that named the SoHL
 * *document* subtype rather than the thing the note is about. The renames land
 * as a retirement **window**, not a refusal: both spellings resolve, the
 * current one is canonical, the retired one is reported. The sweep of the four
 * content trees and the refusal come after.
 *
 * That is deliberate and it is what the rest of the codebase already does for a
 * renamed *field* (`img`/`image`, `templatePriority`/`archetype`). The old
 * names occur about 31,000 times, overwhelmingly as `(type, shortcode)`
 * references inside a being's `items:` list, so a toolchain release that
 * refused them would red every consumer's build until it had swept.
 */
describe("renamed content types", () => {
    it("names the current spelling of each renamed type", () => {
        expect(RENAMED_TYPES).toEqual({
            armor: "armorgear",
            concoction: "concoctiongear",
            projectile: "projectilegear",
        });
    });

    it("does not rename `weapongear`, which both systems call the document", () => {
        expect(RENAMED_TYPES).not.toHaveProperty("weapongear");
        expect(currentType("weapongear")).toBe("weapongear");
    });

    it("is a rename, not a retirement — the two tables never overlap", () => {
        // A retired type throws by name; a renamed one compiles. A name in both
        // tables would make the answer depend on which reader asked first.
        for (const retired of Object.keys(RENAMED_TYPES)) {
            expect(RETIRED_TYPES, retired).not.toHaveProperty(retired);
            expect(() => assertTypeNotRetired(retired)).not.toThrow();
        }
    });

    it("leaves anything it does not name alone, including a non-string", () => {
        expect(currentType("skill")).toBe("skill");
        expect(currentType("armorgear")).toBe("armorgear");
        expect(currentType(undefined)).toBeUndefined();
        expect(currentType(7)).toBe(7);
    });

    it("says what to write, and that the note compiles either way", () => {
        const message = renamedTypeMessage("armor", "armorgear", "/tree/Mail.md");
        expect(message).toContain('"armorgear"');
        expect(message).toContain('"armor"');
        expect(message).toContain("/tree/Mail.md");
        expect(message).toMatch(/not\s+wrong/);
    });
});

describe("both spellings reach the same declaration", () => {
    it.each(Object.entries(RENAMED_TYPES))("%s → %s: the same SoHL row", (retired, current) => {
        expect(subtypeRow(SOHL_DOCUMENT_SUBTYPES, retired)).toBe(
            subtypeRow(SOHL_DOCUMENT_SUBTYPES, current),
        );
    });

    it("emits the document subtype it always emitted, which is why packs cannot move", () => {
        expect(documentSubtype(SOHL_DOCUMENT_SUBTYPES, "armorgear", {})).toBe("armorgear");
        expect(documentSubtype(SOHL_DOCUMENT_SUBTYPES, "concoctiongear", {})).toBe(
            "concoctiongear",
        );
        expect(documentSubtype(SOHL_DOCUMENT_SUBTYPES, "projectilegear", {})).toBe(
            "projectilegear",
        );
        expect(documentSubtype(HM3_DOCUMENT_SUBTYPES, "armorgear", {})).toBe("armorgear");
        expect(documentSubtype(HM3_DOCUMENT_SUBTYPES, "projectilegear", {})).toBe("missilegear");
    });

    it("resolves an embedded `(type, shortcode)` reference on the old spelling", () => {
        // The side that carries ~1,000 old-spelling occurrences for every one a
        // note's own `type:` carries. Resolving notes but not references would
        // drop 30,000 embedded items in silence.
        expect(referencedSubtype(SOHL_DOCUMENT_SUBTYPES, "armorgear", "Item")).toEqual({
            subType: "armorgear",
        });
        expect(referencedSubtype(HM3_DOCUMENT_SUBTYPES, "projectilegear", "Item")).toEqual({
            subType: "missilegear",
        });
    });

    it("reads the same `data:` vocabulary under either spelling", () => {
        for (const [retired, current] of Object.entries(RENAMED_TYPES)) {
            expect(dataFields(retired), retired).toBe(dataFields(current));
            expect(subTypes(retired), retired).toBe(subTypes(current));
        }
    });

    it("routes to the items pack under either spelling", () => {
        for (const retired of Object.keys(RENAMED_TYPES)) {
            expect(packForType(retired), retired).toEqual({ pack: "items", docType: "Item" });
        }
    });

    it("groups a being's gear under the same sidebar heading either way", () => {
        const index = new Map();
        const out: any = deriveBeingInfo(
            {
                items: [
                    { type: "armorgear", shortcode: "mail", name: "Mail" },
                    { type: "armor", shortcode: "plate", name: "Plate" },
                ],
            },
            index,
        );
        expect(out.gear.armor.map((e: any) => e.name)).toEqual(["Mail", "Plate"]);
    });
});

describe("the tables themselves carry only the current spelling", () => {
    // A second key would be a second statement of the same fact, free to drift
    // — and it would double every enumeration built from these keys (the item
    // whitelist, a census line, the format's coverage report).
    it.each([
        ["NOTE_VOCABULARY", NOTE_VOCABULARY],
        ["NOTE_SCHEMAS", NOTE_SCHEMAS],
        ["ITEM_FIELDS", ITEM_FIELDS],
        ["HM3_ITEM_FIELDS", HM3_ITEM_FIELDS],
        ["GEAR_TYPE_TO_KEY", GEAR_TYPE_TO_KEY],
        ["SOHL_DOCUMENT_SUBTYPES.types", SOHL_DOCUMENT_SUBTYPES.types],
        ["HM3_DOCUMENT_SUBTYPES.types", HM3_DOCUMENT_SUBTYPES.types],
    ])("%s is keyed by the current spelling alone", (_name, table) => {
        for (const retired of Object.keys(RENAMED_TYPES)) {
            expect(table, retired).not.toHaveProperty(retired);
        }
    });

    it("declares `armorlocation`, which has no SoHL counterpart at all", () => {
        // The other half: the markdown vocabulary is system-agnostic, so
        // it is not limited to what SoHL happens to define.
        expect(NOTE_VOCABULARY).toHaveProperty("armorlocation");
        expect(NOTE_SCHEMAS).toHaveProperty("armorlocation");
        expect(HM3_ITEM_FIELDS).toHaveProperty("armorlocation");
        expect(subtypeRow(HM3_DOCUMENT_SUBTYPES, "armorlocation")).toEqual({
            document: "Item",
            subType: "armorlocation",
        });
        // Accepted, not merely ignored, by a system that does not map it.
        expect(subtypeRow(SOHL_DOCUMENT_SUBTYPES, "armorlocation")).toBeUndefined();
        expect(documentSubtype(SOHL_DOCUMENT_SUBTYPES, "armorlocation", {})).toBeUndefined();
    });
});

describe("a note on a retired spelling is reported, never refused", () => {
    const noteOn = (type: string) => ({
        file: `/tree/${type}.md`,
        type,
        raw: `---\ntype: ${type}\nshortcode: mail\n---\n`,
        fm: { type, shortcode: "mail", sohl: {} },
    });

    it("warns, naming the file, the line and what to write instead", () => {
        const findings = lintNote(noteOn("armor"), {
            schemas: NOTE_SCHEMAS,
            vocabulary: NOTE_VOCABULARY,
            references: false,
        });
        const renamed = findings.filter((f: any) => /was renamed to/.test(f.message));
        expect(renamed).toHaveLength(1);
        expect(renamed[0].severity).toBe("warning");
        expect(renamed[0].file).toBe("/tree/armor.md");
        expect(renamed[0].line).toBe(2);
        expect(renamed[0].message).toContain('"armorgear"');
    });

    it("still lints the note against its type rather than stopping there", () => {
        // The failure a bare rename would have caused: no schema for
        // `armorgear`, so the note is reported as a type nothing declares and
        // every other check on it is skipped.
        const findings = lintNote(noteOn("armorgear"), {
            schemas: NOTE_SCHEMAS,
            vocabulary: NOTE_VOCABULARY,
            references: false,
        });
        expect(findings.some((f: any) => /no schema is declared/.test(f.message))).toBe(false);
    });

    it("says nothing about a note already on the current spelling", () => {
        const findings = lintNote(noteOn("armorgear"), {
            schemas: NOTE_SCHEMAS,
            vocabulary: NOTE_VOCABULARY,
            references: false,
        });
        expect(findings.some((f: any) => /was renamed to/.test(f.message))).toBe(false);
    });
});
