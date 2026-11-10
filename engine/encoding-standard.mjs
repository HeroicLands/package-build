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

/** Shared Roman punctuation and invisible structural controls for every encoding. */
export const STANDARD_ROWS = Object.freeze(
    [
        [".", "\u{E0100}"],
        ["?", "\u{E0101}"],
        ["‼", "\u{E0102}"],
        ["!", "\u{E0103}"],
        { from: "^", to: "\u{E0104}", at: "line-start" },
        [",", "\u{E0105}"],
        ["«", "\u{E0106}"],
        ["»", "\u{E0107}"],
        ["‹", "\u{E0108}"],
        ["›", "\u{E0109}"],
        ["—", "\u{E010A}"],
        ["…", "\u{E010B}"],
        ["/", "\u{E010C}"],
        ["\\/", "\u{E010F}"],
        ["{", "\u{E0110}"],
        ["}", "\u{E0111}"],
    ].map(Object.freeze),
);
/** Controls belong to the engine and never come from font encoding files. */
export const STANDARD_CONTROLS = Object.freeze({
    verseStanza: "\u{E010D}",
    verseCanto: "\u{E010E}",
    wordSeparator: " ",
    literalOpen: "\u{E0112}",
    literalClose: "\u{E0113}",
    literalEscape: "\u{E0115}",
});

/** Shared sound metadata. Keys are IPA values, never positions in the guide. */
const SOUND_ALLOCATION = Object.freeze([
    ["a", "ɑ", 0xe0118, "vowel"],
    ["e", "ɛ", 0xe0119, "vowel"],
    ["i", "i", 0xe011a, "vowel"],
    ["o", "o", 0xe011b, "vowel"],
    ["u", "u", 0xe011c, "vowel"],
    ["à", "æ", 0xe011d, "short vowel"],
    ["ì", "ɪ", 0xe011e, "short vowel"],
    ["ò", "ʌ", 0xe011f, "short vowel"],
    ["ù", "ʊ", 0xe0120, "short vowel"],
    ["ai", "aɪ", 0xe0121, "vowel pair"],
    ["au", "aʊ", 0xe0122, "vowel pair"],
    ["ei", "eɪ", 0xe0123, "vowel pair"],
    ["oi", "ɔɪ", 0xe0124, "vowel pair"],
    ["ou", "oʊ", 0xe0125, "vowel pair"],
    ["iy", "ij", 0xe0126, "vowel pair"],
    ["uy", "uj", 0xe0127, "vowel pair"],
    ["aa", "ɑː", 0xe0128, "long vowel"],
    ["ii", "iː", 0xe0129, "long vowel"],
    ["uu", "uː", 0xe012a, "long vowel"],
    ["b", "b", 0xe012b, "consonant"],
    ["d", "d", 0xe012c, "consonant"],
    ["f", "f", 0xe012d, "consonant"],
    ["h", "h", 0xe012e, "consonant"],
    ["l", "l", 0xe012f, "consonant"],
    ["m", "m", 0xe0130, "consonant"],
    ["n", "n", 0xe0131, "consonant"],
    ["p", "p", 0xe0132, "consonant"],
    ["s", "s", 0xe0133, "consonant"],
    ["t", "t", 0xe0134, "consonant"],
    ["v", "v", 0xe0135, "consonant"],
    ["w", "w", 0xe0136, "consonant"],
    ["z", "z", 0xe0137, "consonant"],
    ["g", "ɡ", 0xe0138, "consonant"],
    ["k", "k", 0xe0139, "consonant"],
    ["ch", "tʃ", 0xe013a, "consonant"],
    ["sh", "ʃ", 0xe013b, "consonant"],
    ["th", "θ", 0xe013c, "consonant"],
    ["dh", "ð", 0xe013d, "consonant"],
    ["kh", "x", 0xe013e, "consonant"],
    ["gh", "ɣ", 0xe013f, "consonant"],
    ["zh", "ʒ", 0xe0140, "consonant"],
    ["j", "dʒ", 0xe0141, "consonant"],
    ["y", "j", 0xe0142, "consonant"],
    ["q", "q", 0xe0143, "consonant"],
    ["ts", "ts", 0xe0144, "consonant"],
    ["ny", "ɲ", 0xe0145, "consonant"],
    ["ng", "ŋ", 0xe0146, "consonant"],
    ["r", "r", 0xe0147, "consonant"],
    ["'", "ʔ", 0xe0148, "catch"],
]);

