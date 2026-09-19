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
 * `docs/content-format.md` is the specification, and this makes it executable.
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
import { IMAGE_CLASSES, IMAGE_FLOATS } from "../engine/content-images.mjs";
import { DECLARED_TAGS, NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
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

/**
 * The `data:` keys the specification states **once**, for every type.
 *
 * A key legal on every type has nowhere to go in a per-type table, and
 * repeating it in twenty-five of them would be twenty-five chances for one to
 * disagree with the rest. So the specification states it in a table of its own,
 * recognised by its own header, and the comparison below adds it to every
 * type's documented set — which is exactly what `dataFields` does on the other
 * side.
 */
function documentedSharedProperties(): string[] {
    const table = SPEC.match(/^\|\s*shared `data` property.*?\n\|[-\s|]+\n((?:\|.*\n)+)/m);
    return (table?.[1] ?? "")
        .trim()
        .split("\n")
        .map((row) => row.trim().replace(/^\|/, "").split("|")[0].trim().replace(/`/g, ""))
        .filter(Boolean);
}

const DOCUMENTED = documentedTypes();
const SHARED = documentedSharedProperties();

describe("the specification and the implementation agree", () => {
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

    it("states the keys every type accepts, so the shared half is not vacuous", () => {
        // Guards the guard: were the shared table's header to change shape, the
        // comparison below would report every type as declaring two keys the
        // specification does not.
        expect(SHARED).toEqual(["icon", "banner"]);
    });

    it("declares exactly the `data` properties the specification lists", () => {
        const drift: Record<string, { documented?: string[]; declared?: string[] }> = {};
        for (const [type, documented] of DOCUMENTED) {
            const spec = NOTE_VOCABULARY[type as keyof typeof NOTE_VOCABULARY];
            if (!spec) continue; // reported by the test above
            // Both halves of what a type accepts: the keys its own table names,
            // and the ones the specification states once for every type.
            const props = [...SHARED, ...documented];
            const declared = (dataFields(type) ?? []).map((f: { name: string }) => f.name);
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
 * The other half of the same vocabulary entry.
 *
 * The block above compares each type's documented `data` properties to the
 * declared ones. Its `subType` values — the genres an author picks from, and
 * the values a note's `subType` is closed against — were compared to nothing,
 * so the specification and `note-vocabulary.mjs` were free to disagree about
 * which genres exist, in either direction. That is the drift the two gaps
 * were filed about, on the half they did not reach.
 *
 * Read through the shared specification parser rather than a second regex
 * here, because the values are stated in one shape the document now keeps to,
 * and that parser is where the shape is enforced: a marker it does not
 * recognise throws rather than yielding a section that declares nothing.
 */
describe("the specification and the vocabulary agree about subTypes", () => {
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
        // Folds in the `lore`-only assertion: every declared genre
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

/**
 * The closed vocabularies a body directive admits.
 *
 * An image states its width as a class and its position as `float:`, and both
 * are closed: an unrecognised value is refused rather than rendered as the
 * default, because a page that silently looks like the author asked for
 * nothing is the failure worth preventing. Two places say which values exist —
 * the specification's tables and `engine/content-images.mjs` — and a reader of
 * either has to be able to trust it.
 *
 * So the tables are read through the shared specification parser, which
 * recognises a vocabulary table by its own header, and compared against the
 * declarations the renderers use. A value documented but not implemented
 * renders as its own literal braces; a value implemented but not documented is
 * an undocumented feature of a format whose whole contract is that it is
 * written down.
 */
describe("the specification and the renderers agree about an image's vocabularies", () => {
    const FORMAT = loadContentFormat();

    it("reads vocabulary tables out of the specification, so the comparison is not vacuous", () => {
        // Guards the guard: were the table's header to change shape, every
        // comparison below would be between two empty lists. The two this
        // suite compares are named, rather than every vocabulary the
        // specification declares, so a vocabulary added elsewhere does not
        // fail an assertion about images.
        expect([...FORMAT.vocabularies.keys()]).toEqual(expect.arrayContaining(["class", "float"]));
    });

    it("declares exactly the width classes the specification lists, in its order", () => {
        expect(Object.keys(IMAGE_CLASSES)).toEqual(
            FORMAT.vocabularies.get("class")?.values.map((v) => v.replace(/^\./, "")),
        );
    });

    it("declares exactly the float positions the specification lists, in its order", () => {
        expect(Object.keys(IMAGE_FLOATS)).toEqual(FORMAT.vocabularies.get("float")?.values);
    });
});

/**
 * The tag groups, which nothing compared until now.
 *
 * `tags:` sits in the open top-level region, so most tags are the author's own
 * and no registry has standing over them. A **classifying** tag is different,
 * because something queries it: a settlement tagged `village` is in the list of
 * villages and one tagged `vilage` is not, while the list still renders looking
 * complete. `DECLARED_TAGS` is what the lint checks a near miss against, and
 * the specification's table is what an author reads — two statements of one
 * vocabulary, free to disagree in either direction.
 *
 * The table's group names are prose (`being kind`) and the registry's are keys
 * (`beingKind`), so the name is camel-cased rather than mapped: a hand-written
 * second map would be one more pair free to drift.
 *
 * Only the tags are compared, not the `applies to` column. That column is
 * written for a reader and says `place / settlement` where the registry scopes
 * the group to `place` and the subtype is what narrows it — a true sentence
 * about where the tag belongs, and not the same statement as `types`.
 */
describe("the specification and the registry agree about the tags that classify", () => {
    /** Each row of the tag-group table: prose group name → the tags it lists. */
    function documentedTagGroups(): Map<string, string[]> {
        const table = SPEC.match(/^\|\s*group\s*\|.*\n\|[-\s|]+\n((?:\|.*\n)+)/m);
        const out = new Map<string, string[]>();
        for (const row of (table?.[1] ?? "").trim().split("\n")) {
            const cells = row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
            const name = cells[0].replace(/\*/g, "").trim();
            const tags = [...(cells[2] ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1]);
            if (name) out.set(name, tags);
        }
        return out;
    }

    /** `being kind` → `beingKind`, so the two names need no third list. */
    const key = (name: string) => name.replace(/\s+(\w)/g, (_, c: string) => c.toUpperCase());

    const DOCUMENTED_GROUPS = documentedTagGroups();

    it("reads a tag-group table that still has rows, so the comparison is not vacuous", () => {
        expect(DOCUMENTED_GROUPS.size).toBeGreaterThan(4);
        expect(DOCUMENTED_GROUPS.get("state")).toEqual(["draft"]);
    });

    it("declares exactly the groups the specification tabulates", () => {
        expect([...DOCUMENTED_GROUPS.keys()].map(key).sort()).toEqual(
            Object.keys(DECLARED_TAGS).sort(),
        );
    });

    it("declares exactly the tags the specification lists, in its order", () => {
        const drift: Record<string, { documented: string[]; declared: string[] }> = {};
        for (const [name, documented] of DOCUMENTED_GROUPS) {
            const group = DECLARED_TAGS[key(name) as keyof typeof DECLARED_TAGS];
            if (!group) continue; // reported by the test above
            const declared = [...group.tags];
            if (documented.join(" ") !== declared.join(" ")) drift[name] = { documented, declared };
        }
        expect(drift).toEqual({});
    });
});

/**
 * A being's kind, which is the one tag group that is a slot.
 *
 * `character` and `creature` are not two of the several things a being may be
 * at once — they are the two answers to one question, and a note answering it
 * twice has said nothing. That is what `exclusive` marks, and it is the only
 * refusal a closed tag vocabulary can make without redefining the open region
 * it sits in.
 *
 * Stated twice on purpose and compared here: the group table above lists the
 * two tags where a reader looks for tags, and the vocabulary table states what
 * each one means. Both are read against `DECLARED_TAGS`, so neither can drift
 * from the registry or, through it, from the other.
 */
describe("the specification and the registry agree about a being's kind", () => {
    const FORMAT = loadContentFormat();

    it("reads a vocabulary table out of the specification, so the comparison is not vacuous", () => {
        // Guards the guard: were the table's header to change shape, every
        // comparison below would be between two empty lists.
        expect([...FORMAT.vocabularies.keys()]).toContain("beingKind");
    });

    it("admits exactly the values the specification lists, in its order", () => {
        expect([...DECLARED_TAGS.beingKind.tags]).toEqual(
            FORMAT.vocabularies.get("beingKind")?.values,
        );
    });

    it("marks the group single-valued, which is what the specification promises", () => {
        expect(DECLARED_TAGS.beingKind.exclusive).toBe("kind");
        expect(DECLARED_TAGS.beingKind.types).toEqual(["being"]);
    });
});
