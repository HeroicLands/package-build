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
 * A language's name lists: how its speakers' names are built, and the names
 * each part is drawn from.
 *
 * A `skill` note of `subType: language` states them as `data.names`, and
 * `package-build npc new` draws a person's name from them, or checks a name it
 * is given against them. A culture reaches them through its language, the
 * note `languages:` names for its `data.lang`, so cultures sharing a tongue
 * share its lists.
 *
 * - `pattern` — the name's shape: placeholders such as `{given}` and `{clan}`,
 *   each naming a list, with literal text around them or directly against
 *   them. `"{given} {clan}"`, `"{family} {given}"`, `"{given} yra {clan}"` and
 *   `"{given} {given.male}sen"` are all patterns. A tongue with several forms
 *   of name states a list of patterns, any one of which a name may take; a
 *   tongue whose forms differ by gender states a map of gender words to a
 *   pattern or a list of them. A gender with no pattern of its own takes every
 *   pattern stated.
 * - `given` — given names, one list per gender word of the closed gender
 *   vocabulary. `female` and `male` are required. `{given}` draws from the
 *   person's gender's list, or from every given list together where that gender
 *   has none; `{given.<gender>}` draws from that gender's list whatever the
 *   person's gender, as a patronymic draws a father's name.
 * - `en` — English names, in groups of lists: `en.epithet` is a list a pattern
 *   draws from as `{en.epithet}`, as `"{given} the {en.epithet}"` does. English
 *   names are never encoded in the tongue's script or checked against its
 *   spelling.
 * - every other key — a list of names the pattern draws from by that key:
 *   `clan`, `family`, `place`. A list name is letters, digits and underscores,
 *   beginning with a letter.
 *
 * Every placeholder must name a list, and every list must be named by some
 * pattern's placeholder. Each list holds at least one name, and each name is
 * non-empty text.
 *
 * This module imports nothing from `note-vocabulary.mjs`, which declares the
 * field and calls {@link checkLanguageNames}; the being-look vocabulary is
 * handed in, as `appearance-profile.mjs` takes it.
 *
 * @module
 */

import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { isPlainMap } from "./data-keys.mjs";
import { nearest } from "./near-miss.mjs";

/** The `skill` subType whose notes may carry name lists. */
export const NAMES_SUBTYPE = "language";

/** The key whose groups of lists hold English names. */
export const ENGLISH_GROUP = "en";

/** The placeholder that draws from the given-name list for a gender. */
export const GIVEN_LIST = "given";

/** What a list name may be spelled with. */
const LIST_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** A placeholder's text: a list name, and after a dot a gender for `given` or a list for `en`. */
const PLACEHOLDER = /^([A-Za-z][A-Za-z0-9_]*)(?:\.([A-Za-z][A-Za-z0-9_]*))?$/;

/**
 * The genders every `data.names.given` states a list for.
 *
 * A function rather than a `const`: `note-vocabulary.mjs` reads it while the
 * module graph is still evaluating.
 *
 * @returns {readonly string[]} The genders.
 */
export function requiredGivenGenders() {
    return Object.freeze(["female", "male"]);
}

/**
 * One piece of a parsed pattern: literal text, or a placeholder naming a list
 * and, for `given`, the gender whose list it draws from.
 *
 * @typedef {{literal: string} | {list: string, gender?: string, sub?: string}} PatternPart
 */

/** A placeholder as written, without its braces. */
function placeholderText(part) {
    if (part.sub !== undefined) return `${part.list}.${part.sub}`;
    return part.gender ? `${part.list}.${part.gender}` : part.list;
}

/**
 * A pattern read into literal text and placeholders.
 *
 * @param {string} pattern - The pattern as written.
 * @returns {{parts: PatternPart[], problems: string[]}} The parts, and what is
 *   wrong with the pattern's own spelling.
 */
