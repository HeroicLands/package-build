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
 * A culture's appearance profile: what its people look like, as weighted words
 * from the closed being-look vocabulary and height ranges by gender.
 *
 * A `lore` note of `subType: culture` states it as `data.appearanceProfile`,
 * and `package-build npc new` draws a person from it. `npc new` refuses a
 * culture that states none.
 *
 * - `frame`, `eye_color`, `hair_color`, `skin_color` and `complexion` each map
 *   a word of that field's vocabulary to a positive weight. A word's chance is
 *   its weight over the sum of the map's weights; a word left out is never
 *   drawn.
 * - `height` maps a gender word to a `{min, max}` range, each a height in
 *   metres or feet and inches. `female` and `male` are required; a gender with
 *   no range of its own draws from the span of every range stated.
 *
 * Weight is not in the profile. It follows from the height drawn and the frame
 * drawn, through {@link FRAME_MASS_INDEX}, so a heavy frame always weighs more
 * than a light one at the same height.
 *
 * This module imports nothing from `note-vocabulary.mjs`, which declares the
 * field and calls {@link checkAppearanceProfile}; the vocabulary is handed in.
 * The two still meet in one import cycle through other modules, so what
 * `note-vocabulary.mjs` reads here while it evaluates is a function, never a
 * `const`.
 *
 * @module
 */

import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { fitsKind, isPlainMap } from "./data-keys.mjs";
import { parseBeingHeight } from "./being-measurements.mjs";
import { nearest } from "./near-miss.mjs";

/** The `lore` subType whose notes may carry a profile. */
export const PROFILE_SUBTYPE = "culture";

/**
 * The genders every profile states a height range for.
 *
 * A function as well as a constant: `note-vocabulary.mjs` reads it while the
 * module graph is still evaluating, before any `const` here is initialised,
 * and a function declaration is bound from the start.
 *
 * @returns {readonly string[]} The genders.
 */
export function requiredHeightGenders() {
    return Object.freeze(["female", "male"]);
}

/** The genders every profile states a height range for. */
export const REQUIRED_HEIGHT_GENDERS = requiredHeightGenders();

/**
 * The body-mass index band, in kg/m², each frame word means, lightest to
 * heaviest. The bands meet end to end, so every weight at a given height falls
 * in exactly one frame.
 *
 * @type {Readonly<Record<string, readonly [number, number]>>}
 */
export const FRAME_MASS_INDEX = Object.freeze({
    scant: Object.freeze([16.5, 19]),
    light: Object.freeze([19, 21.5]),
    medium: Object.freeze([21.5, 24.5]),
    heavy: Object.freeze([24.5, 28]),
    massive: Object.freeze([28, 33]),
});

/**
 * One thing wrong with a profile.
 *
 * @typedef {object} ProfileProblem
 * @property {Array<string|number>} path - Where, from the profile itself.
 * @property {boolean} [key] - The fault is the key at `path`, not its value.
 * @property {boolean} [shape] - The frontmatter lint's inner-key walk reports
 *   this too, from the field's declaration.
 * @property {string} message - What is wrong, naming the full `data.` path.
 */

/** `data.appearanceProfile.<path>`, as a reader writes it. */
function label(path) {
    return ["data.appearanceProfile", ...path].join(".");
}

/** The words of one vocabulary field, by the profile key that names it. */
function wordsFor(lookVocabulary, key) {
    const name = Object.keys(lookVocabulary).find((field) => field.split(".").at(-1) === key);
    return name ? lookVocabulary[name].map(({ value }) => value) : [];
}

/**
 * The profile keys that take weighted words, read from the vocabulary: every
 * being-look field but `gender`, by its last segment.
 *
 * @param {Readonly<Record<string, readonly {value: string}[]>>} lookVocabulary
 * @returns {string[]} The keys, in the vocabulary's order.
 */
export function profileLookKeys(lookVocabulary) {
    return Object.keys(lookVocabulary)
        .filter((field) => field !== "gender")
        .map((field) => /** @type {string} */ (field.split(".").at(-1)));
}

/**
 * Everything wrong with a profile.
 *
 * @param {unknown} profile - The profile as authored.
 * @param {Readonly<Record<string, readonly {value: string}[]>>} lookVocabulary -
 *   The being-look vocabulary.
 * @returns {ProfileProblem[]} The problems, in the order a reader meets them.
 */
