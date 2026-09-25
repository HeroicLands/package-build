/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";

import {
    UNIVERSAL_KEYS,
    lintFrontmatter,
    lintNote,
    matchesKind,
} from "../engine/frontmatter-lint.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
import { ITEM_FIELDS } from "../sohl/item-fields.mjs";
import { authoredFields, STRING } from "../engine/field-spec.mjs";
import { MAP_TYPES, PACK_BY_TYPE, RETIRED_TYPES } from "../engine/ids.mjs";

/** A note as the link index hands one over. */
const note = (type: string, sohl: object = {}, extra: object = {}) => ({
    file: `/tree/${type}.md`,
    type,
    raw: `---\ntype: ${type}\n---\n`,
    fm: { type, ...extra, sohl },
});

/** An index whose references resolve to exactly the pairs it is given. */
const indexOf = (...addresses: string[]) => ({
    notes: [],
    shortcodeHit: (type: string, shortcode: string) =>
        addresses.includes(`${type}-${shortcode}`) ? {} : null,
});

const messages = (findings: Array<{ message: string }>) =>
    findings.map((f) => f.message).join("\n");

describe("matchesKind", () => {
    it("accepts a number however YAML spelled it, and rejects a word", () => {
        expect(matchesKind(12, "number")).toBe(true);
        // Quoted scalars are how a number arrives from several editors.
        expect(matchesKind("12", "number")).toBe(true);
        expect(matchesKind("heavy", "number")).toBe(false);
        expect(matchesKind("", "number")).toBe(false);
    });

    it("treats an emptied map as a map", () => {
        // Obsidian's property editor serialises a cleared map as `[]` (#8), and
        // that means the same thing `{}` does.
        expect(matchesKind({}, "map")).toBe(true);
        expect(matchesKind([], "map")).toBe(true);
        expect(matchesKind([1], "map")).toBe(false);
    });

    it("makes no claim about a field that declares no kind", () => {
        expect(matchesKind("anything", undefined as any)).toBe(true);
    });
});