export function parsePattern(pattern) {
    const parts = [];
    const problems = [];
    let literal = "";
    let i = 0;
    while (i < pattern.length) {
        const ch = pattern[i];
        if (ch === "}") {
            problems.push(`has a \`}\` with no \`{\` before it, at character ${i + 1}`);
            i++;
            continue;
        }
        if (ch !== "{") {
            literal += ch;
            i++;
            continue;
        }
        const close = pattern.indexOf("}", i + 1);
        const open = pattern.indexOf("{", i + 1);
        if (close < 0 || (open >= 0 && open < close)) {
            problems.push(`has a \`{\` with no \`}\` after it, at character ${i + 1}`);
            i++;
            continue;
        }
        const text = pattern.slice(i + 1, close);
        const match = PLACEHOLDER.exec(text);
        if (!match)
            problems.push(
                `has the placeholder \`{${text}}\`; a placeholder names a list in letters, ` +
                    "digits and underscores, beginning with a letter",
            );
        else if (match[1] === ENGLISH_GROUP && match[2] === undefined)
            problems.push(
                `has the placeholder \`{${text}}\`; \`en\` holds groups of English names, ` +
                    "so a placeholder names one as `{en.<list>}`",
            );
        else if (match[2] !== undefined && match[1] !== GIVEN_LIST && match[1] !== ENGLISH_GROUP)
            problems.push(
                `has the placeholder \`{${text}}\`; only \`given\` takes a gender after a dot, ` +
                    "as `{given.male}` does, and `en` a list, as `{en.epithet}` does",
            );
        else {
            if (literal) parts.push({ literal });
            literal = "";
            if (match[2] === undefined) parts.push({ list: match[1] });
            else if (match[1] === ENGLISH_GROUP) parts.push({ list: match[1], sub: match[2] });
            else parts.push({ list: match[1], gender: match[2] });
        }
        i = close + 1;
    }
    if (literal) parts.push({ literal });
    if (!problems.length && !parts.some((part) => "list" in part))
        problems.push("has no placeholder, so it draws on no list");
    return { parts, problems };
}

/**
 * Every pattern string `data.names.pattern` states, each with its path from
 * `data.names`: one string, a list of them, or a map of genders to either.
 *
 * @param {unknown} pattern - `data.names.pattern` as authored.
 * @returns {Array<{path: Array<string|number>, text: unknown, gender?: string}>}
 *   The patterns, in the order they are written; `gender` is the map key a
 *   pattern sits under.
 */
function patternEntries(pattern) {
    const out = [];
    const add = (value, path, gender) => {
        if (Array.isArray(value))
            value.forEach((text, i) => out.push({ path: [...path, i], text, gender }));
        else out.push({ path, text: value, gender });
    };
    if (!isPlainMap(pattern)) add(pattern, ["pattern"]);
    else
        for (const [gender, value] of Object.entries(pattern))
            if (value !== null && value !== undefined) add(value, ["pattern", gender], gender);
    return out;
}

/**
 * The patterns a name of `gender` may take: every pattern where they are not
 * keyed by gender, the gender's own where it has some, else every pattern
 * stated.
 *
 * @param {object} names - Checked `data.names`.
 * @param {string} gender - A gender word.
 * @returns {string[]} The patterns.
 */
export function patternsFor(names, gender) {
    const pattern = names.pattern;
    if (!isPlainMap(pattern)) return [pattern].flat();
    if (pattern[gender] !== undefined && pattern[gender] !== null) return [pattern[gender]].flat();
    return [
        ...new Set(
            Object.values(pattern)
                .filter((v) => v !== null && v !== undefined)
                .flat(),
        ),
    ];
}

/**
 * One thing wrong with a language's name lists.
 *
 * @typedef {object} NamesProblem
 * @property {Array<string|number>} path - Where, from `data.names` itself.
 * @property {boolean} [key] - The fault is the key at `path`, not its value.
 * @property {boolean} [shape] - The frontmatter lint's inner-key walk reports
 *   this too, from the field's declaration.
 * @property {string} message - What is wrong, naming the full `data.` path.
 */

/** `data.names.<path>`, as a reader writes it: `pattern[1]` for a list entry. */
function label(path) {
    return path.reduce(
        (text, segment) =>
            typeof segment === "number" ? `${text}[${segment}]` : `${text}.${segment}`,
        "data.names",
    );
}

/** The gender words of the being-look vocabulary. */
function genderWords(lookVocabulary) {
    return (lookVocabulary.gender ?? []).map(({ value }) => value);
}

/**
 * Everything wrong with a language's name lists.
 *
 * @param {unknown} names - `data.names` as authored.
 * @param {Readonly<Record<string, readonly {value: string}[]>>} lookVocabulary -
 *   The being-look vocabulary, whose `gender` words key `given`.
 * @returns {NamesProblem[]} The problems, in the order a reader meets them.
 */
