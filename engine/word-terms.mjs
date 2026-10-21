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
 * The inner keys of a language note's words, fields and affixes, and of a
 * culture's or an affiliation's glossary entries, as inner-key declarations.
 *
 * A leaf module, importing nothing: the note vocabulary reads these
 * declarations as it loads, and the checks that judge what the values mean —
 * a class against the master word classes, a field against the note's own
 * fields — live in `language-words.mjs` and `glossary-entries.mjs`.
 *
 * @module
 */

/** The `skill` subType whose notes are languages, and the only one with words. */
export const LANGUAGE_SUBTYPE = "language";

/** The `data` keys a language note states its words in, beside `names`. */
export const WORD_DATA_KEYS = Object.freeze(["classModifiers", "fields", "words", "affixes"]);

/**
 * Where a word comes from. `borrowed` names the tongue it was taken from;
 * `inherited`, `kept` and `worn` name the ancient form where the note gives
 * one; `coined`, `substrate` and `island` name no form.
 */
export const WORD_SOURCE_KINDS = Object.freeze([
    "inherited",
    "borrowed",
    "kept",
    "worn",
    "coined",
    "substrate",
    "island",
]);

/**
 * What an affix makes: a case, a word derived from another, a verb's tense,
 * aspect, mood or voice, a given name's ending, or a lineage name's ending.
 */
export const AFFIX_KINDS = Object.freeze([
    "case",
    "derivation",
    "tense",
    "aspect",
    "mood",
    "voice",
    "name",
    "lineage",
]);

/** The affix kind whose ending says who the name is given to. */
export const NAME_AFFIX_KIND = "name";

/** How a zero affix is written where a table prints it. */
export const ZERO_AFFIX = "∅";

/** Who a given name's ending is given to. */
export const AFFIX_GIVEN = Object.freeze(["man", "woman", "either"]);

/** The source kind that requires `language`. */
export const BORROWED_SOURCE_KIND = "borrowed";

/**
 * The keys of a word's `source`.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const WORD_SOURCE_FIELDS = Object.freeze([
    Object.freeze({
        name: "kind",
        kind: "string",
        required: true,
        allowed: WORD_SOURCE_KINDS,
        shape: `one of ${WORD_SOURCE_KINDS.join(", ")}`,
        describe: "How the word came into the tongue.",
    }),
    Object.freeze({
        name: "language",
        kind: "address",
        shape: "a language skill Address",
        describe: "The tongue the word was borrowed from; required for `borrowed`.",
    }),
    Object.freeze({
        name: "form",
        kind: "string",
        shape: "a string",
        describe: "The form the word had in its source, bare.",
    }),
]);

/**
 * The keys of one entry of a word's `native`.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const WORD_NATIVE_FIELDS = Object.freeze([
    Object.freeze({
        name: "map",
        kind: "string",
        required: true,
        shape: "a mapping note's `data.map.name`",
        describe: "The map the native form is written for.",
    }),
    Object.freeze({
        name: "font",
        kind: "string",
        shape: "a face the map lists",
        describe:
            "The one face the native form is for; unstated, it is for every face the map lists, " +
            "and a form stated for a face wins over it there.",
    }),
    Object.freeze({
        name: "text",
        kind: "string",
        required: true,
        shape: "the word in the script, as the map's characters",
        describe:
            "The word as the script writes it, where the map's rows would write it otherwise.",
    }),
]);

/**
 * The keys one word of a language note's `data.words` carries.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const WORD_FIELDS = Object.freeze([
    Object.freeze({
        name: "form",
        kind: "string",
        required: true,
        shape: "the word as cited, bare",
        describe: "The word as cited, with no backticks.",
    }),
    Object.freeze({
        name: "variants",
        kind: "list",
        shape: "a list of forms",
        entries: Object.freeze({ kind: "string", shape: "a form, bare" }),
        describe:
            "The word's other forms, such as a long form beside a short one; a marked use of " +
            "one cites the word.",
    }),
    Object.freeze({
        name: "name_sort",
        kind: "string",
        shape: "a string",
        describe: "The sort key; the form when unstated.",
    }),
    Object.freeze({
        name: "class",
        kind: "string",
        required: true,
        shape: "a word class, base first, such as `n I f`",
        describe:
            "A class from the master word classes: a base, then the modifiers the language " +
            "declares in `classModifiers`.",
    }),
    Object.freeze({
        name: "plural",
        kind: "string",
        shape: "a string",
        describe:
            "The noun's explicit plural, where it differs from the language's optional plural " +
            "rule. A dictionary uses this form before the rule; no rule agreement is checked.",
    }),
    Object.freeze({
        name: "field",
        kind: "string",
        required: true,
        shape: "one of the language's `fields` names",
        describe: "The field tag beside the dictionary entry, named in the language's `fields`.",
    }),
    Object.freeze({
        name: "gloss",
        kind: "string-or-list",
        required: true,
        shape: "a string, or a list of senses",
        entries: Object.freeze({ kind: "string", shape: "a sense" }),
        describe:
            "The meaning, in brief; a list states one sense per entry, which a dictionary numbers.",
    }),
    Object.freeze({
        name: "source",
        kind: "map",
        shape: "a map — `{ kind, language?, form? }`",
        fields: WORD_SOURCE_FIELDS,
        describe: "Where the word comes from.",
    }),
    Object.freeze({
        name: "built",
        kind: "list",
        shape: "a list of pieces",
        entries: Object.freeze({ kind: "string", shape: "a string" }),
        describe:
            "The pieces the word is built from, in order, as the language's words and affixes " +
            "write them; absent for a root word.",
    }),
    Object.freeze({
        name: "note",
        kind: "string",
        shape: "a string",
        describe:
            "What a source says of the word beyond its pieces, such as a cognate it is read with.",
    }),
    Object.freeze({
        name: "pronunciation",
        kind: "string",
        shape: "a respelling such as `sol-MEH-reh`",
        describe:
            "A respelling in hyphen-separated syllables, the stressed one in capitals: letters, " +
            "apostrophes and hyphens only, and at most one capitalised syllable.",
    }),
    Object.freeze({
        name: "tones",
        kind: "string",
        shape: "a string",
        describe: "A tone pattern, such as `LHL`.",
    }),
    Object.freeze({
        name: "root",
        kind: "string",
        shape: "a string",
        describe: "A consonantal skeleton, such as `d-l-k`.",
    }),
    Object.freeze({
        name: "frame",
        kind: "string",
        shape: "a frame of the language's `sounds.frames`",
        describe: "The frame a root is set in, named in the language's `sounds.frames`.",
    }),
    Object.freeze({
        name: "native",
        kind: "list",
        shape: "a list of `{ map, font?, text }`",
        entries: Object.freeze({
            kind: "map",
            shape: "a map — `{ map, font?, text }`",
            fields: WORD_NATIVE_FIELDS,
        }),
        describe:
            "The word's native form under a map, stated only where the map's rows spell it " +
            "differently. Its derived forms are spelled by the rows.",
    }),
]);

/** The keys of {@link WORD_FIELDS}, in declared order. */
export const WORD_KEYS = Object.freeze(WORD_FIELDS.map((field) => field.name));

