// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openNotesDatabase } from "../engine/sql-tables.mjs";
it("preserves case-distinct mapping sources in own and dependency SQL without changing index records", async () => {
    const record = {
        type: "doc",
        shortcode: "lettersenc",
        package: "demo",
        name: { full: "Letters" },
        file: { path: "Encoding.md" },
        description: "Spelling",
        address: { canonical: "demo-note-doc-lettersenc", slug: "doc-lettersenc" },
        data: {
            language: "test",
            font: "face",
            mappings: { a: "LOWER", A: ["UPPER", "MARK"] },
            rules: { normalization: "NFC", matching: "longest-first" },
        },
    };
    const original = JSON.stringify(record),
        root = fs.mkdtempSync(path.join(os.tmpdir(), "encoding-sql-"));
    const dependency = path.join(root, "foreign.jsonl");
    fs.writeFileSync(dependency, JSON.stringify({ ...record, package: "foreign" }) + "\n");
    let db;
    try {
        db = await openNotesDatabase([record], {
            dir: root,
            dependencies: [{ id: "foreign", file: dependency }],
        });
        for (const relation of ["notes", '"foreign".notes']) {
            const rows = await db.query(`SELECT unnest(data.mappings) AS mapping FROM ${relation}`);
            expect(rows.rows).toEqual([
                { mapping: { from: "a", codes: ["LOWER"] } },
                { mapping: { from: "A", codes: ["UPPER", "MARK"] } },
            ]);
        }
        expect(JSON.stringify(record)).toBe(original);
    } finally {
        await db?.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});
it("keeps mapping case across separate notes while still refusing ordinary struct-key collisions", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "encoding-sql-case-"));
    const note = (shortcode: string, mappings: any) => ({
        type: "doc",
        shortcode,
        package: "demo",
        name: { full: shortcode },
        file: { path: shortcode + ".md" },
        description: "Spelling",
        address: { canonical: "demo-note-doc-lettersenc", slug: "doc-lettersenc" },
        data: { mappings },
    });
    let db;
    try {
        db = await openNotesDatabase(
            [note("lower", { a: "LOWER" }), note("upper", { A: "UPPER" })],
            { dir: root },
        );
        expect(
            (
                await db.query(
                    "SELECT unnest(data.mappings).from AS source FROM notes ORDER BY source",
                )
            ).rows,
        ).toEqual([{ source: "A" }, { source: "a" }]);
        await db.close();
        db = undefined;
        await expect(
            openNotesDatabase(
                [
                    {
                        ...note("bad", { a: "LOWER", A: "UPPER" }),
                        data: {
                            mappings: { a: "LOWER", A: "UPPER" },
                            custom: { Case: 1, case: 2 },
                        },
                    },
                ],
                { dir: path.join(root, "bad") },
            ),
        ).rejects.toThrow(/`Case` and `case`|`case` and `Case`/);
    } finally {
        await db?.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});