describe("the five failure classes", () => {
    const schemas = {
        skill: [
            {
                name: "subType",
                required: true,
                shape: "string",
                describe: "Which family of skill it is.",
            },
            {
                name: "masteryLevelBase",
                kind: "number",
                shape: "number",
                describe: "Mastery before any modifier.",
            },
            {
                name: "parentSkillCode",
                code: "skill",
                describe: "The skill this one specialises.",
            },
        ],
    } as any;

    it("names the replacement for a retired type", () => {
        const [type, replacement] = Object.entries(RETIRED_TYPES)[0];
        const findings = lintNote(note(type), { schemas });
        expect(messages(findings)).toContain(`"${replacement}"`);
    });

    it("reports a type no schema declares", () => {
        const findings = lintNote(note("sandwich"), { schemas });
        expect(messages(findings)).toContain("no schema is declared");
    });

    it("reports a missing required property", () => {
        const findings = lintNote(note("skill", {}), { schemas });
        expect(messages(findings)).toContain("must declare `sohl.subType`");
    });

    it("reports a wrong value shape", () => {
        const findings = lintNote(note("skill", { subType: "craft", masteryLevelBase: "heavy" }), {
            schemas,
        });
        expect(messages(findings)).toContain("`sohl.masteryLevelBase` should");
    });

    it("reports an unknown property and suggests the near miss", () => {
        const findings = lintNote(note("skill", { subType: "craft", masterylevelBase: 3 }), {
            schemas,
        });
        // The whole reason the silence mattered: a misspelling is discarded at
        // compile with no warning (#3).
        expect(messages(findings)).toContain("is not a property of a skill");
        expect(messages(findings)).toContain('Did you mean "masteryLevelBase"');
    });

    it("does not guess when nothing is close", () => {
        const findings = lintNote(note("skill", { subType: "craft", elephant: 1 }), { schemas });
        expect(messages(findings)).not.toContain("Did you mean");
    });

    it("reports a reference that lands nowhere, and accepts one that lands", () => {
        const live = lintNote(note("skill", { subType: "craft", parentSkillCode: "swrd" }), {
            schemas,
            index: indexOf("skill-swrd"),
        });
        expect(live).toEqual([]);

        const dead = lintNote(note("skill", { subType: "craft", parentSkillCode: "nope" }), {
            schemas,
            index: indexOf("skill-swrd"),
        });
        expect(messages(dead)).toContain("no note or fetched index");
    });

    it("refuses a `code:` value carrying the address separator, explaining why", () => {
        // A Shortcode is one segment: this position resolves it at runtime
        // among one actor's embedded items, where packages do not exist, so a
        // qualified value can never mean what it asks for — caught before the
        // resolver is even asked, so the message never reads as a dead
        // reference when it is a wrong data type instead.
        const findings = lintNote(
            note("skill", { subType: "craft", parentSkillCode: "sohl-sohl-skill-swrd" }),
            { schemas, index: indexOf("skill-sohl-sohl-skill-swrd") },
        );
        expect(messages(findings)).toContain("must be a shortcode");
        expect(messages(findings)).toContain("not an address");
        expect(messages(findings)).toContain("packages do not exist");
    });

    it("asks the resolver for the field's type and shortcode", () => {
        // The field supplies the type, so the pair is the whole of what the
        // resolver is handed. Asked for anything less, every reference in every
        // tree lands nowhere.
        const asked: Array<[string, string]> = [];
        const index = {
            notes: [],
            shortcodeHit: (type: string, shortcode: string) => {
                asked.push([type, shortcode]);
                return {};
            },
        };
        lintNote(note("skill", { subType: "craft", parentSkillCode: "swrd" }), {
            schemas,
            index: index as any,
        });
        expect(asked).toEqual([["skill", "swrd"]]);
    });

    it("takes the reference resolver's answer, not the address rule's", () => {
        // A reference is a shortcode: persisted as written and looked up at
        // runtime among one actor's items, so a parent another package declares
        // resolves unqualified. `resolve` defaults the package to this one and
        // would report the reference dead.
        const index = {
            notes: [],
            shortcodeHit: (type: string, shortcode: string) =>
                type === "skill" && shortcode === "lang" ? {} : null,
            resolve: () => undefined,
            manifestHit: () => null,
        };
        const findings = lintNote(note("skill", { subType: "craft", parentSkillCode: "lang" }), {
            schemas,
            index: index as any,
        });
        expect(findings).toEqual([]);
    });

    it("skips the reference check when it has no index to check against", () => {
        // Reporting every reference as dead because nothing was loaded to
        // resolve it would be worse than not checking.
        const findings = lintNote(note("skill", { subType: "craft", parentSkillCode: "nope" }), {
            schemas,
        });
        expect(findings).toEqual([]);
    });

    it("reports nothing for a correct note", () => {
        expect(
            lintNote(note("skill", { subType: "craft", masteryLevelBase: 30 }), {
                schemas,
            }),
        ).toEqual([]);
    });

    it("reports a retired top-level `package:`, at its own position", () => {
        // The lint is where an author meets the whole list at once; the compile
        // refuses one note at a time. Reported whatever it says — the
        // value is the repository's `contentPackage` and no note restates it.
        const declaring = {
            file: "/tree/skill.md",
            type: "skill",
            raw: `---\ntype: skill\npackage: sohl\n---\n`,
            fm: { type: "skill", package: "sohl", sohl: { subType: "craft" } },
        };
        const findings = lintNote(declaring, { schemas });
        expect(messages(findings)).toContain("retired");
        expect(messages(findings)).toContain("contentPackage");
        expect(findings[0]).toMatchObject({ line: 3, column: 1 });
    });
});

