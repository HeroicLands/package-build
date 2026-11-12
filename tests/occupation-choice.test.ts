/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { checkOccupationChoice, occupationKey } from "../engine/occupation-choice.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";

describe("occupation template references", () => {
    const index = {
        contentPackage: "demo",
        types: new Set(["being", "lore"]),
        packages: new Set(["demo"]),
        addressHit: (key: string) =>
            key.endsWith("porter") ?
                { type: "being", subType: "npc" }
            :   { type: "being", subType: "character" },
    };
    const note = (value: string) => ({
        file: "being.md",
        raw: `---\ndata:\n  occupationNote: ${value}\n---\n`,
        fm: { data: { occupationNote: value } },
    });
    it("declares an optional being Address and accepts NPC templates", () => {
        expect(
            NOTE_VOCABULARY.being.data.find(
                (field: { name: string }) => field.name === "occupationNote",
            ),
        ).toMatchObject({ kind: "address", ref: "being", accepts: ["being"] });
        expect(occupationKey("porter", index)).toBe("demo-note-being-porter");
        expect(checkOccupationChoice(note("porter"), { index })).toEqual([]);
    });
    it("locates a reference to a non-NPC being", () => {
        const findings = checkOccupationChoice(note("character"), { index });
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ file: "being.md", severity: "error", line: 3 });
        expect(findings[0].message).toContain("subType npc");
    });
});