export function namesProblems(names, lookVocabulary) {
    const problems = [];
    const problem = (path, message, key = false) =>
        problems.push({ path, message, ...(key ? { key } : {}) });
    const shape = (path, message, key = false) =>
        problems.push({ path, message, shape: true, ...(key ? { key } : {}) });

    if (!isPlainMap(names)) {
        shape([], `\`${label([])}\` should be a map, but reads ${JSON.stringify(names)}`);
        return problems;
    }

    /** One list of names: present, a list, not empty, every entry text. */
    const checkList = (path) => {
        const list = path.reduce((value, segment) => value?.[segment], names);
        if (!Array.isArray(list)) {
            shape(path, `\`${label(path)}\` should be a list of names`);
            return;
        }
        if (!list.length) {
            problem(path, `\`${label(path)}\` must hold at least one name`);
            return;
        }
        list.forEach((entry, i) => {
            if (typeof entry !== "string")
                shape(
                    [...path, i],
                    `\`${label(path)}\` entry ${i + 1} should be a name, but reads ` +
                        JSON.stringify(entry),
                );
            else if (!entry.trim())
                problem(
                    [...path, i],
                    `\`${label(path)}\` entry ${i + 1} should be a name, but reads ` +
                        JSON.stringify(entry),
                );
        });
    };

    const lists = Object.keys(names).filter((key) => key !== "pattern" && key !== ENGLISH_GROUP);
    const english = names[ENGLISH_GROUP];
    const englishLists = [];
    if (english !== undefined && english !== null) {
        if (!isPlainMap(english))
            shape(
                [ENGLISH_GROUP],
                `\`${label([ENGLISH_GROUP])}\` should be a map of names to lists of English names`,
            );
        else
            for (const key of Object.keys(english)) {
                if (!LIST_NAME.test(key)) {
                    problem(
                        [ENGLISH_GROUP, key],
                        `"${key}" is not a list name; a list of \`${label([ENGLISH_GROUP])}\` is ` +
                            "named in letters, digits and underscores, beginning with a letter",
                        true,
                    );
                    continue;
                }
                englishLists.push(key);
                checkList([ENGLISH_GROUP, key]);
            }
    }
    for (const key of lists) {
        if (key === GIVEN_LIST) continue;
        if (!LIST_NAME.test(key)) {
            problem(
                [key],
                `"${key}" is not a list name; a list of \`data.names\` is named in letters, ` +
                    "digits and underscores, beginning with a letter",
                true,
            );
            continue;
        }
        checkList([key]);
    }

    const given = names[GIVEN_LIST];
    if (given === undefined || given === null) shape([], "`data.names` must state `given`", true);
    else if (!isPlainMap(given))
        shape([GIVEN_LIST], `\`${label([GIVEN_LIST])}\` should be a map of genders to lists`);
    else {
        const genders = genderWords(lookVocabulary);
        for (const gender of requiredGivenGenders()) {
            if (given[gender] === undefined || given[gender] === null)
                problem(
                    [GIVEN_LIST],
                    `\`${label([GIVEN_LIST])}\` must state a list for \`${gender}\``,
                    true,
                );
        }
        for (const gender of Object.keys(given)) {
            if (!genders.includes(gender)) {
                const guess = nearest(gender, genders);
                problem(
                    [GIVEN_LIST, gender],
                    `${JSON.stringify(gender)} is not a gender; \`${label([GIVEN_LIST])}\` is ` +
                        `keyed by ${genders.join(", ")}` +
                        (guess ? `. Did you mean "${guess}"?` : ""),
                    true,
                );
                continue;
            }
            if (given[gender] === null) continue;
            checkList([GIVEN_LIST, gender]);
        }
    }

    const pattern = names.pattern;
    if (pattern === undefined || pattern === null) {
        shape([], "`data.names` must state `pattern`", true);
        return problems;
    }
    const scalar = (value) => value === null || typeof value !== "object";
    if (!scalar(pattern) && !Array.isArray(pattern) && !isPlainMap(pattern)) {
        shape(["pattern"], `\`${label(["pattern"])}\` should be a pattern, a list or a map`);
        return problems;
    }
    const genders = genderWords(lookVocabulary);
    // A pattern that does not read leaves which lists are used unknown.
    let unreadable = false;
    /** A list of patterns, at `path`, holds at least one. */
    const nonEmpty = (value, path) => {
        if (!Array.isArray(value) || value.length) return;
        problem(path, `\`${label(path)}\` must hold at least one pattern`);
        unreadable = true;
    };
    nonEmpty(pattern, ["pattern"]);
    if (isPlainMap(pattern)) {
        for (const [gender, value] of Object.entries(pattern)) {
            if (!genders.includes(gender)) {
                const guess = nearest(gender, genders);
                problem(
                    ["pattern", gender],
                    `${JSON.stringify(gender)} is not a gender; \`${label(["pattern"])}\` is ` +
                        `keyed by ${genders.join(", ")}` +
                        (guess ? `. Did you mean "${guess}"?` : ""),
                    true,
                );
            }
            if (isPlainMap(value))
                shape(
                    ["pattern", gender],
                    `\`${label(["pattern", gender])}\` should be a pattern or a list of them`,
                );
            else nonEmpty(value, ["pattern", gender]);
        }
    }

    const givenMap = isPlainMap(given) ? given : {};
    const named = new Set();
    for (const { path, text } of patternEntries(pattern)) {
        if (isPlainMap(text)) continue;
        if (typeof text !== "string") {
            // A list entry's kind is the inner-key walk's to report; a lone
            // value's is not, since that walk admits any scalar there.
            if (typeof path.at(-1) === "number")
                shape(
                    path,
                    `\`${label(path)}\` should be a pattern, but reads ${JSON.stringify(text)}`,
                );
            else
                problem(
                    path,
                    `\`${label(path)}\` should be a pattern such as "{given} {clan}", but reads ` +
                        JSON.stringify(text),
                );
            unreadable = true;
            continue;
        }
        const parsed = parsePattern(text);
        for (const message of parsed.problems) problem(path, `\`${label(path)}\` ${message}`);
        if (parsed.problems.length) unreadable = true;
        for (const part of parsed.parts) {
            if (!("list" in part)) continue;
            if (part.sub !== undefined) {
                named.add(placeholderText(part));
                if (englishLists.includes(part.sub)) continue;
                const guess = nearest(part.sub, englishLists);
                problem(
                    path,
                    `\`{${placeholderText(part)}}\` in \`${label(path)}\` names no list of ` +
                        `\`${label([ENGLISH_GROUP])}\`` +
                        (englishLists.length ? `; the lists are ${englishLists.join(", ")}` : "") +
                        (guess ? `. Did you mean "{en.${guess}}"?` : ""),
                );
                continue;
            }
            named.add(part.list);
            if (part.gender !== undefined) {
                if (givenMap[part.gender] === undefined || givenMap[part.gender] === null)
                    problem(
                        path,
                        `\`{${placeholderText(part)}}\` in \`${label(path)}\` names no list: ` +
                            `\`${label([GIVEN_LIST])}\` has no \`${part.gender}\` list`,
                    );
                continue;
            }
            if (lists.includes(part.list)) continue;
            const guess = nearest(part.list, lists);
            problem(
                path,
                `\`{${part.list}}\` in \`${label(path)}\` names no list of \`data.names\`` +
                    (lists.length ? `; the lists are ${lists.join(", ")}` : "") +
                    (guess ? `. Did you mean "{${guess}}"?` : ""),
            );
        }
    }
    if (unreadable) return problems;
    for (const list of englishLists) {
        if (named.has(`${ENGLISH_GROUP}.${list}`)) continue;
        problem(
            [ENGLISH_GROUP, list],
            `\`${label([ENGLISH_GROUP, list])}\` is never drawn from: no pattern of ` +
                `\`${label(["pattern"])}\` has \`{${ENGLISH_GROUP}.${list}}\``,
            true,
        );
    }
    for (const list of lists) {
        if (named.has(list)) continue;
        problem(
            [list],
            `\`${label([list])}\` is never drawn from: no pattern of \`${label(["pattern"])}\` ` +
                `has \`{${list}}\``,
            true,
        );
    }
    return problems;
}

