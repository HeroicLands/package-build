/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **An event entry's schema: one declaration on every type that carries it,
 * closed lists that are the documented lists, addresses that resolve, an
 * identity per entry, and a `follows` graph that runs backward and never
 * closes on itself.**
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";
import { describe, expect, it } from "vitest";

import { parseAddress, renderAddress } from "../engine/address.mjs";
import { loadContentFormat, parseContentFormat } from "../engine/content-format.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { EVENT_ENTRY_KEYS, EVENT_VOCABULARIES, checkNoteEvents } from "../engine/note-events.mjs";
import { EVENTS_FIELD, NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
import { checkDataKeys } from "../engine/data-keys.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const REFERENCE = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../docs/reference/format-details.md",
);

const PACKAGE = "thalorna";
const TYPES = new Set(["lore", "place", "affiliation", "being", "skill", "doc"]);

/** A note as the link index hands one over, with a real frontmatter fence. */
function note(fm: Record<string, any>, file = `${fm.type}-${fm.shortcode}.md`, body = "Prose.\n") {
    const raw = `---\n${YAML.stringify(fm)}---\n\n${body}`;
    return { file, raw, fm, body: `\n${body}`, type: String(fm.type) };
}

/** An index over the given notes, resolving addresses the way the real one does. */
function indexOf(notes: ReturnType<typeof note>[]) {
    const byKey = new Map<string, unknown>();
    for (const n of notes) {
        const tuple = parseAddress(`${n.fm.type}-${n.fm.shortcode}`, {
            package: PACKAGE,
            system: "note",
            types: TYPES,
            packages: new Set([PACKAGE]),
        });
        byKey.set(renderAddress(tuple as any), n);
    }
    return {
        notes,
        contentPackage: PACKAGE,
        types: TYPES,
        packages: new Set([PACKAGE]),
        addressHit(target: string) {
            const tuple = parseAddress(target, {
                package: PACKAGE,
                system: "note",
                types: TYPES,
                packages: new Set([PACKAGE]),
            });
            return (tuple as any).reason ? undefined : byKey.get(renderAddress(tuple as any));
        },
    };
}

/** The places, peoples and calendar every well-formed event below names. */
const WORLD = [
    note({ type: "place", shortcode: "vale", subType: "region" }),
    note({ type: "place", shortcode: "fells", subType: "region" }),
    note({ type: "lore", shortcode: "folk", subType: "culture" }),
    note({ type: "lore", shortcode: "cal", subType: "calendar" }),
    note({ type: "affiliation", shortcode: "crown", subType: "polity" }),
    note({ type: "being", shortcode: "aran", subType: "npc" }),
    note({ type: "skill", shortcode: "tongue", subType: "language" }),
    note({ type: "doc", shortcode: "guide" }),
    note({
        type: "place",
        shortcode: "ford",
        subType: "site",
        data: { events: [{ when: "-300", summary: "The ford is forded." }] },
    }),
];

/** A complete, valid event entry, every key written. */
function fullEvent(overrides: Record<string, unknown> = {}) {
    return {
        kind: "fall",
        depth: "world",
        when: "-200",
        summary: "The city falls.",
        standing: "attested",
        names: [{ name: "The Sealing", by: "lore-folk", gloss: "their word" }],
        where: {
            locus: ["place-vale"],
            reach: [
                { place: "place-fells", how: "the holds empty", knowledge: "named" },
                {
                    place: "place-vale",
                    how: "the roads close",
                    knowledge: "misattributed",
                    attributedTo: "lore-folk",
                },
            ],
        },
        who: [{ ref: "affiliation-crown", role: "victim" }],
        accounts: [{ by: "lore-folk", says: "It fell.", agrees: "partly", withholds: "the name" }],
        unresolved: ["who did it"],
        sources: ["place-vale"],
        stated: { calendar: "cal", text: "1 ST" },
        ...overrides,
    };
}

