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
 * **A map reads its language's dictionary first.** The sound rules belong to
 * the script: a mapping note's rows spell every language written in it. The
 * exceptions belong to the language: a word of a language note's
 * `data.words` states a `native` form for a map only where the rows would
 * spell it differently.
 *
 * ```yaml
 * words:
 *   - form: zaron
 *     class: n
 *     field: Law
 *     gloss: an oath
 *     native:
 *       - {map: semaron, text: "…"}
 *       - {map: semaron, font: semaron-carved, text: "…"}
 * ```
 *
 * - **`languages.<name>.note`** in the configuration names the language note
 *   whose words are the language's lexicon. A run marked `lang=` with that
 *   name and a `map=` reads it; a language with no `note`, a bare BCP 47 tag
 *   and a run with no `lang=` are spelled by the rows alone.
 * - **A native form with a `font`** applies in that face alone, and wins there
 *   over one with none.
 * - **Derived forms take the rows**: a plural or a verb ending of an exception
 *   word is spelled by the rows, and only the word as cited is looked up.
 *
 * {@link mappingFor} is the one path from a map, a face and a language to the
 * function that rewrites text: the build's runs, `package-build transliterate`
 * and `package-build lexicon` all go through it.
 *
 * @module
 */

import fs from "node:fs";

import { parseAddress, renderAddress } from "./address.mjs";
import { positionOfFrontmatterPath, positionOfYamlPath } from "./diagnostics.mjs";
import { isNoteRecord } from "./index-records.mjs";
import { nearest } from "./near-miss.mjs";
import { FONTS_PACKAGE } from "./script-fonts.mjs";
import { GENERIC_FAMILIES, applyMap } from "./text-maps.mjs";
import { isLanguageRecord, noteAddressOf } from "./word-rows.mjs";
import { derivedForms } from "./word-forms.mjs";
import { LANGUAGE_SUBTYPE, glossText } from "./word-terms.mjs";

/** The configuration file a language is declared in. */
const CONFIG = "package-build.config.yaml";

/** Whether a value is a plain map. */
const isMap = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** A list value, or an empty one. */
const listOf = (value) => (Array.isArray(value) ? value : []);

/** `U+XXXX` for a code point. */
const codeName = (point) => `U+${point.toString(16).toUpperCase().padStart(4, "0")}`;

