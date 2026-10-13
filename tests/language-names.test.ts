/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { formatDiagnostic } from "../engine/diagnostics.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { BEING_LOOK_VOCABULARY, NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import {
    drawName,
    givenNames,
    nameMisfit,
    parsePattern,
    requiredGivenGenders,
} from "../engine/language-names.mjs";

/**
 * A language skill note's `data.names`: the pattern a name is built by and the
 * lists each part is drawn from, as `package-build npc new` reads them.
 *
 * Every lint assertion goes through the frontmatter lint, the check an author
 * meets.
 */

const file = "assets/content/Skills/Languages/Khelathi.md";

/** A valid `data.names` block's YAML lines, below `names:`, with keys replaced. */
function namesLines(replace: Record<string, string> = {}): string[] {
    const lines: Record<string, string> = {
        pattern: '        pattern: "{given} ez {place}"',
        given: [
            "        given:",
            "            female: [Rethutê, Agosi]",
            "            male: [Aguri, Khelemûr]",
        ].join("\n"),
        place: "        place: [Zileti, Iqu]",
        ...replace,
    };
    return Object.values(lines)
        .filter((line) => line !== "")
        .flatMap((line) => line.split("\n"));
}

/** A skill note carrying name lists, written as an author would. */
function language(lines: string[], subType = "language") {
    const raw = [
        "---",
        "shortcode: khelathi",
        'name: { full: "Khelâthi Language" }',
        "type: skill",
        `subType: ${subType}`,
        "data:",
        "    names:",
        ...lines,
        "---",
        "",
        "Khelâthi is the tongue of the river towns, written in the temple script.",
        "",
    ].join("\n");
    const fm = YAML.parse(raw.split("---\n")[1]);
    return { file, raw, type: "skill", fm };
}

/** Every finding the lint makes of a note. */
function lint(note: ReturnType<typeof language>) {
    return lintNote(note as any, { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY } as any);
}

/** The 1-based position of a literal in a note's raw text. */
function at(raw: string, literal: string) {
    const before = raw.slice(0, raw.indexOf(literal)).split("\n");
    return { line: before.length, column: (before.at(-1) as string).length + 1 };
}

const NAMES = {
    pattern: "{given} ez {place}",
    given: { female: ["Rethutê", "Agosi"], male: ["Aguri", "Khelemûr"] },
    place: ["Zileti", "Iqu"],
};

/** A stream that returns its values in turn. */
const fixed =
    (...values: number[]) =>
    () =>
        values.shift() as number;