/**
 * A word's senses: one for a string gloss, one per entry for a list, each
 * trimmed, blanks dropped.
 *
 * @param {unknown} gloss - The word's `gloss`.
 * @returns {string[]} The senses, in order.
 */
export function glossSenses(gloss) {
    const list = Array.isArray(gloss) ? gloss : [gloss];
    return list
        .filter((sense) => typeof sense === "string")
        .map((sense) => sense.trim())
        .filter(Boolean);
}

/**
 * A word's gloss as one line of text: its senses joined by `; `, or `null`
 * where it states none.
 *
 * @param {unknown} gloss - The word's `gloss`.
 * @returns {string|null}
 */
export function glossText(gloss) {
    const senses = glossSenses(gloss);
    return senses.length ? senses.join("; ") : null;
}

/**
 * The keys one entry of a language note's `data.fields` carries.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const WORD_FIELD_FIELDS = Object.freeze([
    Object.freeze({
        name: "name",
        kind: "string",
        required: true,
        shape: "a string",
        describe: "The field's name, which a word's `field` names.",
    }),
    Object.freeze({
        name: "holds",
        kind: "string",
        required: true,
        shape: "a string",
        describe: "What the field holds.",
    }),
]);

/**
 * The keys one entry of a language note's `data.affixes` carries.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const AFFIX_FIELDS = Object.freeze([
    Object.freeze({
        name: "form",
        kind: "string",
        shape: "the affix as written, such as `-rith`",
        describe: "The affix as a word's `built` names it; absent on a zero affix.",
    }),
    Object.freeze({
        name: "zero",
        kind: "boolean",
        shape: "`true`",
        describe:
            "The affix is written as nothing, such as a case with no ending; it states no " +
            `\`form\`, prints as \`${ZERO_AFFIX}\`, and no \`built\` piece names it.`,
    }),
    Object.freeze({
        name: "kind",
        kind: "string",
        allowed: AFFIX_KINDS,
        shape: `one of ${AFFIX_KINDS.join(", ")}`,
        describe: "What the affix makes.",
    }),
    Object.freeze({
        name: "given",
        kind: "string",
        allowed: AFFIX_GIVEN,
        shape: `one of ${AFFIX_GIVEN.join(", ")}`,
        describe: `Who a given name closing on it belongs to; an affix of kind \`${NAME_AFFIX_KIND}\` only.`,
    }),
    Object.freeze({
        name: "where",
        kind: "string",
        shape: "a string, such as `before a stop`",
        describe: "Where this form stands, for an affix written two ways; everywhere where absent.",
    }),
    Object.freeze({
        name: "gloss",
        kind: "string",
        required: true,
        shape: "a string",
        describe: "What the affix means.",
    }),
    Object.freeze({
        name: "attaches",
        kind: "string",
        shape: "a string",
        describe: "How it attaches, in words, such as `replaces a closing vowel`.",
    }),
    Object.freeze({
        name: "replaces",
        kind: "string",
        shape: "`vowel`, or the letters, such as `a`",
        describe:
            "What it takes the place of at the close of the stem: `vowel` for any closing " +
            "vowel, or the letters it replaces; added to the whole stem where absent.",
    }),
    Object.freeze({
        name: "attachesTo",
        kind: "list",
        shape: "a list of word classes, such as `[n, adj]`",
        entries: Object.freeze({ kind: "string", shape: "a word class, such as `n`" }),
        describe:
            "The word classes it attaches to, by their base; every class where absent. A " +
            "suffix stating `replaces` derives forms of these classes' words alone.",
    }),
    Object.freeze({
        name: "lengthens",
        kind: "boolean",
        shape: "`true` or `false`",
        describe:
            "Whether the stem's last vowel lengthens before the affix; `false` where unstated. An " +
            "affix that `replaces` the stem's close does not also lengthen it.",
    }),
    Object.freeze({
        name: "front",
        kind: "string",
        shape: "the affix as written, such as `-ür`",
        describe: "Its form after front vowels, where the language keeps vowel harmony.",
    }),
    Object.freeze({
        name: "examples",
        kind: "list",
        shape: "a list of strings",
        entries: Object.freeze({ kind: "string", shape: "a string" }),
        describe: "The names the affix is read from.",
    }),
    Object.freeze({
        name: "barredAfter",
        kind: "list",
        shape: "a list of sounds",
        entries: Object.freeze({ kind: "string", shape: "a sound as written" }),
        describe: "The sounds a stem may not close on to take the affix.",
    }),
    Object.freeze({
        name: "tones",
        kind: "string",
        shape: "a tone pattern, such as `L`",
        describe: "The tone pattern the affix carries, written as a word's `tones` is.",
    }),
]);

/** The keys of {@link WORD_FIELD_FIELDS}, in declared order. */
export const FIELD_KEYS = Object.freeze(WORD_FIELD_FIELDS.map((field) => field.name));

