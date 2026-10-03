/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { completeNote } from "./complete-note.js";
import { DECLARED_TAGS, NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
import { buildIndexRecord } from "../engine/content-index.mjs";
import { openNotesDatabase } from "../engine/sql-tables.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const source = (purpose: string, tags = ["mining", "coastal"], subType = "settlement") =>
    [
        "---",
        "shortcode: quarrytown",
        "name: {full: Quarrytown}",
        "type: place",
        `subType: ${subType}`,
        `tags: [${tags.join(", ")}]`,
        "data:",
        `  purpose: ${purpose}`,
        "---",
        "",
        "A quarry settlement.",
    ].join("\n");

const note = (purpose: string, tags?: string[], subType?: string) => ({
    file: "Quarrytown.md",
    type: "place",
    raw: source(purpose, tags, subType),
    fm: completeNote({
        shortcode: "quarrytown",
        name: { full: "Quarrytown", aliases: [] },
        type: "place",
        subType: subType ?? "settlement",
        tags: tags ?? ["mining", "coastal"],
        data: { purpose },
    }),
});

describe("a place's purpose selects one of its character tags", () => {
    const lint = (n: ReturnType<typeof note>) =>
        lintNote(n, { schemas: NOTE_SCHEMAS as any, vocabulary: NOTE_VOCABULARY });

    it("declares the purpose field and geographic reasons in the source vocabulary", () => {
        expect(
            dataFields("place", NOTE_VOCABULARY)?.some((field: any) => field.name === "purpose"),
        ).toBe(true);
        for (const tag of ["ford", "portage", "pass", "well"])
            expect(DECLARED_TAGS.placeCharacter.tags).toContain(tag);
    });

    it("accepts a settlement, site, or structure selecting a carried tag", () => {
        for (const subType of ["settlement", "site", "structure"])
            expect(lint(note("mining", undefined, subType))).toEqual([]);
    });

    it("locates a purpose that is absent from the note's tags", () => {
        const findings = lint(note("caravan"));
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ file: "Quarrytown.md", line: 8, severity: "error" });
        expect(findings[0].message).toContain("caravan");
        expect(findings[0].message).toContain("mining");
    });

    it("refuses a purpose outside the character vocabulary and an irrelevant subtype", () => {
        expect(
            lint(note("unknown", ["unknown"])).some((finding: any) =>
                finding.message.includes("placeCharacter"),
            ),
        ).toBe(true);
        expect(
            lint(note("mining", undefined, "region")).some((finding: any) =>
                finding.message.includes("settlement"),
            ),
        ).toBe(true);
    });

    it("keeps the selected value in the index for SQL", async () => {
        const n = note("mining");
        const record = buildIndexRecord({
            frontmatter: n.fm,
            relPath: n.file,
            contentPackage: "demo",
            body: "A quarry settlement.",
            bodyLine: 11,
        });
        expect(record.data.purpose).toBe("mining");
        const db = await openNotesDatabase([record]);
        try {
            expect(
                (await db.query("SELECT data.purpose AS purpose FROM notes")).rows[0].purpose,
            ).toBe("mining");
        } finally {
            await db.close();
        }
    });
});