describe("a language's name lists", () => {
    it("key their given names by words of the gender vocabulary", () => {
        const genders = BEING_LOOK_VOCABULARY.gender.map(({ value }: { value: string }) => value);
        for (const gender of requiredGivenGenders()) expect(genders).toContain(gender);
    });

    it("are accepted when the pattern and every list are well formed", () => {
        expect(lint(language(namesLines()))).toEqual([]);
    });

    it("refuse a placeholder naming no list, at the pattern", () => {
        const note = language(namesLines({ pattern: '        pattern: "{given} ez {plce}"' }));
        const findings = lint(note);
        expect(findings.map((f: any) => f.message)).toEqual([
            expect.stringMatching(/`\{plce\}`.*names no list.*Did you mean "\{place\}"\?/),
            expect.stringMatching(/data\.names\.place.*never drawn from.*\{place\}/),
        ]);
        const pos = at(note.raw, '"{given} ez {plce}"');
        expect(formatDiagnostic(findings[0])).toMatch(
            new RegExp(`^${file}:${pos.line}:${pos.column}: error: `),
        );
    });

    it("refuse a list the pattern never uses, at the list's key", () => {
        const note = language(namesLines({ pattern: '        pattern: "{given}"' }));
        const findings = lint(note);
        expect(findings).toHaveLength(1);
        const pos = at(note.raw, "place:");
        expect(formatDiagnostic(findings[0])).toMatch(
            new RegExp(`^${file}:${pos.line}:${pos.column}: error: .*data\\.names\\.place`),
        );
    });

    it("refuse a pattern with an unmatched brace or no placeholder", () => {
        for (const pattern of ['"{given ez {place}"', '"{given} ez place}"', '"nobody"']) {
            const findings = lint(language(namesLines({ pattern: `        pattern: ${pattern}` })));
            expect(
                findings.some((f: any) => /data\.names\.pattern/.test(f.message)),
                pattern,
            ).toBe(true);
        }
    });

    it("refuse a missing pattern, a missing given list and a given list for no gender", () => {
        const noPattern = lint(language(namesLines({ pattern: "" })));
        expect(noPattern.map((f: any) => f.message)).toContainEqual(
            expect.stringMatching(/must state `pattern`/),
        );
        const noMale = lint(
            language(namesLines({ given: "        given:\n            female: [Agosi]" })),
        );
        expect(noMale.map((f: any) => f.message)).toEqual([
            expect.stringMatching(/data\.names\.given.*`male`/),
        ]);
        const typo = lint(
            language(
                namesLines({
                    given: [
                        "        given:",
                        "            female: [Agosi]",
                        "            male: [Aguri]",
                        "            femal: [Agosi]",
                    ].join("\n"),
                }),
            ),
        );
        expect(typo.map((f: any) => f.message)).toEqual([
            expect.stringMatching(/"femal" is not a gender.*Did you mean "female"\?/),
        ]);
    });

    it("refuse an empty list and an entry that is not a name, at the entry", () => {
        const empty = lint(language(namesLines({ place: "        place: []" })));
        expect(empty.map((f: any) => f.message)).toEqual([
            expect.stringMatching(/data\.names\.place.*at least one name/),
        ]);
        const note = language(namesLines({ place: '        place: [Zileti, ""]' }));
        const findings = lint(note);
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toMatch(/data\.names\.place.*entry 2/);
        const pos = at(note.raw, '""');
        expect(findings[0]).toMatchObject({ line: pos.line, column: pos.column });
    });

    it("refuse a list that is not a list of names, at the list or the entry", () => {
        const note = language(namesLines({ place: "        place: Zileti" }));
        const findings = lint(note);
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toMatch(/data\.names\.place.*a list of names/);
        const pos = at(note.raw, "Zileti");
        expect(findings[0]).toMatchObject({ line: pos.line, column: pos.column });
        const entry = lint(
            language(
                namesLines({
                    given: "        given:\n            female: [Agosi, 5]\n            male: [Aguri]",
                }),
            ),
        );
        expect(entry.map((f: any) => f.message)).toEqual([
            expect.stringMatching(/data\.names\.given\.female\[1\].*a name/),
        ]);
    });

    it("refuse a list name a placeholder cannot spell, at its key", () => {
        const findings = lint(
            language(
                namesLines({
                    pattern: '        pattern: "{given} ez {place}"',
                    place: "        place: [Zileti]\n        home-town: [Iqu]",
                }),
            ),
        );
        expect(findings.map((f: any) => f.message)).toContainEqual(
            expect.stringMatching(/"home-town" is not a list name/),
        );
    });

    it("refuse name lists on a skill that is not a language", () => {
        const findings = lint(language(namesLines(), "craft"));
        expect(findings.map((f: any) => f.message)).toEqual([
            expect.stringMatching(/data\.names.*`language`/),
        ]);
    });
});

describe("a pattern", () => {
    it("reads into literal text and placeholders", () => {
        expect(parsePattern("{family} {given}").parts).toEqual([
            { list: "family" },
            { literal: " " },
            { list: "given" },
        ]);
        expect(parsePattern("{given} yra {clan}").parts).toEqual([
            { list: "given" },
            { literal: " yra " },
            { list: "clan" },
        ]);
    });
});