/** Lint one note carrying `events` against the world, and return its messages. */
function findingsFor(events: unknown[], { type = "lore", extra = [] as any[] } = {}) {
    const subject = note({
        type,
        shortcode: "subject",
        subType:
            type === "lore" ? "history"
            : type === "place" ? "region"
            : "polity",
        data: { events },
    });
    const index = indexOf([...WORLD, ...extra, subject]);
    // What an entry holds is the inner-key check's, read from the field's
    // declaration; what its values mean is the event check's.
    return [...checkDataKeys(subject, dataFields(type)), ...checkNoteEvents(subject, { index })];
}

const messages = (findings: Array<{ message: string }>) => findings.map((f) => f.message);

describe("one declaration, on every type that carries events", () => {
    it("is the same object on lore, place and affiliation, and on no other type", () => {
        const carrying = Object.entries(NOTE_VOCABULARY)
            .filter(([, entry]) => entry.data.some((field) => field.name === "events"))
            .map(([type]) => type)
            .sort();
        expect(carrying).toEqual(["affiliation", "lore", "place"]);
        for (const type of carrying) {
            const field = NOTE_VOCABULARY[type as keyof typeof NOTE_VOCABULARY].data.find(
                (f) => f.name === "events",
            );
            expect(field, type).toBe(EVENTS_FIELD);
        }
    });

    it("lints a full entry clean on each of the three types", () => {
        for (const type of ["lore", "place", "affiliation"]) {
            expect(messages(findingsFor([fullEvent()], { type })), type).toEqual([]);
        }
    });
});

describe("the closed lists are the documented lists", () => {
    const reference = parseContentFormat(fs.readFileSync(REFERENCE, "utf8"), {
        file: REFERENCE,
    });
    const contract = loadContentFormat();

    it("names every vocabulary in the reference and the contract", () => {
        for (const [name, values] of Object.entries(EVENT_VOCABULARIES)) {
            expect(reference.vocabularies.get(name)?.values, `reference ${name}`).toEqual([
                ...values,
            ]);
            expect(contract.vocabularies.get(name)?.values, `contract ${name}`).toEqual([
                ...values,
            ]);
        }
    });

    it("documents every key an entry admits", () => {
        const text = fs.readFileSync(REFERENCE, "utf8");
        const section = text.slice(text.indexOf("### Events"));
        for (const key of EVENT_ENTRY_KEYS) {
            expect(section, key).toContain(`| \`${key}\``);
        }
    });

    it("refuses a value outside each closed list, at that value", () => {
        const cases: Array<[string, Record<string, unknown>]> = [
            ["kind", { kind: "echoed" }],
            ["depth", { depth: "continent" }],
            ["standing", { standing: "rumoured" }],
            [
                "knowledge",
                {
                    where: {
                        locus: ["place-vale"],
                        reach: [{ place: "place-fells", how: "x", knowledge: "felt" }],
                    },
                },
            ],
            ["role", { who: [{ ref: "affiliation-crown", role: "bystander" }] }],
            ["agrees", { accounts: [{ by: "lore-folk", says: "x", agrees: "maybe" }] }],
        ];
        for (const [key, override] of cases) {
            const found = findingsFor([fullEvent(override)]);
            expect(found.length, key).toBe(1);
            expect(found[0].message, key).toContain(`\`${key}\``);
            expect(found[0].line, key).toBeGreaterThan(0);
        }
    });
});