describe("keys every type accepts", () => {
    it("allows the universal keys on any type", () => {
        const schemas = { doc: [] } as any;
        const sohl = Object.fromEntries([...UNIVERSAL_KEYS].map((k) => [k, "x"]));
        const findings = lintNote(note("doc", sohl), { schemas });

        // One is rejected, and only one: `archetype` is the retiring spelling
        // of `templatePriority`, and both are universal keys during the window,
        // so a note naming every universal key necessarily names the old
        // spelling too. Every other universal key passes.
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].message).toMatch(/write `templatePriority:` instead/);
    });

    it("includes kbcat, which no compiler reads but the knowledgebase does", () => {
        // The check's calibration depends on this: a note's frontmatter feeds a
        // knowledgebase and a website as well as a pack, so "the vocabulary" is
        // wider than "what the builder emits".
        expect(UNIVERSAL_KEYS.has("kbcat")).toBe(true);
    });
});

describe("NOTE_SCHEMAS covers what the package compiles", () => {
    it("declares every item type and every non-item type", () => {
        for (const type of Object.keys(ITEM_FIELDS)) {
            expect(NOTE_SCHEMAS, type).toHaveProperty(type);
        }
        for (const type of [...Object.keys(PACK_BY_TYPE), ...MAP_TYPES]) {
            expect(NOTE_SCHEMAS, type).toHaveProperty(type);
        }
    });

    it("leaves ITEM_FIELDS untouched — the builder registry holds that identity", () => {
        for (const [type, fields] of Object.entries(ITEM_FIELDS as any)) {
            expect(NOTE_SCHEMAS[type], type).not.toBe(fields);
            // …but every compiled field is still in the schema.
            const declared = new Set(
                authoredFields(NOTE_SCHEMAS[type] as any).map((f: any) => f.name),
            );
            for (const field of authoredFields(fields as any)) {
                expect(declared, `${type}.${(field as any).name}`).toContain((field as any).name);
            }
        }
    });

    it("gives every declared field a name and a description", () => {
        for (const [type, fields] of Object.entries(NOTE_SCHEMAS as any)) {
            for (const field of authoredFields(fields as any)) {
                expect((field as any).name, type).toBeTruthy();
                expect((field as any).describe, `${type}.${(field as any).name}`).toBeTruthy();
            }
        }
    });

    it("points every reference at a type the vocabulary declares", () => {
        for (const [type, fields] of Object.entries(NOTE_SCHEMAS as any)) {
            for (const field of fields as any[]) {
                if (!field.code) continue;
                expect(NOTE_SCHEMAS, `${type}.${field.name}`).toHaveProperty(field.code);
            }
        }
    });

    it("derives the classification from the declaration, so a tenth field cannot omit it", () => {
        // A `system`-block field naming a content type declares a Shortcode —
        // `code:` — never an Address, because an Address's `ref:` belongs to a
        // `data:` field's own vocabulary. A field found here still carrying the
        // old `ref:` key would silently mean an Address to nothing and a
        // Shortcode to no one, so its absence is asserted rather than assumed.
        for (const [type, fields] of Object.entries(NOTE_SCHEMAS as any)) {
            for (const field of fields as any[]) {
                expect(field.ref, `${type}.${field.name}`).toBeUndefined();
            }
        }
    });

    it("holds the converse for every `data:` field, so the two kinds cannot swap", () => {
        // A `data:` field naming a content type declares an Address — `ref:` —
        // never a Shortcode: `code:` at this position would mean nothing to
        // any reader, since only a `system`-block field is ever resolved among
        // one actor's embedded items.
        for (const type of Object.keys(NOTE_VOCABULARY as any)) {
            for (const field of dataFields(type) ?? []) {
                expect((field as any).code, `${type}.${field.name}`).toBeUndefined();
            }
        }
    });
});

describe("lintFrontmatter over an index", () => {
    it("reports each note, in path order", () => {
        const index = {
            notes: [note("sandwich"), note("baguette")],
            shortcodeHit: () => null,
        } as any;
        const r = lintFrontmatter(index, { schemas: NOTE_SCHEMAS });
        expect(r.notes).toBe(2);
        expect(r.findings).toHaveLength(2);
        expect(r.findings[0].file).toContain("baguette");
    });

    it("reports nothing for a tree of correct notes", () => {
        const index = {
            notes: [note("skill", { subType: "craft" })],
            shortcodeHit: () => ({}),
        } as any;
        expect(lintFrontmatter(index, { schemas: NOTE_SCHEMAS }).findings).toEqual([]);
    });
});