describe("a drawn name", () => {
    it("fills each placeholder from its list, the given name from the gender's", () => {
        expect(drawName(NAMES, "female", fixed(0.9, 0.1))).toBe("Agosi ez Zileti");
        expect(drawName(NAMES, "male", fixed(0, 0.6))).toBe("Aguri ez Iqu");
    });

    it("draws a gender with no list of its own from every given list", () => {
        expect(givenNames(NAMES, "nonbinary")).toEqual(["Rethutê", "Agosi", "Aguri", "Khelemûr"]);
    });
});

describe("a supplied name", () => {
    it("fits when every part is a name of its list", () => {
        expect(nameMisfit("Khelemûr ez Iqu", NAMES, "male")).toBeUndefined();
        // A decomposed accent is the same letter.
        expect(nameMisfit("Khelemûr ez Iqu", NAMES, "male")).toBeUndefined();
        expect(nameMisfit("Agosi ez Iqu", NAMES, "nonbinary")).toBeUndefined();
    });

    it("names the part that is in no list", () => {
        expect(nameMisfit("Aguri ez Lut", NAMES, "male")).toMatch(/"Lut".*\{place\}.*place list/);
        expect(nameMisfit("Zâra ez Iqu", NAMES, "male")).toMatch(/"Zâra".*\{given\}/);
    });

    it("names a given name from another gender's list", () => {
        expect(nameMisfit("Agosi ez Iqu", NAMES, "male")).toMatch(
            /"Agosi".*not a male given name.*listed for female/,
        );
    });

    it("names a name that does not read as the pattern", () => {
        expect(nameMisfit("Aguri of Iqu", NAMES, "male")).toMatch(/pattern/);
    });
});

describe("a tongue named in several forms", () => {
    const KHELATHI = {
        pattern: ["{given} {house}", "{given} ez {place}", "{given}"],
        given: { female: ["Rethutê", "Ahmuzê"], male: ["Aguri", "Khelemûr"] },
        house: ["Reth'el'Lêru"],
        place: ["Zileti", "Iqu"],
    };

    it("accepts a name in any of its forms", () => {
        expect(nameMisfit("Rethutê Reth'el'Lêru", KHELATHI, "female")).toBeUndefined();
        expect(nameMisfit("Aguri ez Zileti", KHELATHI, "male")).toBeUndefined();
        expect(nameMisfit("Ahmuzê", KHELATHI, "female")).toBeUndefined();
    });

    it("refuses a part in no list, naming it", () => {
        expect(nameMisfit("Aguri ez Lut", KHELATHI, "male")).toMatch(
            /"Lut".*\{place\}.*place list/,
        );
    });

    it("draws every form, each a name that fits", () => {
        const forms = new Set<number>();
        for (let i = 0; i < 60; i++) {
            const seed = (i * 0.618) % 1;
            const name = drawName(KHELATHI, "male", fixed(seed, (seed * 7) % 1, (seed * 13) % 1));
            expect(nameMisfit(name, KHELATHI, "male"), name).toBeUndefined();
            forms.add(
                name.includes(" ez ") ? 1
                : name.includes(" ") ? 0
                : 2,
            );
        }
        expect(forms.size).toBe(3);
    });

    it("lints clean as a list, counting a list used when any pattern uses it", () => {
        const findings = lint(
            language(
                namesLines({
                    pattern:
                        '        pattern: ["{given} {house}", "{given} ez {place}", "{given}"]',
                    place: "        place: [Zileti, Iqu]\n        house: [\"Reth'el'Lêru\"]",
                }),
            ),
        );
        expect(findings).toEqual([]);
    });

    it("refuses a bad pattern in a list at its own entry, and an empty list", () => {
        const note = language(
            namesLines({ pattern: '        pattern: ["{given} ez {place}", "{given} {hous}"]' }),
        );
        const findings = lint(note);
        expect(findings.map((f: any) => f.message)).toEqual([
            expect.stringMatching(/`\{hous\}` in `data\.names\.pattern\[1\]`.*names no list/),
        ]);
        const pos = at(note.raw, '"{given} {hous}"');
        expect(findings[0]).toMatchObject({ line: pos.line, column: pos.column });
        expect(
            lint(language(namesLines({ pattern: "        pattern: []" }))).map(
                (f: any) => f.message,
            ),
        ).toEqual([expect.stringMatching(/data\.names\.pattern.*at least one pattern/)]);
    });
});

