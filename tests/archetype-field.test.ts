/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `archetype` is a **schema field**, not a flag.
 *
 * The authored form is unchanged — a required nullable number at the top level
 * of a note's system block — and only the emission target moves, from
 * `flags.sohl.docArchetype` to `system.archetype`. So the cases below are the
 * ones the flag carried; their subject is what changed.
 *
 * The falsy trap is what these tests exist to hold. `0` means "is an archetype,
 * at priority 0" — what SoHL's own archetypes ship at — while `null` means "is
 * not one". Anything testing the value must ask `typeof v === "number"`, so
 * every case here that could pass under a truthiness check is paired with one
 * that could not.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Build-time pack helpers (plain ESM, no Foundry). Imported by relative path
// because the pack-build scripts live outside the `@src` alias tree.
import {
    resolveTemplatePriority,
    systemTemplatePriority,
    // eslint-disable-next-line
} from "../engine/helpers.mjs";
import * as helpers from "../engine/helpers.mjs";
import { loadPackConfig } from "../engine/pack-config.mjs";
import { compareFields, SCHEMA_ARTIFACT_VERSION } from "../engine/schema-check.mjs";
import { Items } from "../sohl/items.mjs";
import { Actors } from "../sohl/actors.mjs";

/** This package's own root — where its test fixtures live. */
const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** The Item compiler, against this repository's own configuration. */
function items() {
    const config = loadPackConfig();
    return new Items({
        skipDirectories: [],
        contentBase: path.join(PKG_ROOT, "tests/fixtures"),
        dest: config.paths.packJson,
    });
}

/** The Actor compiler. Nothing here walks a tree or reads a pack. */
function actors() {
    const config = loadPackConfig();
    return new Actors({
        skipDirectories: [],
        contentBase: path.join(PKG_ROOT, "tests/fixtures"),
        dest: config.paths.packJson,
    });
}

/** A skill note, with whatever `sohl` block a case needs. */
const skillNote = (sohl: Record<string, unknown>) => ({
    id: "DDDDDDDDDDDDDDDD",
    type: "skill",
    shortcode: "awar",
    name: { full: "Awareness" },
    sohl: { subType: "physical", ...sohl },
});

/** A being note, likewise. */
const beingNote = (sohl: Record<string, unknown>) => ({
    id: "EEEEEEEEEEEEEEEE",
    type: "being",
    shortcode: "folk",
    name: { full: "Basic Folk" },
    sohl,
});

describe("resolveTemplatePriority (build:compiledb archetype contract)", () => {
    it("returns the number when sohl.archetype is a number", () => {
        expect(resolveTemplatePriority({ sohl: { archetype: 0 } }, "x")).toBe(0);
        expect(resolveTemplatePriority({ sohl: { archetype: 3 } }, "x")).toBe(3);
    });

    it("returns undefined when sohl.archetype is null (not an archetype)", () => {
        expect(resolveTemplatePriority({ sohl: { archetype: null } }, "x")).toBe(undefined);
    });

    it("throws when neither spelling is present", () => {
        // The message names `templatePriority`, the spelling to write — not
        // `archetype`, which is retiring.
        expect(() => resolveTemplatePriority({ sohl: {} }, "widget")).toThrow(/templatePriority/i);
        expect(() => resolveTemplatePriority({}, "widget")).toThrow(/templatePriority/i);
    });

    it("throws when sohl.archetype is a non-number, non-null value", () => {
        expect(() => resolveTemplatePriority({ sohl: { archetype: "0" } }, "widget")).toThrow(
            /archetype/i,
        );
        expect(() => resolveTemplatePriority({ sohl: { archetype: true } }, "widget")).toThrow(
            /archetype/i,
        );
    });

    it("accepts a top-level archetype key (sohlField fallback parity)", () => {
        expect(resolveTemplatePriority({ archetype: 2 }, "x")).toBe(2);
        expect(resolveTemplatePriority({ archetype: null }, "x")).toBe(undefined);
    });
});