export function profileProblems(profile, lookVocabulary) {
    const problems = [];
    const shape = (path, message, key = false) =>
        problems.push({ path, message, shape: true, ...(key ? { key } : {}) });
    const meaning = (path, message, key = false) =>
        problems.push({ path, message, ...(key ? { key } : {}) });

    if (!isPlainMap(profile)) {
        shape([], `\`${label([])}\` should be a map, but reads ${JSON.stringify(profile)}`);
        return problems;
    }
    const lookKeys = profileLookKeys(lookVocabulary);
    const known = [...lookKeys, "height"];
    for (const key of Object.keys(profile)) {
        if (known.includes(key)) continue;
        const guess = nearest(key, known);
        shape(
            [key],
            `"${key}" is not a key of \`data.appearanceProfile\`` +
                (guess ? `. Did you mean "${guess}"?` : ""),
            true,
        );
    }

    for (const key of lookKeys) {
        const weights = profile[key];
        if (weights === undefined || weights === null) {
            shape([], `\`data.appearanceProfile\` must state \`${key}\``, true);
            continue;
        }
        if (!isPlainMap(weights)) {
            shape([key], `\`${label([key])}\` should be a map of words to weights`);
            continue;
        }
        const words = wordsFor(lookVocabulary, key);
        const entries = Object.entries(weights);
        if (!entries.length) {
            meaning(
                [key],
                `\`${label([key])}\` must weight at least one word: ${words.join(", ")}`,
                true,
            );
            continue;
        }
        for (const [word, weight] of entries) {
            if (!words.includes(word)) {
                const guess = nearest(word, words);
                meaning(
                    [key, word],
                    `\`${label([key])}\` names ${JSON.stringify(word)}, which is not a ${key} ` +
                        `word; it takes ${words.join(", ")}` +
                        (guess ? `. Did you mean "${guess}"?` : ""),
                    true,
                );
                continue;
            }
            if (weight === null || !fitsKind(weight, "number")) {
                shape(
                    [key, word],
                    `\`${label([key, word])}\` should be a positive weight, but reads ` +
                        JSON.stringify(weight),
                );
                continue;
            }
            if (!(Number(weight) > 0))
                meaning(
                    [key, word],
                    `\`${label([key, word])}\` should be a positive weight, but reads ` +
                        `${JSON.stringify(weight)}; leave a word out to never draw it`,
                );
        }
    }

    const heights = profile.height;
    if (heights === undefined || heights === null) {
        shape([], "`data.appearanceProfile` must state `height`", true);
        return problems;
    }
    if (!isPlainMap(heights)) {
        shape(["height"], `\`${label(["height"])}\` should be a map of genders to ranges`);
        return problems;
    }
    const genders = wordsFor(lookVocabulary, "gender");
    for (const gender of REQUIRED_HEIGHT_GENDERS) {
        if (heights[gender] === undefined || heights[gender] === null)
            meaning(
                ["height"],
                `\`${label(["height"])}\` must state a range for \`${gender}\``,
                true,
            );
    }
    for (const [gender, range] of Object.entries(heights)) {
        if (!genders.includes(gender)) {
            const guess = nearest(gender, genders);
            meaning(
                ["height", gender],
                `${JSON.stringify(gender)} is not a gender; \`${label(["height"])}\` is keyed by ` +
                    `${genders.join(", ")}` +
                    (guess ? `. Did you mean "${guess}"?` : ""),
                true,
            );
            continue;
        }
        if (range === null || range === undefined) continue;
        if (!isPlainMap(range)) {
            shape(
                ["height", gender],
                `\`${label(["height", gender])}\` should be a {min, max} range`,
            );
            continue;
        }
        const bounds = {};
        for (const end of ["min", "max"]) {
            const value = range[end];
            if (value === undefined || value === null || !fitsKind(value, "string")) {
                shape(
                    value === undefined || value === null ?
                        ["height", gender]
                    :   ["height", gender, end],
                    `\`${label(["height", gender])}\` must state \`${end}\` as a height`,
                    value === undefined || value === null,
                );
                continue;
            }
            const inches = parseBeingHeight(value);
            if (inches === null) {
                meaning(
                    ["height", gender, end],
                    `\`${label(["height", gender, end])}\` needs metres or feet and inches, ` +
                        `such as 1.75m or 5' 9", but reads ${JSON.stringify(value)}`,
                );
                continue;
            }
            bounds[end] = inches;
        }
        if (bounds.min !== undefined && bounds.max !== undefined && bounds.min > bounds.max)
            meaning(
                ["height", gender],
                `\`${label(["height", gender])}\` has its \`min\` above its \`max\``,
                true,
            );
    }
    return problems;
}

/**
 * The frontmatter lint's check of `data.appearanceProfile`.
 *
 * Scoped to a `lore` note of `subType: culture`: on any other lore it is an
 * error at the key. On a culture it reports what the field's declared inner
 * keys cannot: words outside the vocabulary, weights that are not positive, a
 * word map with no words, height ranges that are unreadable, reversed or keyed
 * by no gender, and a missing `female` or `male` range.
 *
 * @param {object} note - The note: `file`, `raw` and parsed `fm`.
 * @param {Readonly<Record<string, readonly {value: string}[]>>} lookVocabulary -
 *   The being-look vocabulary.
 * @returns {object[]} Findings, located at the word, weight or key at fault.
 */
export function checkAppearanceProfile(note, lookVocabulary) {
    const data = note?.fm?.data;
    if (!isPlainMap(data)) return [];
    const profile = data.appearanceProfile;
    if (profile === undefined || profile === null) return [];
    const raw = note.raw ?? "";
    const finding = (path, message, key) => ({
        file: note.file,
        ...positionOfFrontmatterPath(raw, ["data", "appearanceProfile", ...path], { key }),
        severity: "error",
        message,
    });
    const subType = String(note.fm?.subType ?? "").toLowerCase();
    if (subType !== PROFILE_SUBTYPE)
        return [
            finding(
                [],
                "`data.appearanceProfile` describes a culture's people, and this note's " +
                    `\`subType\` is not \`${PROFILE_SUBTYPE}\``,
                true,
            ),
        ];
    return profileProblems(profile, lookVocabulary)
        .filter((problem) => !problem.shape)
        .map((problem) => finding(problem.path, problem.message, Boolean(problem.key)));
}

/**
 * A profile's problems as findings at the culture note that states it, for a
 * caller holding the note but not running the lint.
 *
 * @param {object} note - The culture note: `file`, `raw` and parsed `fm`.
 * @param {Readonly<Record<string, readonly {value: string}[]>>} lookVocabulary -
 *   The being-look vocabulary.
 * @returns {object[]} Every problem, shape included, as findings.
 */
export function profileFindings(note, lookVocabulary) {
    const raw = note?.raw ?? "";
    return profileProblems(note?.fm?.data?.appearanceProfile, lookVocabulary).map((problem) => ({
        ...(note?.file ? { file: note.file } : {}),
        ...positionOfFrontmatterPath(raw, ["data", "appearanceProfile", ...problem.path], {
            key: Boolean(problem.key),
        }),
        severity: "error",
        message: problem.message,
    }));
}