describe("a pattern of the wrong kind", () => {
    it("is refused once, at the entry, whether in a list or under a gender", () => {
        for (const pattern of [
            '        pattern: ["{given} ez {place}", 5]',
            '        pattern:\n            male: ["{given} ez {place}", 5]',
        ]) {
            const findings = lint(language(namesLines({ pattern })));
            expect(
                findings.map((f: any) => f.message),
                pattern,
            ).toEqual([expect.stringMatching(/data\.names\.pattern.*\[1\].*should be a pattern/)]);
        }
    });
});

describe("a gendered patronymic", () => {
    const NORDMAL = {
        pattern: { male: "{given} {given.male}sen", female: "{given} {given.male}dóttir" },
        given: { female: ["Sigrid", "Astrid"], male: ["Ulf", "Harald"] },
    };

    it("builds a name from a father's given name and the gender's suffix", () => {
        expect(drawName(NORDMAL, "male", fixed(0, 0.9))).toBe("Ulf Haraldsen");
        expect(drawName(NORDMAL, "female", fixed(0.9, 0))).toBe("Astrid Ulfdóttir");
    });

    it("accepts each gender's own form, and every form for a gender with none", () => {
        expect(nameMisfit("Harald Ulfsen", NORDMAL, "male")).toBeUndefined();
        expect(nameMisfit("Sigrid Haralddóttir", NORDMAL, "female")).toBeUndefined();
        expect(nameMisfit("Sigrid Haralddóttir", NORDMAL, "nonbinary")).toBeUndefined();
        expect(nameMisfit("Ulf Haraldsen", NORDMAL, "nonbinary")).toBeUndefined();
    });

    it("refuses another gender's form, and a parent's name from the wrong list", () => {
        expect(nameMisfit("Ulf Haralddóttir", NORDMAL, "male")).toMatch(
            /"\{given\} \{given\.male\}dóttir".*not a male pattern/,
        );
        expect(nameMisfit("Sigrid Astriddóttir", NORDMAL, "female")).toMatch(
            /"Astrid".*\{given\.male\}/,
        );
    });

    it("lints clean as a map keyed by gender", () => {
        const findings = lint(
            language(
                namesLines({
                    pattern: [
                        "        pattern:",
                        '            male: "{given} {given.male}sen"',
                        '            female: ["{given} {given.male}dóttir", "{given} ez {place}"]',
                    ].join("\n"),
                }),
            ),
        );
        expect(findings).toEqual([]);
    });

    it("refuses a pattern keyed by no gender, and a placeholder naming no given list", () => {
        const findings = lint(
            language(
                namesLines({
                    pattern: [
                        "        pattern:",
                        '            femal: "{given} ez {place}"',
                        '            female: "{given} {given.nonbinary}dóttir {place.x}"',
                    ].join("\n"),
                }),
            ),
        );
        expect(findings.map((f: any) => f.message)).toEqual([
            expect.stringMatching(/"femal" is not a gender.*Did you mean "female"\?/),
            expect.stringMatching(/`\{place\.x\}`.*only `given`/),
            expect.stringMatching(/`\{given\.nonbinary\}`.*no `nonbinary` list/),
        ]);
    });
});

describe("a name whose parts touch", () => {
    const TOUCHING = {
        pattern: "{given}{clan}",
        given: { female: ["Al", "Ala"], male: ["Al", "Ala"] },
        clan: ["lan", "n"],
    };

    it("is read by trying every split, not only the first", () => {
        expect(nameMisfit("Alan", TOUCHING, "male")).toBeUndefined();
        expect(nameMisfit("Allan", TOUCHING, "male")).toBeUndefined();
        expect(nameMisfit("Alax", TOUCHING, "male")).toBeDefined();
    });
});
