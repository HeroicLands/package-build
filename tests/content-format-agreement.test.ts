/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { loadContentFormat } from "../engine/content-format.mjs";
import { IMAGE_CLASSES, IMAGE_FLOATS, IMAGE_SIZES } from "../engine/content-images.mjs";
import { DECLARED_TAGS, NOTE_VOCABULARY, SHARED_DATA_FIELDS } from "../engine/note-vocabulary.mjs";
import { MARKET_CLASSES } from "../engine/market-class.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const contract = loadContentFormat();

describe("the structured format contract", () => {
    it("covers every declared type and its schema", () => {
        expect([...contract.types.keys()].sort()).toEqual(Object.keys(NOTE_VOCABULARY).sort());
        expect([...contract.types.keys()].sort()).toEqual(Object.keys(NOTE_SCHEMAS).sort());
    });

    it("covers every type-specific field and subtype", () => {
        for (const [type, spec] of contract.types) {
            const declaration = NOTE_VOCABULARY[type as keyof typeof NOTE_VOCABULARY];
            expect([...spec.dataPaths].sort(), `${type} fields`).toEqual(
                (declaration.data ?? []).map((field: { name: string }) => field.name).sort(),
            );
            expect(spec.subTypes, `${type} subtypes`).toEqual(declaration.subTypes ?? []);
        }
    });

    it("gives every author-facing data field an explanation", () => {
        for (const field of SHARED_DATA_FIELDS) {
            expect(field.describe?.trim(), `shared ${field.name}`).toBeTruthy();
        }
        for (const [type, vocabulary] of Object.entries(NOTE_VOCABULARY)) {
            for (const field of vocabulary.data ?? []) {
                expect(field.describe?.trim(), `${type}.${field.name}`).toBeTruthy();
            }
        }
    });

    it("covers renderer and validator vocabularies", () => {
        expect(
            contract.vocabularies.get("class")?.values.map((value) => value.replace(/^\./, "")),
        ).toEqual(Object.keys(IMAGE_CLASSES));
        expect(contract.vocabularies.get("float")?.values).toEqual(Object.keys(IMAGE_FLOATS));
        expect(contract.vocabularies.get("size")?.values).toEqual(IMAGE_SIZES);
        expect(contract.vocabularies.get("beingKind")?.values).toEqual([
            ...DECLARED_TAGS.beingKind.tags,
        ]);
        expect(contract.vocabularies.get("market")?.values).toEqual(
            MARKET_CLASSES.map((entry) => String(entry.value)),
        );
    });

    it("holds each mapping to a declared type and a system target", () => {
        expect(contract.claims.length).toBeGreaterThan(70);
        for (const claim of contract.claims) {
            if (!claim.shared)
                expect(contract.types.has(claim.noteType), claim.noteType).toBe(true);
            expect(["sohl", "hm3"]).toContain(claim.system);
            expect(claim.target).toMatch(/^system\./);
            expect(claim.line).toBeGreaterThan(0);
            expect(claim.column).toBeGreaterThan(0);
        }
    });
});