/**
 * The frontmatter lint's check of `data.names`.
 *
 * Scoped to a `skill` note of `subType: language`: on any other skill it is an
 * error at the key. On a language it reports what the field's declared inner
 * keys cannot: a pattern that does not parse, a placeholder naming no list, a
 * list no pattern names, a list name a placeholder cannot spell, an empty list
 * of patterns or of names, an empty name, a pattern or given list keyed by no
 * gender, and a missing `female` or `male` list. Each is located at the pattern, list, entry or key at fault.
 *
 * @param {object} note - The note: `file`, `raw` and parsed `fm`.
 * @param {Readonly<Record<string, readonly {value: string}[]>>} lookVocabulary -
 *   The being-look vocabulary.
 * @returns {object[]} Findings.
 */
export function checkLanguageNames(note, lookVocabulary) {
    const data = note?.fm?.data;
    if (!isPlainMap(data)) return [];
    if (data.names === undefined || data.names === null) return [];
    const subType = String(note.fm?.subType ?? "").toLowerCase();
    if (subType !== NAMES_SUBTYPE)
        return [
            {
                file: note.file,
                ...positionOfFrontmatterPath(note.raw ?? "", ["data", "names"], { key: true }),
                severity: "error",
                message:
                    "`data.names` holds a language's name lists, and this note's `subType` is " +
                    `not \`${NAMES_SUBTYPE}\``,
            },
        ];
    const raw = note.raw ?? "";
    return namesProblems(data.names, lookVocabulary)
        .filter((problem) => !problem.shape)
        .map((problem) => ({
            file: note.file,
            ...positionOfFrontmatterPath(raw, ["data", "names", ...problem.path], {
                key: Boolean(problem.key),
            }),
            severity: "error",
            message: problem.message,
        }));
}

