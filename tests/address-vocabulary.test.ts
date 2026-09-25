/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, it, expect } from "vitest";
import { stringify } from "yaml";
import { parseAddress } from "../engine/address.mjs";
import { lintNote, lintFrontmatter, matchesKind } from "../engine/frontmatter-lint.mjs";
import { valueKindOf } from "../engine/infobox.mjs";
import { NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const context = {
    package: "world",
    system: "none",
    type: "place",
    types: new Set(["place", "lore", "skill", "affiliation", "icon", "image", "audio"]),
};
const findings = (type: string, data: object) => {
    const fm = { type, data };
    return lintNote(
        { file: "note.md", fm, type, raw: `---\n${stringify(fm)}---\n` },
        {
            schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
            vocabulary: NOTE_VOCABULARY,
            addressContext: context,
        },
    ).filter((f) => f.message.includes("`data."));
};

describe("declared Address grammar", () => {
    it.each([
        "north",
        "place-north",
        "none-place-north",
        "elsewhere-none-place-north",
        "place/north",
    ])("accepts %s with complete context", (value) => {
        expect(parseAddress(value, context, { declared: true })).toMatchObject({
            package: value.startsWith("elsewhere-") ? "elsewhere" : "world",
            system: "none",
            type: "place",
            shortcode: "north",
        });
        expect(matchesKind(value, "address", context)).toBe(true);
    });
    it.each([
        "north!",
        "North",
        "place-North",
        "bad_pkg-none-place-north",
        "world-wrong-place-north",
        "world-none-unknown-north",
        "[[place-north]]",
        "place-north#anchor",
        "place-north|label",
        "place-",
        "north south",
        17,
        {},
        [],
    ])("refuses malformed %s", (value) => {
        expect(matchesKind(value, "address", context)).toBe(false);
    });
    it("requires completion and keeps Shortcodes separate", () => {
        expect(matchesKind("north", "address")).toBe(false);
        expect(matchesKind("north", "address", { ...context, system: "invalid" })).toBe(false);
        expect(matchesKind("north", "shortcode")).toBe(true);
        expect(matchesKind("place-north", "shortcode")).toBe(false);
    });
});

it("renders every declared Address scalar and list as links", () => {
    const mismatches = [];
    for (const type of Object.keys(NOTE_VOCABULARY))
        for (const field of dataFields(type)) {
            const expected =
                field.kind === "address" ? "link"
                : field.kind === "list" && field.entryKind === "address" ? "links"
                : undefined;
            if (expected && valueKindOf(field, null) !== expected)
                mismatches.push(`${type}.${field.name}`);
        }
    expect(mismatches).toEqual([]);
});

describe("typed data entries", () => {
    it("locates scalar and list errors", () => {
        const errors = findings("being", {
            species: "bad code",
            homes: ["place-north", "bad!", "bad!"],
        });
        expect(errors.map(({ line, column }) => ({ line, column }))).toEqual([
            { line: 7, column: 7 },
            { line: 8, column: 7 },
            { line: 4, column: 12 },
        ]);
        expect(errors.every((f) => f.severity === "error")).toBe(true);
    });
    it("validates Address map keys and Shortcode selector keys", () => {
        expect(
            findings("affiliation", { relations: { "other-sohl-affiliation-guild": "rival" } }),
        ).toEqual([]);
        expect(findings("affiliation", { relations: { "bad key": "rival" } })).toMatchObject([
            { line: 5, column: 5, severity: "error" },
        ]);
        expect(findings("mystery", { skillAptitudes: { sword: 1, "subType:combat": 2 } })).toEqual(
            [],
        );
        expect(
            findings("mystery", { skillAptitudes: { "skill-sword": 1, "subType:": 2 } }),
        ).toHaveLength(2);
    });
    it("checks accepted types after parsing and leaves package visibility to resolution", () => {
        expect(findings("being", { species: "affiliation-guild" })).toMatchObject([
            {
                line: 4,
                column: 12,
                severity: "error",
                message: expect.stringContaining("accepts lore"),
            },
        ]);
        expect(
            parseAddress(
                "foreign-none-place-north",
                { ...context, packages: new Set(["world"]), noIndexPackages: new Set(["foreign"]) },
                { declared: true },
            ),
        ).toMatchObject({ package: "foreign", type: "place" });
    });
    it("keeps optional nulls and empty containers", () => {
        expect(findings("being", { species: null, homes: [] })).toEqual([]);
        expect(findings("affiliation", { relations: [] })).toEqual([]);
        expect(findings("mystery", { skillAptitudes: {} })).toEqual([]);
        expect(findings("folder", { parent: { default: null, journals: "folder-root" } })).toEqual(
            [],
        );
    });
    it("accepts art sets independently of their default", () => {
        expect(findings("being", { icon: "image-portrait", tokenIcon: "head" })).toEqual([]);
        expect(findings("being", { icon: "audio-song" })).toHaveLength(1);
    });
    it("requires an explicit type in heterogeneous fields", () => {
        expect(findings("affiliation", { economy: ["currency"] })).toHaveLength(1);
        expect(
            findings("affiliation", { economy: ["lore-currency", "affiliation-merchants"] }),
        ).toEqual([]);
        expect(findings("affiliation", { economy: ["place-north"] })).toHaveLength(1);
        expect(findings("bundle", { contents: ["being-guard", "place-north"] })).toEqual([]);
    });
    it("checks grammar when target resolution is disabled", () => {
        const fm = { type: "being", data: { species: "bad!" } };
        const index = {
            contentPackage: "world",
            types: context.types,
            notes: [{ type: "being", file: "a.md", fm, raw: `---\n${stringify(fm)}---\n` }],
        };
        expect(
            lintFrontmatter(index, {
                schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
                vocabulary: NOTE_VOCABULARY,
                references: false,
            }).findings.some((f) => f.message.includes("`data.species`")),
        ).toBe(true);
    });
});

it("validates runtime Shortcode grammar without a target index", () => {
    const fm = { type: "skill", sohl: { parentSkillCode: "skill-sword" } };
    const subject = { type: "skill", file: "skill.md", fm, raw: `---\n${stringify(fm)}---\n` };
    const index = { notes: [subject], contentPackage: "world" };
    const result = lintFrontmatter(index, {
        schemas: { skill: [{ name: "parentSkillCode", code: "skill" }] },
        references: false,
    });
    expect(result.findings).toMatchObject([
        {
            line: 4,
            column: 20,
            severity: "error",
            message: expect.stringContaining("must be a shortcode"),
        },
    ]);
});
