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
    "thalorna-note-skill-languageone": { subType: "language" },
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
                    ranks: [
                        { level: 0, title: "Kinless", description: "Cast out of the tribes." },
                        { level: 1, title: "Tribesman", description: "Belongs to a tribe." },
                        { level: 5, title: "Elder", description: "Speaks in the moot." },
                    ],
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

/**
 * The fields each fixture covers, kept beside the fixture that answers for it.
 * Keyed by type, or by `<type>:<subType>` where a field belongs to one subType
 * and the type's main fixture is another.
 */
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
            "appearance.extra_features",
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
                appearance: {
                    complexion: ["weathered"],
                    extra_features: ["a burn scar on the left forearm"],
                },
            },
        }),
    },
    place: {
        covers: [
            "events",
            "calendar",
            "purpose",
            "culture",
            "population",
            "market",
            "borders",
            "routes",
        ],
        fm: () => ({
            type: "place",
            subType: "settlement",
            shortcode: "vylar",
            tags: ["market"],
            data: {
                events: [
                    {
                        kind: "founding",
                        when: "412.1",
                        summary: "The town is founded.",
                        where: { locus: ["place-korrath"] },
                        who: [{ ref: "affiliation-vrystwldtrbs", role: "founder" }],
                    },
                ],
                calendar: "calendarone",
                purpose: "market",
                culture: "cultureone",
                population: 1200,
                market: 3,
                borders: [{ to: "korrath", bearing: "N" }],
                routes: [{ to: "tolvern", bearing: "N", mode: "land", days: 5 }],
            },
        }),
    },
    affiliation: {
        covers: ["events", "governance.ranks", "governance.offices", "culture"],
        fm: () => ({
            type: "affiliation",
            shortcode: "someaffiliation",
            data: {
                events: [
                    {
                        kind: "founding",
                        when: "412.1",
                        summary: "The town is founded.",
                        where: { locus: ["place-korrath"] },
                        who: [{ ref: "affiliation-vrystwldtrbs", role: "founder" }],
                    },
                ],
                governance: {
                    ranks: [
                        { level: 0, title: "Outcast", description: "Barred from the body." },
                        { level: 1, title: "Member", description: "An ordinary member." },
                    ],
                    offices: {
                        Steward: "Keeps the accounts.",
                        Chancellor: { description: "Keeps the seal.", holders: [] },
                    },
                },
                culture: "cultureone",
            },
        }),
    },
    lore: {
        covers: ["culture", "language", "events"],
        fm: () => ({
            type: "lore",
            subType: "literature",
            shortcode: "foundingsaga",
            data: {
                culture: "cultureone",
                language: "languageone",
                events: [
                    {
                        when: "412.1",
                        until: "612.1",
                        recurs: { every: 1 },
                        summary: "The saga is recited every year.",
                    },
                ],
            },
        }),
    },
    "lore:culture": {
        covers: ["appearanceProfile", "parents"],
        fm: () => ({
            type: "lore",
            subType: "culture",
            shortcode: "cultureone",
            data: {
                parents: [],
                appearanceProfile: {
                    frame: { light: 1, medium: 2 },
                    eye_color: { brown: 1 },
                    hair_color: { black: 1 },
                    skin_color: { olive: 1 },
                    complexion: { clear: 1 },
                    height: {
                        female: { min: "1.5m", max: "1.7m" },
                        male: { min: "1.6m", max: "1.85m" },
                    },
                },
            },
        }),
    },
    "skill:language": {
        covers: ["names"],
        fm: () => ({
            type: "skill",
            subType: "language",
            shortcode: "languageone",
            data: {
                names: {
                    pattern: "{given} {clan}",
                    given: { female: ["Agosi"], male: ["Aguri"] },
                    clan: ["Zekar"],
                },
            },
        }),
    },
    doc: {
        covers: ["culture"],
        fm: () => ({
            type: "doc",
            subType: "settingguide",
            shortcode: "someguide",
            data: { culture: "cultureone" },
        }),
    },
};

/** The fixture that covers one field of a type. */
function fixtureFor(type: string, name: string) {
    return Object.entries(FIXTURES).find(
        ([key, fixture]) => key.split(":")[0] === type && fixture.covers.includes(name),
    )?.[1];
}

/** A decoded note for one field of a type, built once per test from its fixture. */
function decodedNote(type: string, name: string) {
    const fixture = fixtureFor(type, name);
    if (!fixture) throw new Error(`${type}.${name} has no fixture`);
    const fm = decodeNoteAddresses(fixture.fm(), { package: "thalorna", system: "note" });
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
            const covers = fixtureFor(type, name)?.covers ?? [];
            expect(covers, `${type}.${name} needs a fixture covering it`).toContain(name);
        }
        const coveredCount = Object.values(FIXTURES).reduce((n, f) => n + f.covers.length, 0);
        expect(coveredCount).toBe(fields.length);
    });

    it("accepts its own documented form once the note boundary has decoded it", () => {
        for (const { type, name } of fields) {
            const note = decodedNote(type, name);
            const field = (dataFields(type) ?? []).find((f: any) => f.name === name);
            const findings = field.check(note, { index });
            expect(findings, `${type}.${name}`).toEqual([]);
        }
    });
});
