/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A mapping row's `data.` source is a source some declaration names.**
 *
 * The specification's per-type mapping tables say where a shared value is
 * written: `data.seat` reaches `system.seat`, `data.weight` reaches
 * `system.weightBase`. A declaration naming the bare key instead reads three
 * positions — the destination, its own block, and the note's **top level** — and
 * never enters the container the row names, so the row asserts a resolution the
 * code cannot perform. The value arrives at the field's `?? default` as an
 * ordinary absence, and the document ships the default.
 *
 * `checkDeclaredFields` normalizes `data.seat` and `seat` before comparing
 * targets. This guard checks whether the declaration reads the stated source.
 *
 * So this derives the comparison from the specification rather than listing it.
 * Every `| data.X | system.Y |` row is read out of the document, the declaration
 * that compiles it is found through the same matcher the target check uses, and
 * that declaration must name `data.X`. Every unmatched row is a finding.
 *
 * The second assertion is the trap the first one walks into. `legacyKeyOf` falls
 * back to `name`, so renaming a source to `data.weight` and stopping there moves
 * step 2 from `sohl.weight` to `sohl["data.weight"]` — a position no note
 * authors — and every tree that writes the key inside its block loses the value
 * to fix the container. A `data.` source therefore declares `legacyKey`, and
 * that key is the bare remainder.
 */

import { describe, it, expect } from "vitest";

import { loadContentFormat } from "../engine/content-format.mjs";
import { declarationFor } from "../engine/content-format-check.mjs";
import { authoredFields } from "../engine/field-spec.mjs";
import { legacyKeyOf, retiredTopLevelKey, resolveFieldValue } from "../engine/system-block.mjs";
import { resolveCharges, resolveRelation, resolveSkillAptitudes } from "../engine/frontmatter.mjs";
import { ITEM_FIELDS } from "../sohl/item-fields.mjs";
import { HM3_ITEM_FIELDS } from "../hm3/item-fields.mjs";

/** The declaration sets this package ships, by the system column that compiles them. */
const REGISTRIES: Record<string, Record<string, readonly any[]>> = {
    sohl: ITEM_FIELDS,
    hm3: HM3_ITEM_FIELDS,
};

const FORMAT = loadContentFormat();

/** One mapping row, and the declaration that compiles it. */
type MappedRow = {
    system: string;
    noteType: string;
    source: string;
    target: string;
    line: number;
    field: any;
};

/**
 * Every per-type mapping row naming a `data.` source that a declaration
 * compiles.
 *
 * The **shared** tables are excluded, and by construction rather than by
 * choice: a shared row's scope is not a note type, so no per-type declaration
 * set answers for it.
 */
function mappedRows(): MappedRow[] {
    const rows: MappedRow[] = [];
    for (const claim of FORMAT.claims) {
        if (claim.shared || !String(claim.source).startsWith("data.")) continue;
        const declared = REGISTRIES[claim.system]?.[claim.noteType];
        if (!declared) continue;
        const found = declarationFor(claim.source, authoredFields(declared));
        if (!found) continue;
        rows.push({
            system: claim.system,
            noteType: claim.noteType,
            source: claim.source,
            target: claim.target,
            line: claim.line,
            field: found.field,
        });
    }
    return rows;
}

/**
 * Every per-type mapping row that reaches no authored declaration, as
 * `source → target`.
 */
function skippedRows(): string[] {
    const out = new Set<string>();
    for (const claim of FORMAT.claims) {
        if (claim.shared) continue;
        const declared = REGISTRIES[claim.system]?.[claim.noteType];
        if (!declared) continue;
        if (declarationFor(claim.source, authoredFields(declared))) continue;
        out.add(`${claim.system} ${claim.noteType} ${claim.source} → ${claim.target}`);
    }
    return [...out].sort();
}

/** Every declaration in both registries, once, with the types that carry it. */
function everyDeclaration(): { system: string; noteType: string; field: any }[] {
    const out: { system: string; noteType: string; field: any }[] = [];
    for (const [system, registry] of Object.entries(REGISTRIES)) {
        for (const [noteType, fields] of Object.entries(registry)) {
            for (const field of authoredFields(fields)) out.push({ system, noteType, field });
        }
    }
    return out;
}

const ROWS = mappedRows();

