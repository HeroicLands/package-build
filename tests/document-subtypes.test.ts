/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The note-type → document-subtype map (#79).
 *
 * The two vocabularies — what a markdown note calls its `type`, and what
 * Foundry calls the document's subtype — were the same identifier because a
 * builder wrote the same string twice: `sohl/actors.mjs` declared
 * `ACTOR_VAULT_TYPE = "being"` and emitted `type: "being"` a few hundred lines
 * below it, with nothing relating the two. Change one and the other follows by
 * coincidence rather than by rule.
 *
 * These tests hold the mechanism that replaces the coincidence, and the SoHL
 * declaration that must — today — be the identity in every row, since the
 * compiled packs may not move by a byte.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    defineDocumentSubtypes,
    documentSubtype,
    mapsNoteType,
    noteTypesFor,
    subtypeRow,
} from "../engine/document-subtypes.mjs";
import { SOHL_DOCUMENT_SUBTYPES } from "../sohl/document-subtypes.mjs";
import { ITEM_FIELDS } from "../sohl/item-fields.mjs";
import { packForType } from "../engine/ids.mjs";
import { itemTypes } from "../engine/item-registry.mjs";
import { loadPackConfig } from "../engine/pack-config.mjs";
import { Items } from "../sohl/items.mjs";
import { Actors } from "../sohl/actors.mjs";

/** This package's own root — where its test fixtures live. */
const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * A **fixture system**, not SoHL.
 *
 * SoHL has no one-to-many row and this change does not invent one, so the
 * one-to-many mechanism is exercised against a system that exists only here.
 * It also carries a row whose subtype differs from its note type (`weapon` →
 * `weapongear`), which is the property the identity rows can never prove.
 */
const DEMO = defineDocumentSubtypes({
    system: "demo",
    types: {
        skill: { document: "Item", subType: "skill" },
        weapon: { document: "Item", subType: "weapongear" },
        being: {
            document: "Actor",
            discriminator: "kindOf",
            subTypes: ["character", "creature"],
        },
    },
});

describe("defineDocumentSubtypes (the declaration, and what it refuses)", () => {
    it("names the system, and reads a note's block of the same name by default", () => {
        expect(DEMO.system).toBe("demo");
        expect(DEMO.block).toBe("demo");
    });

    it("takes a block name that differs from the system's", () => {
        const map = defineDocumentSubtypes({
            system: "demo",
            block: "demoblock",
            types: { skill: { document: "Item", subType: "skill" } },
        });
        expect(map.block).toBe("demoblock");
    });

    it("refuses a declaration with no system", () => {
        expect(() => defineDocumentSubtypes({ types: {} } as never)).toThrow(/system/i);
    });

    it("refuses a row that names no document", () => {
        expect(() =>
            defineDocumentSubtypes({
                system: "demo",
                types: { skill: { subType: "skill" } } as never,
            }),
        ).toThrow(/skill.*document/is);
    });

    it("refuses a row that declares neither a subtype nor a discriminator", () => {
        expect(() =>
            defineDocumentSubtypes({
                system: "demo",
                types: { skill: { document: "Item" } },
            }),
        ).toThrow(/skill/);
    });

    it("refuses a row that declares both", () => {
        expect(() =>
            defineDocumentSubtypes({
                system: "demo",
                types: {
                    skill: {
                        document: "Item",
                        subType: "skill",
                        discriminator: "kindOf",
                        subTypes: ["a", "b"],
                    },
                },
            }),
        ).toThrow(/skill/);
    });

    it("refuses a discriminated row whose permitted values are empty", () => {
        expect(() =>
            defineDocumentSubtypes({
                system: "demo",
                types: { being: { document: "Actor", discriminator: "kindOf", subTypes: [] } },
            }),
        ).toThrow(/being/);
    });

    it("freezes the declaration, rows and all", () => {
        expect(Object.isFrozen(DEMO)).toBe(true);
        expect(Object.isFrozen(DEMO.types)).toBe(true);
        expect(Object.isFrozen(subtypeRow(DEMO, "skill"))).toBe(true);
    });
});