/** Names in backticks, joined as a list is said: `a`, `b` and `c`. */
function said(names) {
    const quoted = names.map((name) => `\`${name}\``);
    return quoted.length < 2 ?
            quoted.join("")
        :   `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

/**
 * One native form, read.
 *
 * @typedef {object} NativeForm
 * @property {string} map - The map it is written for.
 * @property {string|undefined} font - The one face it is for.
 * @property {string} text - The word in the script.
 */

/**
 * One word of a lexicon.
 *
 * @typedef {object} LexiconWord
 * @property {string} form - The word as cited.
 * @property {string|null} class - Its class.
 * @property {string|null} gloss - Its senses, joined by `; `.
 * @property {readonly NativeForm[]} natives - Its native forms.
 */

/**
 * A language's lexicon.
 *
 * @typedef {object} Lexicon
 * @property {string} language - The language's configured name.
 * @property {readonly LexiconWord[]} words - Its words, in `data.words` order.
 * @property {ReadonlyMap<string, readonly NativeForm[]>} byForm - The native
 *   forms by the word's form, NFC; the first word of a form keeps it.
 * @property {ReadonlyArray<{form: string, from: LexiconWord}>} derived - The
 *   forms the language's rules derive from its words, folded, as the mapped-run
 *   word check accepts them (see {@link module:engine/word-forms.derivedForms}).
 */

/**
 * A word's native forms as written, keeping those that read.
 *
 * @param {unknown} value - A word's `native`.
 * @returns {NativeForm[]} The forms.
 */
function readNatives(value) {
    return listOf(value)
        .filter(
            (entry) =>
                isMap(entry) && typeof entry.map === "string" && typeof entry.text === "string",
        )
        .map((entry) => ({
            map: entry.map,
            font: typeof entry.font === "string" ? entry.font : undefined,
            text: entry.text,
        }));
}

/**
 * A language note's words as a lexicon.
 *
 * @param {string} language - The language's configured name.
 * @param {Record<string, any>} data - The note's `data`.
 * @returns {Lexicon} The lexicon.
 */
function lexiconOf(language, data) {
    const words = [];
    const byForm = new Map();
    const bySource = new Map();
    for (const word of listOf(data?.words)) {
        if (!isMap(word) || typeof word.form !== "string") continue;
        const natives = readNatives(word.native);
        const read = Object.freeze({
            form: word.form,
            class: typeof word.class === "string" ? word.class : null,
            gloss: glossText(word.gloss),
            natives,
        });
        words.push(read);
        bySource.set(word, read);
        const key = word.form.normalize("NFC");
        if (!byForm.has(key)) byForm.set(key, natives);
    }
    const derived = derivedForms(data).map(({ form, word }) =>
        Object.freeze({ form, from: bySource.get(word) }),
    );
    return Object.freeze({
        language,
        words: Object.freeze(words),
        byForm,
        derived: Object.freeze(derived),
    });
}

/**
 * The canonical Address `languages.<name>.note` names, or `undefined` where
 * the value is no Address.
 *
 * @param {unknown} note - The configured value.
 * @param {string|undefined} contentPackage - The package it is read in.
 * @param {Iterable<string>} types - The types a qualified value may name.
 * @returns {string|undefined} The Address.
 */
function noteKey(note, contentPackage, types) {
    if (typeof note !== "string" || !contentPackage) return undefined;
    const tuple = parseAddress(
        note,
        { package: contentPackage, system: "note", type: "skill", types: new Set(types) },
        { declared: true },
    );
    return "reason" in tuple ? undefined : renderAddress(tuple);
}

/**
 * Each record by the Address a reference to it is written as.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @param {string|undefined} contentPackage - The package a record with no
 *   `package` belongs to.
 * @returns {Map<string, Record<string, any>>} The records.
 */
function recordsByKey(records, contentPackage) {
    const byKey = new Map();
    for (const record of records ?? []) {
        if (!record || !isNoteRecord(record) || !record.type || !record.shortcode) continue;
        const pkg = record.package ?? contentPackage;
        if (!pkg) continue;
        const key = renderAddress({
            package: String(pkg),
            system: "note",
            type: String(record.type),
            shortcode: String(record.shortcode),
        });
        if (!byKey.has(key)) byKey.set(key, record);
    }
    return byKey;
}

/** Whether a record is a language note's. */
const isLanguage = (record) =>
    record?.type === "skill" && String(record.subType ?? "").toLowerCase() === LANGUAGE_SUBTYPE;

/**
 * The language note each configured language names.
 *
 * @param {Readonly<Record<string, {tag: string, note?: string}>>} languages -
 *   The configured languages.
 * @param {string|undefined} contentPackage - The package.
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {Map<string, {key: string|undefined, record: Record<string, any>|undefined}>}
 *   Each language stating a `note`, with what it resolves to.
 */
function languageNotes(languages, contentPackage, records) {
    const list = [...(records ?? [])];
    const byKey = recordsByKey(list, contentPackage);
    const types = new Set(list.map((record) => record?.type).filter(Boolean));
    types.add("skill");
    const out = new Map();
    for (const [name, spec] of Object.entries(languages ?? {})) {
        if (spec?.note === undefined) continue;
        const key = noteKey(spec.note, contentPackage, types);
        const record = key ? byKey.get(key) : undefined;
        out.set(name, { key, record: isLanguage(record) ? record : undefined });
    }
    return out;
}

/**
 * Each configured language's lexicon, read from the language note its `note`
 * names. A language with no `note`, or one naming no language note, has none.
 *
 * @param {Iterable<Record<string, any>>|undefined} records - Index records.
 * @param {{languages?: Readonly<Record<string, {tag: string, note?: string}>>, contentPackage?: string}} config -
 *   The resolved configuration.
 * @returns {Map<string, Lexicon>} The lexicons by language name.
 */
export function lexiconsFromRecords(records, config = {}) {
    const lexicons = new Map();
    for (const [name, record] of languageRecordsByName(records, config))
        lexicons.set(name, lexiconOf(name, record.data));
    return lexicons;
}

/**
 * The language note each configured language's `note` names, by language
 * name. A language with no `note`, or one naming no language note, is absent.
 *
 * @param {Iterable<Record<string, any>>|undefined} records - Index records.
 * @param {{languages?: Readonly<Record<string, {tag: string, note?: string}>>, contentPackage?: string}} config -
 *   The resolved configuration.
 * @returns {Map<string, Record<string, any>>} The records.
 */
export function languageRecordsByName(records, { languages, contentPackage } = {}) {
    const out = new Map();
    for (const [name, { record }] of languageNotes(languages, contentPackage, records))
        if (record) out.set(name, record);
    return out;
}

/**
 * Each `languages.<name>.note` that names no language note, at its key.
 *
 * @param {{languages?: Readonly<Record<string, {tag: string, note?: string}>>, contentPackage?: string, configFile?: string, configText?: string}} config -
 *   The resolved configuration, and where it was read from.
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]} The findings.
 */
export function languageNoteFindings(config, records) {
    const { languages, contentPackage, configFile, configText } = config ?? {};
    let text = configText;
    if (text === undefined && configFile) {
        try {
            text = fs.readFileSync(configFile, "utf8");
        } catch {
            text = undefined;
        }
    }
    const findings = [];
    for (const [name, { record }] of languageNotes(languages, contentPackage, records)) {
        if (record) continue;
        findings.push({
            file: configFile ?? CONFIG,
            ...(text ? positionOfYamlPath(text, ["languages", name, "note"], { key: true }) : {}),
            severity: "error",
            message:
                `\`languages.${name}.note\` is \`${String(languages[name].note)}\`, which names no ` +
                `language note in ${contentPackage}; it names a skill note whose subType is language`,
        });
    }
    return findings;
}