describe("a mapping row's `data.` source is read", () => {
    it("reads rows out of the specification, so the comparison is not vacuous", () => {
        // Guards the guard: were the mapping tables' header to change shape, or
        // the registries to stop being addressable by note type, every
        // assertion below would hold of an empty list.
        expect(ROWS.length).toBeGreaterThan(40);
        expect(
            ROWS.some(
                (row) =>
                    row.noteType === "affiliation" &&
                    row.source === "data.seat" &&
                    row.target === "system.seat",
            ),
        ).toBe(true);
    });

    it("declares the source the row names, not the bare key beneath it", () => {
        const bare = ROWS.filter((row) => !String(row.field.name).startsWith("data.")).map(
            (row) => ({
                row: `${FORMAT.file}:${row.line}`,
                maps: `${row.source} → ${row.target}`,
                declares: `name: "${row.field.name}"`,
            }),
        );
        expect(bare).toEqual([]);
    });

    it("has no mapping row whose source a declaration cannot read", () => {
        expect(skippedRows()).toEqual([]);
    });

    it("keeps the in-block key a note authors reachable beneath it", () => {
        // `legacyKeyOf` falls back to `name`, so a dotted source with no
        // `legacyKey` sends step 2 looking for a key spelled `data.weight`
        // inside the block — which nothing writes.
        const unreachable = everyDeclaration()
            .filter(({ field }) => String(field.name ?? "").startsWith("data."))
            .filter(({ field }) => legacyKeyOf(field) !== retiredTopLevelKey(field))
            .map(({ system, noteType, field }) => ({
                declaration: `${system}.${noteType}.${field.name}`,
                legacyKey: legacyKeyOf(field),
            }));
        expect(unreachable).toEqual([]);
    });
});

/**
 * The four positions the rows were measured on, end to end.
 *
 * The assertions above hold the declarations to the specification; these hold
 * the resolution to the declarations, because three of the four are read by a
 * function that re-reads the note rather than taking the value it is handed. A
 * declaration naming a container its own reader ignores is the same defect one
 * layer down.
 */
describe("an affiliation's four shared sources reach the document", () => {
    const fieldNamed = (name: string) =>
        ITEM_FIELDS.affiliation.find((field: any) => field.name === name);

    it("resolves `seat`, `parents` and `domains` out of the container", () => {
        const fm = {
            data: { seat: "tashal", parents: ["affiliation-a"], domains: ["place-b"] },
        };
        for (const name of ["data.seat", "data.parents", "data.domains"]) {
            const field = fieldNamed(name);
            expect(field, name).toBeDefined();
            expect(resolveFieldValue(field, fm, { block: "sohl" }).from, name).toBe("shared");
        }
    });

    it("resolves `relations` out of the container, through its own reader", () => {
        // Its `read` re-reads the note, so the declaration alone proves nothing.
        expect(resolveRelation({ data: { relations: { peoni: "nemesis" } } })).toEqual({
            peoni: "nemesis",
        });
    });

    it("keeps the in-block and top-level positions every tree still writes", () => {
        expect(resolveRelation({ sohl: { relations: { peoni: "aligned" } } })).toEqual({
            peoni: "aligned",
        });
        expect(resolveRelation({ relations: { peoni: "rival" } })).toEqual({ peoni: "rival" });
        // The retired spelling of the field, in the container and out of it.
        expect(resolveRelation({ data: { relation: { peoni: "nemesis" } } })).toEqual({
            peoni: "nemesis",
        });
        expect(resolveRelation({ sohl: { relation: { peoni: "nemesis" } } })).toEqual({
            peoni: "nemesis",
        });
    });
});

/**
 * The other two re-reading fields the rows name.
 *
 * `data.charges.value`, `data.charges.max` and `data.skillAptitudes` are mapping
 * rows exactly as the affiliation four are, and their readers re-read the note
 * for the same reason — each validates a shape spread over several keys. No tree
 * authors them under `data:` today, which is why they cost nothing and why they
 * would have gone unnoticed.
 */
describe("a mystery's shared sources reach the document", () => {
    it("resolves `charges` out of the container", () => {
        expect(resolveCharges({ data: { charges: { value: 2, max: 5 } } })).toEqual({
            value: 2,
            max: 5,
        });
    });

    it("resolves `skillAptitudes` out of the container", () => {
        expect(resolveSkillAptitudes({ data: { skillAptitudes: { wpnc: 2 } } })).toEqual({
            wpnc: 2,
        });
    });

    it("keeps the destination and in-block positions winning over it", () => {
        expect(
            resolveCharges({
                data: { charges: { value: 2, max: 5 } },
                sohl: { charges: { value: 1, max: 3 } },
            }),
        ).toEqual({ value: 1, max: 3 });
        expect(
            resolveSkillAptitudes({
                data: { skillAptitudes: { wpnc: 2 } },
                sohl: { system: { skillAptitudes: { wpnc: 4 } } },
            }),
        ).toEqual({ wpnc: 4 });
    });
});
