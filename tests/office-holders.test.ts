/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { checkDatedOffices } from "../engine/office-holders.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

function roster(offices: unknown, people: Record<string, object> = {}) {
    const note = { file: "Guild.md", raw: "", fm: { data: { governance: { offices } } } };
    const index = {
        contentPackage: "thalorna",
        types: new Set(["being"]),
        packages: new Set(["thalorna"]),
        notes: [{ fm: { type: "place", data: { year: { days: 365 } } } }],
        addressHit: (address: string) => people[address],
    };
    return checkDatedOffices(note, { index });
}

describe("dated office holders", () => {
    it("runs from the note linter's affiliation vocabulary", () => {
        const note = {
            file: "Guild.md",
            raw: "---\nshortcode: guild\ntype: affiliation\n---\n",
            fm: {
                shortcode: "guild",
                type: "affiliation",
                name: { full: "Guild" },
                data: {
                    governance: { offices: { Chancellor: { description: "Keeper", holder: [] } } },
                },
            },
        };
        const findings = lintNote(note, {
            schemas: NOTE_SCHEMAS,
            vocabulary: NOTE_VOCABULARY,
            index: { notes: [], contentPackage: "thalorna" },
        });
        expect(findings.map((f) => f.message)).toContainEqual(
            expect.stringContaining("unknown key holder"),
        );
    });

    it("keeps string descriptions and living current holders valid", () => {
        expect(roster({ Chancellor: "Keeps the seal." })).toEqual([]);
        expect(
            roster(
                {
                    Chancellor: {
                        description: "Keeps the seal.",
                        holders: [{ being: "being-aran", start: 720 }],
                    },
                },
                { "thalorna-note-being-aran": { fm: { data: {} } } },
            ),
        ).toEqual([]);
    });

    it("rejects dated and unknown deaths for current claims", () => {
        for (const died of ["719.100", "unknown"])
            expect(
                roster(
                    {
                        Chancellor: {
                            description: "Keeps the seal.",
                            holders: [{ being: "being-aran", start: 720 }],
                        },
                    },
                    { "thalorna-note-being-aran": { fm: { data: { died } } } },
                ).map((f) => f.message),
            ).toEqual([expect.stringContaining("current holder")]);
    });

    it("reports misspelled keys, missing beings, reversed and overlapping terms", () => {
        const findings = roster(
            {
                Chancellor: {
                    description: "Keeps the seal.",
                    holder: [],
                    holders: [
                        { being: "being-aran", start: "720.200", end: "720.100", unknown: true },
                        { being: "being-mara", start: "720.150", end: "720.250" },
                    ],
                },
            },
            { "thalorna-note-being-aran": { fm: { data: {} } } },
        );
        const messages = findings.map((f) => f.message);
        expect(messages).toContainEqual(expect.stringContaining("unknown key holder"));
        expect(messages).toContainEqual(expect.stringContaining("unknown key unknown"));
        expect(messages).toContainEqual(expect.stringContaining("does not resolve"));
        expect(messages).toContainEqual(expect.stringContaining("ends before its start"));
    });

    it("rejects overlapping terms unless one is contested", () => {
        const people = {
            "thalorna-note-being-aran": { fm: { data: {} } },
            "thalorna-note-being-mara": { fm: { data: {} } },
        };
        const holders = [
            { being: "being-aran", start: "720.100", end: "720.200" },
            { being: "being-mara", start: "720.150", end: "720.250" },
        ];
        const offices = { Chancellor: { description: "Keeps the seal.", holders } };
        expect(roster(offices, people).map((f) => f.message)).toEqual([
            expect.stringContaining("overlapping holder terms"),
        ]);
        holders[0].contested = true;
        expect(roster(offices, people)).toEqual([]);
    });
});
