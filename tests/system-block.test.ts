/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The per-system frontmatter block (#58).
 *
 * A note is system-agnostic; the only system-specific things are the
 * properties named after a system. `<system>.system` maps straight onto the
 * document's `system` property, the rest of the block is what the toolchain
 * needs in order to build the document at all, and every shared value reaches a
 * system field through a **declared** mapping rather than a shared spelling —
 * SoHL's `Actor.being` and HM3's `Actor.character` have no field name in
 * common, so a name-matched fallback between them never fires.
 *
 * These tests hold the mechanism. The corpus migration that exercises it is
 * #126, in other repositories.
 */

import { describe, it, expect } from "vitest";

import {
    BLOCK_DIRECTIVES,
    BLOCK_DOCUMENT_PROPERTIES,
    SYSTEM_BLOCK_KEYS,
    SYSTEM_DATA_KEY,
    blockField,
    blockProperty,
    carriesSystemBlock,
    mergeSystemData,
    resolveFieldValue,
    sharedProperty,
    systemBlock,
    systemData,
    systemDataPaths,
    undeclaredPaths,
    unknownBlockKeys,
} from "../engine/system-block.mjs";
import { buildFromFields, readField, NUMBER, STRING } from "../engine/field-spec.mjs";

/* --------------------------------------------------------------------- */
/*  Reading a block                                                       */
/* --------------------------------------------------------------------- */

describe("the vocabulary of a system block", () => {
    it("names the document properties a block maps onto", () => {
        // `effects` is plural, matching the existing top-level field and the
        // Foundry document property. A singular-to-plural rename that applied
        // to one property and not its neighbour would read as a typo for years.
        expect(Object.keys(BLOCK_DOCUMENT_PROPERTIES).sort()).toEqual([
            "effects",
            "flags",
            "img",
            "items",
            "system",
            "type",
        ]);
    });

    it("keeps `pack` a build directive, mapping onto no document property", () => {
        expect(BLOCK_DIRECTIVES).toContain("pack");
        expect(BLOCK_DOCUMENT_PROPERTIES).not.toHaveProperty("pack");
    });

    it("accepts every property and directive as a block key", () => {
        for (const key of [...Object.keys(BLOCK_DOCUMENT_PROPERTIES), ...BLOCK_DIRECTIVES]) {
            expect(SYSTEM_BLOCK_KEYS.has(key)).toBe(true);
        }
    });
});

describe("systemBlock / systemData / carriesSystemBlock", () => {
    it("reads the named block and nothing else", () => {
        const fm = { sohl: { type: "being" }, hm3: { type: "character" } };
        expect(systemBlock(fm, "sohl")).toEqual({ type: "being" });
        expect(systemBlock(fm, "hm3")).toEqual({ type: "character" });
        expect(systemBlock(fm, "dnd5e")).toBeUndefined();
    });

    it("treats a non-object block as absent", () => {
        expect(systemBlock({ sohl: "yes" }, "sohl")).toBeUndefined();
        expect(systemBlock({ sohl: ["a"] }, "sohl")).toBeUndefined();
        expect(carriesSystemBlock({ sohl: "yes" }, "sohl")).toBe(false);
    });

    it("answers whether a note carries a system's block at all", () => {
        expect(carriesSystemBlock({ sohl: {} }, "sohl")).toBe(true);
        expect(carriesSystemBlock({ hm3: {} }, "sohl")).toBe(false);
        expect(carriesSystemBlock({}, "sohl")).toBe(false);
    });

    it("returns an empty object for an absent or malformed `<system>.system`", () => {
        expect(systemData({}, "sohl")).toEqual({});
        expect(systemData({ sohl: {} }, "sohl")).toEqual({});
        expect(systemData({ sohl: { system: 3 } }, "sohl")).toEqual({});
        expect(systemData({ sohl: { system: { body: {} } } }, "sohl")).toEqual({ body: {} });
    });

    it("spells the data key `system`", () => {
        expect(SYSTEM_DATA_KEY).toBe("system");
    });
});

/* --------------------------------------------------------------------- */
/*  The declared shared → system mapping                                  */
/* --------------------------------------------------------------------- */

describe("the resolution order for a declared field", () => {
    const field = { to: "portrait", name: "data.portrait", default: "", describe: "" };

    it("prefers `<system>.system.<to>`, authored directly", () => {
        const fm = {
            data: { portrait: "shared.webp" },
            sohl: { portrait: "legacy.webp", system: { portrait: "own.webp" } },
        };
        expect(resolveFieldValue(field, fm, { block: "sohl" })).toEqual({
            value: "own.webp",
            from: "system",
        });
    });

    it("falls back to the block's own key — where the corpus writes it today", () => {
        const fm = { data: { portrait: "shared.webp" }, sohl: { "data.portrait": "legacy.webp" } };
        expect(resolveFieldValue(field, fm, { block: "sohl" }).from).toBe("block");
    });

    it("falls back to the shared property the field declares as its source", () => {
        const fm = { data: { portrait: "shared.webp" } };
        expect(resolveFieldValue(field, fm, { block: "sohl" })).toEqual({
            value: "shared.webp",
            from: "shared",
        });
    });

    it("falls back to the field's own default", () => {
        expect(resolveFieldValue(field, {}, { block: "sohl" })).toEqual({
            value: "",
            from: "default",
        });
    });

    it("reads a dotted shared source, not only a sibling key", () => {
        // `data:` (#128) puts every type-specific fact under a container, so
        // every shared→system row draws from a path *into* it. A rule that
        // accepted only a sibling key would never fire.
        const fm = { data: { species: "human" } };
        const species = { to: "species", name: "data.species", default: "", describe: "" };
        expect(resolveFieldValue(species, fm, { block: "hm3" }).value).toBe("human");
    });

    it("treats an authored `null` as authored, not as absent", () => {
        const fm = { data: { portrait: "shared.webp" }, sohl: { system: { portrait: null } } };
        expect(resolveFieldValue(field, fm, { block: "sohl" })).toEqual({
            value: null,
            from: "system",
        });
    });

    it("carries one shared source to two differently-named destinations", () => {
        // The whole objective. `Actor.being` declares `portrait`,
        // `Actor.character` declares `bioImage`, and the two schemas share no
        // field name at all — so nothing here can be name-matched.
        const fm = { data: { portrait: "kaldor.webp" } };
        const sohlField_ = { to: "portrait", name: "data.portrait", describe: "" };
        const hm3Field = { to: "bioImage", name: "data.portrait", describe: "" };
        expect(resolveFieldValue(sohlField_, fm, { block: "sohl" }).value).toBe("kaldor.webp");
        expect(resolveFieldValue(hm3Field, fm, { block: "hm3" }).value).toBe("kaldor.webp");
    });

    it("lets each system override the shared source independently", () => {
        const fm = {
            data: { portrait: "kaldor.webp" },
            hm3: { system: { bioImage: "hm3-only.webp" } },
        };
        const sohlField_ = { to: "portrait", name: "data.portrait", describe: "" };
        const hm3Field = { to: "bioImage", name: "data.portrait", describe: "" };
        expect(resolveFieldValue(sohlField_, fm, { block: "sohl" }).value).toBe("kaldor.webp");
        expect(resolveFieldValue(hm3Field, fm, { block: "hm3" }).value).toBe("hm3-only.webp");
    });

    it("resolves a field with no shared source only at `<system>.system.<to>`", () => {
        const derived = { to: "numDice", value: 2, describe: "" };
        expect(resolveFieldValue(derived, {}, { block: "sohl" })).toEqual({
            value: 2,
            from: "value",
        });
    });
});

describe("blockField", () => {
    it("generalizes `sohlField` to any block", () => {
        const fm = { weight: 3, hm3: { weight: 7 } };
        expect(blockField(fm, "hm3", "weight", 0)).toBe(7);
        expect(blockField(fm, "sohl", "weight", 0)).toBe(3);
    });
});

describe("sharedProperty", () => {
    it("reads a dotted path out of the top level, ignoring every block", () => {
        const fm = { data: { weight: 4 }, sohl: { data: { weight: 99 } } };
        expect(sharedProperty(fm, "data.weight", 0)).toBe(4);
        expect(sharedProperty(fm, "data.absent", "fallback")).toBe("fallback");
    });
});

/* --------------------------------------------------------------------- */
/*  Properties a block overrides                                          */
/* --------------------------------------------------------------------- */

describe("blockProperty", () => {
    it("prefers the block's value over the shared top-level one", () => {
        const fm = { pack: "items", hm3: { pack: "items-hm3" } };
        expect(blockProperty(fm, "hm3", "pack")).toBe("items-hm3");
        expect(blockProperty(fm, "sohl", "pack")).toBe("items");
    });

    it("gives `effects` and `flags` their per-system form for free", () => {
        const fm = { effects: [{ shared: true }], sohl: { effects: [{ own: true }] }, flags: {} };
        expect(blockProperty(fm, "sohl", "effects")).toEqual([{ own: true }]);
        expect(blockProperty(fm, "hm3", "effects")).toEqual([{ shared: true }]);
        expect(blockProperty(fm, "hm3", "flags")).toEqual({});
    });

    it("returns the supplied default when neither declares it", () => {
        expect(blockProperty({}, "sohl", "pack", "items")).toBe("items");
    });
});

/* --------------------------------------------------------------------- */
/*  The verbatim passthrough                                              */
/* --------------------------------------------------------------------- */

describe("mergeSystemData", () => {
    it("writes `<system>.system` onto the built block verbatim", () => {
        const built = { shortcode: "kal" };
        const fm = { sohl: { system: { currentMoveMedium: "walk", body: { weight: 12 } } } };
        expect(mergeSystemData(built, fm, { block: "sohl" })).toEqual({
            shortcode: "kal",
            currentMoveMedium: "walk",
            body: { weight: 12 },
        });
    });

    it("merges rather than replaces a container the builder already wrote", () => {
        const built = { body: { weight: 1, reachBase: 0 } };
        const fm = { sohl: { system: { body: { weight: 12 } } } };
        expect(mergeSystemData(built, fm, { block: "sohl" })).toEqual({
            body: { weight: 12, reachBase: 0 },
        });
    });

    it("leaves a path a declared field already claims to that field", () => {
        // A declared field's value came from the same authored place and went
        // through the field's own `read`; writing it a second time, uncoerced,
        // would make the coercion depend on which mechanism ran last.
        const built = { weightBase: 3 };
        const fm = { sohl: { system: { weightBase: "3", material: "iron" } } };
        expect(
            mergeSystemData(built, fm, { block: "sohl", claimed: new Set(["weightBase"]) }),
        ).toEqual({ weightBase: 3, material: "iron" });
    });

    it("treats an authored empty object as a value, not as nothing", () => {
        const fm = { sohl: { system: { body: {} } } };
        expect(mergeSystemData({}, fm, { block: "sohl" })).toEqual({ body: {} });
    });

    it("writes an array whole", () => {
        const fm = { sohl: { system: { movementProfiles: [{ medium: "walk" }] } } };
        expect(mergeSystemData({}, fm, { block: "sohl" })).toEqual({
            movementProfiles: [{ medium: "walk" }],
        });
    });

    it("changes nothing for a note carrying no block", () => {
        const built = { shortcode: "kal" };
        expect(mergeSystemData(built, {}, { block: "sohl" })).toEqual({ shortcode: "kal" });
    });
});

describe("systemDataPaths", () => {
    it("lists every authored path, containers included", () => {
        expect(systemDataPaths({ body: { weight: 1 }, moves: [1] }).sort()).toEqual([
            "body",
            "body.weight",
            "moves",
        ]);
    });
});

/* --------------------------------------------------------------------- */
/*  Checking a block against the system's published schema                */
/* --------------------------------------------------------------------- */

describe("undeclaredPaths", () => {
    const declared = new Set(["body", "body.weight", "currentMoveMedium"]);

    it("finds nothing when every authored path is declared", () => {
        expect(
            undeclaredPaths({ body: { weight: 12 }, currentMoveMedium: "walk" }, declared),
        ).toEqual([]);
    });

    it("names a key the schema does not declare", () => {
        expect(undeclaredPaths({ bodyy: {} }, declared)).toEqual(["bodyy"]);
    });

    it("reports the shallowest undeclared path, not every leaf beneath it", () => {
        // One mistake, one finding: everything under an undeclared container is
        // undeclared by construction, and listing it all buries the cause.
        expect(undeclaredPaths({ boddy: { weight: 1, reachBase: 2 } }, declared)).toEqual([
            "boddy",
        ]);
    });

    it("reports a nested key whose container is declared", () => {
        expect(undeclaredPaths({ body: { wieght: 1 } }, declared)).toEqual(["body.wieght"]);
    });
});

describe("unknownBlockKeys", () => {
    it("accepts the block vocabulary and a system's declared extras", () => {
        const fm = {
            sohl: {
                type: "being",
                pack: "actors",
                system: {},
                items: [],
                archetype: 1,
                kbcat: "people",
                attributes: {},
            },
        };
        expect(
            unknownBlockKeys(fm, "sohl", { known: ["archetype", "kbcat", "attributes"] }),
        ).toEqual([]);
    });

    it("reports a key neither the vocabulary nor the system declares", () => {
        const fm = { sohl: { systme: {} } };
        expect(unknownBlockKeys(fm, "sohl", { known: [] })).toEqual(["systme"]);
    });

    it("says nothing about a note carrying no block", () => {
        expect(unknownBlockKeys({}, "sohl", { known: [] })).toEqual([]);
    });
});

/* --------------------------------------------------------------------- */
/*  Through a field declaration                                           */
/* --------------------------------------------------------------------- */

describe("a field declaration reads through the block", () => {
    // How today's corpus is declared and authored: a bare shared key, which the
    // notes write inside the block. Both positions still resolve, so nothing
    // moves until #126.
    const today = [
        { to: "weightBase", name: "weight", ...NUMBER, default: 0, describe: "" },
        { to: "material", name: "material", ...STRING, default: "", describe: "" },
    ];
    // How #128's `data:` container makes it read: every type-specific source is
    // a path into a shared container, so every such row is dotted.
    const contained = [
        { to: "weightBase", name: "data.weight", ...NUMBER, default: 0, describe: "" },
        { to: "material", name: "data.material", ...STRING, default: "", describe: "" },
    ];

    it("still reads the legacy in-block position, so today's corpus is unmoved", () => {
        const fm = { sohl: { weight: 4, material: "iron" } };
        expect(buildFromFields(today)(fm)).toEqual({ weightBase: 4, material: "iron" });
    });

    it("prefers `<system>.system.<to>` when the note authors it", () => {
        const fm = { sohl: { weight: 4, system: { weightBase: 9 } } };
        expect(buildFromFields(today)(fm)).toEqual({ weightBase: 9, material: "" });
    });

    it("compiles the same declaration against a second system's block", () => {
        const fm = { data: { weight: 4, material: "iron" } };
        expect(buildFromFields(contained, { block: "hm3" })(fm)).toEqual({
            weightBase: 4,
            material: "iron",
        });
    });

    it("coerces a value authored at the system path exactly as a shared one", () => {
        const shared = { data: { weight: "7" } };
        const own = { sohl: { system: { weightBase: "7" } } };
        expect(readField(contained[0], shared)).toBe(7);
        expect(readField(contained[0], own)).toBe(7);
    });
});
