/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { lintFrontmatter, lintNote } from "../engine/frontmatter-lint.mjs";
import { completeNote } from "./complete-note.js";
import { NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const file = "assets/content/People/Aran.md";
const raw = "---\ntype: being\ndata:\n    culture: lore-vedyariclt\n---\n";
const being = (culture: unknown) => ({
    file,
    raw,
    type: "being",
    fm: completeNote({ type: "being", subType: "creature", data: { culture } }),
});
const index = (subType: string) => ({
    notes: [being("lore-vedyariclt")],
    contentPackage: "thalorna",
    types: new Set(["being", "lore", "place"]),
    packages: new Set(["thalorna"]),
    addressHit: () => ({ fm: completeNote({ type: "lore", subType }) }),
});

describe("a being's primary culture", () => {
    it("declares a single lore Address and accepts a culture note", () => {
        expect(dataFields("being").find((field) => field.name === "culture")).toMatchObject({
            kind: "address",
            ref: "lore",
            accepts: ["lore"],
        });
        expect(
            lintFrontmatter(index("culture") as any, {
                schemas: NOTE_SCHEMAS,
                vocabulary: NOTE_VOCABULARY,
            }).findings,
        ).toEqual([]);
    });

    it("locates a lore note with the wrong subtype", () => {
        expect(
            lintFrontmatter(index("law") as any, {
                schemas: NOTE_SCHEMAS,
                vocabulary: NOTE_VOCABULARY,
            }).findings,
        ).toContainEqual(
            expect.objectContaining({
                file,
                line: 4,
                severity: "error",
                message: expect.stringContaining("subType is not culture"),
            }),
        );
    });

    it("rejects a non-lore Address and a list", () => {
        const opts = { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY };
        expect(
            lintNote(being("place-vedyara") as any, opts)
                .map((f) => f.message)
                .join("\n"),
        ).toContain("should be an Address");
        expect(
            lintNote(being(["lore-vedyariclt"]) as any, opts)
                .map((f) => f.message)
                .join("\n"),
        ).toContain("data.culture");
    });
});
