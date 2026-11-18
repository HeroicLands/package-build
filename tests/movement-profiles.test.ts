/* SPDX-License-Identifier: GPL-3.0-or-later */
import { expect, it } from "vitest";
import YAML from "yaml";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";

it.each(["being", "vehicle"])("declares and validates movement profiles on %s", (type) => {
    expect(dataFields(type).some((field: any) => field.name === "movementProfiles")).toBe(true);
    const findings = (movementProfiles: unknown) => {
        const fm = { type, data: { movementProfiles } };
        return lintNote(
            { fm, file: "subject.md", raw: `---\n${YAML.stringify(fm)}---\n` },
            { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY },
        ).filter((x: any) => x.message.includes("movementProfiles"));
    };
    expect(
        findings([
            { medium: "none" },
            { medium: "terrestrial", feetPerRound: 0, leaguesPerWatch: 0.5 },
            { medium: "terrestrial" },
            ...["aquatic", "aerial", "burrowing", "astral"].map((medium) => ({ medium })),
        ]),
    ).toEqual([]);
    for (const value of [
        [{}],
        [{ medium: "bad" }],
        [{ medium: "none", feetPerRound: 0.5 }],
        [{ medium: "none", leaguesPerWatch: -1 }],
        [{ medium: "none", disabled: true }],
        [null],
        [[]],
        [[{ medium: "none" }]],
        "none",
    ]) {
        const found = findings(value);
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({
            file: "subject.md",
            line: expect.any(Number),
            column: expect.any(Number),
            severity: "error",
        });
    }
});

it("accepts occupant records through full note lint", async () => {
    const { lintNote } = await import("../engine/frontmatter-lint.mjs");
    const { NOTE_SCHEMAS } = await import("../sohl/note-schemas.mjs");
    const fm = {
        type: "vehicle",
        shortcode: "cart",
        name: { full: "Cart" },
        data: {
            family: "Cart",
            size: 1,
            locomotion: ["wheeled"],
            role: ["merchant"],
            capacity: 1,
            movementProperties: [
                {
                    medium: "terrestrial",
                    rates: [{ prob: 1, distance: 0, distUnit: "feet", timeUnit: "hour" }],
                },
            ],
            occupants: [{ address: "being-horse", role: "draft_animal" }],
            movementProfiles: [{ medium: "none" }],
        },
    };
    const findings = lintNote(
        { file: "cart.md", fm, raw: "---\n---\nBody" },
        {
            schemas: NOTE_SCHEMAS,
            vocabulary: NOTE_VOCABULARY,
            addressContext: { package: "local", system: "note" },
        },
    );
    expect(findings.filter((f: any) => /occupants|movementProfiles/.test(f.message))).toEqual([]);
});

it.each([Infinity, NaN, -Infinity])("rejects nonfinite leagues per watch", async (value) => {
    const { checkMovementProfiles } = await import("../engine/movement-profiles.mjs");
    const found = checkMovementProfiles({
        fm: { data: { movementProfiles: [{ medium: "none", leaguesPerWatch: value }] } },
    });
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("finite nonnegative");
});
