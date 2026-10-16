/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** The dictionary reference follows the columns and exports a consumer gets. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as rows from "../engine/dictionary-rows.mjs";
import * as layout from "../engine/dictionary-layout.mjs";
import * as lexical from "../engine/lexical-sections.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REFERENCE = fs.readFileSync(path.join(ROOT, "docs/reference/format-details.md"), "utf8");
const API = fs.readFileSync(path.join(ROOT, "docs/api.md"), "utf8");

/** The first column table after a relation's declaration in its own section. */
function documentedColumns(relation: string): string[] {
    const section = REFERENCE.slice(REFERENCE.indexOf("#### Dictionaries and glossaries"));
    const declaration = section.indexOf(`**\`${relation}\`**`);
    const table = section
        .slice(declaration)
        .match(/^\| Column[^\n]*\n\| [-| ]+\n((?:\|[^\n]*\n)+)/m);
    expect(declaration, relation).toBeGreaterThanOrEqual(0);
    expect(table, relation).not.toBeNull();
    return [...table![1].matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((match) => match[1]);
}

describe("dictionary documentation follows its public contract", () => {
    it("tabulates exactly the dictionary and term columns in declaration order", () => {
        expect(documentedColumns("dictionary")).toEqual(rows.DICTIONARY_COLUMNS);
        expect(documentedColumns("terms")).toEqual(rows.TERM_COLUMNS);
    });

    for (const [subpath, module] of Object.entries({
        "dictionary-rows": rows,
        "dictionary-layout": layout,
        "lexical-sections": lexical,
    })) {
        it(`documents every export of engine/${subpath}`, () => {
            const documented = new Set(
                [...API.matchAll(/^\|\s*`([A-Za-z0-9_$]+)`\s*\|/gm)].map((match) => match[1]),
            );
            expect(API.includes(`@heroiclands/package-build/engine/${subpath}`)).toBe(true);
            expect(Object.keys(module).filter((name) => !documented.has(name))).toEqual([]);
        });
    }
});
