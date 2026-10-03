/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
import { decodeNoteAddresses } from "../engine/note-addresses.mjs";

/**
 * Every `data.` field, across every note type, that declares both a `kind`
 * and a `check`.
 *
 * A `kind` normalises the authored value before anything else sees it — a
 * map keyed by Address becomes an `AddressEntries` wrapper, a single Address
 * becomes a parsed tuple — and a `check` runs after that normalisation, on
 * whatever shape it left behind. A check written against the authored shape
 * and a `kind` that rewrites the field are a standing trap: `socialTies` fell
 * into it, and nothing short of exercising the normalised form on every such
 * field answers whether anything else did too.
 *
 * Derived from {@link NOTE_VOCABULARY} rather than copied by hand, so a field
 * that starts declaring both tomorrow is a name this list grows on its own —
 * the fixture table below is what has to grow to meet it.
 */
function kindAndCheckFields() {
    const found: Array<{ type: string; name: string }> = [];
    for (const type of Object.keys(NOTE_VOCABULARY)) {
        for (const field of dataFields(type) ?? []) {
            if (field.kind && typeof field.check === "function") {
                found.push({ type, name: field.name });
            }
        }
    }
    return found;
}

/**
 * A fixture note for one type, carrying a documented, valid value for every
 * field this suite checks on it, decoded exactly as the note boundary decodes
 * every note before a lint sees it.
 *
 * One note per type rather than one per field: an author writes a `being` or
 * a `place` whole, and the fields that need an index to resolve against share
 * one small fetched corpus rather than each inventing its own.
 */
const HITS: Record<string, unknown> = {
    "thalorna-note-lore-cultureone": { subType: "culture" },
    "thalorna-note-lore-calendarone": { subType: "calendar" },
    "thalorna-note-being-ally": true,
    "thalorna-note-place-korrath": { type: "place", borders: [{ to: "vylar", bearing: "S" }] },
    "thalorna-note-place-tolvern": {
        type: "place",
        routes: [{ to: "vylar", bearing: "S", mode: "land", days: 5 }],
    },
    "thalorna-note-affiliation-vrystwldtrbs": {
        fm: {
            data: {
                governance: {
                    ranks: [{ level: 5, title: "War Chief", description: "Leads in war." }],
                },
            },
        },
    },
};

const index = {
    contentPackage: "thalorna",
    types: new Set(Object.keys(NOTE_VOCABULARY)),
    packages: new Set(["thalorna"]),
    notes: [] as unknown[],
    addressHit: (address: string) => HITS[address] ?? false,
};

/** The fields each fixture covers, kept beside the fixture that answers for it. */
const FIXTURES: Record<string, { fm: () => any; covers: string[] }> = {
    being: {
        covers: [
            "culture",
            "calendar",
            "affiliations",
            "socialTies",
            "born",
            "died",
            "height",
            "weight",
        ],
        fm: () => ({
            type: "being",
            shortcode: "subject",
            data: {
                culture: "cultureone",
                calendar: "calendarone",
                affiliations: { vrystwldtrbs: { rank: 5 } },
                socialTies: { "being-ally": "patron" },
                born: "unknown",
                died: "unknown",
                height: "1.91m",
                weight: "85kg",
            },
        }),
    },
    place: {
        covers: ["calendar", "purpose", "population", "market", "borders", "routes"],
        fm: () => ({
            type: "place",
            subType: "settlement",
            shortcode: "vylar",
            tags: ["market"],
            data: {
                calendar: "calendarone",
                purpose: "market",
                population: 1200,
                market: 3,
                borders: [{ to: "korrath", bearing: "N" }],
                routes: [{ to: "tolvern", bearing: "N", mode: "land", days: 5 }],
            },
        }),
    },
    affiliation: {
        covers: ["governance.ranks"],
        fm: () => ({
            type: "affiliation",
            shortcode: "someaffiliation",
            data: {
                governance: {
                    ranks: [{ level: 1, title: "Member", description: "An ordinary member." }],
                },
            },
        }),
    },
    lore: {
        covers: ["events"],
        fm: () => ({
            type: "lore",
            subType: "history",
            shortcode: "founding",
            data: {
                events: [{ when: "412.1", until: "612.1", recurs: { every: 1 } }],
            },
        }),
    },
};

/** A decoded note for one type, built once per test from its fixture. */
function decodedNote(type: string) {
    const fm = decodeNoteAddresses(FIXTURES[type].fm(), { package: "thalorna", system: "note" });
    return { fm, file: `${type}.md`, raw: "" };
}

describe("every field declaring both a kind and a check", () => {
    const fields = kindAndCheckFields();

    it("is covered by this suite's fixtures — the guard itself", () => {
        // Proves the list is read from the vocabulary rather than restated:
        // a field added to NOTE_VOCABULARY with both a `kind` and a `check`
        // and no matching fixture entry fails here, naming itself, rather
        // than silently going untested.
        expect(fields.length).toBeGreaterThan(0);
        for (const { type, name } of fields) {
            const covers = FIXTURES[type]?.covers ?? [];
            expect(covers, `${type}.${name} needs a fixture covering it`).toContain(name);
        }
        const coveredCount = Object.values(FIXTURES).reduce((n, f) => n + f.covers.length, 0);
        expect(coveredCount).toBe(fields.length);
    });

    it("accepts its own documented form once the note boundary has decoded it", () => {
        for (const { type, name } of fields) {
            const note = decodedNote(type);
            const field = (dataFields(type) ?? []).find((f: any) => f.name === name);
            const findings = field.check(note, { index });
            expect(findings, `${type}.${name}`).toEqual([]);
        }
    });
});
