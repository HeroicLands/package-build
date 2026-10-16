/* SPDX-License-Identifier: GPL-3.0-or-later */

import { expect, it, vi } from "vitest";
import {
    joinGeneratedSections,
    openNotesDatabase,
    prepareSqlTables,
} from "../engine/sql-tables.mjs";

it("answers each authored fence once per stub context within a preparation", async () => {
    const db = await openNotesDatabase([
        {
            type: "lore",
            shortcode: "full",
            package: "demo",
            address: "demo-note-lore-full",
            name: { full: "Full" },
        },
        { type: "lore", shortcode: "stub", package: "demo", address: null, name: { full: "Stub" } },
    ]);
    try {
        const query = vi.spyOn(db, "query");
        const compare = vi.spyOn(db, "stubsExcluded");
        const queries = ["SELECT shortcode FROM notes", "SELECT name.full FROM notes"];
        const sources = Array.from({ length: 3 }, (_, i) => ({
            source: `${i}.md`,
            markdown: queries.map((sql) => `\`\`\`sql\n${sql}\n\`\`\``).join("\n\n"),
        }));
        for (let run = 1; run <= 2; run += 1) {
            const prepared = await prepareSqlTables(db, sources);
            for (const tables of prepared.values()) {
                for (const table of tables) {
                    expect(table.reason).toBeUndefined();
                    expect(table.rows).toBe(1);
                    expect(table.stubsExcluded).toBe(1);
                    expect(table.markdown).not.toMatch(/stub|Stub/);
                }
            }
            expect(query).toHaveBeenCalledTimes(queries.length * run);
            expect(compare).toHaveBeenCalledTimes(queries.length * run);
        }
    } finally {
        await db.close();
    }
});

it("keeps authored fences eligible when their SQL also appears in a generated section", async () => {
    const query = "SELECT shortcode FROM entries";
    const fence = `\`\`\`sql\n${query}\n\`\`\``;
    const sources = [{ source: "note.md", markdown: fence }];
    joinGeneratedSections(
        { sections: new Map([["note.md", `# Events\n\n${fence}`]]), views: new Set(["note.md"]) },
        sources,
    );
    const db = {
        query: vi.fn(async () => ({ rows: [{ shortcode: "one" }], columnNames: ["shortcode"] })),
        stubsExcluded: vi.fn(async () => 0),
    };
    const prepared = await prepareSqlTables(db, sources);
    expect(prepared.get("note.md")).toHaveLength(2);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.stubsExcluded).toHaveBeenCalledTimes(1);
});