describe("every address-bearing key resolves", () => {
    const dangling: Array<[string, Record<string, unknown>]> = [
        ["names.0.by", { names: [{ name: "X", by: "lore-nobody" }] }],
        ["where.locus.0", { where: { locus: ["place-nowhere"] } }],
        [
            "where.reach.0.place",
            {
                where: {
                    locus: ["place-vale"],
                    reach: [{ place: "place-nowhere", how: "x", knowledge: "named" }],
                },
            },
        ],
        [
            "where.reach.0.attributedTo",
            {
                where: {
                    locus: ["place-vale"],
                    reach: [
                        {
                            place: "place-fells",
                            how: "x",
                            knowledge: "misattributed",
                            attributedTo: "lore-nothing",
                        },
                    ],
                },
            },
        ],
        ["who.0.ref", { who: [{ ref: "being-nobody", role: "actor" }] }],
        ["follows.0.event", { follows: [{ event: "lore-nothing", how: "caused" }] }],
        ["accounts.0.by", { accounts: [{ by: "lore-nobody", says: "x", agrees: "full" }] }],
        ["sources.0", { sources: ["lore-nothing"] }],
        ["stated.calendar", { stated: { calendar: "nocal", text: "1 ST" } }],
    ];

    for (const [where, override] of dangling) {
        it(`refuses a dangling address in ${where}`, () => {
            const found = findingsFor([fullEvent(override)]);
            expect(found.length, messages(found).join("\n")).toBe(1);
            expect(found[0].message).toContain(`data.events.0.${where}`);
            expect(found[0].message).toContain("does not resolve");
            expect(found[0].line).toBeGreaterThan(0);
        });
    }

    it("refuses a bare name in where.locus", () => {
        const found = findingsFor([fullEvent({ where: { locus: ["The Vale"] } })]);
        expect(messages(found).join("\n")).toContain("data.events.0.where.locus.0");
    });

    it("reads a bare shortcode in where.locus and where.reach.place as a place", () => {
        for (const locus of ["vale", "place-vale", "thalorna-note-place-vale"]) {
            const found = findingsFor([
                fullEvent({
                    where: {
                        locus: [locus],
                        reach: [{ place: "fells", how: "the holds empty", knowledge: "named" }],
                    },
                }),
            ]);
            expect(messages(found), locus).toEqual([]);
        }
    });

    it("refuses a where.locus or where.reach.place that resolves to anything but a place", () => {
        for (const other of ["affiliation-crown", "lore-folk"]) {
            const locus = findingsFor([fullEvent({ where: { locus: [other] } })]);
            expect(locus, other).toHaveLength(1);
            expect(locus[0].message).toContain("data.events.0.where.locus.0");
            expect(locus[0].message).toContain("must name a place");
            const reach = findingsFor([
                fullEvent({
                    where: {
                        locus: ["vale"],
                        reach: [{ place: other, how: "x", knowledge: "named" }],
                    },
                }),
            ]);
            expect(reach, other).toHaveLength(1);
            expect(reach[0].message).toContain("data.events.0.where.reach.0.place");
            expect(reach[0].message).toContain("must name a place");
        }
    });

    it("reads a bare attributedTo as lore, and takes an event or a lore note", () => {
        expect(
            messages(
                findingsFor([
                    fullEvent({
                        where: {
                            locus: ["vale"],
                            reach: [
                                {
                                    place: "fells",
                                    how: "x",
                                    knowledge: "misattributed",
                                    attributedTo: "folk",
                                },
                            ],
                        },
                    }),
                ]),
            ),
        ).toEqual([]);
        expect(
            messages(
                findingsFor([
                    fullEvent({
                        where: {
                            locus: ["vale"],
                            reach: [
                                {
                                    place: "fells",
                                    how: "x",
                                    knowledge: "misattributed",
                                    attributedTo: "place-ford",
                                },
                            ],
                        },
                    }),
                ]),
            ),
        ).toEqual([]);
        const notEvent = messages(
            findingsFor([
                fullEvent({
                    where: {
                        locus: ["vale"],
                        reach: [
                            {
                                place: "fells",
                                how: "x",
                                knowledge: "misattributed",
                                attributedTo: "place-fells",
                            },
                        ],
                    },
                }),
            ]),
        ).join("\n");
        expect(notEvent).toContain("must name an event or a lore note");
    });

    it("reads a bare follows.event as lore", () => {
        const earlier = note({
            type: "lore",
            shortcode: "earlier",
            subType: "history",
            data: { events: [fullEvent({ when: "-900" })] },
        });
        expect(
            messages(
                findingsFor([fullEvent({ follows: [{ event: "earlier", how: "caused" }] })], {
                    extra: [earlier],
                }),
            ),
        ).toEqual([]);
    });

    it("holds who.ref, accounts.by and names.by to the types each accepts", () => {
        const refused = (override: Record<string, unknown>) =>
            messages(findingsFor([fullEvent(override)])).join("\n");
        expect(refused({ who: [{ ref: "being-aran", role: "actor" }] })).toBe("");
        expect(refused({ who: [{ ref: "place-vale", role: "actor" }] })).toContain(
            "must name a being, affiliation or lore note",
        );
        expect(refused({ accounts: [{ by: "being-aran", says: "x", agrees: "full" }] })).toBe("");
        expect(
            refused({ accounts: [{ by: "skill-tongue", says: "x", agrees: "full" }] }),
        ).toContain("must name an affiliation, lore, place or being note");
        expect(refused({ names: [{ name: "X", by: "skill-tongue" }] })).toBe("");
        expect(refused({ names: [{ name: "X", by: "doc-guide" }] })).toContain(
            "must name an affiliation, lore, place, being or skill note",
        );
        expect(refused({ sources: ["doc-guide"] })).toBe("");
    });

    it("refuses a stated calendar that is not a calendar note", () => {
        const found = findingsFor([fullEvent({ stated: { calendar: "folk", text: "1 ST" } })]);
        expect(messages(found).join("\n")).toContain("subType is not calendar");
    });

    it("refuses attributedTo beside any knowledge but misattributed", () => {
        const found = findingsFor([
            fullEvent({
                where: {
                    locus: ["place-vale"],
                    reach: [
                        {
                            place: "place-fells",
                            how: "x",
                            knowledge: "named",
                            attributedTo: "lore-folk",
                        },
                    ],
                },
            }),
        ]);
        expect(messages(found).join("\n")).toContain("attributedTo");
    });
});