describe("documentSubtype (looked up, never inferred)", () => {
    it("returns the declared subtype for a one-to-one row", () => {
        expect(documentSubtype(DEMO, "skill", {})).toBe("skill");
    });

    it("returns a subtype that differs from the note type", () => {
        // The whole point: the note type is `weapon`, the document subtype is
        // `weapongear`, and no rule but the declaration connects them.
        expect(documentSubtype(DEMO, "weapon", {})).toBe("weapongear");
    });

    it("produces no document for a type this system does not map", () => {
        // Silent and correct — not an error, and not a wrongly-typed document.
        expect(documentSubtype(DEMO, "place", {})).toBeUndefined();
        expect(subtypeRow(DEMO, "place")).toBeUndefined();
        expect(mapsNoteType(DEMO, "place")).toBe(false);
        expect(documentSubtype(DEMO, undefined, {})).toBeUndefined();
    });

    it("answers which document a mapped type compiles into", () => {
        expect(mapsNoteType(DEMO, "being", "Actor")).toBe(true);
        expect(mapsNoteType(DEMO, "being", "Item")).toBe(false);
        expect(noteTypesFor(DEMO, "Item")).toEqual(["skill", "weapon"]);
        expect(noteTypesFor(DEMO, "Actor")).toEqual(["being"]);
    });
});