describe("systemTemplatePriority (the `system.templatePriority` value)", () => {
    it("is the number when sohl.archetype is a number", () => {
        expect(systemTemplatePriority({ sohl: { archetype: 3 } }, "x")).toBe(3);
    });

    it("is `0` — not `null` — for an archetype at priority 0", () => {
        // The falsy trap. `resolveTemplatePriority(...) || null` passes every other
        // case in this file and fails this one.
        const value = systemTemplatePriority({ sohl: { archetype: 0 } }, "x");
        expect(value).toBe(0);
        expect(typeof value).toBe("number");
        expect(value).not.toBeNull();
    });

    it("is `null` when sohl.archetype is null (not an archetype)", () => {
        const value = systemTemplatePriority({ sohl: { archetype: null } }, "x");
        expect(value).toBeNull();
        expect(typeof value).not.toBe("number");
    });

    it("never returns undefined — the field is always emitted", () => {
        // `undefined` would be dropped by `JSON.stringify`, so the compiled
        // document would carry no `archetype` at all and the tri-state would
        // read as two.
        expect(systemTemplatePriority({ sohl: { archetype: null } }, "x")).not.toBe(undefined);
        expect(systemTemplatePriority({ sohl: { archetype: 0 } }, "x")).not.toBe(undefined);
    });

    it("accepts a top-level archetype key (sohlField fallback parity)", () => {
        expect(systemTemplatePriority({ archetype: 2 }, "x")).toBe(2);
        expect(systemTemplatePriority({ archetype: 0 }, "x")).toBe(0);
        expect(systemTemplatePriority({ archetype: null }, "x")).toBeNull();
    });

    it("throws when archetype is absent, so 'not an archetype' is never assumed", () => {
        expect(() => systemTemplatePriority({ sohl: {} }, "widget")).toThrow(/templatePriority/i);
        expect(() => systemTemplatePriority({}, "widget")).toThrow(/templatePriority/i);
    });

    it("throws when archetype is a non-number, non-null value", () => {
        expect(() => systemTemplatePriority({ sohl: { archetype: "0" } }, "widget")).toThrow(
            /archetype/i,
        );
    });
});

describe("withArchetypeFlag is gone", () => {
    it("is exported by nothing", () => {
        expect("withArchetypeFlag" in helpers).toBe(false);
    });
});

describe("where the ordering constraint actually binds", () => {
    // `templatePriority` must be declared by the receiving system before a builder
    // emits it, and it is worth being exact about what enforces that. Neither
    // schema check does: `compareFields` derives the emitted set from the
    // `itemBuilders` field declarations, and `templatePriority` is written by the
    // compiler itself — alongside `shortcode`, `actionDefs`, `notes` and
    // `docHtml`, none of which are declared fields either. So the constraint is
    // Foundry's own silent discard at construction, which no build reports.
    const artifact = (documents: object) => ({
        version: SCHEMA_ARTIFACT_VERSION,
        system: "sohl",
        systemVersion: "0.8.2",
        documents,
    });
    const builders = { skill: [{ to: "subType" }, { to: "masteryLevelBase" }] };

    it("says nothing about `templatePriority` against a schema that omits it", () => {
        const { undeclared, unemitted } = compareFields({
            builders,
            artifact: artifact({
                Item: {
                    skill: { own: ["subType", "masteryLevelBase"], inherited: ["shortcode"] },
                },
            }),
        });
        expect([...undeclared, ...unemitted].map((f) => f.field)).not.toContain("templatePriority");
    });

    it("says nothing about it against a schema that declares it, either", () => {
        // The published shape: one declaration on the shared base, so
        // every subtype inherits it.
        const { undeclared, unemitted } = compareFields({
            builders,
            artifact: artifact({
                Item: {
                    skill: {
                        own: ["subType", "masteryLevelBase"],
                        inherited: ["shortcode", "templatePriority"],
                    },
                },
            }),
        });
        expect(undeclared).toEqual([]);
        expect([...unemitted].map((f) => f.field)).not.toContain("templatePriority");
    });
});

