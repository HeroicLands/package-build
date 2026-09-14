/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The declared infobox.
 *
 * The guard that matters most is the first one: **the note box's field set is
 * derived, never written twice.** A second list would drift from the note
 * vocabulary the moment either was edited, and nothing would fail — which is
 * the shape of defect this whole structure exists to remove. So the test
 * derives the expected rows from `NOTE_VOCABULARY` at runtime and compares,
 * rather than stating them.
 *
 * The overlay is checked in both directions. A key it names that the
 * vocabulary does not declare is a label nobody will ever see, and a field the
 * vocabulary declares is required to reach a row unless the overlay says in so
 * many words why it does not.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import {
    INFOBOX_LAYOUTS,
    INFOBOX_VALUE_KINDS,
    NOTE_BOX_ID,
    NOTE_FIELD_PRESENTATION,
    NOTHING_BEYOND_PROFILE,
    NOT_AVAILABLE,
    assertInfoboxSet,
    buildInfoboxes,
    defineInfobox,
    humanizeFieldName,
    isDeclaredDefault,
    overlayFor,
    noteInfobox,
    presentValue,
    requiredInfoboxIds,
} from "../engine/infobox.mjs";
import { SOHL_FIELD_PRESENTATION, strikeModes } from "../sohl/infobox.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { infoboxesToHtml, infoboxesToTypst, sectionHasContent } from "../engine/infobox-render.mjs";
import { noteInfoboxes } from "../engine/infobox-registry.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { KNOWN_DOCUMENT_SUBTYPE_MAPS } from "../engine/subtype-registry.mjs";

/**
 * The suffixes a declaration's own key carries into a label.
 *
 * A field is named for the value it carries into a DataModel, so
 * `perceptionPenaltyBase`, `assocSkillCode` and `improveFlag` humanise into the
 * compiler's word rather than a reader's. Deriving the check from the
 * declarations means a field added with such a name fails until an overlay
 * names it or withholds it.
 */
const COMPILER_WORDS = /\b(base|code|flag|mult|desc)$/i;

/** A value the vocabulary's declared shape will accept, so every field is filled. */
function sampleFor(field: { shape?: string; kind?: string }): unknown {
    if (field.shape === "a wikilink") return "someref";
    if (field.shape === "list of wikilinks") return ["someref"];
    if (field.kind === "number") return 7;
    if (field.kind === "list") return ["one", "two"];
    return "something";
}

/** A note of `type` with every `data:` key its vocabulary declares filled in. */
function fullyStated(type: string): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const field of NOTE_VOCABULARY[type].data) {
        const parts = String(field.name).split(".");
        let cursor = data;
        for (const part of parts.slice(0, -1)) {
            cursor[part] = cursor[part] ?? {};
            cursor = cursor[part] as Record<string, unknown>;
        }
        cursor[parts[parts.length - 1]] = sampleFor(field);
    }
    return { type, name: { full: "A Note" }, shortcode: "anote", data };
}

