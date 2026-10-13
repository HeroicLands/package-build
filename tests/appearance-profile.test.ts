/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { formatDiagnostic } from "../engine/diagnostics.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { BEING_LOOK_VOCABULARY, NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import {
    FRAME_MASS_INDEX,
    REQUIRED_HEIGHT_GENDERS,
    profileLookKeys,
} from "../engine/appearance-profile.mjs";

const PROFILE_LOOK_KEYS = profileLookKeys(BEING_LOOK_VOCABULARY);

/**
 * A culture note's `data.appearanceProfile`: the weighted words and height
 * ranges `package-build npc new` draws a person from.
 *
 * The words a profile may name are read from the closed being-look vocabulary,
 * so a word added there is covered here without an edit. Every lint assertion
 * goes through the frontmatter lint, the check an author meets.
 */

const file = "assets/content/Cultures/Khelathi.md";

/** The vocabulary key a profile key draws its words from. */
const vocabularyKey = (key: string) =>
    Object.keys(BEING_LOOK_VOCABULARY).find((name) => name.split(".").at(-1) === key) as string;

/** The words one profile key may name. */
const wordsOf = (key: string) =>
    (BEING_LOOK_VOCABULARY as Record<string, ReadonlyArray<{ value: string }>>)[
        vocabularyKey(key)
    ].map(({ value }) => value);

/** A valid profile's YAML lines, below `appearanceProfile:`, with one line replaced. */
function profileLines(replace: Record<string, string> = {}): string[] {
    const lines: Record<string, string> = {
        frame: "        frame: { light: 2, medium: 5, heavy: 2 }",
        eye_color: "        eye_color: { brown: 6, dark_brown: 3, hazel: 1 }",
        hair_color: "        hair_color: { black: 6, dark_brown: 3 }",
        skin_color: "        skin_color: { tawny: 5, olive: 3, brown: 2 }",
        complexion: "        complexion: { clear: 3, weathered: 2, smooth: 2 }",
        height: [
            "        height:",
            "            female:",
            "                min: 4' 11\"",
            "                max: 5' 8\"",
            "            male:",
            "                min: 5' 4\"",
            "                max: 6' 3\"",
        ].join("\n"),
        ...replace,
    };
    return Object.values(lines)
        .filter((line) => line !== "")
        .flatMap((line) => line.split("\n"));
}

/** A lore note carrying a profile, written as an author would. */
function culture(lines: string[], subType = "culture") {
    const raw = [
        "---",
        "shortcode: khelathi",
        'name: { full: "The Khelâthi" }',
        "type: lore",
        `subType: ${subType}`,
        "data:",
        "    appearanceProfile:",
        ...lines,
        "---",
        "",
        "The Khelâthi are a river people whose towns line the lower reaches of the great valley.",
        "",
    ].join("\n");
    const fm = YAML.parse(raw.split("---\n")[1]);
    return { file, raw, type: "lore", fm };
}

/** Every finding the lint makes of a note. */
function lint(note: ReturnType<typeof culture>) {
    return lintNote(note as any, { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY } as any);
}

/** The 1-based position of a literal in a note's raw text. */
function at(raw: string, literal: string, occurrence = 1) {
    let index = -1;
    for (let i = 0; i < occurrence; i++) index = raw.indexOf(literal, index + 1);
    const before = raw.slice(0, index).split("\n");
    return { line: before.length, column: (before.at(-1) as string).length + 1 };
}

