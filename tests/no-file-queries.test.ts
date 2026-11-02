// SPDX-License-Identifier: GPL-3.0-or-later

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { expandContentTables } from "../engine/content-tables.mjs";
import { openNotesDatabase, prepareSqlTables } from "../engine/sql-tables.mjs";

const RECORDS = [
    {
        type: "miscgear",
        shortcode: "bowlcer",
        package: "sohl",
        name: { full: "Bowl" },
        address: { canonical: "sohl-miscgear-bowlcer", slug: "miscgear-bowlcer" },
        file: { path: "Misc_Gear/Cooking/Bowl.md", folder: "Misc_Gear/Cooking", name: "Bowl" },
        tags: ["cooking"],
        data: { file: "a property that happens to be named file" },
    },
];

let dir: string;
let db: any;

beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "no-file-queries-"));
    db = await openNotesDatabase(RECORDS, { dir });
}, 60_000);

afterAll(async () => {
    await db?.close();
    fs.rmSync(dir, { recursive: true, force: true });
});

const fence = (query: string) => `Intro.\n\n\`\`\`sql\n${query}\n\`\`\`\n`;

async function expand(markdown: string) {
    const prepared = await prepareSqlTables(db, [{ source: "note.md", markdown }]);
    return expandContentTables(markdown, { source: "note.md", sqlTables: prepared.get("note.md") });
}

describe("a note query does not read the file", () => {
    it("refuses file.folder in a WHERE clause at its position", async () => {
        const { errors } = await expand(
            fence("SELECT name.full AS Name\nFROM notes\nWHERE file.folder = 'Misc_Gear/Cooking'"),
        );
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
            source: "note.md",
            line: 5,
            column: 7,
        });
        expect(errors[0].reason).toMatch(/file\.folder/);
        expect(errors[0].reason).toMatch(/property, tag or address/);
    });

    for (const [where, query, line, column] of [
        ["select", "SELECT file.path AS Path FROM notes", 3, 8],
        ["order", "SELECT name.full AS Name FROM notes ORDER BY file.name", 3, 46],
        ["qualified", "SELECT n.file.path AS P FROM notes n", 3, 8],
        ["group", "SELECT count(*) AS N FROM notes GROUP BY file.folder", 3, 42],
    ] as const) {
        it(`refuses file.* in ${where}`, async () => {
            const { errors } = await expand(fence(query));
            expect(errors).toHaveLength(1);
            expect(errors[0]).toMatchObject({ line, column });
        });
    }

    it("leaves a property that only contains the word alone", async () => {
        const { errors } = await expand(
            fence(
                "SELECT name.full AS Name FROM notes WHERE data.file LIKE 'a%' AND 'file.x' <> ''",
            ),
        );
        expect(errors).toEqual([]);
    });
});