/**
 * A lookup of a word's native form under one map in one face: the form stated
 * for the face, else the one stated for no face.
 *
 * @param {Lexicon|undefined} lexicon - The lexicon.
 * @param {string} map - The map's name.
 * @param {string|undefined} font - The face.
 * @returns {((word: string) => string|undefined)|undefined} The lookup, or
 *   `undefined` with no lexicon.
 */
export function nativeLookup(lexicon, map, font) {
    if (!lexicon) return undefined;
    return (word) => {
        const natives = lexicon.byForm.get(word.normalize("NFC"));
        if (!natives) return undefined;
        const own =
            font === undefined ? undefined : natives.find((n) => n.map === map && n.font === font);
        return (own ?? natives.find((n) => n.map === map && n.font === undefined))?.text;
    };
}

/**
 * What a run, a passage or a listing is mapped by.
 *
 * @typedef {object} Mapping
 * @property {import("./text-maps.mjs").TextMap} map - The map.
 * @property {string|undefined} font - The face, whose own rows come first.
 * @property {((word: string) => string|undefined)|undefined} native - The
 *   language's native forms under the map in the face.
 */

/**
 * The one path from a map, a face and a language to what rewrites the text.
 *
 * @param {{maps?: ReadonlyMap<string, import("./text-maps.mjs").TextMap>, lexicons?: ReadonlyMap<string, Lexicon>}} ctx -
 *   The run context.
 * @param {{map: string, font?: string, lang?: string}} keys - The map, the face
 *   and the language.
 * @returns {Mapping|undefined} The mapping, or `undefined` for an unknown map.
 */
export function mappingFor(ctx, { map, font, lang }) {
    const textMap = ctx?.maps?.get(map);
    if (!textMap) return undefined;
    const lexicon = lang === undefined ? undefined : ctx.lexicons?.get(lang);
    return { map: textMap, font, native: nativeLookup(lexicon, textMap.name, font) };
}

