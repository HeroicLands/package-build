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

/** Frontmatter shapes for executable encoding documents. */
const text = (name, describe, required = false) => ({
    name,
    kind: "string",
    shape: "a string",
    describe,
    required,
});
const fixed = (name, value) => ({
    ...text(name, `Required value: ${JSON.stringify(value)}.`, true),
    kind: typeof value === "boolean" ? "boolean" : "string",
    shape: JSON.stringify(value),
    ...(typeof value === "string" ? { allowed: [value] } : {}),
});
const block = (name, describe, fields) => ({ name, kind: "map", shape: "a map", describe, fields });
const sequence = {
    kind: "string-or-list",
    shape: "a glyph code or list of codes (empty only with canonical round trips)",
    entries: {
        kind: "string",
        shape: "a glyph code",
        describe: "A code published by the selected font.",
    },
};
/** Closed nested keys, also documented by the generated note reference. */
export const ENCODING_RULE_FIELDS = Object.freeze([
    fixed("normalization", "NFC"),
    fixed("matching", "longest-first"),
    {
        ...text(
            "roundTrip",
            "Exact by default; canonical permits aliases and empty code sequences and decodes an authored conventional spelling.",
        ),
        allowed: ["exact", "canonical"],
    },
    {
        name: "word-separators",
        kind: "list",
        shape: "a list of nonempty NFC source sequences",
        entries: {
            kind: "string",
            shape: "a word separator",
            describe: "A source sequence that writes the shared word space.",
        },
        describe:
            "Source word dividers written as shared spaces, after contextual alternatives; cannot also be ordinary mappings or replace shared punctuation.",
    },
    block("case", "Case handling for letters and consonant groups.", [
        fixed("single-letter", "preserve"),
        fixed("consonant-group", "lowercase-or-initial-uppercase"),
        fixed("other-group-cases", "forbidden"),
    ]),
    block("stress", "The font's nonprinting stress modifier after an acute vowel.", [
        text("modifier", "The font code for U+E0114.", true),
        fixed("position", "after-stressed-vowel"),
        fixed("printing", false),
        fixed("effect", "stress-only"),
        fixed("changes-sound", false),
        fixed("changes-length", false),
        fixed("vowel-group-position", "first-vowel"),
    ]),
    block("vowel-groups", "Explicit recognized vowel groups and their acute placement.", [
        fixed("reading", "established"),
        fixed("allow-splitting", false),
        fixed("unrecognized-adjacent-vowels", "separate"),
        {
            name: "groups",
            kind: "list",
            shape: "a list of vowel groups",
            required: true,
            entries: {
                kind: "string",
                shape: "a lowercase vowel sequence",
                describe: "One recognized sequence of declared unaccented vowels.",
            },
            describe: "The complete authored group inventory.",
        },
    ]),
    ...["diaeresis", "grave-accent"].map((name) =>
        block(name, `Whether ${name} mappings are allowed.`, [
            {
                name: "allowed",
                kind: "boolean",
                shape: "true or false",
                required: true,
                describe:
                    "False forbids the accent; true permits explicitly mapped and accepted characters.",
            },
        ]),
    ),
    {
        name: "contextual-mappings",
        kind: "list",
        shape: "a list of conditional mappings",
        describe:
            "Alternatives conditioned on the following letter or source position, applied before unconditional mappings.",
        entries: {
            kind: "map",
            shape: "a contextual mapping",
            fields: [
                text("match", "The source sequence.", true),
                {
                    ...text("before", "Match before a declared vowel or another letter."),
                    allowed: ["vowel", "consonant"],
                },
                {
                    ...text("at", "Match at word start, word end or line start."),
                    allowed: ["start", "end", "line-start"],
                },
                {
                    name: "emit",
                    ...sequence,
                    required: true,
                    describe: "The font codes written by this alternative.",
                },
            ],
        },
    },
    block("y", "The consonant reading of y.", [
        fixed("kind", "consonant"),
        fixed("sound", "y in yes"),
        fixed("vowel-reading", false),
    ]),
]);
/** The additional data keys a document may use to define its encoding. */
export const ENCODING_NOTE_FIELDS = Object.freeze([
    {
        ...text("language", "The configured language alias an encoding document writes."),
        shape: "a configured language alias",
    },
    {
        ...text("font", "The encoding's installed font, which supplies all glyph codes."),
        shape: "an installed font slug",
    },
    {
        name: "accepts",
        kind: "list",
        shape: "a list of characters or ranges",
        entries: {
            kind: "string",
            shape: "characters or a range",
            describe: "Accepted Roman characters or a range.",
        },
        describe: "Accepted Roman letters and additions to standard punctuation.",
    },
    text("vowels", "The letters a contextual vowel match reads as vowels."),
    {
        name: "mappings",
        kind: "map",
        shape: "Roman strings to glyph codes",
        values: {
            ...sequence,
            describe: "The font code or sequence written for this Roman string.",
        },
        describe: "Roman source strings mapped to codes published by the selected font.",
    },
    {
        name: "rules",
        kind: "map",
        shape: "the closed encoding rules vocabulary",
        fields: ENCODING_RULE_FIELDS,
        describe:
            "Executable normalization, matching, case, stress, vowel groups, accents and contextual mappings.",
    },
]);
