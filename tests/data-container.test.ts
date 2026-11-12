/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";

import { lintNote, lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY, dataFields, subTypes } from "../engine/note-vocabulary.mjs";
import { MARKET_CLASSES } from "../engine/market-class.mjs";
import { positionOfFrontmatterPath } from "../engine/diagnostics.mjs";
import { pageFrontmatter } from "../engine/site-build.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

/**
 * A note as the link index hands one over, with a real frontmatter fence so a
 * finding can be located in it.
 */
const note = (type: string, fm: Record<string, unknown> = {}) => {
    const body = { type, ...fm };
    const lines: string[] = [];
    const emit = (obj: Record<string, unknown>, indent: string) => {
        for (const [key, value] of Object.entries(obj)) {
            if (value !== null && typeof value === "object" && !Array.isArray(value)) {
                lines.push(`${indent}${key}:`);
                emit(value as Record<string, unknown>, `${indent}    `);
            } else {
                lines.push(`${indent}${key}: ${JSON.stringify(value)}`);
            }
        }
    };
    emit(body, "");
    return {
        file: `/tree/${type}.md`,
        type,
        raw: `---\n${lines.join("\n")}\n---\n`,
        fm: body,
    };
};

const messages = (findings: Array<{ message: string }>) =>
    findings.map((f) => f.message).join("\n");

const opts = { schemas: NOTE_SCHEMAS as any, vocabulary: NOTE_VOCABULARY };

describe("the `data:` container is closed", () => {
    it("accepts an event on every lore subtype, and on a place and an affiliation", () => {
        const event = { when: "412.1", summary: "The town is founded." };
        for (const subType of subTypes("lore") ?? []) {
            const findings = lintNote(note("lore", { subType, data: { events: [event] } }), opts);
            expect(messages(findings), subType).not.toContain("data.events");
        }
        for (const type of ["place", "affiliation"]) {
            const findings = lintNote(note(type, { data: { events: [event] } }), opts);
            expect(messages(findings), type).not.toContain("data.events");
        }
    });

    it("rejects events on a type that does not carry them, and requires a list", () => {
        expect(
            messages(lintNote(note("being", { data: { events: [{ when: "412.1" }] } }), opts)),
        ).toContain("`data:` property declared by being");
        expect(messages(lintNote(note("lore", { data: { events: "founding" } }), opts))).toContain(
            "`data.events` should",
        );
    });

    it("reports a singular data.event as an undeclared key", () => {
        const found = messages(
            lintNote(note("lore", { data: { event: { kind: "founding" } } }), opts),
        );
        expect(found).toContain('"event" is not a `data:` property declared by lore');
        expect(found).not.toContain("retired");
    });

    it("accepts every key the type declares", () => {
        const findings = lintNote(
            note("weapongear", {
                data: { kind: "weapon", weight: 4, value: 20, quality: 0, durability: 12 },
            }),
            opts,
        );
        expect(findings).toEqual([]);
    });

    it("reports an unknown `data:` key and suggests the near miss", () => {
        const findings = lintNote(
            note("weapongear", { data: { wieght: 4, kind: "weapon" } }),
            opts,
        );
        expect(messages(findings)).toContain("`data:` property declared by weapongear");
        expect(messages(findings)).toContain('Did you mean "weight"?');
    });

    it("does not guess when nothing is close", () => {
        const findings = lintNote(
            note("weapongear", { data: { elephant: 1, kind: "weapon" } }),
            opts,
        );
        expect(messages(findings)).toContain("`data:` property declared by weapongear");
        expect(messages(findings)).not.toContain("Did you mean");
    });

    it("locates the offending key at its own line and column", () => {
        const subject = note("weapongear", { data: { wieght: 4, kind: "weapon" } });
        const findings = lintNote(subject, opts);
        // `---`, `type:`, `data:`, then the key — file line 4, indented four.
        expect(findings[0]).toMatchObject({ line: 4, column: 5 });
    });

    it("draws the suggestion from that type's own vocabulary, not another's", () => {
        // `transmission` is an affliction's, and no weapon has one; the guess
        // must come from the weapon's list or not be made at all.
        const findings = lintNote(note("weapongear", { data: { transmision: "airborne" } }), opts);
        expect(messages(findings)).not.toContain('Did you mean "transmission"');
    });

    it("reports a value whose shape the type does not allow", () => {
        const findings = lintNote(note("weapongear", { data: { weight: "heavy" } }), opts);
        expect(messages(findings)).toContain("`data.weight` should");
    });

    it("refuses a `data:` that is not a map at all", () => {
        const findings = lintNote(note("weapongear", { data: ["weight", 4] }), opts);
        expect(messages(findings)).toContain("`data:` must be a map");
    });

    it("accepts an emptied map, which the property editor writes as a list", () => {
        expect(lintNote(note("lore", { data: [] }), opts)).toEqual([]);
    });

    it("checks a type whose vocabulary is empty just as strictly", () => {
        const findings = lintNote(note("doc", { data: { weight: 4 } }), opts);
        expect(messages(findings)).toContain("`data:` property declared by doc");
    });

    it("makes no claim when no vocabulary is supplied", () => {
        expect(
            lintNote(note("weapongear", { data: { wieght: 4, kind: "weapon" } }), {
                schemas: NOTE_SCHEMAS as any,
            }),
        ).toEqual([]);
    });

    it("reaches a nested key through its declared root", () => {
        expect(
            lintNote(
                note("mystery", {
                    sohl: { subType: "boon" },
                    data: { charges: { value: 2, max: 3 } },
                }),
                opts,
            ),
        ).toEqual([]);
        const findings = lintNote(
            note("mystery", { sohl: { subType: "boon" }, data: { charges: { value: "lots" } } }),
            opts,
        );
        expect(messages(findings)).toContain("`data.charges.value` should");
    });
});

