/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Checking a note's **system blocks** — each against that system's own
 * vocabulary (#58).
 *
 * The frontmatter lint knew one block, `sohl:`, and one vocabulary, the note
 * type's field names. Two things follow from #58 and neither was expressible:
 * the block now carries the shared vocabulary any system's block may
 * (`system`, `type`, `img`, …), and a note may carry a second system's block
 * whose keys were not looked at at all — dropped in silence, which is the
 * failure class this whole check exists for.
 */

import { describe, it, expect } from "vitest";

import { DEFAULT_SYSTEM_BLOCKS, lintNote } from "../engine/frontmatter-lint.mjs";

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
        // does, or a migrated note (#126) reports its own field as missing.
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