/** The keys of {@link AFFIX_FIELDS}, in declared order. */
export const AFFIX_KEYS = Object.freeze(AFFIX_FIELDS.map((field) => field.name));

/**
 * The keys one entry of a culture's or an affiliation's `data.glossary`
 * carries.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const GLOSSARY_ENTRY_FIELDS = Object.freeze([
    Object.freeze({
        name: "name",
        kind: "string",
        required: true,
        shape: "a string",
        describe: "The headword.",
    }),
    Object.freeze({
        name: "name_sort",
        kind: "string",
        shape: "a string",
        describe: "Its sort key; the dictionary word's sort key, or the name, when unstated.",
    }),
    Object.freeze({
        name: "common",
        kind: "boolean",
        shape: "`true` or `false`",
        describe: "Core vocabulary for this glossary's owner; `false` when unstated.",
    }),
    Object.freeze({
        name: "definition",
        kind: "string",
        shape: "a string",
        describe:
            "The sense text, overriding the word's or governance sources' senses. Unstated, " +
            "a named dictionary word supplies all its senses and class; a named rank or office supplies its descriptions.",
    }),
    Object.freeze({
        name: "pronunciation",
        kind: "string",
        shape: "a respelling such as `sol-MEH-reh`",
        describe:
            "A respelling, held to the same rule as a word's; the dictionary word's when unstated.",
    }),
    Object.freeze({
        name: "language",
        kind: "address",
        shape: "a language skill Address",
        describe:
            "The language the term is in. Unstated, it is the affiliation's language, its " +
            "parents', or its culture's, or the culture's own.",
    }),
]);

/** The keys of {@link GLOSSARY_ENTRY_FIELDS}, in declared order. */
export const GLOSSARY_ENTRY_KEYS = Object.freeze(GLOSSARY_ENTRY_FIELDS.map((field) => field.name));

/**
 * Why a pronunciation is not a respelling, or `undefined` when it is one.
 *
 * A respelling is letters and apostrophes in hyphen-separated syllables, with
 * at most one syllable in capitals.
 *
 * @param {string} text
 * @returns {string|undefined}
 */
export function pronunciationProblem(text) {
    const value = String(text ?? "");
    if (!/^[\p{L}\p{M}'’]+(?:-[\p{L}\p{M}'’]+)*$/u.test(value))
        return "a respelling holds letters, apostrophes and hyphens only, as `sol-MEH-reh`";
    const stressed = value
        .split(/-/)
        .filter(
            (syllable) =>
                syllable !== syllable.toLowerCase() && syllable === syllable.toUpperCase(),
        );
    if (stressed.length > 1)
        return `a respelling stresses one syllable, and this capitalises ${stressed.length}`;
    return undefined;
}