describe("the compiled Item carries `system.templatePriority`, not the flag", () => {
    it("emits the number", () => {
        const doc = items().buildEntry(skillNote({ archetype: 3 }), "");
        expect(doc.system.templatePriority).toBe(3);
    });

    it("emits `0` as `0`", () => {
        const doc = items().buildEntry(skillNote({ archetype: 0 }), "");
        expect(doc.system.templatePriority).toBe(0);
        expect(typeof doc.system.templatePriority).toBe("number");
    });

    it("emits `null` for a document that is not an archetype", () => {
        const doc = items().buildEntry(skillNote({ archetype: null }), "");
        expect(doc.system.templatePriority).toBeNull();
        expect("templatePriority" in doc.system).toBe(true);
    });

    it("survives JSON as it was written — `0` is not dropped and not nulled", () => {
        // What the pack actually receives. `undefined` would vanish here and
        // `0` would become `null` under a truthiness check; both are visible
        // only after the round trip.
        const round = (archetype: number | null) =>
            JSON.parse(JSON.stringify(items().buildEntry(skillNote({ archetype }), "")));
        expect(round(0).system.templatePriority).toBe(0);
        expect(round(1).system.templatePriority).toBe(1);
        expect(round(null).system.templatePriority).toBeNull();
    });

    it("writes no `flags.sohl.docArchetype`, whatever the priority", () => {
        for (const archetype of [0, 1, null]) {
            const doc = items().buildEntry(skillNote({ archetype }), "");
            expect(doc.flags?.sohl?.docArchetype, String(archetype)).toBe(undefined);
        }
    });

    it("passes `flags` through unchanged, defaulting to an empty object", () => {
        expect(items().buildEntry(skillNote({ archetype: 1 }), "").flags).toEqual({});
        const authored = items().buildEntry(
            { ...skillNote({ archetype: 1 }), flags: { core: { keep: true } } },
            "",
        );
        expect(authored.flags).toEqual({ core: { keep: true } });
    });

    it("lets the system block override the shared `flags`", () => {
        const doc = items().buildEntry(
            {
                ...skillNote({ archetype: 1, flags: { core: { own: true } } }),
                flags: { core: { shared: true } },
            },
            "",
        );
        expect(doc.flags).toEqual({ core: { own: true } });
    });

    it("refuses a note with no archetype at all", () => {
        expect(() => items().buildEntry(skillNote({}), "")).toThrow(/templatePriority/i);
    });
});

describe("the compiled Actor carries `system.templatePriority`, not the flag", () => {
    it("emits the number, and `0` as `0`", () => {
        expect(
            actors().buildBeing(new Map(), beingNote({ archetype: 2 }), "").system.templatePriority,
        ).toBe(2);
        const zero = actors().buildBeing(new Map(), beingNote({ archetype: 0 }), "");
        expect(zero.system.templatePriority).toBe(0);
        expect(typeof zero.system.templatePriority).toBe("number");
    });

    it("emits `null` for a being that is not an archetype", () => {
        const doc = actors().buildBeing(new Map(), beingNote({ archetype: null }), "");
        expect(doc.system.templatePriority).toBeNull();
        expect("templatePriority" in doc.system).toBe(true);
    });

    it("writes no `flags.sohl.docArchetype`, whatever the priority", () => {
        for (const archetype of [0, 1, null]) {
            const doc = actors().buildBeing(new Map(), beingNote({ archetype }), "");
            expect(doc.flags?.sohl?.docArchetype, String(archetype)).toBe(undefined);
        }
    });

    it("passes `flags` through unchanged, defaulting to an empty object", () => {
        expect(actors().buildBeing(new Map(), beingNote({ archetype: 1 }), "").flags).toEqual({});
        const authored = actors().buildBeing(
            new Map(),
            { ...beingNote({ archetype: 1 }), flags: { core: { keep: true } } },
            "",
        );
        expect(authored.flags).toEqual({ core: { keep: true } });
    });

    it("refuses a note with no archetype at all", () => {
        expect(() => actors().buildBeing(new Map(), beingNote({}), "")).toThrow(
            /templatePriority/i,
        );
    });
});
