/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { formatDiagnostic } from "../engine/diagnostics.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { BEING_LOOK_VOCABULARY, NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import {
    NON_PHYSICAL_FEATURES,
    featureProblems,
    featurePunctuation,
} from "../engine/appearance-features.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

/**
 * A being's `data.appearance` as `package-build lint` holds it: `complexion` a
 * required list of complexion words, and `extra_features` only short plain
 * descriptions of visible physical marks. Every rule is exercised through the
 * frontmatter lint, the check an author meets, on a note that breaks it alone.
 */

const file = "assets/content/Beings/Someone.md";

/** A being whose `data.appearance` block is `lines`, indented beneath it. */
function being(lines: string[]) {
    const raw = [
        "---",
        "shortcode: someone",
        'name: { full: "Someone" }',
        "type: being",
        "subType: creature",
        "data:",
        "    frame: medium",
        "    appearance:",
        ...lines.map((line) => `        ${line}`),
        "---",
        "",
        "Someone stands in the road and looks at the travellers as they pass by the inn door.",
        "",
    ].join("\n");
    const fm = YAML.parse(raw.split("---\n")[1]);
    return { file, raw, type: "being", fm };
}

/** The findings the lint reports about a being's appearance. */
function findings(lines: string[]) {
    return lintNote(being(lines), {
        schemas: NOTE_SCHEMAS,
        vocabulary: NOTE_VOCABULARY,
    } as any).filter((f: { message: string }) => f.message.includes("data.appearance"));
}

/** The findings on one `extra_features` entry, beside a valid complexion. */
function onFeature(entry: string) {
    return findings(["complexion: [clear]", "extra_features:", `    - ${JSON.stringify(entry)}`]);
}

/** The rules one entry breaks. */
const rules = (entry: string) =>
    featureProblems(entry, BEING_LOOK_VOCABULARY).map((p: { rule: string }) => p.rule);

const words = (field: string) =>
    (BEING_LOOK_VOCABULARY[field] ?? []).map(({ value }: { value: string }) => value);

const CLEAN = [
    "eye_color: dark_brown",
    "hair_color: black",
    "skin_color: olive",
    "complexion: [weathered, scarred]",
    "extra_features:",
    "    - a burn scar on the left forearm",
    "    - a missing finger",
    "    - a tattoo of a knight's helmet on the shoulder",
    "    - ink-stained fingers",
    "    - walks with a limp",
];