/**
 * Why a face is not one a map is for, or `undefined` where it is.
 *
 * @param {import("./text-maps.mjs").TextMap} map - The map.
 * @param {string} font - The face's slug.
 * @returns {string|undefined} The problem.
 */
export function fontProblem(map, font) {
    if (!map.fonts.size || map.fonts.has(font)) return undefined;
    return `\`${font}\` is not a font of the map \`${map.name}\`; it is for ${said([...map.fonts.keys()])}`;
}

/**
 * The mapping a command uses, or what is wrong with what it was given. A map
 * listing one face defaults to it; one listing more needs `font`.
 *
 * @param {object} ctx - The run context.
 * @param {{map: string, font?: string, lang?: string}} keys - What was asked for.
 * @returns {{mapping: Mapping}|{problem: string, about: "map"|"lang"|"font"}} The mapping or the problem.
 */
function commandMapping(ctx, { map, font, lang }) {
    const textMap = ctx?.maps?.get(map);
    if (!textMap) {
        const names = [...(ctx?.maps?.keys() ?? [])];
        const near = nearest(map, names);
        return {
            about: "map",
            problem:
                `\`${map}\` is not a map: a map is named by the \`data.map.name\` of a mapping note` +
                (near ? `; did you mean \`${near}\`?`
                : names.length ? `; the maps are ${said(names)}`
                : "; no note declares one"),
        };
    }
    if (lang !== undefined && !Object.hasOwn(ctx.languages ?? {}, lang)) {
        const near = nearest(lang, Object.keys(ctx.languages ?? {}));
        return {
            about: "lang",
            problem:
                `\`${lang}\` is not a declared language (\`languages\` in ${CONFIG})` +
                (near ? `; did you mean \`${near}\`?` : ""),
        };
    }
    let face = font;
    if (face === undefined && textMap.fonts.size === 1) face = [...textMap.fonts.keys()][0];
    if (face === undefined && textMap.fonts.size > 1)
        return {
            about: "font",
            problem: `the map \`${map}\` is for ${said([...textMap.fonts.keys()])}; name one with \`--font\``,
        };
    if (face !== undefined) {
        const problem = fontProblem(textMap, face);
        if (problem) return { about: "font", problem };
    }
    return { mapping: /** @type {Mapping} */ (mappingFor(ctx, { map, font: face, lang })) };
}

/**
 * What is wrong with a capitalised word whose native form the rows cannot
 * capitalise.
 *
 * @param {string} word - The word as written.
 * @param {string} lower - The lowercase form the lexicon states.
 * @param {string|undefined} lang - The language.
 * @param {string} map - The map's name.
 * @returns {string} The message.
 */
export function uncapitalisedMessage(word, lower, lang, map) {
    return (
        `\`${word}\` is capitalised, and the native form the lexicon of \`${lang}\` states for ` +
        `\`${lower}\` under the map \`${map}\` does not begin as the rows spell its first letter, ` +
        `so the rows cannot capitalise it; state \`${word}\` as a word of its own with its native form`
    );
}

/**
 * Map a passage exactly as the build maps a run with the same keys.
 *
 * @param {object} ctx - The run context.
 * @param {{map: string, font?: string, lang?: string}} keys - The map, the face
 *   and the language.
 * @param {string} text - The passage, with no escapes.
 * @returns {{text: string}|{problem: string, about: string}} The mapped text, or the problem.
 */
export function transliterate(ctx, keys, text) {
    const found = commandMapping(ctx, keys);
    if ("problem" in found) return { problem: found.problem, about: found.about };
    const { map, font, native } = found.mapping;
    const mapped = applyMap(map, text, { font, native });
    const piece = mapped.pieces.find((one) => one.uncapitalised !== undefined);
    if (piece)
        return {
            about: "word",
            problem: uncapitalisedMessage(
                piece.from,
                /** @type {string} */ (piece.uncapitalised),
                keys.lang,
                map.name,
            ),
        };
    return { text: mapped.text };
}

