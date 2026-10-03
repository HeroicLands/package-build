/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { parseBeingHeight, parseBeingWeight } from "../engine/being-measurements.mjs";
import { completeNote } from "./complete-note.js";
import { noteInfobox } from "../engine/infobox.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

function findings(data: object) {
    return lintNote(
        {
            file: "Being.md",
            raw: "---\ntype: being\ndata:\n  height: bad\n  weight: bad\n---\n",
            fm: completeNote({ type: "being", subType: "creature", data }),
        },
        { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY },
    );
}

describe("being measurements", () => {
    it("reads metric and imperial height to the nearest inch", () => {
        expect(parseBeingHeight(1.91)).toBe(75);
        expect(parseBeingHeight("1.91m")).toBe(75);
        expect(parseBeingHeight("1.91 m")).toBe(75);
        expect(parseBeingHeight("6' 3\"")).toBe(75);
        expect(parseBeingHeight("6'3\"")).toBe(75);
        expect(parseBeingHeight("6'")).toBe(72);
        for (const value of [
            "6' 12\"",
            "1.91",
            "191cm",
            "6 feet",
            -1,
            1e30,
            "9".repeat(320) + "m",
            {},
        ])
            expect(parseBeingHeight(value)).toBeNull();
    });

    it("reads metric and imperial weight to the nearest pound", () => {
        expect(parseBeingWeight(85)).toBe(187);
        expect(parseBeingWeight("85kg")).toBe(187);
        expect(parseBeingWeight("85 kg")).toBe(187);
        expect(parseBeingWeight("187lbs")).toBe(187);
        expect(parseBeingWeight("187 lbs")).toBe(187);
        for (const value of [
            "85",
            "85g",
            "187lb",
            "187.5 lbs",
            -1,
            1e30,
            "9".repeat(320) + "kg",
            {},
        ])
            expect(parseBeingWeight(value)).toBeNull();
    });

    it("shows either input unit in imperial without a second conversion", () => {
        for (const data of [
            { height: 1.91, weight: 85 },
            { height: "1.91m", weight: "85kg" },
            { height: "6' 3\"", weight: "187 lbs" },
        ]) {
            const box = noteInfobox({ type: "being", name: { full: "Someone" }, data });
            const appearance = box.sections[0].rows.find(
                (row: { label: string }) => row.label === "Appearance",
            );
            expect(appearance.value).toEqual(["6′ 3″", "187 lbs"]);
        }
    });

    it("validates being units while keeping Item gear weight numeric", () => {
        expect(findings({ height: "6' 3\"", weight: "187 lbs" })).toEqual([]);
        expect(findings({ height: "1.91m", weight: "85kg" })).toEqual([]);
        const invalid = findings({ height: "6' 12\"", weight: "85 stones" });
        expect(invalid).toHaveLength(2);
        expect(invalid.map((finding) => finding.message).join(" ")).toContain("data.height");
        expect(invalid.map((finding) => finding.message).join(" ")).toContain("data.weight");
        expect(invalid.map((finding) => finding.line)).toEqual([4, 5]);
    });
});