describe("a culture's appearance profile", () => {
    it("draws its keys from the being-look vocabulary", () => {
        expect([...PROFILE_LOOK_KEYS].sort()).toEqual(
            Object.keys(BEING_LOOK_VOCABULARY)
                .filter((name) => name !== "gender")
                .map((name) => name.split(".").at(-1))
                .sort(),
        );
        expect(REQUIRED_HEIGHT_GENDERS.every((g: string) => wordsOf("gender").includes(g))).toBe(
            true,
        );
    });

    it("is accepted when every word and range is well formed", () => {
        expect(lint(culture(profileLines()))).toEqual([]);
    });

    it("refuses a word outside the vocabulary at the word, naming what it meant", () => {
        const note = culture(
            profileLines({ eye_color: "        eye_color: { brown: 6, dark_browm: 3 }" }),
        );
        const findings = lint(note);
        expect(findings).toHaveLength(1);
        const pos = at(note.raw, "dark_browm");
        expect(formatDiagnostic(findings[0])).toMatch(
            new RegExp(`^${file}:${pos.line}:${pos.column}: error: `),
        );
        expect(findings[0].message).toContain("data.appearanceProfile.eye_color");
        expect(findings[0].message).toContain('"dark_browm"');
        expect(findings[0].message).toContain('Did you mean "dark_brown"?');
    });

    it("refuses a word from another field's list", () => {
        const findings = lint(
            culture(profileLines({ hair_color: "        hair_color: { black: 6, tawny: 2 }" })),
        );
        expect(findings.map((f: any) => f.message)).toEqual([expect.stringContaining('"tawny"')]);
    });

    it("refuses a weight that is not a positive number, at the weight", () => {
        for (const bad of ["-1", "0", "lots"]) {
            const note = culture(
                profileLines({ frame: `        frame: { light: 2, medium: ${bad} }` }),
            );
            const findings = lint(note);
            expect(findings, bad).toHaveLength(1);
            const pos = at(note.raw, `medium: ${bad}`);
            expect(findings[0], bad).toMatchObject({
                line: pos.line,
                column: pos.column + "medium: ".length,
                severity: "error",
            });
            expect(findings[0].message, bad).toContain("data.appearanceProfile.frame.medium");
        }
    });

    it("refuses a word map with no words", () => {
        const findings = lint(culture(profileLines({ complexion: "        complexion: {}" })));
        expect(findings.map((f: any) => f.message)).toEqual([
            expect.stringMatching(/data\.appearanceProfile\.complexion.*at least one word/),
        ]);
    });

    it("refuses a profile missing a word map or a required height range", () => {
        const noSkin = lint(culture(profileLines({ skin_color: "" })));
        expect(noSkin.map((f: any) => f.message)).toEqual([
            expect.stringMatching(/data\.appearanceProfile.*must state `skin_color`/),
        ]);
        const noMale = lint(
            culture(
                profileLines({
                    height: [
                        "        height:",
                        "            female:",
                        "                min: 4' 11\"",
                        "                max: 5' 8\"",
                    ].join("\n"),
                }),
            ),
        );
        expect(noMale.map((f: any) => f.message)).toEqual([
            expect.stringMatching(/data\.appearanceProfile\.height.*`male`/),
        ]);
    });

    it("refuses a height range that is unreadable, reversed or keyed by no gender", () => {
        const range = (gender: string, min: string, max: string) =>
            [
                "        height:",
                "            female:",
                "                min: 4' 11\"",
                "                max: 5' 8\"",
                `            ${gender}:`,
                `                min: ${min}`,
                `                max: ${max}`,
            ].join("\n");
        const unreadable = lint(culture(profileLines({ height: range("male", "tall", "6' 3\"") })));
        expect(unreadable.map((f: any) => f.message)).toEqual([
            expect.stringMatching(/data\.appearanceProfile\.height\.male\.min.*metres or feet/),
        ]);
        const reversed = lint(culture(profileLines({ height: range("male", "6' 3\"", "5' 4\"") })));
        expect(reversed.map((f: any) => f.message)).toEqual([
            expect.stringMatching(/data\.appearanceProfile\.height\.male.*min.*above.*max/),
        ]);
        const notGender = lint(
            culture(
                profileLines({
                    height:
                        range("male", "5' 4\"", "6' 3\"") +
                        "\n            femal:\n                min: 5' 4\"\n                max: 6' 3\"",
                }),
            ),
        );
        expect(notGender.map((f: any) => f.message)).toEqual([
            expect.stringMatching(/"femal".*Did you mean "female"\?/),
        ]);
    });

    it("refuses a profile on lore that is not a culture", () => {
        const findings = lint(culture(profileLines(), "custom"));
        expect(findings.map((f: any) => f.message)).toEqual([
            expect.stringMatching(/data\.appearanceProfile.*`culture`/),
        ]);
    });
});

describe("the frame's sense of weight", () => {
    it("gives every frame word a body-mass band, lightest to heaviest and contiguous", () => {
        const frames = wordsOf("frame");
        expect(Object.keys(FRAME_MASS_INDEX)).toEqual(frames);
        frames.forEach((frame: string, i: number) => {
            const [low, high] = (FRAME_MASS_INDEX as any)[frame];
            expect(low, frame).toBeLessThan(high);
            if (i > 0) expect(low, frame).toBe((FRAME_MASS_INDEX as any)[frames[i - 1]][1]);
        });
    });
});
