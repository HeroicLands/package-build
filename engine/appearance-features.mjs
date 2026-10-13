/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE.md file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **What a being's `data.appearance.extra_features` admits.**
 *
 * Each entry is a short plain description of one visible physical mark: a
 * scar, a missing finger, a tattoo, a limp. The closed look fields carry
 * everything else, so an entry is refused when it states:
 *
 * - **a colour or skin condition** — a hair colour beside the word `hair`, an
 *   eye colour beside `eye` or `eyes`, a skin colour beside `skin` or
 *   `complexion`, or a skin condition. These belong in `hair_color`,
 *   `eye_color`, `skin_color` and `complexion`. The colour and condition words
 *   are the being-look vocabulary's own, read at run time, plus the spellings
 *   in {@link COLOUR_VARIANTS} and {@link CONDITION_PHRASES}. A localised mark
 *   that only mentions skin — a burn scar on the forearm — is a mark;
 * - **anything that is not a physical mark** — the categories of
 *   {@link NON_PHYSICAL_FEATURES}: gear, clothing or a weapon; a voice or
 *   speech; behaviour, manner or temperament; an impression; handedness; sterility; an
 *   apparent-age reading;
 * - **punctuation** — any punctuation or symbol character, apart from a hyphen
 *   or an apostrophe standing between two letters (`ink-stained fingers`, `a
 *   lion's mane`). A long punctuated entry is several facts, or a labelled one,
 *   where a single mark belongs.
 *
 * @module
 */

import { isPlainMap } from "./data-keys.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";

/** A vocabulary word as an author writes it: `dark_brown` is "dark brown" or "dark-brown". */
const phrase = (word) => word.replaceAll("_", "[ -]");

/** A case-insensitive whole-word alternation. */
const anyOf = (alternatives) => new RegExp(`\\b(?:${alternatives.join("|")})\\b`, "iu");

/**
 * Hair and eye colour spellings the vocabulary does not take but an author
 * writes, as regular-expression alternatives. Beside `hair` or `eyes` any of
 * them, or any hair or eye colour word, states a colour.
 */
export const COLOUR_VARIANTS = Object.freeze([
    "gr[ae]y(?:ing|ed)?",
    "blond",
    "ginger",
    "milky",
    "yellow",
    "gold(?:en)?",
    "pink",
    "orange",
    "purple",
    "copper",
    "mixed",
    "streaked",
    "dyed",
]);

/**
 * Skin-condition phrasings that are not complexion words, as
 * regular-expression alternatives. Any of them states a complexion.
 */
export const CONDITION_PHRASES = Object.freeze([
    "freckles",
    "pox marks?",
    "pocked",
    "pitted skin",
    "acne",
    "pimples",
    "sunburn",
    "wrinkles",
    "pallid",
    "flushed",
    "weather-beaten",
]);

/**
 * Complexion words with an everyday sense beyond the skin: refused when the
 * entry is the word alone, or names the skin and describes no mark.
 */
const BROAD_CONDITIONS = Object.freeze(["scarred", "rough", "clear", "smooth", "oily", "wan"]);

/** An entry describing one of these is a physical mark, whatever else it mentions. */
const MARK =
    /\b(?:tattoos?|tatoo|scars?|scarred|scarring|scarification|brand(?:ed)?|birthmark|burn marks?|pox marks?)\b/iu;

const SKIN = /\b(?:skin|complexion|complected)\b/iu;

/**
 * The terms that make an `extra_features` entry something other than a
 * physical mark, by category, as case-insensitive whole-word patterns.
 *
 * `exemptMarks` lets an entry describing a tattoo, scar, brand or burn mark
 * pass the category, so "a tattoo of a knight's helmet" stands while "wears a
 * helmet" does not. The voice, impression, handedness, sterility and age
 * categories admit no such exemption: "a beautiful tattoo of a crane" is
 * refused.
 *
 * @type {ReadonlyArray<{rule: string, category: string, pattern: RegExp, exemptMarks: boolean}>}
 */