describe("an event's identity", () => {
    it("refuses two events sharing an id in one note", () => {
        const found = findingsFor([
            fullEvent({ id: "sack" }),
            fullEvent({ id: "sack", when: "-100" }),
        ]);
        expect(found).toHaveLength(1);
        expect(found[0].message).toContain("`id` sack");
        expect(found[0].line).toBeGreaterThan(0);
    });

    it("requires an id on every event of a note holding two or more", () => {
        const found = findingsFor([fullEvent({ id: "rise" }), fullEvent({ when: "-100" })]);
        expect(found).toHaveLength(1);
        expect(found[0].message).toContain("data.events.1");
        expect(found[0].message).toContain("needs an `id`");
    });

    it("refuses an id outside the address-segment charset", () => {
        const found = findingsFor([fullEvent({ id: "The-Sack" })]);
        expect(messages(found).join("\n")).toContain("`id`");
    });

    it("lets a single event omit its id", () => {
        expect(findingsFor([fullEvent()])).toEqual([]);
    });

    it("resolves follows into a multi-event note only by note#id", () => {
        const earlier = note({
            type: "place",
            shortcode: "ironfells",
            subType: "region",
            data: {
                events: [
                    fullEvent({ id: "raise", when: "-900" }),
                    fullEvent({ id: "sack", when: "-500" }),
                ],
            },
        });
        const ok = findingsFor(
            [fullEvent({ follows: [{ event: "place-ironfells#sack", how: "caused" }] })],
            { extra: [earlier] },
        );
        expect(messages(ok)).toEqual([]);

        const ambiguous = findingsFor(
            [fullEvent({ follows: [{ event: "place-ironfells", how: "caused" }] })],
            { extra: [earlier] },
        );
        expect(messages(ambiguous).join("\n")).toContain("holds 2 events");

        const missing = findingsFor(
            [fullEvent({ follows: [{ event: "place-ironfells#burn", how: "caused" }] })],
            { extra: [earlier] },
        );
        expect(messages(missing).join("\n")).toContain("declares no anchor burn");
    });

    it("refuses an anchored follows naming a heading, with the kind it names", () => {
        const withHeading = note(
            {
                type: "place",
                shortcode: "ironfells",
                subType: "region",
                data: { events: [fullEvent({ id: "sack", when: "-500" })] },
            },
            "place-ironfells.md",
            "# The Holds {#holds}\n\nProse.\n",
        );
        const heading = findingsFor(
            [fullEvent({ follows: [{ event: "place-ironfells#holds", how: "caused" }] })],
            { extra: [withHeading] },
        );
        expect(heading).toHaveLength(1);
        expect(heading[0].message).toContain("is a prose anchor, not an event anchor");
        const event = findingsFor(
            [fullEvent({ follows: [{ event: "place-ironfells#sack", how: "caused" }] })],
            { extra: [withHeading] },
        );
        expect(messages(event)).toEqual([]);
    });

    it("refuses an anchor on a key that accepts none", () => {
        const found = findingsFor([fullEvent({ sources: ["place-vale#north"] })]);
        expect(found).toHaveLength(1);
        expect(found[0].message).toContain("takes no anchor");
    });

    it("refuses an event id that repeats a heading slug in its note", () => {
        const subject = note(
            {
                type: "lore",
                shortcode: "subject",
                subType: "history",
                data: { events: [fullEvent({ id: "overview" })] },
            },
            "lore-subject.md",
            "# Overview {#overview}\n\nProse.\n",
        );
        const found = checkNoteEvents(subject, { index: indexOf([...WORLD, subject]) });
        expect(messages(found).join("\n")).toContain("one namespace");
    });
});

