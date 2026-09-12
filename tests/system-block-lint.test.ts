/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Checking a note's **system blocks** — each against that system's own
 * vocabulary.
 *
 * The frontmatter lint knew one block, `sohl:`, and one vocabulary, the note
 * type's field names. Two things follow from the mapping tables:
 * the block now carries the shared vocabulary any system's block may
 * (`system`, `type`, `img`, …), and a note may carry a second system's block
 * whose keys were not looked at at all — dropped in silence, which is the
 * failure class this whole check exists for.
 */

import { describe, it, expect } from "vitest";

import {
    DEFAULT_SYSTEM_BLOCKS,
    declaredSystems,
    lintNote,
    systemBlocksFor,
} from "../engine/frontmatter-lint.mjs";
import { loadPackConfig } from "../engine/pack-config.mjs";

const SCHEMAS = {
    skill: [
        { name: "subType", to: "subType", kind: "string", required: true, describe: "the kind" },
        { name: "weight", to: "weightBase", kind: "number", describe: "how heavy" },
    ],
};

function note(fm: Record<string, unknown>) {
    return { fm: { type: "skill", ...fm }, file: "Skill.md", raw: "" };
}

const messages = (findings: { message: string }[]) => findings.map((f) => f.message);

describe("the shared block vocabulary", () => {
    it("accepts every key any system block may carry", () => {
        const findings = lintNote(
            note({
                sohl: {
                    subType: "physical",
                    system: { weightBase: 3 },
                    type: "skill",
                    img: "icons/a.svg",
                    effects: [],
                    flags: {},
                    pack: "items",
                },
            }),
            { schemas: SCHEMAS },
        );
        expect(messages(findings)).toEqual([]);
    });

    it("still reports a misspelling of one, with the suggestion", () => {
        const findings = lintNote(note({ sohl: { subType: "physical", sytem: {} } }), {
            schemas: SCHEMAS,
        });
        expect(messages(findings)).toHaveLength(1);
        expect(findings[0].message).toMatch(/"sytem" is not a property of a skill/);
        expect(findings[0].message).toMatch(/Did you mean "system"\?/);
    });
});

describe("a field resolved through the block", () => {
    it("counts a value authored at `<system>.system.<to>` as authored", () => {
        // The required check must follow the same resolution order the compiler
        // does, or a migrated note reports its own field as missing.
        const findings = lintNote(note({ sohl: { system: { subType: "physical" } } }), {
            schemas: SCHEMAS,
        });
        expect(messages(findings)).toEqual([]);
    });

    it("counts a value at the declared shared source as authored", () => {
        const findings = lintNote(note({ subType: "physical" }), { schemas: SCHEMAS });
        expect(messages(findings)).toEqual([]);
    });

    it("still reports a required field nothing authors, anywhere", () => {
        const findings = lintNote(note({ sohl: {} }), { schemas: SCHEMAS });
        expect(messages(findings)).toHaveLength(1);
        expect(findings[0].message).toMatch(/must declare `sohl\.subType`/);
    });

    it("still reports a value of the wrong shape", () => {
        const findings = lintNote(
            note({ sohl: { subType: "physical", system: { weightBase: "heavy" } } }),
            { schemas: SCHEMAS },
        );
        expect(messages(findings)).toHaveLength(1);
        expect(findings[0].message).toMatch(/should be number/);
    });
});

describe("a second system's block", () => {
    const withHm3 = {
        schemas: SCHEMAS,
        systems: { ...DEFAULT_SYSTEM_BLOCKS, hm3: { known: ["attributes"] } },
    };

    it("is not looked at when the build declares only one system", () => {
        // Today's behaviour: nothing says what an undeclared system's block may
        // carry, so nothing may claim a key in it is wrong.
        const findings = lintNote(note({ sohl: { subType: "physical" }, hm3: { anything: 1 } }), {
            schemas: SCHEMAS,
        });
        expect(messages(findings)).toEqual([]);
    });

    it("is checked against its own vocabulary once the build declares it", () => {
        const findings = lintNote(
            note({ sohl: { subType: "physical" }, hm3: { attributes: {}, system: {}, wat: 1 } }),
            withHm3,
        );
        expect(messages(findings)).toHaveLength(1);
        expect(findings[0].message).toMatch(/"wat" is not a property of a skill under `hm3`/);
    });

    it("does not borrow the other system's field names", () => {
        // `subType` is SoHL's; nothing says HM3 declares it, so writing it in
        // HM3's block is a finding rather than a coincidence that passes.
        const findings = lintNote(
            note({ sohl: { subType: "physical" }, hm3: { subType: "x" } }),
            withHm3,
        );
        expect(messages(findings)).toHaveLength(1);
        expect(findings[0].message).toMatch(/"subType"/);
    });
});

