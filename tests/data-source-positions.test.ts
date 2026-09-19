/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A `data:` source has a retiring top-level spelling, and it is read**.
 *
 * `data:` did not invent the facts it holds — it gathered them out of the
 * note's open top level, where `species:` sat beside `shortcode:`. So a field
 * declaring `data.species` has *two* shared spellings, and the resolver knew
 * only about the retiring **in-block** one. Step 3 read the declared source and
 * stopped, so the position the specification names never reached the document
 * and the `?? default` beside it dressed the miss up as "this note states
 * nothing".
 *
 * Two things have to be true at once, which is what makes this a
 * resolution-order rule rather than a one-line emitter fix:
 *
 * - `data.<key>` — what the specification's mapping tables name — must reach
 *   the document;
 * - the top-level `<key>:` must keep working, because a tree still on it has
 *   not been swept.
 *
 * So the resolver gained step 3b, and it is **derived** rather than declared:
 * the retiring spelling of `data.<key>` is `<key>`, because that is precisely
 * what the sweep did. A `protection.blunt` was never a `blunt:`, so it has none.
 */

import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveFieldValue, retiredTopLevelKey } from "../engine/system-block.mjs";
import { readField, readsRetiredTopLevel, STRING } from "../engine/field-spec.mjs";
import { retiredTopLevelMessage } from "../engine/retired-fields.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { loadPackConfig } from "../engine/pack-config.mjs";
import { Actors } from "../sohl/actors.mjs";
import { Hm3Actors } from "../hm3/actors.mjs";

/** This package's own root — where its test fixtures live. */
const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** A `data:`-sourced field with a retiring top-level spelling, as HM3 declares one. */
const SPECIES = Object.freeze({
    name: "data.species",
    legacyKey: "species",
    to: "species",
    ...STRING,
    default: "",
    describe: "The being's species, as a lore note.",
});

/* --------------------------------------------------------------------- */
/*  The derivation                                                        */
/* --------------------------------------------------------------------- */

describe("retiredTopLevelKey", () => {
    it("strips the `data.` a field's shared source declares", () => {
        expect(retiredTopLevelKey(SPECIES)).toBe("species");
        expect(retiredTopLevelKey({ name: "data.occupation" })).toBe("occupation");
    });

    it("keeps a nested `data:` path nested, so it addresses the same fact", () => {
        // `data.appearance.eye_color` was `appearance.eye_color` at the top
        // level, not `eye_color`: #128 moved the container, not its leaves.
        expect(retiredTopLevelKey({ name: "data.appearance.eye_color" })).toBe(
            "appearance.eye_color",
        );
    });

    it("answers for a `data.` source alone", () => {
        // A path into a container a note has *always* written at the top level.
        // Reading `blunt:` or `die:` would invent a position rather than
        // remember one — nothing was ever authored there.
        expect(retiredTopLevelKey({ name: "protection.blunt" })).toBeUndefined();
        expect(retiredTopLevelKey({ name: "impact.die" })).toBeUndefined();
        expect(retiredTopLevelKey({ name: "img" })).toBeUndefined();
    });

    it("answers for nothing when there is no source, or nothing after the prefix", () => {
        expect(retiredTopLevelKey({})).toBeUndefined();
        expect(retiredTopLevelKey({ name: "data." })).toBeUndefined();
        expect(retiredTopLevelKey(undefined as never)).toBeUndefined();
    });
});

/* --------------------------------------------------------------------- */
/*  The resolution order, with step 3b in it                              */
/* --------------------------------------------------------------------- */

describe("resolving a `data:`-sourced field", () => {
    it("reads the declared `data:` source — the position the specification names", () => {
        expect(
            resolveFieldValue(SPECIES, { data: { species: "lore-a" } }, { block: "sohl" }),
        ).toEqual({ value: "lore-a", from: "shared" });
    });

    it("reads the retiring top-level key, which `data:` gathered the fact off", () => {
        // The whole point: this is what `sohl`'s bestiary writes, on every
        // note, and it reached the resolver as an absence.
        expect(resolveFieldValue(SPECIES, { species: "lore-b" }, { block: "sohl" })).toEqual({
            value: "lore-b",
            from: "topLevel",
        });
    });

    it("prefers the current `data:` spelling to the retiring one", () => {
        expect(
            resolveFieldValue(
                SPECIES,
                { data: { species: "lore-a" }, species: "lore-b" },
                { block: "sohl" },
            ),
        ).toEqual({ value: "lore-a", from: "shared" });
    });

    it("still lets the in-block key win over both, as step 2 always did", () => {
        expect(
            resolveFieldValue(
                SPECIES,
                {
                    data: { species: "lore-a" },
                    species: "lore-b",
                    sohl: { species: "lore-c" },
                },
                { block: "sohl" },
            ),
        ).toEqual({ value: "lore-c", from: "block" });
    });

    it("still lets the destination path win over everything", () => {
        expect(
            resolveFieldValue(
                SPECIES,
                {
                    data: { species: "lore-a" },
                    species: "lore-b",
                    sohl: { species: "lore-c", system: { species: "lore-d" } },
                },
                { block: "sohl" },
            ),
        ).toEqual({ value: "lore-d", from: "system" });
    });

    it("falls to the default when no position carries it", () => {
        expect(resolveFieldValue(SPECIES, { name: { full: "x" } }, { block: "sohl" })).toEqual({
            value: "",
            from: "default",
        });
    });

    it("reads no top-level key at all for a field that declares `topLevelMeans`", () => {
        // The opt-out removes the shared *level*, not one spelling of it: the
        // objection is that the note's top level means something else here, and
        // that is as true of the retiring position as of the current one.
        const exempt = { ...SPECIES, topLevelMeans: "the note's own heading" };
        expect(
            resolveFieldValue(
                exempt,
                { species: "lore-b", data: { species: "lore-a" } },
                { block: "sohl" },
            ),
        ).toEqual({ value: "", from: "default" });
    });

    it("leaves a non-`data:` shared source resolving exactly as it did", () => {
        // The guard on the whole change: every declared field has a
        // bare or non-`data.` source, so none of them gained a position.
        const blunt = { name: "protection.blunt", to: "protection.blunt", ...STRING, default: "" };
        expect(resolveFieldValue(blunt, { blunt: "5" }, { block: "sohl" })).toEqual({
            value: "",
            from: "default",
        });
    });
});