describe("checkTags — a classifying tag is queried, so a near miss is a finding", () => {
    /** A note carrying tags, as the index hands one over. */
    const tagged = (tags: string[]) => ({
        file: "/tree/place.md",
        type: "place",
        raw: `---\ntags:\n${tags.map((x) => `  - ${x}`).join("\n")}\ntype: place\n---\n`,
        fm: { type: "place", subType: "settlement", tags },
    });
    const tagFindings = (tags: string[]) =>
        lintFrontmatter({ notes: [tagged(tags)], shortcodeHit: () => ({}) } as any, {
            schemas: NOTE_SCHEMAS,
            vocabulary: NOTE_VOCABULARY,
        }).findings.filter((f: { message: string }) => f.message.startsWith('tag "'));

    it("passes a declared tag", () => {
        expect(tagFindings(["village", "fishing", "draft"])).toEqual([]);
    });

    it("passes a tag that is plainly the author's own", () => {
        // The top level is open, so an unrecognised tag is legal. Only a tag
        // close enough to a declared one to be a typo of it is reported.
        expect(tagFindings(["byzaria", "underworld", "heroes-and-knaves"])).toEqual([]);
    });

    it("reports a near miss, naming what was probably meant", () => {
        const f = tagFindings(["vilage"]);
        expect(f).toHaveLength(1);
        expect(f[0].message).toContain('"vilage"');
        expect(f[0].message).toContain('"village"');
    });

    it("reports a near miss in any group, not only a place's kind", () => {
        expect(tagFindings(["contienent"])[0].message).toContain('"continent"');
        expect(tagFindings(["drafft"])[0].message).toContain('"draft"');
        expect(tagFindings(["fortifed"])[0].message).toContain('"fortified"');
    });

    it("reports a declared tag written in the wrong case", () => {
        // A query for `village` does not find `Village`, which is the whole
        // reason the tag is checked at all.
        expect(tagFindings(["Village"])[0].message).toContain('"village"');
    });

    it("survives the early return for a type with no vocabulary entry", () => {
        // `place` declares no `data:` vocabulary, so the type-scoped checks
        // return early — the tag finding has to be raised before that.
        expect(tagFindings(["vilage"])).toHaveLength(1);
    });

    it("checks a group only on the types it applies to", () => {
        // Distance alone was wrong on every note it touched: `azravan` on a
        // faith, `barter` on an economy note and `secret` on three lore notes
        // are each a typo's distance from `caravan`, `border` and `sacred`, and
        // none is a mistake. A place's kinds are only ever a place's.
        const on = (type: string, tags: string[]) =>
            lintFrontmatter(
                {
                    notes: [
                        {
                            file: "/tree/n.md",
                            type,
                            raw: `---\ntags:\n${tags.map((x) => `  - ${x}`).join("\n")}\ntype: ${type}\n---\n`,
                            fm: { type, tags },
                        },
                    ],
                    shortcodeHit: () => ({}),
                } as any,
                { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY },
            ).findings.filter((f: { message: string }) => f.message.startsWith('tag "'));

        expect(on("lore", ["secret"])).toEqual([]);
        expect(on("affiliation", ["azravan"])).toEqual([]);
        expect(on("lore", ["barter"])).toEqual([]);
        // `draft` applies to any note, so a near miss of it is caught anywhere.
        expect(on("lore", ["drafft"])[0].message).toContain('"draft"');
    });

    it("catches a misspelt kind even beside a correct one", () => {
        expect(tagFindings(["town", "vilage"])).toHaveLength(1);
    });

    it("ignores a note with no tags, and a non-string tag", () => {
        expect(tagFindings([])).toEqual([]);
        expect(tagFindings([null as any, 3 as any])).toEqual([]);
    });
});