/**
 * Every word of a language's lexicon with its native form under a map: the
 * stated exception, else the rows' spelling, each exactly as the build gives
 * it. With `derived`, the forms the language's rules derive follow the words,
 * each case folded and naming the word it comes from in `from`, so the list
 * is what the mapped-run word check accepts of the lexicon.
 *
 * @param {object} ctx - The run context.
 * @param {{lang: string, map: string, font?: string, derived?: boolean}} keys -
 *   The language, the map, the face, and whether to list derived forms.
 * @returns {{entries: Array<{form: string, native: string, exception: boolean, class: string|null, gloss: string|null, from?: string}>}|{problem: string, about: string}}
 *   The words in `data.words` order, then any derived forms, or the problem.
 */
export function lexiconEntries(ctx, { lang, map, font, derived = false }) {
    const found = commandMapping(ctx, { map, font, lang });
    if ("problem" in found) return { problem: found.problem, about: found.about };
    const lexicon = ctx.lexicons?.get(lang);
    if (!lexicon)
        return {
            about: "lang",
            problem:
                `\`${lang}\` has no lexicon: \`languages.${lang}\` names no language note ` +
                "in its `note`",
        };
    const { map: textMap, font: face, native } = found.mapping;
    const listed = [
        ...lexicon.words.map((word) => ({ word, form: word.form, from: undefined })),
        ...(derived ?
            lexicon.derived.map((one) => ({ word: one.from, form: one.form, from: one.from.form }))
        :   []),
    ];
    const mapped = listed.map((one) => applyMap(textMap, one.form, { font: face, native }));
    const unsound = mapped.flatMap((one) => one.pieces).find((one) => one.uncapitalised);
    if (unsound)
        return {
            about: "word",
            problem: uncapitalisedMessage(
                unsound.from,
                /** @type {string} */ (unsound.uncapitalised),
                lang,
                textMap.name,
            ),
        };
    return {
        entries: listed.map(({ word, form, from }, i) => ({
            form,
            native: mapped[i].text,
            exception:
                native?.(form) !== undefined ||
                (form.toLowerCase() !== form && native?.(form.toLowerCase()) !== undefined),
            class: word.class,
            gloss: word.gloss,
            ...(from === undefined ? {} : { from }),
        })),
    };
}

/**
 * Whether a shared row can be reached in a face: no plain row of the face's
 * own matches at the start of its `from`, which would win there first.
 *
 * @param {import("./text-maps.mjs").MapRow} row - A shared row.
 * @param {readonly import("./text-maps.mjs").MapRow[]} own - The face's rows.
 * @returns {boolean} Whether the row can apply.
 */
function reachable(row, own) {
    return !own.some((mine) => !mine.before && !mine.at && row.from.startsWith(mine.from));
}

/**
 * Check a mapping note's `fonts` against the installed faces: an unknown face
 * and a face listed twice, at the entry, and each code point a listed face
 * lacks, at the row that writes it.
 *
 * @param {{file: string, raw?: string, fm?: Record<string, any>}} note - The note.
 * @param {{faces?: ReadonlyMap<string, import("./script-fonts.mjs").Face>, maps?: ReadonlyMap<string, import("./text-maps.mjs").TextMap>}} ctx -
 *   The run context.
 * @returns {object[]} The findings.
 */
