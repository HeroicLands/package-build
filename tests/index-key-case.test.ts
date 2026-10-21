// SPDX-License-Identifier: GPL-3.0-or-later

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectContentIndex } from "../engine/content-index.mjs";
import { openNotesDatabase } from "../engine/sql-tables.mjs";

let tmp: string;

function note(file: string, key: string): void {
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(
        path.join(tmp, file),
        [
            "---",
            `shortcode: ${file.slice(0, 1).toLowerCase()}`,
            "name: { full: Note }",
            "type: doc",
            "subType: reference",
            "data:",
            "  fonts:",
            `    ${key}: 1`,
            "---",
            "",
            "Body.",
            "",
        ].join("\n"),
    );
}

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "index-key-case-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("keys that differ only in case", () => {
    it("are reported with both notes and their lines, not as a bare database error", async () => {
        note("A.md", "carved");
        note("B.md", "Carved");
        const records = collectContentIndex(tmp, { contentPackage: "demo", skipDirectories: [] });
        const error: any = await openNotesDatabase(records, { contentBase: tmp }).then(
            () => undefined,
            (err: unknown) => err,
        );
        expect(error?.located).toBe(true);
        const rel = (name: string) =>
            path
                .relative(process.cwd(), path.join(tmp, name))
                .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const lines = error.message.split("\n");
        expect(lines).toHaveLength(2);
        expect(lines[0]).toMatch(
            new RegExp(`^${rel("B.md")}:8:5: error: .*\`Carved\`.*${rel("A.md")}:8:5`),
        );
        expect(lines[1]).toMatch(
            new RegExp(`^${rel("A.md")}:8:5: error: .*\`carved\`.*${rel("B.md")}:8:5`),
        );
    });

    it("do not trouble keys that agree", async () => {
        note("A.md", "carved");
        note("B.md", "carved");
        const records = collectContentIndex(tmp, { contentPackage: "demo", skipDirectories: [] });
        const db = await openNotesDatabase(records, { contentBase: tmp });
        await db.close();
    });
});