describe("a one-to-many row: the note supplies the discriminator", () => {
    it("reads it from that system's own block", () => {
        expect(documentSubtype(DEMO, "being", { demo: { kindOf: "creature" } })).toBe("creature");
        expect(documentSubtype(DEMO, "being", { demo: { kindOf: "character" } })).toBe("character");
    });

    it("does not read a top-level key of the same name", () => {
        // The discriminator is a statement about *this system's* document, so
        // it belongs in this system's block. A note carrying it at the top
        // level has not supplied it.
        expect(() => documentSubtype(DEMO, "being", { kindOf: "creature" })).toThrow(
            /demo\.kindOf/,
        );
    });

    it("is an error when absent — never a default", () => {
        expect(() => documentSubtype(DEMO, "being", { demo: {} })).toThrow(/demo\.kindOf/);
        // The permitted values are in the message, so the author is told what
        // to write rather than only that something is missing.
        expect(() => documentSubtype(DEMO, "being", {})).toThrow(/character/);
        expect(() => documentSubtype(DEMO, "being", {})).toThrow(/creature/);
        // A blank one is as absent as none at all.
        expect(() => documentSubtype(DEMO, "being", { demo: { kindOf: "" } })).toThrow(
            /demo\.kindOf/,
        );
    });

    it("is an error when it names a value the row does not permit", () => {
        expect(() => documentSubtype(DEMO, "being", { demo: { kindOf: "vehicle" } })).toThrow(
            /vehicle/,
        );
        expect(() => documentSubtype(DEMO, "being", { demo: { kindOf: "vehicle" } })).toThrow(
            /character/,
        );
    });

    it("names the note, and locates the offending line when it can", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sohl-subtypes-"));
        const absPath = path.join(dir, "Condor.md");
        fs.writeFileSync(
            absPath,
            ["---", "type: being", "demo:", "    power: 3", "---", "", "A bird.", ""].join("\n"),
            "utf8",
        );
        try {
            let thrown: (Error & { position?: { line?: number } }) | undefined;
            try {
                documentSubtype(DEMO, "being", { demo: { power: 3 } }, { file: absPath, absPath });
            } catch (err) {
                thrown = err as Error & { position?: { line?: number } };
            }
            expect(thrown?.message).toContain(absPath);
            // `demo:` is the note's line 3 — the block the discriminator is
            // missing from, which is where the author has to write it.
            expect(thrown?.position?.line).toBe(3);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("SOHL_DOCUMENT_SUBTYPES (the declaration this system ships)", () => {
    it("is declared for the `sohl` system and reads the `sohl:` block", () => {
        expect(SOHL_DOCUMENT_SUBTYPES.system).toBe("sohl");
        expect(SOHL_DOCUMENT_SUBTYPES.block).toBe("sohl");
    });

    it("declares one Item row per registered item type, and no others", () => {
        // The identity rows are written out, one per type: the coincidence of
        // names may never stand in for a mapping, so the map is not derived
        // from the registry's keys — it is checked against them.
        expect(noteTypesFor(SOHL_DOCUMENT_SUBTYPES, "Item")).toEqual(
            Object.keys(ITEM_FIELDS).sort(),
        );
        expect(noteTypesFor(SOHL_DOCUMENT_SUBTYPES, "Item")).toEqual([...itemTypes()].sort());
    });

    it("declares `being` as this system's one Actor row", () => {
        expect(noteTypesFor(SOHL_DOCUMENT_SUBTYPES, "Actor")).toEqual(["being"]);
    });

    it("maps every row to the identical subtype, which is why nothing moves", () => {
        // The evidence that compiled output cannot change: today every SoHL
        // row is the identity, so looking the subtype up returns exactly what
        // inferring it did. A row that ever stops being the identity is a
        // deliberate rename with a content migration behind it (#78).
        for (const type of Object.keys(SOHL_DOCUMENT_SUBTYPES.types)) {
            expect(documentSubtype(SOHL_DOCUMENT_SUBTYPES, type, {}), type).toBe(type);
        }
    });

    it("agrees with the engine's own note-type → document routing", () => {
        // Two declarations of related facts: the engine says which pack and
        // document class a note type routes to, this map says which subtype of
        // that class it becomes. They may not disagree about the class.
        for (const [type, row] of Object.entries(SOHL_DOCUMENT_SUBTYPES.types)) {
            expect(packForType(type).docType, type).toBe(row.document);
        }
    });
});

describe("the compilers look the subtype up", () => {
    /** The Item compiler, against this repository's own configuration. */
    function items() {
        const config = loadPackConfig();
        return new Items({
            contentBase: path.join(PKG_ROOT, "tests/fixtures"),
            dest: config.paths.packJson,
        });
    }

    /** The Actor compiler. Nothing here walks a tree or reads a pack. */
    function actors() {
        const config = loadPackConfig();
        return new Actors({
            contentBase: path.join(PKG_ROOT, "tests/fixtures"),
            dest: config.paths.packJson,
        });
    }

    const SKILL_FM = {
        id: "DDDDDDDDDDDDDDDD",
        type: "skill",
        shortcode: "awar",
        name: { full: "Awareness" },
        sohl: { subType: "physical", archetype: null },
    };

    const BEING_FM = {
        id: "EEEEEEEEEEEEEEEE",
        type: "being",
        shortcode: "folk",
        name: { full: "Basic Folk" },
        sohl: { archetype: null },
    };

    it("emits the item subtype the map declares", () => {
        expect(items().buildEntry(SKILL_FM, "").type).toBe("skill");
    });

    it("emits the actor subtype the map declares", () => {
        expect(actors().buildBeing(new Map(), BEING_FM, "").type).toBe("being");
    });

    it("claims exactly the note types their half of the map declares", () => {
        expect(actors().selects({ type: "being" })).toBe(true);
        expect(actors().selects({ type: "skill" })).toBe(false);
        expect(actors().selects({ type: "place" })).toBe(false);
        expect(actors().selects({})).toBe(false);

        expect(items().selects({ type: "skill" })).toBe(true);
        // An Actor row is not claimed by the Item pass even where a registry
        // happens to carry the name: no wrongly-typed document.
        expect(items().selects({ type: "being" })).toBe(false);
        expect(items().selects({ type: "place" })).toBe(false);
    });
});