describe("a being's kind is one slot, and a note fills it once or not at all", () => {
    /** A being carrying tags, as the index hands one over. */
    const being = (tags: string[]) => ({
        file: "/tree/being.md",
        type: "being",
        raw: `---\ntype: being\ntags:\n${tags.map((x) => `  - ${x}`).join("\n")}\n---\n`,
        fm: { type: "being", tags },
    });
    const findings = (tags: string[], type = "being") =>
        lintFrontmatter(
            {
                notes: [{ ...being(tags), type, fm: { type, tags } }],
                shortcodeHit: () => ({}),
            } as any,
            { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY },
        ).findings.filter(
            (f: { message: string }) => f.message.includes("kind") || f.message.startsWith('tag "'),
        );

    it("passes a being that states one kind", () => {
        expect(findings(["character"])).toEqual([]);
        expect(findings(["creature"])).toEqual([]);
    });

    it("passes a being that states no kind at all", () => {
        // The kind is authored deliberately, and a tree part-way through
        // tagging is a tree with untagged beings in it. Silence is the only
        // honest answer: nothing can tell an unstated kind from a wrong one.
        expect(findings([])).toEqual([]);
        expect(findings(["soldiery", "draft"])).toEqual([]);
    });

    it("refuses a being that states both, as an error", () => {
        const f = findings(["character", "creature"]);
        expect(f).toHaveLength(1);
        expect(f[0].severity).toBe("error");
        expect(f[0].message).toContain('"character"');
        expect(f[0].message).toContain('"creature"');
    });

    it("locates the finding on the note's `tags` key", () => {
        // The whole list is at fault, not one entry of it, so the key's own
        // line is where a reader is sent. `type:` is line 2 and `tags:` line 3.
        const f = findings(["character", "creature"])[0];
        expect(f.line).toBe(3);
        expect(f.column).toBe(1);
    });

    it("reports a near miss of either kind, naming what was probably meant", () => {
        expect(findings(["charcter"])[0].message).toContain('"character"');
        expect(findings(["creture"])[0].message).toContain('"creature"');
    });

    it("leaves a tag that is plainly the author's own alone", () => {
        // Nothing else names a being's kind, and nothing else is refused for
        // failing to: the top level stays open.
        expect(findings(["monstrous", "undead", "beast-of-burden"])).toEqual([]);
    });

    it("checks the kind only on a being", () => {
        // `character` is also what HM3 calls one of the two documents a being
        // compiles to, and it was once a note type of its own. A place tagged
        // with the word is neither, and is nobody's finding.
        expect(findings(["character", "creature"], "place")).toEqual([]);
    });
});

/* -------------------------------------------------------------------- */
/*  `img: ""` — the old spelling of "unset"                       */
/* -------------------------------------------------------------------- */

describe('an authored `icon: ""`', () => {
    const schemas = { skill: [] as any[] };

    it("is warned about, because it reads as the opposite", () => {
        // `""` was how a note said "no art authored" while `resolveImg`
        // conflated the two empties; it now says "ship no art". Forty-five
        // `sohl-thalorna` notes were written under the old reading and would
        // have lost their default art silently.
        const findings = lintNote(note("skill", {}, { data: { icon: "" } }), { schemas });
        const icon = findings.filter((f) => /`icon: ""`/.test(f.message));

        expect(icon).toHaveLength(1);
        expect(icon[0].severity).toBe("warning");
        expect(icon[0].message).toMatch(/icon: null/);
    });

    it("is warned about under a system block too, where a note may also write it", () => {
        const findings = lintNote(note("skill", { icon: "" }), { schemas });

        expect(findings.filter((f) => /`icon: ""`/.test(f.message))).toHaveLength(1);
    });

    it("says nothing about `icon: null`, which is the spelling it asks for", () => {
        const findings = lintNote(note("skill", {}, { data: { icon: null } }), { schemas });

        expect(findings.filter((f) => /`icon: ""`/.test(f.message))).toHaveLength(0);
    });

    it("says nothing about a note that names art, or names none at all", () => {
        expect(
            lintNote(note("skill", {}, { data: { icon: "sword" } }), { schemas }).filter((f) =>
                /`icon: ""`/.test(f.message),
            ),
        ).toHaveLength(0);
        expect(
            lintNote(note("skill"), { schemas }).filter((f) => /`icon: ""`/.test(f.message)),
        ).toHaveLength(0);
    });

    it("is warned about for every slot, since the rule belongs to the resolution", () => {
        // A check keyed on one slot would call a tree clean that loses its
        // default art through another.
        for (const key of ["tokenIcon", "bgImage", "banner"]) {
            const findings = lintNote(note("skill", {}, { data: { [key]: "" } }), { schemas });
            const art = findings.filter((f) => new RegExp(`\`${key}: ""\``).test(f.message));

            expect(art, key).toHaveLength(1);
            expect(art[0].severity).toBe("warning");
            expect(art[0].message).toMatch(new RegExp(`${key}: null`));
        }
    });

    it('warns on `title: ""` too, for the page\'s heading', () => {
        // The collision that kept `title` off this rule is gone: the field
        // declares `topLevelMeans`, so the top-level key no longer feeds an
        // affiliation's `system.title` and `title: null` no longer compiles
        // the literal `"null"`. What remains is the page heading, and the
        // emitter is `fm.title ?? name` — so `""` survives, the page
        // publishes unnamed, and it sorts ahead of every named page in its
        // section. Fifteen notes in `sohl-thalorna` are in that state.
        const findings = lintNote(note("skill", {}, { title: "" }), { schemas });
        const titleFindings = findings.filter((f) => /title: ""/.test(f.message));

        expect(titleFindings).toHaveLength(1);
        expect(titleFindings[0].severity).toBe("warning");
        expect(titleFindings[0].message).toMatch(/title: null/);
    });
});