export const NON_PHYSICAL_FEATURES = Object.freeze([
    {
        rule: "gear",
        category: "gear, clothing or a weapon",
        pattern: anyOf([
            "wears?",
            "worn",
            "wearing",
            "carr(?:ies|ied|ying)(?! (?:him|her|them|it)self)",
            "cloak(?:ed|s)?",
            "clothing",
            "clothes",
            "robes?",
            "vestments",
            "tunic",
            "mail",
            "armou?r",
            "shirt",
            "axe",
            "sword",
            "dagger",
            "staff",
            "bag",
            "chain",
            "cord",
            "thong",
            "boots?",
            "hat",
            "helm(?:et)?",
            "ring",
            "amulet",
            "pendant",
            "belt",
            "weapons?",
            "garb",
            "dress(?:ed|es)?",
            "gloves?",
        ]),
        exemptMarks: true,
    },
    {
        rule: "voice",
        category: "a voice or speech",
        pattern: anyOf([
            "voice",
            "speech",
            "speaks?",
            "spoken",
            "accent",
            "lisp",
            "stutter\\w*",
            "stammer\\w*",
            "whisper\\w*",
            "tone",
            "laugh\\w*",
            "sings?",
            "singing",
        ]),
        exemptMarks: false,
    },
    {
        rule: "behaviour",
        category: "behaviour, manner or temperament",
        pattern: anyOf([
            "moves?",
            "moving",
            "fidgets?",
            "smil\\w+",
            "grin\\w*",
            "scowl\\w*",
            "frown\\w*",
            "gaze",
            "stares?",
            "glare\\w*",
            "poise",
            "bearing",
            "demeanou?r",
            "manner",
            "habits?",
            "grooming",
            "expressive",
            "intensity",
            "shakes?",
            "air of",
            "carr(?:y|ies|ied|ying) (?:him|her|them|it)self",
            "hyperactive",
            "restless\\w*",
            "jitter\\w*",
            "twitch\\w*",
            "nervous\\w*",
            "anxious\\w*",
            "energetic",
            "lively",
            "cheerful",
            "sullen",
            "shy",
            "calm",
            "placid",
            "fidgety",
        ]),
        exemptMarks: true,
    },
    {
        rule: "impression",
        category: "an impression rather than a mark",
        pattern: anyOf([
            "beautiful",
            "handsome",
            "attractive",
            "ugly",
            "imposing",
            "menacing",
            "unnerv\\w+",
            "disarming",
            "commanding",
            "presence",
            "authority",
            "pretty",
            "lovely",
            "gorgeous",
            "stunning",
            "comely",
            "homely",
            "hideous",
            "striking\\w*",
            "alluring",
            "dashing",
            "rugged",
            "elegant\\w*",
            "grace\\w*",
            "feminine",
            "masculine",
            "girly",
            "good looks",
        ]),
        exemptMarks: false,
    },
    {
        rule: "handedness",
        category: "handedness",
        pattern: /\b(?:left|right)[- ]handed\b|\bambidextrous\b|\bhandedness\b|\bsouthpaw\b/iu,
        exemptMarks: false,
    },
    {
        rule: "sterility",
        category: "sterility",
        pattern: anyOf(["steril\\w*", "infertil\\w*", "barren", "childless"]),
        exemptMarks: false,
    },
    {
        rule: "age",
        category: "an apparent-age reading",
        pattern: anyOf([
            "look(?:s|ing)? (?:younger|older|young|old)",
            "younger than",
            "older than",
            "appears? (?:\\w+ )?(?:years|young|old)",
            "apparent age",
            "youthful",
            "boyish",
            "girlish",
            "childlike",
            "ageless",
            "elderly",
        ]),
        exemptMarks: false,
    },
]);