describe("the note box's fields are the type's own vocabulary", () => {
    it("gives every declared type a box, and every box a name", () => {
        for (const type of Object.keys(NOTE_VOCABULARY)) {
            const box = noteInfobox({ type, name: { full: "A Note" } });
            expect(box.id).toBe(NOTE_BOX_ID);
            expect(box.sections[0].rows[0]).toEqual({
                label: "Name",
                kind: "text",
                value: "A Note",
            });
        }
    });

    it("carries every field the vocabulary declares, unless the overlay withholds it", () => {
        const missing: Record<string, string[]> = {};
        for (const type of Object.keys(NOTE_VOCABULARY)) {
            const box = noteInfobox(fullyStated(type));
            const labels = new Set(box.sections[0].rows.map((row: { label: string }) => row.label));
            for (const field of NOTE_VOCABULARY[type].data) {
                const overlay = overlayFor(NOTE_FIELD_PRESENTATION, type, field.name);
                if (overlay.withheld) continue;
                const wanted =
                    overlay.group ? "Appearance" : (overlay.label ?? humanizeFieldName(field.name));
                if (!labels.has(wanted)) (missing[type] ??= []).push(field.name);
            }
        }
        expect(missing).toEqual({});
    });

    it("keeps the vocabulary's order", () => {
        const box = noteInfobox(fullyStated("affliction"));
        const rows = box.sections[0].rows.map((row: { label: string }) => row.label);
        expect(rows).toEqual([
            "Name",
            "Transmission",
            "Outcome",
            "Healing rate",
            "Contagion index",
            "Outcome traumas",
            "Onset roll",
            "Onset",
            "Healing check roll",
            "Healing check",
            "Resolution roll",
            "Resolution",
        ]);
    });

    it("withholds nothing but machinery and images", () => {
        for (const [name, overlay] of Object.entries(NOTE_FIELD_PRESENTATION)) {
            if (!overlay.withheld) continue;
            expect(overlay.withheld, `\`${name}\` withheld for a third reason`).toMatch(
                /image|machinery/,
            );
        }
    });

    it("leaves no declaration's own key on a page", () => {
        const leaked: Record<string, string> = {};
        for (const [type, entry] of Object.entries(NOTE_VOCABULARY)) {
            for (const field of entry.data as { name: string }[]) {
                // An overlay entry is somebody deciding what the row is called,
                // so it is trusted. What this catches is a field nobody has
                // decided about, humanised straight out of the vocabulary.
                const overlay = overlayFor(NOTE_FIELD_PRESENTATION, type, field.name);
                if (overlay.withheld || overlay.label || overlay.group) continue;
                const label = humanizeFieldName(field.name);
                if (COMPILER_WORDS.test(label)) leaked[`${type}.${field.name}`] = label;
            }
        }
        expect(leaked).toEqual({});
    });

    it("names no field the vocabulary does not declare", () => {
        const declared = new Set(
            Object.entries(NOTE_VOCABULARY).flatMap(([type, entry]) =>
                entry.data.flatMap((field: { name: string }) => [
                    field.name,
                    `${type}.${field.name}`,
                ]),
            ),
        );
        const stale = Object.keys(NOTE_FIELD_PRESENTATION).filter((name) => !declared.has(name));
        expect(stale).toEqual([]);
    });

    it("drops a field the note left empty rather than printing a placeholder", () => {
        const box = noteInfobox({
            type: "being",
            name: { full: "Abyssdrake" },
            data: { occupation: null, gender: "", homes: [], archetypes: [], age: null },
        });
        expect(box.sections[0].rows).toEqual([
            { label: "Name", kind: "text", value: "Abyssdrake" },
        ]);
    });

    it("composes a being's measurements into one clause", () => {
        const box = noteInfobox({
            type: "being",
            name: { full: "Someone" },
            data: { age: 34, height: 1.85, weight: 82, frame: "medium" },
        });
        const appearance = box.sections[0].rows.find(
            (row: { label: string }) => row.label === "Appearance",
        );
        expect(appearance.value).toEqual(["Age 34", "6′ 1″", "181 lbs", "medium frame"]);
    });
});

describe("which boxes a page carries", () => {
    const maps = KNOWN_DOCUMENT_SUBTYPE_MAPS;

    it("is one per system the type maps to, never one per system block authored", () => {
        expect(requiredInfoboxIds({ type: "weapongear" }, { maps })).toEqual([
            "note",
            "sohl",
            "hm3",
        ]);
        expect(requiredInfoboxIds({ type: "affiliation" }, { maps })).toEqual(["note", "sohl"]);
        expect(requiredInfoboxIds({ type: "armorlocation" }, { maps })).toEqual(["note", "hm3"]);
        expect(requiredInfoboxIds({ type: "place" }, { maps })).toEqual(["note"]);
    });

    it("reads _Not available_ for a mapped system the note says nothing about", () => {
        const boxes = noteInfoboxes({ type: "weapongear", name: { full: "Spear" }, sohl: {} });
        const hm3 = boxes.find((box) => box.id === "hm3");
        expect(hm3.available).toBe(false);
        expect(hm3.sections).toEqual([]);
        expect(infoboxesToHtml([hm3])).toContain(NOT_AVAILABLE);
    });

    it("refuses a set that disagrees with the map", () => {
        const boxes = noteInfoboxes({ type: "place", name: { full: "Provènzia" } });
        expect(() =>
            assertInfoboxSet(
                [...boxes, { id: "hm3", kind: "system", system: "hm3", title: "HM3" }],
                { type: "place", name: { full: "Provènzia" } },
                { maps },
            ),
        ).toThrow(/carries `hm3` as well/);
        expect(() => assertInfoboxSet([], { type: "place" }, { maps })).toThrow(
            /is missing `note`/,
        );
    });
});