export function checkMapFonts(note, ctx) {
    const value = note?.fm?.data?.map;
    if (!isMap(value) || !Array.isArray(value.fonts)) return [];
    const raw = note.raw ?? "";
    const finding = (keyPath, message, key = false) => ({
        file: note.file,
        ...positionOfFrontmatterPath(raw, ["data", "map", ...keyPath], { key }),
        severity: "error",
        message,
    });
    const faces = ctx?.faces ?? new Map();
    const findings = [];
    const first = new Map();
    const listed = [];
    value.fonts.forEach((entry, at) => {
        if (!isMap(entry) || typeof entry.font !== "string") return;
        const slug = entry.font;
        if (GENERIC_FAMILIES.includes(slug)) return;
        if (first.has(slug)) {
            findings.push(
                finding(
                    ["fonts", at],
                    `\`data.map.fonts[${at}]\` lists the font \`${slug}\` a second time; the first is ` +
                        `\`data.map.fonts[${first.get(slug)}]\``,
                ),
            );
            return;
        }
        first.set(slug, at);
        if (!faces.has(slug)) {
            const near = nearest(slug, [...faces.keys()]);
            findings.push(
                finding(
                    ["fonts", at, "font"],
                    `\`${slug}\` is not a font: \`data.map.fonts[${at}].font\` names ` +
                        (faces.size ? "an installed face" : (
                            `a face of ${FONTS_PACKAGE}, which this package has not installed`
                        )) +
                        (near ? `; did you mean \`${near}\`?` : ""),
                ),
            );
            return;
        }
        listed.push({ slug, at });
    });
    const compiled = ctx?.maps?.get(value.name);
    if (!compiled) return findings;
    for (const { slug, at } of listed) {
        const face = /** @type {import("./script-fonts.mjs").Face} */ (faces.get(slug));
        const own = compiled.fonts.get(slug)?.rows ?? [];
        const gaps = (rows, keyPath, label, message) =>
            listOf(rows).forEach((authored, j) => {
                const to = Array.isArray(authored) ? authored[1] : authored?.to;
                if (typeof to !== "string") return;
                const from = Array.isArray(authored) ? authored[0] : authored?.from;
                if (keyPath[0] === "rows" && !reachable({ from: String(from), to }, own)) return;
                const seen = new Set();
                for (const char of to) {
                    const point = /** @type {number} */ (char.codePointAt(0));
                    if (/\s/u.test(char) || face.draws.has(point) || seen.has(point)) continue;
                    seen.add(point);
                    findings.push(
                        finding(
                            [...keyPath, j],
                            `\`${label}[${j}]\` writes ${codeName(point)}, which the font \`${slug}\`${message} does not draw`,
                        ),
                    );
                }
            });
        gaps(value.fonts[at].rows, ["fonts", at, "rows"], `data.map.fonts[${at}].rows`, "");
        gaps(value.rows, ["rows"], "data.map.rows", ", listed in `data.map.fonts`,");
    }
    return findings;
}

/**
 * Check a language note's native forms against the maps and faces: an unknown
 * map, a face the map is not for, a second form for one map and face, a form
 * that states what the rows already give, and a code point a face it applies
 * in does not draw. The shape of each entry is the data-key check's.
 *
 * @param {{file: string, raw?: string, fm?: Record<string, any>}} note - The note.
 * @param {{faces?: ReadonlyMap<string, import("./script-fonts.mjs").Face>, maps?: ReadonlyMap<string, import("./text-maps.mjs").TextMap>}} ctx -
 *   The run context.
 * @returns {object[]} The findings.
 */
