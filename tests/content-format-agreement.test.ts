/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE.md file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `docs/content-format.md` is the specification, and this makes it executable
 * (#231, #232).
 *
 * The two had drifted, silently and in both directions. Five types the
 * specification declared — `place`, `lore`, `scenario`, `vehicle` and
 * `armorlocation` — reached no `NOTE_SCHEMAS` entry, so a note using one was
 * reported as having no schema and then *skipped entirely*: `lintNote` returns
 * after that finding, so the note's `data:`, `subType`, references and system
 * block all went unexamined. And three documented `data` properties —
 * `epithet`, `symbol` and the widened `lore` — reached no vocabulary entry, so
 * a note that followed the specification exactly was told its property did not
 * exist, and the value was dropped from the closed container rather than
 * reaching the page.
 *
 * Between them that was 1,981 findings against `sohl-thalorna` alone, none of
 * them a content defect. Nothing compared the two, which is why nobody noticed.
 *
 * The parse is deliberately narrow: a `### type: <name>` heading opens a
 * section, and the one table in it whose first header cell is `` `data`
 * property `` is that type's data vocabulary. A specification that grows a
 * differently-shaped table fails here rather than being read wrongly.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const SPEC = readFileSync(path.resolve(__dirname, "../docs/content-format.md"), "utf8");

/** Each `### type: <name>` section, with the data properties its table declares. */
function documentedTypes(): Map<string, string[]> {
    const heads = [...SPEC.matchAll(/^###\s+type:\s*(\w+)\s*$/gm)];
    const out = new Map<string, string[]>();
    heads.forEach((head, i) => {
        const start = head.index ?? 0;
        const end = i + 1 < heads.length ? (heads[i + 1].index ?? SPEC.length) : SPEC.length;
        const body = SPEC.slice(start, end);
        const table = body.match(/^\|\s*`data` property.*?\n\|[-\s|]+\n((?:\|.*\n)+)/m);
        const props = (table?.[1] ?? "")
            .trim()
            .split("\n")
            .map((row) => row.trim().replace(/^\|/, "").split("|")[0].trim().replace(/`/g, ""))
            .filter(Boolean);
        out.set(head[1], props);
    });
    return out;
}

const DOCUMENTED = documentedTypes();

describe("the specification and the implementation agree (#231, #232)", () => {
    it("parses a specification that still has type sections to read", () => {
        // Guards the guard: a rename of the heading shape would otherwise make
        // every assertion below vacuously pass.
        expect(DOCUMENTED.size).toBeGreaterThan(20);
        expect(DOCUMENTED.get("being")).toContain("lore");
    });

    it("declares a schema for every documented type", () => {
        const missing = [...DOCUMENTED.keys()].filter((t) => !(t in NOTE_SCHEMAS));
        // Without one, `lintNote` reports "no schema is declared" and returns —
        // so the note is not merely mis-reported, it goes wholly unchecked.
        expect(missing).toEqual([]);
    });

    it("declares a vocabulary for every documented type", () => {
        const missing = [...DOCUMENTED.keys()].filter((t) => !(t in NOTE_VOCABULARY));
        expect(missing).toEqual([]);
    });

    it("declares exactly the `data` properties the specification lists", () => {
        const drift: Record<string, { documented?: string[]; declared?: string[] }> = {};
        for (const [type, props] of DOCUMENTED) {
            const spec = NOTE_VOCABULARY[type as keyof typeof NOTE_VOCABULARY];
            if (!spec) continue; // reported by the test above
            const declared = (spec.data ?? []).map((f: { name: string }) => f.name);
            const undeclared = props.filter((p) => !declared.includes(p));
            const undocumented = declared.filter((p) => !props.includes(p));
            if (undeclared.length || undocumented.length) {
                drift[type] = {
                    ...(undeclared.length ? { documented: undeclared } : {}),
                    ...(undocumented.length ? { declared: undocumented } : {}),
                };
            }
        }
        expect(drift).toEqual({});
    });

    it("holds `place`, `lore` and `scenario` to an empty schema", () => {
        // Each produces the JournalEntry every note produces and nothing else,
        // so none writes a `sohl:` field. The emptiness is the declaration: it
        // is what distinguishes a type with no vocabulary from an unknown one.
        for (const type of ["place", "lore", "scenario"]) {
            expect(NOTE_SCHEMAS[type as keyof typeof NOTE_SCHEMAS], type).toEqual([]);
        }
    });

    it("no longer declares `peoples`, which widened to `lore`", () => {
        for (const type of ["being", "affiliation"] as const) {
            const declared = (NOTE_VOCABULARY[type].data ?? []).map(
                (f: { name: string }) => f.name,
            );
            expect(declared, type).toContain("lore");
            expect(declared, type).not.toContain("peoples");
        }
    });
});