/** Every sound has a canonical Roman spelling, IPA, and shared invisible form. */
export const SHARED_SOUNDS = Object.freeze(
    Object.fromEntries(
        SOUND_ALLOCATION.map(([roman, ipa, codepoint, kind]) => [
            ipa,
            Object.freeze({
                roman,
                ipa,
                kind,
                code: `SOUND_${roman === "'" ? "CATCH" : roman.normalize("NFD").replace("\u0300", "_GRAVE").toUpperCase()}`,
                invisible: String.fromCodePoint(codepoint),
            }),
        ]),
    ),
);

/** Metadata characters shared by sound-script encodings. */
export const SHARED_SOUND_CONTROLS = Object.freeze({
    stress: "\u{E0114}",
    legacyShort: "\u{E0116}",
    compoundBoundary: "\u{E0117}",
    toneRising: "\u{E0149}",
    toneFalling: "\u{E014A}",
});

/** Font aliases for the shared sound and metadata characters. */
export const SHARED_SOUND_CODES = Object.freeze({
    ...Object.fromEntries(
        Object.values(SHARED_SOUNDS).map((sound) => [sound.code, sound.invisible]),
    ),
    STRESS: SHARED_SOUND_CONTROLS.stress,
    SHORT: SHARED_SOUND_CONTROLS.legacyShort,
    COMPOUND_BOUNDARY: SHARED_SOUND_CONTROLS.compoundBoundary,
    TONE_RISING: SHARED_SOUND_CONTROLS.toneRising,
    TONE_FALLING: SHARED_SOUND_CONTROLS.toneFalling,
});

/**
 * Check guide sound rows or a language’s canonical spelling references against the registry.
 * Returns findings so a consumer can report them at the guide's own location.
 */
export function validateGuideSounds(letters) {
    if (!Array.isArray(letters)) return ["data.sounds.letters must be an array"];
    const findings = [];
    const seenIpa = new Set();
    const seenRoman = new Set();
    for (const [index, value] of letters.entries()) {
        const selected =
            typeof value === "string" ?
                Object.values(SHARED_SOUNDS).find((sound) => sound.roman === value)
            :   undefined;
        if (typeof value === "string" && !selected) {
            findings.push(`data.sounds.letters[${index}] is not a shared guide spelling: ${value}`);
            continue;
        }
        const row =
            selected ?
                { letters: [selected.roman], ipa: selected.ipa, kind: selected.kind }
            :   value;
        const ipa = row?.ipa;
        const spellings = row?.letters;
        if (
            typeof ipa !== "string" ||
            !ipa ||
            !Array.isArray(spellings) ||
            spellings.length !== 1 ||
            typeof spellings[0] !== "string"
        ) {
            findings.push(`data.sounds.letters[${index}] needs one Roman spelling and IPA`);
            continue;
        }
        const roman = spellings[0];
        if (seenIpa.has(ipa)) findings.push(`data.sounds.letters[${index}] repeats IPA /${ipa}/`);
        if (seenRoman.has(roman))
            findings.push(`data.sounds.letters[${index}] repeats Roman ${roman}`);
        seenIpa.add(ipa);
        seenRoman.add(roman);
        const shared = SHARED_SOUNDS[ipa];
        if (!shared)
            findings.push(
                `data.sounds.letters[${index}] has no shared invisible form for /${ipa}/`,
            );
        else if (shared.roman !== roman)
            findings.push(
                `data.sounds.letters[${index}] spells /${ipa}/ as ${roman}, not ${shared.roman}`,
            );
        else if (row.kind !== shared.kind)
            findings.push(
                `data.sounds.letters[${index}] classifies ${roman} as ${row.kind}, not the guide's ${shared.kind}`,
            );
    }
    return findings;
}