/* -------------------------------------------------------------------- */
/*  A system field that merely shares a note-level field's name   */
/* -------------------------------------------------------------------- */

describe("a system field that merely shares a note-level field's name", () => {
    /** The blank-heading finding, whichever position provoked it. */
    const blankHeading = (findings: Array<{ message: string }>) =>
        findings.filter((f) => /publishes a page with no heading/.test(f.message));

    it("says nothing about an affiliation whose office has no style of address", () => {
        // `sohl.title` on an affiliation is the style of address the office
        // carries — "Ajaw", "Warden" — and `""` is the ordinary way to say an
        // office carries none. The note's *heading* is its top-level `title`,
        // which this note does not author at all, so its page takes `name.full`
        // exactly as intended. Twenty-eight `sohl-kethira-basic` affiliations
        // are in this state and every one of them was reported.
        const findings = lintNote(note("affiliation", { title: "" }), { schemas: NOTE_SCHEMAS });

        expect(blankHeading(findings)).toHaveLength(0);
    });

    it("still reports the note-level `title` on that same type", () => {
        // The exemption removes one position, not the check: an affiliation
        // that really does publish a blank heading is still reported.
        const findings = lintNote(note("affiliation", {}, { title: "" }), {
            schemas: NOTE_SCHEMAS,
        });

        expect(blankHeading(findings)).toHaveLength(1);
    });

    it("still resolves through the block on a type that claims nothing there", () => {
        // `skill` declares no `title`, so nothing competes for the spelling and
        // the resolution is the unchanged one — a `sohl.title: ""` is the note's
        // own heading, written in the block.
        const findings = lintNote(note("skill", { title: "" }), { schemas: NOTE_SCHEMAS });

        expect(blankHeading(findings)).toHaveLength(1);
    });

    it("reads the declaration rather than the field name", () => {
        // The mechanism is `topLevelMeans`, which `resolveFieldValue` already
        // honours — so the linter and the resolver agree about the one field
        // that declares it, and a hardcoded `title` would not have said so.
        const title = ITEM_FIELDS.affiliation.find((field) => field.name === "title") as any;

        expect(title.topLevelMeans).toBeTruthy();
    });

    it("applies to the art fields too, where a type claims the block key", () => {
        // An art slot is checked the same way. No shipped type declares a
        // system field of any slot's name today — which is why `sohl.icon: ""`
        // still answers for the art check, the emitter reading the block first
        // — so the exemption is exercised with a declaration of its own, and
        // the next such collision must not need this fixed a second time.
        const schemas = {
            widget: [
                {
                    name: "icon",
                    to: "icon",
                    ...STRING,
                    default: "",
                    topLevelMeans: "the note's own artwork, not the widget's stamped badge",
                    describe: "The badge a widget is stamped with.",
                },
            ],
        } as any;
        const art = (findings: Array<{ message: string }>) =>
            findings.filter((f) => /`icon: ""`/.test(f.message));

        expect(art(lintNote(note("widget", { icon: "" }), { schemas }))).toHaveLength(0);
        expect(art(lintNote(note("widget", {}, { data: { icon: "" } }), { schemas }))).toHaveLength(
            1,
        );
    });
});