/* --------------------------------------------------------------------- */
/*  Nothing is dropped in silence                                         */
/* --------------------------------------------------------------------- */

describe("the retiring top-level position is reported", () => {
    it("is what `readsRetiredTopLevel` counts, and only that", () => {
        expect(readsRetiredTopLevel(SPECIES, "topLevel")).toBe(true);
        expect(readsRetiredTopLevel(SPECIES, "shared")).toBe(false);
        expect(readsRetiredTopLevel(SPECIES, "block")).toBe(false);
        expect(readsRetiredTopLevel(SPECIES, "default")).toBe(false);
    });

    it("calls back once, naming the field, when a note is read from it", () => {
        const onRetiredTopLevel = vi.fn();
        readField(SPECIES, { species: "lore-b" }, { block: "sohl", onRetiredTopLevel });
        expect(onRetiredTopLevel).toHaveBeenCalledTimes(1);
        expect(onRetiredTopLevel).toHaveBeenCalledWith(SPECIES);
    });

    it("stays quiet for a note already on `data:`", () => {
        const onRetiredTopLevel = vi.fn();
        readField(SPECIES, { data: { species: "lore-a" } }, { block: "sohl", onRetiredTopLevel });
        expect(onRetiredTopLevel).not.toHaveBeenCalled();
    });

    it("says which spelling moves where, and that the value is unaffected", () => {
        const message = retiredTopLevelMessage(SPECIES);
        expect(message).toContain("top-level `species:`");
        expect(message).toContain("`data.species:`");
        expect(message).toContain("Both are read");
    });
});

/* --------------------------------------------------------------------- */
/*  The emitters — the acceptance criteria themselves                     */
/* --------------------------------------------------------------------- */

/**
 * A compile index holding the files these cases name.
 *
 * A species is an `image` address, so the compile answers it from the index
 * rather than from a path; these cases stand in for that with the files they
 * name.
 */
function artIndex(): any {
    const files: Record<string, [string, string]> = {
        akhr: ["image", "images/beings/akhr.webp"],
        donkey: ["image", "images/being/donkey-species.webp"],
        newart: ["image", "images/new.webp"],
        oldart: ["image", "images/old.webp"],
        x: ["icon", "icons/x.svg"],
        defaultcharhead: ["icon", "icons/other/defaultcharhead.webp"],
    };
    return {
        types: new Set(["icon", "image", "audio"]),
        packages: new Set(["sohl"]),
        contentPackage: "sohl",
        assets: new Map(
            Object.entries(files).map(([shortcode, [type, assetPath]]) => [
                `sohl-none-${type}-${shortcode}`,
                { package: "sohl", asset: { path: assetPath } },
            ]),
        ),
        foreign: new Map(),
    };
}

/** The SoHL Actor compiler. Nothing here walks a tree or reads a pack. */
function actors() {
    const config = loadPackConfig();
    const pack = new Actors({
        skipDirectories: [],
        contentBase: path.join(PKG_ROOT, "tests/fixtures"),
        dest: config.paths.packJson,
    });
    pack.linkIndex = artIndex();
    return pack;
}

/** The HM3 Actor compiler, likewise. */
function hm3Actors() {
    const config = loadPackConfig();
    const pack = new Hm3Actors({
        skipDirectories: [],
        contentBase: path.join(PKG_ROOT, "tests/fixtures"),
        dest: config.paths.packJson,
    });
    pack.linkIndex = artIndex();
    return pack;
}

/** A being note, with whatever art positions a case needs. */
const beingNote = (extra: Record<string, unknown>) => ({
    id: "EEEEEEEEEEEEEEEE",
    type: "being",
    shortcode: "folk",
    name: { full: "Basic Folk" },
    data: { templatePriority: null },
    ...extra,
});

/** The art a `character` falls back to, which this index answers locally. */
const DEFAULT_BEING_ART = "systems/sohl/assets/icons/other/defaultcharhead.webp";

/** The subtype's own default, beneath the being's. */
const SUBTYPE_ART = "systems/sohl/assets/icons/game-icons/delapouite/person.svg";