describe("the blocks a configuration says its tree carries", () => {
    it("derives the one system a single-registry tree ships for", () => {
        expect(
            systemBlocksFor({ systems: {}, stats: { systemId: "sohl" } }, { schemaSystem: "sohl" }),
        ).toEqual({ sohl: { fieldVocabulary: true } });
    });

    it("does not hold a system's block to its neighbour's note schemas", () => {
        // The other half of the defect. A package shipping for HM3 had `sohl:`
        // checked — a block it does not carry — so the one finding it could make
        // was about nothing. The note schemas are SoHL's, and with no registry
        // declaring HM3's vocabulary there is nothing to check `hm3:` against.
        expect(systemBlocksFor({ stats: { systemId: "hm3" } }, { schemaSystem: "sohl" })).toEqual(
            {},
        );
    });

    it("gives each declared system its own registry's fields", () => {
        const sohl = { skill: [{ name: "subType" }] };
        const hm3 = { skill: [{ name: "sunsign" }] };
        expect(
            systemBlocksFor(
                { systems: { sohl: {}, hm3: {} }, itemFieldsBySystem: { sohl, hm3 } },
                { schemaSystem: "sohl" },
            ),
        ).toEqual({
            // Both sources, for the system whose schemas the caller supplied:
            // the registry covers its item types, and the note schemas reach
            // the types no registry declares.
            sohl: { fieldVocabulary: true, fields: sohl },
            hm3: { fields: hm3 },
        });
    });

    it("leaves out a declared system whose vocabulary nothing states", () => {
        const sohl = { skill: [] };
        expect(
            systemBlocksFor(
                { systems: { sohl: {}, hm3: {} }, itemFieldsBySystem: { sohl } },
                { schemaSystem: "sohl" },
            ),
        ).toEqual({ sohl: { fieldVocabulary: true, fields: sohl } });
    });

    it("reads the systems a tree declares only through its packs", () => {
        // `harn-ensemble`'s shape: no `systems:`, no `stats.systemId`, and two
        // Actor packs that each name one. A pack's `system:` already decides at
        // compile whether a note may be compiled there, so a lint blind to it
        // would refuse a note for want of a block it never checked.
        const config = {
            packs: [
                { name: "actors-hm3", type: "Actor", system: "hm3" },
                { name: "actors-sohl", type: "Actor", system: "sohl" },
            ],
        };
        expect(declaredSystems(config)).toEqual(["hm3", "sohl"]);
        // It declares no `itemBuilders`, so `sohl:` is still checked — the note
        // schemas are its vocabulary, and they reach `being`, which is every
        // note in that tree. `hm3:` has nothing to be checked against, and the
        // CLI says so rather than passing in silence.
        expect(systemBlocksFor(config, { schemaSystem: "sohl" })).toEqual({
            sohl: { fieldVocabulary: true },
        });
    });

    it("prefers what a package declares over the packs that repeat it", () => {
        expect(
            declaredSystems({
                systems: { sohl: {} },
                packs: [
                    { name: "items", type: "Item" },
                    { name: "actors-sohl", system: "sohl" },
                ],
                stats: { systemId: "sohl" },
            }),
        ).toEqual(["sohl"]);
    });

    it("checks no block for a package that names no system", () => {
        // System-agnostic on purpose: its packs are core document types
        // carrying no system data, so naming a block would invent one.
        expect(systemBlocksFor({}, { schemaSystem: "sohl" })).toEqual({});
        expect(systemBlocksFor(undefined, { schemaSystem: "sohl" })).toEqual({});
    });

    it("holds this package's own configuration to exactly what it was held to", () => {
        // The regression anchor. Every consumer today declares one system and
        // one system-less registry, so on all of them the derivation has to be
        // the identity — the constant it replaces.
        expect(systemBlocksFor(loadPackConfig(), { schemaSystem: "sohl" })).toEqual(
            DEFAULT_SYSTEM_BLOCKS,
        );
    });
});

describe("a second system's own vocabulary", () => {
    const HM3_FIELDS = {
        skill: [{ name: "sunsign", to: "sunsign", kind: "string", describe: "the sign" }],
    };
    const dual = {
        schemas: SCHEMAS,
        systems: { sohl: { fieldVocabulary: true }, hm3: { fields: HM3_FIELDS } },
    };

    it("accepts a key that system's registry declares", () => {
        const findings = lintNote(
            note({ sohl: { subType: "physical" }, hm3: { sunsign: "ulandus" } }),
            dual,
        );
        expect(messages(findings)).toEqual([]);
    });

    it("reports a key it does not, naming the block", () => {
        // `weight` is SoHL's. A block checked against its own system's registry
        // does not accept it for having been spelled somewhere in the tree.
        const findings = lintNote(
            note({ sohl: { subType: "physical" }, hm3: { sunsign: "ulandus", weight: 3 } }),
            dual,
        );
        expect(messages(findings)).toHaveLength(1);
        expect(findings[0].message).toMatch(/"weight" is not a property of a skill under `hm3`/);
    });

    it("leaves the block unchecked on a type that system does not declare", () => {
        // `mysticalability` is SoHL's and HM3 has no such type, so HM3 says
        // nothing about what such a note may carry. Holding the block to an
        // empty vocabulary would report every key in it.
        const findings = lintNote(
            { fm: { type: "mysticalability", hm3: { anything: 1 } }, file: "A.md", raw: "" },
            { schemas: { mysticalability: [] }, systems: { hm3: { fields: HM3_FIELDS } } },
        );
        expect(messages(findings)).toEqual([]);
    });

    it("still checks the block whose note schemas reach a type no registry names", () => {
        // `being` is an actor type and sits in no `itemBuilders` registry, so a
        // spec carrying only `fields` falls silent on it. The system whose note
        // schemas the caller supplied carries `fieldVocabulary` as well, and
        // that is what reaches the 2,512 `being` notes `harn-ensemble` is made
        // of — the coverage a registry-only rule silently dropped.
        const BEING = { being: [{ name: "attributes", to: "attributes" }] };
        const findings = lintNote(
            {
                fm: { type: "being", sohl: { attributes: {}, attrbutes: {} } },
                file: "B.md",
                raw: "",
            },
            {
                schemas: BEING,
                systems: { sohl: { fieldVocabulary: true, fields: HM3_FIELDS } },
            },
        );
        expect(messages(findings)).toHaveLength(1);
        expect(findings[0].message).toMatch(/"attrbutes" is not a property of a being/);
        expect(findings[0].message).toMatch(/Did you mean "attributes"\?/);
    });
});
