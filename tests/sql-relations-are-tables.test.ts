/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A relation built from a file reads the file once.**
 *
 * A view over `read_json_auto` re-parses the whole content-index JSONL on every
 * query, and a check issues over a thousand. Each relation is a table instead,
 * so removing the source after the database opens leaves every query answering.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openNotesDatabase } from "../engine/sql-tables.mjs";

const NOTE = {
    type: "being",
    shortcode: "aldric",
    package: "thalorna",
    address: "thalorna:being:aldric",
    name: { full: "Sir Aldric" },
    data: { events: [{ year: 1, name: "Born" }] },
};

describe("relations built from a file", () => {
    it("answer after the source files are gone", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sql-tables-once-"));
        const depFile = path.join(dir, "dep-source.jsonl");
        fs.writeFileSync(depFile, JSON.stringify({ ...NOTE, shortcode: "dep" }));
        const db = await openNotesDatabase([NOTE], {
            dir: path.join(dir, "work"),
            dependencies: [{ id: "other", file: depFile }],
        });
        try {
            const count = async (relation: string) =>
                Number((await db.query(`SELECT count(*) AS n FROM ${relation}`)).rows[0].n);
            expect(await count("entries")).toBe(1);
            for (const file of fs.readdirSync(path.join(dir, "work"))) {
                fs.rmSync(path.join(dir, "work", file));
            }
            fs.rmSync(depFile);
            expect(await count("entries")).toBe(1);
            expect(await count("notes")).toBe(1);
            expect(await count("events")).toBe(1);
            expect(await count("other.entries")).toBe(1);
            expect(await count("other.events")).toBe(1);
        } finally {
            await db.close();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