describe("a being's appearance", () => {
    it("passes a clean record", () => {
        const note = being(CLEAN);
        expect(
            lintNote(note, { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY } as any),
        ).toEqual([]);
        expect(findings(["complexion: []"])).toEqual([]);
    });

    describe("complexion", () => {
        it("is required once the being states an appearance", () => {
            const found = findings(["hair_color: black"]);
            expect(found).toHaveLength(1);
            expect(found[0].severity).toBe("error");
            expect(found[0].message).toContain("complexion");
        });

        it("is required even when written as null", () => {
            expect(findings(["complexion: null"])).toHaveLength(1);
            expect(findings(["complexion:"])).toHaveLength(1);
        });

        it("refuses a single word, telling the author to write a list", () => {
            const found = findings(["complexion: clear"]);
            expect(found).toHaveLength(1);
            expect(found[0].message).toMatch(/list/);
            expect(formatDiagnostic(found[0])).toMatch(new RegExp(`^${file}:9:21: error: `));
        });

        it("accepts every complexion word in a list, and refuses any other", () => {
            expect(
                findings([`complexion: [${words("appearance.complexion").join(", ")}]`]),
            ).toEqual([]);
            expect(findings(["complexion: [weathered, tanned]"])).toHaveLength(1);
        });

        it("is declared a list, never one word", () => {
            const declared = NOTE_VOCABULARY.being.data.find(
                (f: { name: string }) => f.name === "appearance.complexion",
            );
            expect(declared.kind).toBe("list");
            expect(declared.required).toBe(true);
        });
    });

    describe("extra_features refuses a colour or skin condition", () => {
        it("refuses the forms an author writes", () => {
            const cases: Record<string, string> = {
                "auburn hair": "hair-colour",
                "brown and black hair": "hair-colour",
                "close cropped grey streaked hair": "hair-colour",
                "red eyes": "eye-colour",
                "milky white eyes": "eye-colour",
                "pale skin": "skin-colour",
                "weathered complexion": "complexion",
                freckled: "complexion",
                "Pox marks": "complexion",
            };
            for (const [entry, rule] of Object.entries(cases)) {
                expect(rules(entry), entry).toEqual([rule]);
                expect(onFeature(entry), entry).toHaveLength(1);
            }
        });

        it("refuses every vocabulary colour beside the feature it colours", () => {
            for (const word of words("appearance.hair_color"))
                expect(rules(`${word.replaceAll("_", " ")} hair`), word).toContain("hair-colour");
            for (const word of words("appearance.eye_color"))
                expect(rules(`${word.replaceAll("_", " ")} eyes`), word).toContain("eye-colour");
            for (const word of words("appearance.skin_color"))
                expect(rules(`${word.replaceAll("_", " ")} skin`), word).toContain("skin-colour");
            for (const word of words("appearance.complexion"))
                expect(rules(word.replaceAll("_", " ")), word).toContain("complexion");
        });

        it("allows a localised mark that only mentions skin", () => {
            for (const entry of [
                "a burn scar on the left forearm",
                "a brand scarred into the skin above the heart",
                "a scar on the left eye",
                "a tattoo of a crown on the chest",
            ]) {
                expect(rules(entry), entry).toEqual([]);
            }
        });
    });

    describe("extra_features refuses what is not a physical mark", () => {
        const cases: Record<string, string> = {
            "a mail shirt kept oiled": "gear",
            "carries a heavy battleaxe": "gear",
            "often wears patterned clothing": "gear",
            "a voice pitched to carry": "voice",
            "speaks with a lisp": "voice",
            "fidgets constantly": "behaviour",
            "moves with quiet precision": "behaviour",
            "an infectious grin": "behaviour",
            hyperactive: "behaviour",
            "a restless twitch in the left eye": "behaviour",
            "startlingly beautiful": "impression",
            "a commanding presence": "impression",
            "a beautiful tattoo of a crane": "impression",
            "striking good looks": "impression",
            graceful: "impression",
            "a childlike face": "age",
            "left handed": "handedness",
            ambidextrous: "handedness",
            sterile: "sterility",
            "a boyish face that makes him look younger": "age",
        };
        for (const [entry, rule] of Object.entries(cases)) {
            it(`refuses ${JSON.stringify(entry)} as ${rule}`, () => {
                expect(rules(entry)).toEqual([rule]);
                const found = onFeature(entry);
                expect(found).toHaveLength(1);
                expect(found[0].severity).toBe("error");
            });
        }

        it("names a category for every rule it exercises", () => {
            const exercised = new Set(Object.values(cases));
            for (const { rule } of NON_PHYSICAL_FEATURES)
                expect(exercised.has(rule), rule).toBe(true);
        });
    });

    describe("extra_features refuses punctuation", () => {
        it("refuses every punctuation character", () => {
            for (const mark of [
                ",",
                ":",
                ";",
                ".",
                "!",
                "?",
                "(",
                ")",
                "[",
                "]",
                '"',
                "“",
                "”",
                "/",
                "&",
                "—",
                "–",
            ]) {
                const entry = `a scar ${mark} on the cheek`;
                expect(rules(entry), mark).toEqual(["punctuation"]);
                expect(featurePunctuation(entry), mark).toEqual([mark]);
            }
        });

        it("refuses a labelled value", () => {
            expect(rules("Scar: left cheek")).toEqual(["punctuation"]);
        });

        it("allows a hyphen or an apostrophe between letters, and nowhere else", () => {
            for (const entry of [
                "ink-stained fingers",
                "deep-set eyes",
                "a lion's mane",
                "a lion’s mane",
            ])
                expect(rules(entry), entry).toEqual([]);
            for (const entry of [
                "a scar - on the cheek",
                "a scar -",
                "the twins' mark",
                "'a scar'",
            ])
                expect(rules(entry), entry).toEqual(["punctuation"]);
        });
    });

    it("admits a visible tremor as a physical mark", () => {
        expect(rules("trembling hands")).toEqual([]);
    });

    it("locates a finding at the offending entry", () => {
        const found = findings([
            "complexion: [clear]",
            "extra_features:",
            "    - a scar",
            "    - pale skin",
        ]);
        expect(found).toHaveLength(1);
        expect(formatDiagnostic(found[0])).toMatch(new RegExp(`^${file}:12:15: error: `));
        expect(found[0].message).toContain("data.appearance.extra_features[1]");
        expect(found[0].message).toContain('"pale skin"');
    });
});
