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
import { loadContentFormat } from "../engine/content-format.mjs";
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

/**
 * The other half of the same vocabulary entry (#345).
 *
 * The block above compares each type's documented `data` properties to the
 * declared ones. Its `subType` values — the genres an author picks from, and
 * the values a note's `subType` is closed against — were compared to nothing,
 * so the specification and `note-vocabulary.mjs` were free to disagree about
 * which genres exist, in either direction. That is the drift #231 and #232
 * were filed about, on the half they did not reach.
 *
 * Read through the shared specification parser rather than a second regex
 * here, because the values are stated in one shape the document now keeps to,
 * and that parser is where the shape is enforced: a marker it does not
 * recognise throws rather than yielding a section that declares nothing.
 */
describe("the specification and the vocabulary agree about subTypes (#345)", () => {
    const FORMAT = loadContentFormat();

    it("reads values out of the specification, so the comparison is not vacuous", () => {
        // Guards the guard, as the `data` block above does: were the marker or
        // the bullet shape to change, every type would document no values and
        // the comparison would pass while checking nothing.
        const enumerating = [...FORMAT.types.values()].filter((t) => t.subTypes.length);
        expect(enumerating.length).toBeGreaterThan(10);
        expect(FORMAT.types.get("lore")?.subTypes).toContain("gathering");
    });

    it("declares exactly the values the specification lists, in its order", () => {
        // Folds in the `lore`-only assertion #333 added: every declared genre
        // is defined in the specification, and the specification names no genre
        // the vocabulary has not declared — now asked of every type.
        //
        // Order is compared too. The two agree on it today, and a specification
        // that lists a type's genres in one order while the declaration holds
        // another is worth a line of diff rather than a sort.
        const drift: Record<string, { documented: string[]; declared: string[] | string }> = {};
        for (const [type, section] of FORMAT.types) {
            const vocabulary = NOTE_VOCABULARY[type as keyof typeof NOTE_VOCABULARY];
            if (!vocabulary) continue; // reported by the block above
            const documented = section.subTypes;
            // Three-valued, and the readings differ: a list is closed, `null`
            // is a subType whose values are not enumerated yet, and an absent
            // key is a type with no subType at all.
            const declared = vocabulary.subTypes ? [...vocabulary.subTypes] : vocabulary.subTypes;
            if (declared && documented.join(" ") === declared.join(" ")) continue;
            if (!declared && !documented.length) continue;
            drift[type] = {
                documented,
                declared:
                    declared ??
                    (declared === null ?
                        "declared with no enumerated values (`subTypes: null`)"
                    :   "no `subType` at all (the key is absent)"),
            };
        }
        expect(drift).toEqual({});
    });
});