export function checkLexiconNatives(note, ctx) {
    const fm = note?.fm ?? {};
    if (!isLanguage(fm) || !isMap(fm.data)) return [];
    const raw = note.raw ?? "";
    const finding = (keyPath, message, key = false) => ({
        file: note.file,
        ...positionOfFrontmatterPath(raw, ["data", "words", ...keyPath], { key }),
        severity: "error",
        message,
    });
    const maps = ctx?.maps ?? new Map();
    const faces = ctx?.faces ?? new Map();
    const findings = [];
    listOf(fm.data.words).forEach((word, i) => {
        if (!isMap(word) || !Array.isArray(word.native)) return;
        const form = typeof word.form === "string" ? word.form : "";
        const stated = new Map();
        const entries = word.native.map((entry) =>
            isMap(entry) && typeof entry.map === "string" && typeof entry.text === "string" ?
                {
                    map: entry.map,
                    font: typeof entry.font === "string" ? entry.font : undefined,
                    text: entry.text,
                }
            :   undefined,
        );
        entries.forEach((entry, j) => {
            if (!entry) return;
            const label = `data.words[${i}].native[${j}]`;
            const map = maps.get(entry.map);
            if (!map) {
                const near = nearest(entry.map, [...maps.keys()]);
                findings.push(
                    finding(
                        [i, "native", j, "map"],
                        `\`${label}.map\` is \`${entry.map}\`, which is not a map: a native form names ` +
                            "the `data.map.name` of a mapping note" +
                            (near ? `; did you mean \`${near}\`?` : ""),
                    ),
                );
                return;
            }
            if (entry.font !== undefined && map.fonts.size && !map.fonts.has(entry.font)) {
                findings.push(
                    finding(
                        [i, "native", j, "font"],
                        `\`${label}.font\` is \`${entry.font}\`, which is not a font of the map ` +
                            `\`${map.name}\`; it is for ${said([...map.fonts.keys()])}`,
                    ),
                );
                return;
            }
            const slot = `${entry.map}\u0000${entry.font ?? ""}`;
            if (stated.has(slot))
                findings.push(
                    finding(
                        [i, "native", j],
                        `\`${label}\` states a second native form for the map \`${map.name}\`` +
                            (entry.font === undefined ? "" : ` in the font \`${entry.font}\``) +
                            `; the first is \`data.words[${i}].native[${stated.get(slot)}]\``,
                    ),
                );
            else stated.set(slot, j);
            const fonts =
                entry.font !== undefined ? [entry.font]
                : map.fonts.size ? [...map.fonts.keys()]
                : [undefined];
            if (fonts.every((font) => applyMap(map, form, { font }).text === entry.text))
                findings.push(
                    finding(
                        [i, "native", j],
                        `\`${label}\` states what the rows already give: the map \`${map.name}\` ` +
                            `spells \`${form}\` so ` +
                            (entry.font !== undefined ? `in the font \`${entry.font}\``
                            : map.fonts.size > 1 ? "in every font it is for"
                            : map.fonts.size ? `in the font \`${[...map.fonts.keys()][0]}\``
                            : "by its rows") +
                            "; a native form is stated only where the rows spell the word differently",
                    ),
                );
            // The faces the form is written in: its own, or every listed face
            // no form stated for that face overrides.
            const applies =
                entry.font !== undefined ?
                    [entry.font]
                :   [...map.fonts.keys()].filter(
                        (font) =>
                            !entries.some(
                                (other) => other && other.map === entry.map && other.font === font,
                            ),
                    );
            for (const slug of applies) {
                const face = faces.get(slug);
                if (!face) continue;
                const seen = new Set();
                for (const char of entry.text) {
                    const point = /** @type {number} */ (char.codePointAt(0));
                    if (/\s/u.test(char) || face.draws.has(point) || seen.has(point)) continue;
                    seen.add(point);
                    findings.push(
                        finding(
                            [i, "native", j],
                            `\`${label}\` holds ${codeName(point)}, which the font \`${slug}\`, ` +
                                `listed in the map \`${map.name}\`, does not draw`,
                        ),
                    );
                }
            }
        });
    });
    return findings;
}

/** Every column of the `natives` relation, in order. */
export const NATIVE_COLUMNS = Object.freeze([
    "language",
    "word",
    "form",
    "native",
    "map",
    "font",
    "text",
]);

/**
 * One row per native form of a language note's word, for the `natives`
 * relation: a text is a value of a row, never a struct key, so forms that
 * differ only in case stay apart.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {Array<Record<string, string|number|null>>} The rows; `word` is the
 *   word's 0-based place in `data.words`, `native` the form's in its `native`.
 */
export function nativeRows(records) {
    const rows = [];
    for (const record of records) {
        if (!isLanguageRecord(record)) continue;
        const language = noteAddressOf(record);
        if (!language) continue;
        listOf(record.data?.words).forEach((word, position) => {
            if (!isMap(word) || typeof word.form !== "string") return;
            listOf(word.native).forEach((entry, at) => {
                if (
                    !isMap(entry) ||
                    typeof entry.map !== "string" ||
                    typeof entry.text !== "string"
                )
                    return;
                rows.push({
                    language,
                    word: position,
                    form: word.form,
                    native: at,
                    map: entry.map,
                    font: typeof entry.font === "string" ? entry.font : null,
                    text: entry.text,
                });
            });
        });
    }
    return rows;
}