describe("two embedded items denoting one entity", () => {
    /** `lintNote` returns early on a type no schema declares, so give it one. */
    const BEING_SCHEMA = { being: [] } as any;

    /** YAML flow form of one entry, so the fence matches the parsed frontmatter. */
    const flow = (entry: Record<string, any>): string =>
        `{ ${Object.entries(entry)
            .map(([k, v]) => `${k}: ${v && typeof v === "object" ? flow(v) : v}`)
            .join(", ")} }`;

    /** A being note whose `sohl.items` is spelled out in the fence, so findings can be located. */
    const being = (entries: Array<Record<string, any>>) => ({
        file: "/tree/being.md",
        type: "being",
        raw:
            `---\ntype: being\nsohl:\n  items:\n` +
            entries.map((e) => `    - ${flow(e)}\n`).join("") +
            `---\n`,
        fm: { type: "being", sohl: { items: entries } },
    });

    const dup = (findings: Array<{ message: string }>) =>
        findings.filter((f) => f.message.includes("is already the shortcode of"));

    const lint = (entries: Array<Record<string, any>>) =>
        dup(lintNote(being(entries), { schemas: BEING_SCHEMA }));

    it("reports two entries that inherit one template's shortcode", () => {
        const findings = lint([
            { shortcode: "swim", type: "skill" },
            { shortcode: "swim", type: "skill" },
        ]);
        expect(messages(findings)).toContain('"skill:swim" is already the shortcode of');
    });

    it("points at the later entry and names the earlier one", () => {
        const [finding] = lint([
            { shortcode: "swim", type: "skill" },
            { shortcode: "swim", type: "skill" },
        ]) as any[];
        // The fence's line 1 is `---`, so the second entry is the file's line 6.
        expect(finding.line).toBe(6);
        expect(finding.message).toContain("sohl.items[0]");
        expect(finding.severity).toBe("error");
    });

    it("explains that a top-level shortcode only selects a template", () => {
        const [finding] = lint([
            { shortcode: "swim", type: "skill" },
            { shortcode: "swim", type: "skill" },
        ]) as any[];
        expect(finding.message).toContain("never reaches the document");
    });

    it("accepts a second instance that overrides `system.shortcode`", () => {
        expect(
            lint([
                { shortcode: "Dgr", type: "weapongear" },
                { shortcode: "Dgr", type: "weapongear", system: { shortcode: "Dgr2" } },
            ]),
        ).toHaveLength(0);
    });

    it("keys on the pair, so two types may share a shortcode", () => {
        expect(
            lint([
                { shortcode: "swim", type: "skill" },
                { shortcode: "swim", type: "miscgear" },
            ]),
        ).toHaveLength(0);
    });

    it("leaves an entry naming no key to the compiler", () => {
        expect(lint([{ type: "skill" }, { type: "skill" }])).toHaveLength(0);
    });

    it("catches a stand-alone entry colliding with a template instance", () => {
        const findings = lint([
            { shortcode: "sting", type: "skill" },
            { type: "skill", system: { shortcode: "sting" } },
        ]);
        expect(messages(findings)).toContain('"skill:sting" is already the shortcode of');
    });

    it("says nothing about a note with no items", () => {
        expect(
            dup(
                lintNote(
                    {
                        file: "/t/x.md",
                        type: "being",
                        raw: "---\n---\n",
                        fm: { type: "being", sohl: {} },
                    },
                    { schemas: BEING_SCHEMA },
                ),
            ),
        ).toHaveLength(0);
    });
});