/**
 * A language's name-list problems as findings at the note that states them,
 * shape included, for a caller holding the note but not running the lint.
 *
 * @param {object} note - The language note: `file`, `raw` and parsed `fm`.
 * @param {Readonly<Record<string, readonly {value: string}[]>>} lookVocabulary -
 *   The being-look vocabulary.
 * @returns {object[]} Every problem, as findings.
 */
export function namesFindings(note, lookVocabulary) {
    const raw = note?.raw ?? "";
    return namesProblems(note?.fm?.data?.names, lookVocabulary).map((problem) => ({
        ...(note?.file ? { file: note.file } : {}),
        ...positionOfFrontmatterPath(raw, ["data", "names", ...problem.path], {
            key: Boolean(problem.key),
        }),
        severity: "error",
        message: problem.message,
    }));
}

/**
 * The given names a gender draws from: its own list, or every given list
 * together where it has none.
 *
 * @param {object} names - Checked `data.names`.
 * @param {string} gender - A gender word.
 * @returns {string[]} The names.
 */
export function givenNames(names, gender) {
    const given = names[GIVEN_LIST];
    if (Array.isArray(given[gender])) return given[gender];
    return [...new Set(Object.values(given).filter(Array.isArray).flat())];
}

/** The names one placeholder draws from, for a person of `gender`. */
function listFor(names, part, gender) {
    if (part.sub !== undefined) return names[part.list][part.sub];
    if (part.list !== GIVEN_LIST) return names[part.list];
    if (part.gender !== undefined) return names[GIVEN_LIST][part.gender];
    return givenNames(names, gender);
}

/**
 * A name drawn from a language's lists: one of the gender's patterns, where it
 * has more than one, then each placeholder an even draw from its list.
 *
 * @param {object} names - Checked `data.names`.
 * @param {string} gender - A gender word.
 * @param {() => number} next - A stream of numbers in `[0, 1)`.
 * @returns {string} The name.
 */
export function drawName(names, gender, next) {
    const patterns = patternsFor(names, gender);
    const pattern =
        patterns.length > 1 ? patterns[Math.floor(next() * patterns.length)] : patterns[0];
    return parsePattern(pattern)
        .parts.map((part) => {
            if ("literal" in part) return part.literal;
            const list = listFor(names, part, gender);
            return list[Math.floor(next() * list.length)];
        })
        .join("");
}

const nfc = (text) => text.normalize("NFC");

/** A pattern's parts with literal text in NFC. */
function partsOf(pattern) {
    return parsePattern(pattern).parts.map((part) =>
        "literal" in part ? { literal: nfc(part.literal) } : part,
    );
}