describe("a declaration", () => {
    it("must name the system it belongs to", () => {
        expect(() => defineInfobox({ title: "X" } as never)).toThrow(/name the `system`/);
    });

    it("must name the box", () => {
        expect(() => defineInfobox({ system: "x" } as never)).toThrow(/declares no `title`/);
    });
});

describe("the rendered box", () => {
    const boxes = [
        {
            id: "note",
            kind: "note",
            title: "Profile",
            sections: [
                {
                    id: "profile",
                    layout: "rows",
                    rows: [
                        { label: "Name", kind: "text", value: "Brànwâal" },
                        {
                            label: "Affiliations",
                            kind: "links",
                            value: [
                                { text: "Silent Talon", url: "/x/", address: "affiliation-st" },
                            ],
                        },
                    ],
                },
            ],
        },
        {
            id: "sohl",
            kind: "system",
            system: "sohl",
            title: "SoHL",
            available: true,
            sections: [
                {
                    id: "attributes",
                    label: "Attributes",
                    layout: "grid",
                    cells: [{ label: "STR", value: 14 }],
                },
                {
                    id: "skills",
                    label: "Skills",
                    layout: "runin",
                    groups: [{ label: "Combat", entries: [{ text: "Melee 75" }] }],
                },
                { id: "empty", label: "Nothing", layout: "list", entries: [] },
            ],
        },
    ];

    it("is a disclosure, open by default, one per box", () => {
        const html = infoboxesToHtml(boxes);
        expect(html.match(/<details /g)).toHaveLength(2);
        expect(html).toContain('<details class="infobox infobox-note" open>');
        expect(html).toContain('<a href="/x/">Silent Talon</a>');
    });

    it("draws no section that holds nothing", () => {
        expect(sectionHasContent({ layout: "list", entries: [] })).toBe(false);
        expect(infoboxesToHtml(boxes)).not.toContain("Nothing");
    });

    it("makes every section unbreakable inside a breakable panel", () => {
        const typst = infoboxesToTypst(boxes);
        expect(typst.match(/#block\(breakable: false\)/g)).toHaveLength(3);
        expect(typst).toContain("#infobox-panel[");
    });

    it("carries a panel's title inside its first section, so a break cannot strand it", () => {
        const typst = infoboxesToTypst(boxes);
        expect(typst).toContain("#block(breakable: false)[\n#infobox-title[Profile]");
        expect(typst).toContain("#block(breakable: false)[\n#infobox-title[SoHL]");
    });

    it("gives a box that states rather than shows a block of its own, title and all", () => {
        const typst = infoboxesToTypst([
            {
                id: "hm3",
                kind: "system",
                system: "hm3",
                title: "HM3",
                available: false,
                sections: [],
                statement: NOT_AVAILABLE,
            },
        ]);
        expect(typst).toContain("#infobox-title[HM3]");
        expect(typst).toContain("#infobox-statement[Not available]");
        expect(typst.match(/#block\(breakable: false\)/g)).toHaveLength(1);
    });

    it("escapes what would otherwise be markup", () => {
        const html = infoboxesToHtml([
            {
                id: "note",
                kind: "note",
                title: "Profile",
                sections: [
                    {
                        id: "profile",
                        layout: "rows",
                        rows: [{ label: "Name", kind: "text", value: "<script>x</script>" }],
                    },
                ],
            },
        ]);
        expect(html).not.toContain("<script>");
        expect(html).toContain("&lt;script&gt;");
    });
});

/**
 * The values a closed vocabulary table in the specification states.
 *
 * Read by the header shape the specification uses for one — `` `<name>` value ``
 * as the first header cell, one value per row in an inline-code span.
 */
function specVocabulary(name: string): string[] {
    const text = readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "content-format.md"),
        "utf8",
    );
    const values: string[] = [];
    let inside = false;
    for (const line of text.split("\n")) {
        const cells = line.trim().startsWith("|") ? line.trim().split("|").slice(1, -1) : null;
        if (!cells) {
            inside = false;
            continue;
        }
        if (cells[0].trim() === `\`${name}\` value`) {
            inside = true;
            continue;
        }
        if (!inside) continue;
        const match = /^`([^`]+)`$/.exec(cells[0].trim());
        if (match) values.push(match[1]);
    }
    return values;
}

describe("the closed vocabularies", () => {
    it("states the same four layouts the specification does, in its order", () => {
        const stated = specVocabulary("layout");
        // Guards the guard: were the table's header to change shape, the
        // comparison below would be against an empty list.
        expect(stated.length).toBeGreaterThan(0);
        expect(Object.keys(INFOBOX_LAYOUTS)).toEqual(stated);
    });

    it("states the same five value kinds the specification does, in its order", () => {
        const stated = specVocabulary("kind");
        expect(stated.length).toBeGreaterThan(0);
        expect([...INFOBOX_VALUE_KINDS]).toEqual(stated);
    });

    it("names four layouts, each keyed by the property it carries", () => {
        expect(Object.keys(INFOBOX_LAYOUTS)).toEqual(["rows", "grid", "runin", "list"]);
        expect(Object.values(INFOBOX_LAYOUTS)).toEqual(["rows", "cells", "groups", "entries"]);
    });

    it("names five value kinds", () => {
        expect([...INFOBOX_VALUE_KINDS]).toEqual(["text", "number", "link", "links", "list"]);
    });

    it("capitalises an enumerated value and leaves prose alone", () => {
        expect(presentValue("male")).toBe("Male");
        expect(presentValue("graying_brown")).toBe("Graying Brown");
        expect(presentValue("a dispossessed noble")).toBe("a dispossessed noble");
    });
});

describe("a system box", () => {
    it("reads the fields that system declares, skipping what a default supplied", () => {
        const boxes = buildInfoboxes(
            { type: "skill", name: { full: "Melee" }, sohl: { system: { masteryLevelBase: 40 } } },
            {
                maps: KNOWN_DOCUMENT_SUBTYPE_MAPS,
                providers: [
                    defineInfobox({
                        system: "sohl",
                        title: "SoHL",
                        fields: {
                            skill: [
                                {
                                    name: "masteryLevelBase",
                                    to: "masteryLevelBase",
                                    kind: "number",
                                },
                                {
                                    name: "initSkillMult",
                                    to: "initSkillMult",
                                    kind: "number",
                                    default: 0,
                                },
                            ],
                        },
                    }),
                ],
                carriesBlock: (fm: Record<string, unknown>, block: string) => Boolean(fm[block]),
                resolveField: (
                    field: { to?: string; default?: unknown },
                    fm: Record<string, Record<string, Record<string, unknown>>>,
                    { block }: { block: string },
                ) => {
                    const own = fm?.[block]?.system?.[field.to as string];
                    return own === undefined ?
                            { value: field.default, from: "default" }
                        :   { value: own, from: "system" };
                },
            },
        );
        const sohl = boxes.find((box) => box.id === "sohl");
        expect(sohl.sections[0].rows).toEqual([
            { label: "Mastery level base", kind: "number", value: 40 },
        ]);
    });
});

describe("a fact is on exactly one surface", () => {
    const maps = KNOWN_DOCUMENT_SUBTYPE_MAPS;
    const gearTypes = ["weapongear", "armorgear", "miscgear", "containergear", "projectilegear"];

    /** Every label a note's boxes carry, box id → labels. */
    function labelsOf(fm: Record<string, unknown>): Record<string, string[]> {
        const out: Record<string, string[]> = {};
        for (const box of noteInfoboxes(fm)) {
            out[box.id] = (box.sections ?? []).flatMap((section: { rows?: { label: string }[] }) =>
                (section.rows ?? []).map((row) => row.label),
            );
        }
        return out;
    }

    it("puts a gear note's weight, price and durability on a box wherever it is authored", () => {
        for (const type of gearTypes) {
            const atDestination = labelsOf({
                type,
                name: { full: "A Thing" },
                sohl: { system: { weightBase: 1.5, valueBase: 40, durabilityBase: 6 } },
            });
            expect(atDestination.sohl, type).toEqual(
                expect.arrayContaining(["Weight", "Price", "Durability"]),
            );
            expect(atDestination.note, type).not.toEqual(expect.arrayContaining(["Weight"]));

            const shared = labelsOf({
                type,
                name: { full: "A Thing" },
                data: { weight: 1.5, value: 40, durability: 6 },
                sohl: { system: {} },
            });
            expect(shared.note, type).toEqual(
                expect.arrayContaining(["Weight", "Value", "Durability"]),
            );
            expect(shared.sohl, type).not.toEqual(expect.arrayContaining(["Weight", "Price"]));
        }
    });

    it("skips a value the declaration would have supplied anyway, wherever it was written", () => {
        expect(isDeclaredDefault({ name: "improveFlag", default: false }, false)).toBe(true);
        expect(isDeclaredDefault({ name: "improveFlag", default: false }, true)).toBe(false);
        expect(isDeclaredDefault({ name: "parents", default: [] }, [])).toBe(true);
        expect(isDeclaredDefault({ name: "parents", default: [] }, ["x"])).toBe(false);
        // No declared default is nothing to be equal to.
        expect(isDeclaredDefault({ name: "material" }, "")).toBe(false);

        const written = labelsOf({
            type: "skill",
            name: { full: "Ritual" },
            sohl: { system: { improveFlag: false, combatCategory: "none", initSkillMult: 0 } },
        });
        expect(written.sohl).toEqual([]);
        expect(
            labelsOf({
                type: "skill",
                name: { full: "Melee" },
                sohl: { system: { combatCategory: "melee", initSkillMult: 2 } },
            }).sohl,
        ).toEqual(["Combat category", "Init multiplier"]);
    });
});

describe("armour's protection", () => {
    const note = {
        type: "armorgear",
        name: { full: "Buckram Knee Boots" },
        sohl: { system: { protectionBase: { blunt: 4, edged: 8, piercing: 5 } } },
    };

    it("reads the aspects where a note authors them", () => {
        const box = noteInfoboxes(note).find((entry) => entry.id === "sohl");
        const grid = box.sections.find((section: { id: string }) => section.id === "protection");
        expect(grid.cells).toEqual([
            { label: "Blunt", value: 4 },
            { label: "Edged", value: 8 },
            { label: "Piercing", value: 5 },
            // Armour that stops nothing fiery is a fact, not a gap.
            { label: "Fire", value: 0 },
        ]);
    });

    it("shows them there and nowhere else", () => {
        const box = noteInfoboxes(note).find((entry) => entry.id === "sohl");
        const rows = box.sections
            .filter((section: { id: string }) => section.id === "profile")
            .flatMap((section: { rows: { label: string }[] }) => section.rows);
        expect(rows).toEqual([]);
    });
});

describe("a weapon's strike modes", () => {
    /** The same two modes, in the two shapes the corpus writes. */
    const asList = [
        { shortcode: "crush", name: "Crush", attack: { modifier: 0 }, lengthBase: 5 },
        { shortcode: "pommel", name: "Pommel", attack: { modifier: -5 }, lengthBase: 5 },
    ];
    const asMapping = {
        crush: { name: "Crush", attack: { modifier: 0 }, lengthBase: 5 },
        pommel: { name: "Pommel", attack: { modifier: -5 }, lengthBase: 5 },
    };

    /** The Strike Modes section of a weapon authoring `declared`. */
    function section(declared: unknown) {
        const boxes = noteInfoboxes({
            type: "weapongear",
            name: { full: "A Weapon" },
            sohl: { system: { strikeModes: declared } },
        });
        const sohl = boxes.find((box) => box.id === "sohl");
        return sohl.sections.find((entry: { id: string }) => entry.id === "strikemodes");
    }

    it("reads both authored shapes the same way", () => {
        expect(section(asList)).toEqual(section(asMapping));
        expect(section(asList).groups.map((group: { label: string }) => group.label)).toEqual([
            "Crush",
            "Pommel",
        ]);
    });

    it("names a mode by its shortcode when a list states no name", () => {
        expect(strikeModes([{ shortcode: "swung" }])).toEqual([["swung", { shortcode: "swung" }]]);
        expect(strikeModes(undefined)).toEqual([]);
        expect(strikeModes("crush")).toEqual([]);
    });

    it("shows the modes there and nowhere else", () => {
        const boxes = noteInfoboxes({
            type: "weapongear",
            name: { full: "A Weapon" },
            sohl: { system: { strikeModes: asList } },
        });
        const sohl = boxes.find((box) => box.id === "sohl");
        const rows = sohl.sections
            .filter((entry: { id: string }) => entry.id === "profile")
            .flatMap((entry: { rows: { label: string }[] }) => entry.rows);
        expect(rows.map((row: { label: string }) => row.label)).not.toContain("Strike modes");
    });
});

describe("a system box is never an empty panel", () => {
    it("says which silence it is", () => {
        const boxes = noteInfoboxes({
            type: "miscgear",
            name: { full: "A Coin" },
            // A block the note carries, holding nothing but what the compiler
            // would have supplied anyway.
            sohl: { system: { weightBase: 0, valueBase: 0 } },
        });
        const sohl = boxes.find((box) => box.id === "sohl");
        expect(sohl.available).toBe(true);
        expect(sohl.sections).toEqual([]);
        expect(sohl.statement).toBe(NOTHING_BEYOND_PROFILE);
        expect(sohl.statement).not.toBe(NOT_AVAILABLE);

        const hm3 = boxes.find((box) => box.id === "hm3");
        expect(hm3.available).toBe(false);
        expect(hm3.statement).toBe(NOT_AVAILABLE);
    });

    it("draws the statement rather than a heading over nothing", () => {
        const boxes = noteInfoboxes({
            type: "miscgear",
            name: { full: "A Coin" },
            sohl: { system: { weightBase: 0 } },
        });
        expect(infoboxesToHtml(boxes)).toContain(
            `<p class="infobox-statement">${NOTHING_BEYOND_PROFILE}</p>`,
        );
        expect(infoboxesToTypst(boxes)).toContain(`#infobox-statement[${NOTHING_BEYOND_PROFILE}]`);
    });

    it("leaves no system box with neither sections nor a statement", () => {
        const bare = { type: "weapongear", name: { full: "A Weapon" }, sohl: {}, hm3: {} };
        for (const box of noteInfoboxes(bare)) {
            if (box.kind !== "system") continue;
            const holds = (box.sections ?? []).some((section: Record<string, unknown[]>) =>
                Object.values(INFOBOX_LAYOUTS).some(
                    (key) => Array.isArray(section[key]) && section[key].length,
                ),
            );
            expect(holds || Boolean(box.statement), `\`${box.id}\` draws nothing`).toBe(true);
        }
    });
});