describe("a follows edge into another package", () => {
    /** The subject's index, with one note another package publishes. */
    function withDependency(events: unknown[]) {
        const subject = note({
            type: "lore",
            shortcode: "subject",
            subType: "history",
            data: { events },
        });
        const local = indexOf([...WORLD, subject]);
        const foreign = {
            package: "dep",
            type: "lore",
            noteAnchors: [
                { slug: "holds", kind: "prose" },
                { slug: "rise", kind: "event" },
                { slug: "sack", kind: "event" },
            ],
            events: [
                { id: "rise", when: { canonicalYear: -900, sort: -900 } },
                { id: "sack", when: { canonicalYear: 500, sort: 500 } },
            ],
        };
        const index = {
            ...local,
            types: TYPES,
            packages: new Set([PACKAGE, "dep"]),
            addressHit: (target: string) =>
                target === "dep-note-lore-hold" ? foreign : local.addressHit(target),
        };
        return checkNoteEvents(subject, { index });
    }

    it("resolves an event the dependency publishes and orders it by its published date", () => {
        expect(
            messages(
                withDependency([
                    fullEvent({
                        when: "-100",
                        follows: [{ event: "dep-note-lore-hold#rise", how: "caused" }],
                    }),
                ]),
            ),
        ).toEqual([]);
        const forward = messages(
            withDependency([
                fullEvent({
                    when: "-100",
                    follows: [{ event: "dep-note-lore-hold#sack", how: "caused" }],
                }),
            ]),
        ).join("\n");
        expect(forward).toContain("later than this event");
    });

    it("refuses a dependency's heading, an unknown anchor, and an ambiguous note", () => {
        const found = messages(
            withDependency([
                fullEvent({
                    when: "-100",
                    follows: [
                        { event: "dep-note-lore-hold#holds", how: "caused" },
                        { event: "dep-note-lore-hold#burn", how: "caused" },
                        { event: "dep-note-lore-hold", how: "caused" },
                    ],
                }),
            ]),
        ).join("\n");
        expect(found).toContain("is a prose anchor, not an event anchor");
        expect(found).toContain("declares no anchor burn");
        expect(found).toContain("holds 2 events");
    });
});