/**
 * Whether `text` is the parts, each placeholder one of `lookup(part)`'s
 * names. Every split is tried, so parts that touch read correctly.
 */
function fits(text, parts, lookup) {
    const failed = new Set();
    const walk = (at, from) => {
        if (at === parts.length) return from === text.length;
        const memo = `${at}:${from}`;
        if (failed.has(memo)) return false;
        const part = parts[at];
        const candidates = "literal" in part ? [part.literal] : lookup(part);
        for (const candidate of candidates) {
            if (
                candidate &&
                text.startsWith(candidate, from) &&
                walk(at + 1, from + candidate.length)
            )
                return true;
        }
        failed.add(memo);
        return false;
    };
    return walk(0, 0);
}

/** The text each placeholder holds, where `text` has the pattern's literal shape. */
function looseParts(text, parts) {
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const source = parts
        .map((part) => ("literal" in part ? escape(part.literal) : "(.+?)"))
        .join("");
    const match = new RegExp(`^${source}$`, "su").exec(text);
    if (!match) return undefined;
    return parts.filter((part) => "list" in part).map((part, i) => [part, match[i + 1]]);
}

/**
 * Why a name does not fit a language's lists, or `undefined` where it fits.
 *
 * A name fits when it takes one of the patterns for `gender`, with every
 * placeholder filled by a name of its list: `{given}` from the gender's given
 * list, `{given.<gender>}` from that gender's. Names compare in Unicode NFC, so
 * a precomposed and a decomposed accent are one letter.
 *
 * @param {string} full - The name as given.
 * @param {object} names - Checked `data.names`.
 * @param {string} gender - A gender word.
 * @returns {string|undefined} One sentence naming the part that does not fit.
 */
export function nameMisfit(full, names, gender) {
    const text = nfc(full);
    const given = names[GIVEN_LIST];
    const own = givenNames(names, gender).map(nfc);
    const every = Object.values(given).filter(Array.isArray).flat().map(nfc);
    const lookup = (forGiven) => (part) =>
        part.list === GIVEN_LIST && part.gender === undefined ?
            forGiven
        :   listFor(names, part, gender).map(nfc);

    const patterns = patternsFor(names, gender);
    if (patterns.some((pattern) => fits(text, partsOf(pattern), lookup(own)))) return undefined;

    const elsewhere = patternEntries(names.pattern)
        .map(({ text: pattern }) => pattern)
        .filter((pattern) => typeof pattern === "string" && !patterns.includes(pattern));
    const other = elsewhere.find((pattern) => fits(text, partsOf(pattern), lookup(every)));
    if (other !== undefined)
        return `it has the form ${JSON.stringify(other)}, which is not a ${gender} pattern`;

    const listedFor = (value) =>
        Object.entries(given)
            .filter(([, list]) => Array.isArray(list) && list.map(nfc).includes(value))
            .map(([g]) => g);
    /** The parts of one pattern that hold no name of their list, where its shape reads. */
    const failures = (pattern) => {
        const parts = partsOf(pattern);
        const loose = looseParts(text, parts);
        if (!loose) return undefined;
        const literal = parts.reduce(
            (n, part) => n + ("literal" in part ? part.literal.length : 0),
            0,
        );
        const failed = loose.filter(([part, value]) => !lookup(own)(part).includes(value));
        return { failed, literal };
    };
    const best = patterns
        .map(failures)
        .filter((result) => result && result.failed.length)
        .sort((a, b) => a.failed.length - b.failed.length || b.literal - a.literal)[0];
    if (best) {
        const [part, value] = best.failed[0];
        const name = placeholderText(part);
        if (part.list === GIVEN_LIST && part.gender === undefined && every.includes(value))
            return (
                `${JSON.stringify(value)}, the {${name}} part, is not a ${gender} given name; ` +
                `it is listed for ${listedFor(value).join(" and ")}`
            );
        return `${JSON.stringify(value)}, the {${name}} part, is not in the ${name} list`;
    }
    if (patterns.some((pattern) => fits(text, partsOf(pattern), lookup(every))))
        return `its given name is not a ${gender} given name`;
    return patterns.length === 1 ?
            `it does not read as the pattern ${JSON.stringify(patterns[0])} filled from the lists`
        :   `it reads as none of the patterns ${patterns.map((p) => JSON.stringify(p)).join(", ")} filled from the lists`;
}