/** A hyphen or an apostrophe standing between two letters, which an entry may carry. */
const JOINER = /(?<=\p{L})[-‐'’](?=\p{L})/gu;

/** Any punctuation or symbol character. */
const PUNCTUATION = /[\p{P}\p{S}]/gu;

/**
 * The punctuation an entry carries, a hyphen or apostrophe between letters
 * excepted.
 *
 * @param {string} entry - The entry as written.
 * @returns {string[]} Each distinct character, in order of appearance.
 */
export function featurePunctuation(entry) {
    return [...new Set(entry.replace(JOINER, "").match(PUNCTUATION) ?? [])];
}

/** The colour and condition patterns, built once per vocabulary. */
const patterns = new WeakMap();

/**
 * The colour and condition patterns of one being-look vocabulary.
 *
 * @param {Readonly<Record<string, readonly {value: string}[]>>} look
 * @returns {{colour: RegExp, skin: RegExp, condition: RegExp, broad: RegExp, bareBroad: RegExp}}
 */
function lookPatterns(look) {
    let built = patterns.get(look);
    if (built) return built;
    const words = (field) => (look[field] ?? []).map(({ value }) => value);
    const complexion = words("appearance.complexion");
    const broad = BROAD_CONDITIONS.filter((word) => complexion.includes(word));
    built = {
        colour: anyOf(
            [...new Set([...words("appearance.hair_color"), ...words("appearance.eye_color")])]
                .map(phrase)
                .concat(COLOUR_VARIANTS),
        ),
        skin: anyOf(words("appearance.skin_color").map(phrase)),
        condition: anyOf([
            ...complexion.filter((word) => !broad.includes(word)).map(phrase),
            ...CONDITION_PHRASES,
        ]),
        broad: anyOf(broad.map(phrase)),
        bareBroad: new RegExp(`^(?:${broad.map(phrase).join("|")})$`, "iu"),
    };
    patterns.set(look, built);
    return built;
}

/**
 * Why an `extra_features` entry is not a short plain description of one
 * physical mark.
 *
 * @param {string} entry - The entry as written.
 * @param {Readonly<Record<string, readonly {value: string}[]>>} look - The
 *   being-look vocabulary.
 * @returns {Array<{rule: string, message: string}>} One problem per rule the
 *   entry breaks; empty when it is a mark. `rule` is `hair-colour`,
 *   `eye-colour`, `skin-colour`, `complexion`, `punctuation`, or a rule of
 *   {@link NON_PHYSICAL_FEATURES}.
 */
export function featureProblems(entry, look) {
    const p = lookPatterns(look);
    const has = (re) => re.test(entry);
    const isMark = has(MARK);
    const problems = [];
    if (has(/\bhair\b/iu) && has(p.colour))
        problems.push({
            rule: "hair-colour",
            message: "states a hair colour, which belongs in `appearance.hair_color`",
        });
    if (has(/\beyes?\b/iu) && has(p.colour))
        problems.push({
            rule: "eye-colour",
            message: "states an eye colour, which belongs in `appearance.eye_color`",
        });
    if (has(SKIN) && has(p.skin))
        problems.push({
            rule: "skin-colour",
            message: "states a skin colour, which belongs in `appearance.skin_color`",
        });
    if (
        has(p.condition) ||
        p.bareBroad.test(entry.trim()) ||
        (has(p.broad) && has(SKIN) && !isMark)
    )
        problems.push({
            rule: "complexion",
            message: "states a skin condition, which belongs in `appearance.complexion`",
        });
    for (const { rule, category, pattern, exemptMarks } of NON_PHYSICAL_FEATURES) {
        if (exemptMarks && isMark) continue;
        if (has(pattern))
            problems.push({ rule, message: `names ${category}, which is not a physical mark` });
    }
    const marks = featurePunctuation(entry);
    if (marks.length)
        problems.push({
            rule: "punctuation",
            message:
                "carries punctuation " +
                marks.map((mark) => `\`${mark}\``).join(" ") +
                "; an extra feature is a short plain description of one visible mark, " +
                "with no punctuation but a hyphen or apostrophe inside a word",
        });
    return problems;
}

/**
 * The frontmatter lint's check of `data.appearance.extra_features`.
 *
 * @param {object} note - The note: `file`, `raw` and parsed `fm`.
 * @param {Readonly<Record<string, readonly {value: string}[]>>} look - The
 *   being-look vocabulary.
 * @returns {object[]} Error findings, each located at the entry at fault.
 */
export function checkExtraFeatures(note, look) {
    const appearance = note?.fm?.data?.appearance;
    if (!isPlainMap(appearance)) return [];
    const features = appearance.extra_features;
    if (!Array.isArray(features)) return [];
    const raw = note.raw ?? "";
    const findings = [];
    features.forEach((entry, index) => {
        if (typeof entry !== "string") return;
        const path = ["data", "appearance", "extra_features", index];
        for (const { message } of featureProblems(entry, look)) {
            findings.push({
                file: note.file,
                ...positionOfFrontmatterPath(raw, path),
                severity: "error",
                message: `\`data.appearance.extra_features[${index}]\` ${message}, but reads ${JSON.stringify(entry)}`,
            });
        }
    });
    return findings;
}