describe("follows runs backward and never closes a cycle", () => {
    it("refuses an edge naming a later event", () => {
        const later = note({
            type: "lore",
            shortcode: "later",
            subType: "history",
            data: { events: [fullEvent({ when: "100" })] },
        });
        const found = findingsFor(
            [fullEvent({ when: "-200", follows: [{ event: "lore-later", how: "caused" }] })],
            { extra: [later] },
        );
        expect(found).toHaveLength(1);
        expect(found[0].message).toContain("later than this event");
    });

    it("does not order an edge touching an any-year date", () => {
        const annual = note({
            type: "lore",
            shortcode: "annual",
            subType: "history",
            data: { events: [fullEvent({ when: "0.5" })] },
        });
        const found = findingsFor(
            [fullEvent({ when: "-200", follows: [{ event: "lore-annual", how: "answered" }] })],
            { extra: [annual] },
        );
        expect(found).toEqual([]);
    });

    it("compares a year against a day by the year alone", () => {
        const sameYear = note({
            type: "lore",
            shortcode: "sameyear",
            subType: "history",
            data: { events: [fullEvent({ when: "280.200" })] },
        });
        const found = findingsFor(
            [fullEvent({ when: "280", follows: [{ event: "lore-sameyear", how: "caused" }] })],
            { extra: [sameYear] },
        );
        expect(found).toEqual([]);
    });

    it("refuses a two-event cycle, on each edge that closes it", () => {
        const a = note({
            type: "lore",
            shortcode: "a",
            subType: "history",
            data: {
                events: [fullEvent({ when: "100", follows: [{ event: "lore-b", how: "caused" }] })],
            },
        });
        const b = note({
            type: "lore",
            shortcode: "b",
            subType: "history",
            data: {
                events: [fullEvent({ when: "100", follows: [{ event: "lore-a", how: "ended" }] })],
            },
        });
        const index = indexOf([...WORLD, a, b]);
        for (const subject of [a, b]) {
            const found = checkNoteEvents(subject, { index });
            expect(found, subject.fm.shortcode).toHaveLength(1);
            expect(found[0].message).toContain("cycle");
            expect(found[0].line).toBeGreaterThan(0);
        }
    });

    it("refuses an event that follows itself", () => {
        const self = note({
            type: "lore",
            shortcode: "self",
            subType: "history",
            data: { events: [fullEvent({ follows: [{ event: "lore-self", how: "caused" }] })] },
        });
        const found = checkNoteEvents(self, { index: indexOf([...WORLD, self]) });
        expect(messages(found).join("\n")).toContain("cycle");
    });
});

describe("a key the schema does not declare", () => {
    for (const key of ["precision", "derived"]) {
        it(`refuses ${key} at its own key`, () => {
            const found = findingsFor([fullEvent({ [key]: "year" })]);
            expect(found).toHaveLength(1);
            expect(found[0].message).toContain(`"${key}" is not a key of \`data.events[0]\``);
            expect(found[0].line).toBeGreaterThan(0);
            expect(found[0].column).toBeGreaterThan(0);
        });
    }

    it("refuses an undeclared key inside a nested entry", () => {
        const found = findingsFor([
            fullEvent({ follows: [{ event: "lore-folk", how: "echoed", strength: 3 }] }),
        ]);
        const text = messages(found).join("\n");
        expect(text).toContain('"strength" is not a key of `data.events[0].follows[0]`');
        expect(text).toContain("`how`");
    });

    it("requires a summary", () => {
        const { summary: _summary, ...rest } = fullEvent();
        expect(messages(findingsFor([rest])).join("\n")).toContain("`summary`");
    });

    it("is reported by the frontmatter lint on a place", () => {
        const place = note({
            type: "place",
            shortcode: "town",
            subType: "settlement",
            name: { full: "Town" },
            data: { events: [fullEvent({ precision: "year" })] },
        });
        const { findings } = lintFrontmatter(indexOf([...WORLD, place]) as any, {
            schemas: NOTE_SCHEMAS as any,
            vocabulary: NOTE_VOCABULARY,
        });
        expect(
            findings.filter((f: any) => f.file === place.file).map((f: any) => f.message),
        ).toEqual([expect.stringContaining('"precision" is not a key of `data.events[0]`')]);
    });
});
