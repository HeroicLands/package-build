/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import { docEntryTypes, hasDocEntry } from "../engine/item-docs.mjs";
import { MAP_TYPES, PACK_BY_TYPE, RETIRED_TYPES, isMapType } from "../engine/ids.mjs";

describe("map note types", () => {
    it("recognises the one map type, the other names being subtypes", () => {
        expect([...MAP_TYPES]).toEqual(["map"]);
        expect(isMapType("map")).toBe(true);
        expect(isMapType("battlemap")).toBe(false);
        expect(isMapType("skill")).toBe(false);
        expect(isMapType(undefined)).toBe(false);
    });

    it("names each retired spelling, rather than routing it to the items pack", () => {
        for (const old of ["battlemap", "localmap", "regionalmap"]) {
            expect(RETIRED_TYPES[old], old).toBe("map");
        }
    });

    it("routes the one type to the scenes pack", () => {
        expect(PACK_BY_TYPE.map).toEqual({ pack: "scenes", docType: "Scene" });
    });

    it("is one of the doc-carrying types, so its prose gets a JournalEntry", () => {
        for (const type of MAP_TYPES) {
            expect(hasDocEntry(type), type).toBe(true);
            expect(docEntryTypes().has(type), type).toBe(true);
        }
    });
});
