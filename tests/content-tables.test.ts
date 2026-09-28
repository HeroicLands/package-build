// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { expandContentTables } from "../engine/content-tables.mjs";

describe("prepared content tables", () => {
    it("expands a SQL fence and maps generated rows to its source line", () => {
        const source = "Before.\n\n```sql\nSELECT name.full AS Name FROM notes\n```\n\nAfter.";
        const result = expandContentTables(source, {
            source: "note.md",
            sqlTables: [
                {
                    markdown: "| Name |\n| --- |\n| A |",
                    rows: 1,
                    allowEmpty: false,
                    stubsExcluded: 0,
                },
            ],
        });
        expect(result.errors).toEqual([]);
        expect(result.markdown).toContain("| A |");
        expect(result.lineMap.some((line) => line.generated && line.line === 2)).toBe(true);
    });

    it("reports a SQL fence without prepared results", () => {
        const result = expandContentTables("```sql\nSELECT 1\n```", { source: "note.md" });
        expect(result.errors[0]).toMatchObject({ source: "note.md", line: 0, column: 1 });
        expect(result.errors[0].reason).toMatch(/not prepared/);
    });

    it("rejects obsolete table directives with a source location", () => {
        const result = expandContentTables("```dataview\nTABLE name.full\n```", {
            source: "note.md",
        });
        expect(result.errors[0]).toMatchObject({ source: "note.md", line: 0, column: 1 });
        expect(result.errors[0].reason).toMatch(/unsupported/);
    });
});