describe("the top level is closed", () => {
    const stray = note("weapongear", {
        description: "A blade of no particular distinction",
        heroImage: "banners/sword.webp",
    });

    it("reports an unknown top-level key", () => {
        expect(messages(lintNote(stray, opts))).toContain(
            'unknown top-level frontmatter key "heroImage"',
        );
    });

    it("carries allowed page metadata onto the published page", () => {
        const emitted = pageFrontmatter(
            { kind: "content", fm: stray.fm, name: "Sword", slug: "sword", sec: "weapons" } as any,
            {} as any,
        );
        expect(emitted.description).toBe("A blade of no particular distinction");
    });
});

describe("`subType` is top level, and only where a type declares one", () => {
    it("accepts a declared value", () => {
        expect(
            lintNote(note("skill", { subType: "craft", sohl: { subType: "craft" } }), opts),
        ).toEqual([]);
    });

    it("reports a value the type does not declare, and suggests the near miss", () => {
        const findings = lintNote(
            note("skill", { subType: "crafte", sohl: { subType: "crafte" } }),
            opts,
        );
        expect(messages(findings)).toContain("is not one of the subtypes skill declares");
        expect(messages(findings)).toContain('Did you mean "craft"?');
    });

    it("reports `subType` on a type that declares none", () => {
        const findings = lintNote(note("weapongear", { subType: "melee" }), opts);
        expect(messages(findings)).toContain("declares no subtypes");
    });

    it("permits only the declared being subtypes", () => {
        expect(subTypes("being")).toEqual(["npc", "character", "creature"]);
        expect(
            lintNote(
                note("being", { subType: "character", data: { archetypes: ["warrior"] } }),
                opts,
            ),
        ).toEqual([]);
        expect(messages(lintNote(note("being", { subType: "charcter" }), opts))).toContain(
            'Did you mean "character"?',
        );
    });

    it("locates the finding on the `subType` line", () => {
        const subject = note("weapongear", { subType: "melee" });
        expect(lintNote(subject, opts)[0]).toMatchObject({ line: 3, column: 1 });
    });
});

describe("the declared vocabulary", () => {
    it("declares a data vocabulary for every type the package compiles", () => {
        for (const type of Object.keys(NOTE_SCHEMAS)) {
            expect(NOTE_VOCABULARY, type).toHaveProperty(type);
        }
    });

    it("gives every data field a name and a description", () => {
        for (const [type, entry] of Object.entries(NOTE_VOCABULARY)) {
            for (const field of entry.data) {
                expect(field.name, type).toBeTruthy();
                expect(field.describe, `${type}.${field.name}`).toBeTruthy();
            }
        }
    });

    it("declares no key twice within one type", () => {
        for (const [type, entry] of Object.entries(NOTE_VOCABULARY)) {
            const names = entry.data.map((f) => f.name);
            expect(new Set(names).size, type).toBe(names.length);
        }
    });

    it("declares every subType-bearing item type's values", () => {
        // The eight types whose builders require a `subType` are exactly the
        // ones the specification enumerates values for.
        for (const type of [
            "affiliation",
            "affliction",
            "concoctiongear",
            "mystery",
            "mysticalability",
            "projectilegear",
            "skill",
            "trauma",
        ]) {
            expect(subTypes(type), type).toEqual(expect.any(Array));
        }
    });

    it("declares `templatePriority` on every type that produces a document", () => {
        for (const type of ["being", "skill", "weapongear", "affiliation", "trauma"]) {
            expect(
                dataFields(type).map((f) => f.name),
                type,
            ).toContain("templatePriority");
        }
    });

    it("answers with nothing for a type it does not declare", () => {
        expect(dataFields("sandwich")).toBeUndefined();
        expect(subTypes("sandwich")).toBeUndefined();
    });
});