describe("a system box's labels are a reader's words", () => {
    it("names no field the declaration does not declare", () => {
        const declared = new Set(
            Object.entries(NOTE_SCHEMAS).flatMap(([type, fields]) =>
                fields
                    .filter((field: { name?: string }) => field.name)
                    .flatMap((field: { name: string }) => [field.name, `${type}.${field.name}`]),
            ),
        );
        const stale = Object.keys(SOHL_FIELD_PRESENTATION).filter((name) => !declared.has(name));
        expect(stale).toEqual([]);
    });

    it("leaves no declaration's own key on a page", () => {
        const leaked: Record<string, string> = {};
        for (const [type, fields] of Object.entries(NOTE_SCHEMAS)) {
            for (const field of fields as { name?: string }[]) {
                if (!field.name) continue;
                // An overlay entry is somebody deciding what the row is called,
                // so it is trusted. What this catches is a field nobody has
                // decided about, humanised straight out of the declaration.
                const overlay = overlayFor(SOHL_FIELD_PRESENTATION, type, field.name);
                if (overlay.withheld || overlay.label) continue;
                const label = humanizeFieldName(field.name);
                if (COMPILER_WORDS.test(label)) leaked[`${type}.${field.name}`] = label;
            }
        }
        expect(leaked).toEqual({});
    });

    it("withholds nothing but machinery and a fact the box shows whole elsewhere", () => {
        for (const [name, overlay] of Object.entries(SOHL_FIELD_PRESENTATION)) {
            if (!overlay.withheld) continue;
            expect(overlay.withheld, `\`${name}\` withheld for a third reason`).toMatch(
                /machinery|shown whole|shown one per line|no summary shape/,
            );
        }
    });
});
