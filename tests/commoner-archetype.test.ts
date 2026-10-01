/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { BEING_ARCHETYPES, NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

function findings(archetypes: string[]) {
    return lintNote(
        {
            file: "Being.md",
            raw: `---\ntype: being\ndata:\n  archetypes: [${archetypes.join(", ")}]\n---\n`,
            fm: { type: "being", data: { archetypes } },
        },
        { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY },
    );
}

describe("the commoner archetype", () => {
    it("stands alone", () => {
        expect(findings(["commoner"])).toEqual([]);
        expect(findings(["entertainer", "guildsperson"])).toEqual([]);
        const mixed = findings(["commoner", "guildsperson"]);
        expect(mixed).toHaveLength(1);
        expect(mixed[0]).toMatchObject({
            file: "Being.md",
            line: 4,
            severity: "error",
            message: "`data.archetypes` may contain `commoner` only by itself",
        });
    });
});

describe("being archetype requirements", () => {
    for (const style of ["block", "flow"]) {
        for (const subType of ["character", "npc", "creature"]) {
            for (const state of ["absent", "empty", "populated"]) {
                it(`${style} ${subType} ${state}`, () => {
                    const value = state === "empty" ? "[]" : "[warrior]";
                    const data =
                        state === "absent" ? "data: {}"
                        : style === "flow" ? `data: { archetypes: ${value} }`
                        : `data:\n  archetypes: ${value}`;
                    const yaml = `type: being\nsubType: ${subType}\n${data}`;
                    const result = lintNote(
                        { file: "Being.md", raw: `---\n${yaml}\n---\n`, fm: YAML.parse(yaml) },
                        { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY },
                    );
                    expect(result).toHaveLength(
                        subType !== "creature" && state !== "populated" ? 1 : 0,
                    );
                });
            }
        }
    }
    for (const style of ["block", "flow"]) {
        for (const value of ["wizard", "Commoner", "commoner"]) {
            it(`locates ${style} ${value}`, () => {
                const data =
                    style === "flow" ?
                        `data: { archetypes: [warrior, ${value}] }`
                    :   `data:\n  archetypes:\n    - warrior\n    - ${value}`;
                const yaml = `type: being\nsubType: npc\n${data}`;
                const raw = `---\n${yaml}\n---\n`;
                const result = lintNote(
                    { file: "Being.md", raw, fm: YAML.parse(yaml) },
                    { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY },
                );
                const line = style === "flow" ? 4 : 7;
                expect(result).toHaveLength(1);
                expect(result[0]).toMatchObject({
                    file: "Being.md",
                    line,
                    column: raw.split("\n")[line - 1].indexOf(value) + 1,
                    severity: "error",
                });
            });
        }
    }
});

it("accepts every declared archetype without a second vocabulary", () => {
    for (const archetype of Object.keys(BEING_ARCHETYPES)) {
        expect(findings([archetype])).toEqual([]);
    }
});

it("uses parsed frontmatter for the rule", () => {
    const result = lintNote(
        {
            file: "Being.md",
            raw: "---\ntype: being\nsubType: creature\ndata: { archetypes: [warrior] }\n---\n",
            fm: { type: "being", subType: "npc", data: { archetypes: [] } },
        },
        { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY },
    );
    expect(result).toHaveLength(1);
});