describe("locating a key inside the frontmatter fence", () => {
    it("addresses a nested key by path, past a same-named key elsewhere", () => {
        const raw = ["---", "weight: 1", "data:", "    weight: 4", "---", ""].join("\n");
        expect(positionOfFrontmatterPath(raw, ["data", "weight"], { key: true })).toEqual({
            line: 4,
            column: 5,
        });
    });

    it("drops the position rather than guessing when there is no fence", () => {
        expect(positionOfFrontmatterPath("no fence here", ["data", "weight"])).toEqual({});
    });
});

describe("lintFrontmatter carries the vocabulary through", () => {
    it("reports the container's findings over a whole index", () => {
        const index = {
            notes: [note("weapongear", { data: { wieght: 4, kind: "weapon" } })],
            shortcodeHit: () => ({}),
        } as any;
        const r = lintFrontmatter(index, { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY });
        expect(messages(r.findings)).toContain('Did you mean "weight"?');
    });
});

/**
 * A folder's `parent` is a scalar **or** a map keyed by pack.
 *
 * The compiler reads both — a folder's identity is one thing and
 * its hierarchy another, and both large trees file the same folder under a
 * different parent in the items pack and the journals pack. The vocabulary
 * typed the field as a bare wikilink, so `package-build lint` rejected every
 * note using the form the compiler is specified to accept: 46 findings against
 * `sohl-thalorna` and 3 here, none of them a content defect.
 */
describe("a folder's `parent` is a scalar or a map keyed by pack", () => {
    const folderOpts = {
        addressContext: { package: "world", system: "none" },
        schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS } as any,
        vocabulary: NOTE_VOCABULARY,
    };
    const folder = (parent: unknown) =>
        note("folder", { shortcode: "characteristics", data: { parent } });

    it("accepts the everyday scalar", () => {
        expect(lintNote(folder("possessions"), folderOpts)).toEqual([]);
    });

    it("accepts a map keyed by pack", () => {
        expect(lintNote(folder({ default: null, journals: "descriptions" }), folderOpts)).toEqual(
            [],
        );
    });

    it("accepts an explicit `~` under a pack key, which means at the root there", () => {
        expect(lintNote(folder({ default: "possessions", journals: null }), folderOpts)).toEqual(
            [],
        );
    });

    it("reports a non-address entry per pack key, not the whole map", () => {
        const findings = lintNote(
            folder({ default: "possessions", journals: { full: "Descriptions" } }),
            folderOpts,
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain("`data.parent.journals` should be an Address");
        // The whole map is no longer quoted back at the author: the one entry
        // at fault is, which is the string they have to correct.
        expect(findings[0].message).not.toContain("possessions");
    });

    it("locates that finding at the offending pack key's own line", () => {
        const subject = folder({ default: "possessions", journals: { full: "Descriptions" } });
        // `---`, `type:`, `shortcode:`, `data:`, `parent:`, `default:`, then
        // `journals:` — file line 7, indented eight.
        expect(lintNote(subject, folderOpts)[0]).toMatchObject({ line: 7, column: 9 });
    });

    it("still reports a list, which is neither an address nor a map of them", () => {
        const findings = lintNote(folder(["possessions", "descriptions"]), folderOpts);
        expect(findings).toHaveLength(1);
        expect(messages(findings)).toContain("`data.parent` should be");
    });

    it("reports a pack key naming no declared pack, when the packs are known", () => {
        const findings = lintNote(folder({ default: "possessions", journal: "descriptions" }), {
            ...folderOpts,
            packs: ["items", "journals", "actors"],
        });
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain('"journal" is not a pack');
        expect(findings[0].message).toContain('Did you mean "journals"?');
    });

    it("makes no claim about a pack key when the caller declares no packs", () => {
        expect(lintNote(folder({ default: "possessions", journal: "x" }), folderOpts)).toEqual([]);
    });

    it("takes `default` for a pack name nowhere, since it is the map's own key", () => {
        const findings = lintNote(folder({ default: "possessions" }), {
            ...folderOpts,
            packs: ["items", "journals"],
        });
        expect(findings).toEqual([]);
    });
});

/** Market words are checked against the runtime vocabulary. */
describe("a place states a settlement's market class", () => {
    const settlement = (market: unknown) =>
        note("place", { subType: "settlement", data: { market } });
    for (const entry of MARKET_CLASSES)
        it(`accepts ${entry.value}`, () =>
            expect(lintNote(settlement(entry.value), opts)).toEqual([]));
    it.each([1, 2, 3, 4, 5, 6, "1", "weekly", {}, []])(
        "refuses an undeclared market %s",
        (value) => {
            const findings = lintNote(settlement(value), opts);
            expect(findings.some((f) => f.message.includes("data.market"))).toBe(true);
        },
    );
    it("names the accepted words at the invalid value", () => {
        const findings = lintNote(settlement("weekly"), opts);
        expect(findings).toHaveLength(1);
        for (const entry of MARKET_CLASSES) expect(findings[0].message).toContain(entry.value);
        expect(findings[0]).toMatchObject({ line: 5, column: 13 });
    });
});
