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

/** Encoding-aware language records, validation and plain JSON conversion inputs. */
import fs from "node:fs";
import { encodingAddress } from "./encoding-notes.mjs";
import { parseAddress, renderAddress } from "./address.mjs";
import { positionOfFrontmatterPath, positionOfYamlPath } from "./diagnostics.mjs";
import { isNoteRecord } from "./index-records.mjs";
import { nearest } from "./near-miss.mjs";
import { isLanguageRecord, lineageChain, noteAddressOf } from "./word-rows.mjs";
import { derivedForms, foldWord } from "./word-forms.mjs";
import { WRITTEN_ENDINGS, RESERVED_TONGUE } from "./language-terms.mjs";
import { LANGUAGE_SUBTYPE, glossText } from "./word-terms.mjs";
import { ENGLISH_GROUP } from "./language-names.mjs";
import { writingsOf } from "./language-writings.mjs";
import { encodeText, validateSource, EncodingError } from "./encoding.mjs";
import { encodeWithLanguage } from "./encoding-language.mjs";
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
 * @property {string} enc - The encoding it is written for.
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
 * @property {Record<string, any>} data - The language note's `data`, which a
 *   encoding writes words from.
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
                isMap(entry) && typeof entry.enc === "string" && typeof entry.text === "string",
        )
        .map((entry) => ({
            enc: entry.enc,
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
        data: isMap(data) ? data : {},
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
    if (!contentPackage) return undefined;
    const tuple = parseAddress(
        note,
        { package: contentPackage, system: "note", type: "skill", types: new Set(types) },
        { declared: true },
    );
    return "reason" in tuple ? undefined : renderAddress(tuple);
}

/** Resolve native encoding references in their author's package without changing authored data. */
function resolvedNativeData(value, contentPackage) {
    if (Array.isArray(value)) return value.map((item) => resolvedNativeData(item, contentPackage));
    if (!isMap(value)) return value;
    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
            key,
            key === "native" && Array.isArray(item) ?
                item.map((entry) =>
                    isMap(entry) && typeof entry.enc === "string" ?
                        { ...entry, enc: encodingAddress(entry.enc, contentPackage) ?? entry.enc }
                    :   entry,
                )
            :   resolvedNativeData(item, contentPackage),
        ]),
    );
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
 * names and its family chain. All entries for an exact NFC form come from
 * the nearest lexicon declaring it; grammar, registers and other settings
 * remain the daughter's own.
 * A language with no `note`, or one naming no language note, has none.
 *
 * @param {Iterable<Record<string, any>>|undefined} records - Index records.
 * @param {{languages?: Readonly<Record<string, {tag: string, note?: string}>>, contentPackage?: string}} config -
 *   The resolved configuration.
 * @returns {Map<string, Lexicon>} The lexicons by language name.
 */
export function lexiconsFromRecords(records, config = {}) {
    const list = [...(records ?? [])];
    const byKey = recordsByKey(list, config.contentPackage);
    const types = new Set(["skill", ...list.map((record) => record?.type).filter(Boolean)]);
    const lineage = {
        has: (key) => isLanguage(byKey.get(key)),
        parentOf: (key) => {
            const record = byKey.get(key);
            return noteKey(record.data?.family, record.package ?? config.contentPackage, types);
        },
    };
    const lexicons = new Map();
    for (const [name, { key, record }] of languageNotes(
        config.languages,
        config.contentPackage,
        list,
    )) {
        if (!record) continue;
        const chain = lineageChain(key, lineage);
        let data = resolvedNativeData(record.data, record.package ?? config.contentPackage);
        if (chain.length > 1) {
            const words = [];
            const inherited = new Set();
            for (const ancestor of chain) {
                const forms = new Set();
                for (const word of listOf(
                    resolvedNativeData(
                        byKey.get(ancestor).data,
                        byKey.get(ancestor).package ?? config.contentPackage,
                    )?.words,
                )) {
                    if (!isMap(word) || typeof word.form !== "string") continue;
                    const form = word.form.normalize("NFC");
                    // Retain every sense in the nearest generation, in authored
                    // order, before hiding that form in more distant ancestors.
                    if (!inherited.has(form)) words.push(word);
                    forms.add(form);
                }
                for (const form of forms) inherited.add(form);
            }
            data = { ...data, words };
        }
        lexicons.set(name, lexiconOf(name, data));
    }
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
        if (record) {
            if (typeof record.data?.roman !== "string")
                findings.push({
                    file: configFile ?? CONFIG,
                    ...(text ?
                        positionOfYamlPath(text, ["languages", name, "note"], { key: true })
                    :   {}),
                    severity: "error",
                    message: `the language note named by \`languages.${name}.note\` must declare \`data.roman\``,
                });
            continue;
        }
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

/** Every column of the `natives` relation, in order. */
export const NATIVE_COLUMNS = Object.freeze([
    "language",
    "word",
    "form",
    "native",
    "enc",
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
                    typeof entry.enc !== "string" ||
                    typeof entry.text !== "string"
                )
                    return;
                rows.push({
                    language,
                    word: position,
                    form: word.form,
                    native: at,
                    enc: entry.enc,
                    font: typeof entry.font === "string" ? entry.font : null,
                    text: entry.text,
                });
            });
        });
    }
    return rows;
}

/** Each lexicon's projection, made once and shared by every conversion that reads it. */
const serialized = new WeakMap();

/**
 * Project only conversion-readable language data to a JSON-safe object. The
 * projection of one lexicon is made once and shared, so it must not be modified.
 */
export function serializeLexicon(lexicon) {
    if (!lexicon) return undefined;
    if (!serialized.has(lexicon)) serialized.set(lexicon, projectLexicon(lexicon));
    return serialized.get(lexicon);
}

/** The conversion-readable data of a lexicon, copied. */
function projectLexicon(lexicon) {
    const select = (value, keys) =>
        Object.fromEntries(
            keys
                .filter((key) => value?.[key] !== undefined)
                .map((key) => [key, structuredClone(value[key])]),
        );
    const source = lexicon.data ?? {};
    const data = {
        words: listOf(source.words).map((word) =>
            select(word, ["form", "class", "gloss", "variants", "plural", "built", "native"]),
        ),
        affixes: listOf(source.affixes).map((affix) =>
            select(affix, ["form", "front", "kind", "classes", "attachesTo", "replaces", "native"]),
        ),
        register: listOf(source.register).map((row) => select(row, ["name", "tongue"])),
        ...(source.grammar ?
            {
                grammar: select(source.grammar, [
                    "plural",
                    "verbs",
                    "native",
                    "agreement",
                    "participles",
                ]),
            }
        :   {}),
    };
    return { language: lexicon.language, data };
}

/**
 * Resolve encoding, face and optional language input without loading files.
 *
 * @param {import("./content-scripts.mjs").RunContext} ctx - Installed encodings,
 *   document aliases and lexicons prepared by the caller.
 * @param {object} [options] - Explicit selections; an omitted encoding is the Roman default.
 * @param {string} [options.enc] - Encoding document Address.
 * @param {string} [options.font] - The encoding document's font.
 * @param {string} [options.lang] - Configured language whose lexicon to use.
 */
export function encodingFor(ctx, { enc, font, lang } = {}) {
    const name = enc ?? "default";
    const encoding =
        ctx.encodings?.get(name) ?? ctx.encodings?.get(encodingAddress(name, ctx.contentPackage));
    if (
        !encoding ||
        (encoding.language !== undefined &&
            lang !== undefined &&
            lang !== encoding.language &&
            (ctx.languages?.[encoding.language]?.tag ?? "").toLowerCase() !==
                (ctx.languages?.[lang]?.tag ?? lang).toLowerCase())
    )
        return undefined;
    const face = font ?? encoding.font ?? encoding.fonts[0];
    return {
        encoding,
        font: face,
        lexicon: serializeLexicon(ctx.lexicons?.get(lang) ?? ctx.lexicons?.get(encoding.language)),
    };
}

/** Why a face is incompatible with the selected encoding. */
export function fontProblem(encoding, font) {
    return encoding.fonts.includes(font) ?
            undefined
        :   `\`${font}\` is not a font of the encoding \`${encoding.name}\`; it serves ${said(encoding.fonts)}`;
}

/** List authored and optionally derived forms with their selected native writings. */
export function lexiconEntries(ctx, { lang, enc, font, derived = false }) {
    const selected = encodingFor(ctx, { lang, enc, font });
    if (!selected)
        return {
            about: "enc",
            problem: `No encoding document is selected, or its language conflicts; name an encoding with --enc`,
        };
    const problem = fontProblem(selected.encoding, selected.font);
    if (problem) return { about: "font", problem };
    const lexicon = ctx.lexicons?.get(lang);
    if (!lexicon) return { about: "lang", problem: `\`${lang}\` has no lexicon` };
    const writing = writingsOf(lexicon.data, selected.encoding.name, selected.font);
    const listed = [
        ...lexicon.words.map((word, index) => ({ word, form: word.form, index })),
        ...(derived ?
            lexicon.derived.map((one) => ({ word: one.from, form: one.form, from: one.from.form }))
        :   []),
    ];
    return {
        entries: listed.map(({ word, form, index, from }) => {
            const own = index === undefined ? writing.word(form) : writing.entry(index);
            const result =
                own && "text" in own ?
                    { text: own.text, findings: [] }
                :   encodeWithLanguage(selected.encoding, form, {
                        font: selected.font,
                        lexicon: selected.lexicon,
                    });
            return {
                form,
                native: result.text,
                class: word.class,
                gloss: word.gloss,
                source:
                    own && "text" in own ? own.source
                    : result.findings.length ? "none"
                    : "rows",
                exception: own && "text" in own,
                ...("ambiguous" in own ? { ambiguous: true } : {}),
                ...(from === undefined ? {} : { from }),
            };
        }),
    };
}

/** Validate word, affix and grammar-ending native entries against installed encodings. */
export function checkLexiconNatives(note, ctx) {
    if (!isLanguage(note.fm) || ctx.encodingFindings?.length) return [];
    const findings = [],
        data = note.fm?.data ?? {},
        encodings = ctx.encodings ?? new Map();
    const report = (keys, message) =>
        findings.push({
            file: note.file,
            ...positionOfFrontmatterPath(note.raw ?? "", ["data", ...keys]),
            severity: "error",
            message,
        });
    function check(entries, keys, form) {
        const slots = new Set();
        listOf(entries).forEach((entry, i) => {
            if (!isMap(entry) || typeof entry.enc !== "string" || typeof entry.text !== "string")
                return;
            const encoding =
                encodings.get(entry.enc) ??
                encodings.get(encodingAddress(entry.enc, ctx.contentPackage));
            if (!encoding) {
                report(
                    [...keys, i, "enc"],
                    `\`${entry.enc}\` does not resolve to an encoding document`,
                );
                return;
            }
            if (entry.font !== undefined && !encoding.fonts.includes(entry.font)) {
                report([...keys, i, "font"], fontProblem(encoding, entry.font));
                return;
            }
            if (
                keys[0] === "grammar" &&
                entry.ending !== "plural" &&
                WRITTEN_ENDINGS.includes(entry.ending) &&
                !isMap(data.grammar?.verbs?.persons)
            )
                report(
                    [...keys, i, "ending"],
                    `The ending \`${entry.ending}\` needs data.grammar.verbs.persons`,
                );
            const slot = `${entry.ending ?? ""}\0${encoding.name}\0${entry.font ?? ""}`;
            if (slots.has(slot))
                report([...keys, i], `A second native writing names the same encoding and face`);
            slots.add(slot);
            const fonts =
                entry.font ?
                    [entry.font]
                :   encoding.fonts.filter(
                        (font) =>
                            !listOf(entries).some(
                                (other) =>
                                    other.enc === entry.enc &&
                                    other.font === font &&
                                    other.ending === entry.ending,
                            ),
                    );
            if (typeof form === "string") {
                const same =
                    fonts.length > 0 &&
                    fonts.every((font) => {
                        try {
                            return encodeText(encoding, form, { font }) === entry.text;
                        } catch {
                            return false;
                        }
                    });
                if (same)
                    report(
                        [...keys, i, "text"],
                        `Native writing states what the rows already give for \`${form}\``,
                    );
            }
            for (const font of fonts) {
                const face = ctx.faces?.get(font);
                if (!face) continue;
                const seen = new Set();
                for (const char of entry.text) {
                    const point = char.codePointAt(0);
                    if (
                        /\s/u.test(char) ||
                        (point >= 0xe0100 && point <= 0xe01ef) ||
                        face.draws.has(point) ||
                        seen.has(point)
                    )
                        continue;
                    seen.add(point);
                    report(
                        [...keys, i, "text"],
                        `Native writing holds ${codeName(point)}, which the font \`${font}\` does not draw`,
                    );
                }
            }
        });
    }
    listOf(data.words).forEach((word, i) =>
        check(word?.native, ["words", i, "native"], word?.form),
    );
    listOf(data.affixes).forEach((affix, i) => check(affix?.native, ["affixes", i, "native"]));
    check(data.grammar?.native, ["grammar", "native"]);
    return findings;
}

/** Validate every authored word and name against its language's encoding documents.
 * @param {{fm:Record<string,any>,file:string,raw?:string}} note - The source language note.
 * @param {import("./content-scripts.mjs").RunContext} ctx - Compiled documents and language identities.
 * @returns {object[]} Positioned orthography findings, independent of lexical native overrides.
 */
export function checkEncodingLexicon(note, ctx) {
    if (!isLanguage(note.fm) || ctx.encodingFindings?.length) return [];
    const aliases = new Set(
        [...(ctx.languageRecords ?? [])]
            .filter(
                ([, record]) =>
                    record.shortcode === note.fm.shortcode &&
                    (record.package ?? ctx.contentPackage) === ctx.contentPackage,
            )
            .map(([alias]) => alias),
    );
    const encodings = [
        ...new Map(
            [...(ctx.encodings?.values() ?? [])].map((encoding) => [encoding.name, encoding]),
        ).values(),
    ]
        .filter((encoding) => aliases.has(encoding.language))
        // A codes-only script accepts no letter, so the roman forms are not written in it.
        .filter((encoding) => [...encoding.accepted].some((char) => /\p{L}/u.test(char)));
    if (!encodings.length) return [];
    const forms = [],
        data = note.fm.data ?? {};
    const add = (form, keys, element = false) => {
        if (typeof form === "string" && form) forms.push({ form, keys, element });
    };
    listOf(data.words).forEach((word, i) => {
        add(word?.form, ["words", i, "form"]);
        listOf(word?.variants).forEach((form, j) => add(form, ["words", i, "variants", j]));
    });
    // `en` holds English names, which no encoding of the tongue sees.
    const names = (value, keys) => {
        if (Array.isArray(value))
            value.forEach((item, i) =>
                typeof item === "string" ? add(item, [...keys, i]) : names(item, [...keys, i]),
            );
        else if (isMap(value))
            for (const [key, item] of Object.entries(value))
                if (
                    key !== "pattern" &&
                    key !== "metadata" &&
                    !(keys.length === 1 && key === ENGLISH_GROUP)
                )
                    names(item, [...keys, key]);
    };
    names(data.names, ["names"]);
    listOf(data.elements).forEach((element, i) => {
        add(element?.form, ["elements", i, "form"], true);
        listOf(element?.variants).forEach((form, j) =>
            add(form, ["elements", i, "variants", j], true),
        );
        listOf(element?.examples).forEach((form, j) => add(form, ["elements", i, "examples", j]));
    });
    listOf(data.register).forEach((name, i) => {
        if (name?.tongue !== RESERVED_TONGUE) add(name?.name, ["register", i, "name"]);
    });
    const findings = [],
        seen = new Set();
    for (const encoding of encodings)
        for (const { form, keys, element } of forms) {
            // Edge hyphens on bound elements mark joining positions, not sounds.
            const written = element ? form.replace(/^-|-$/gu, "") : form;
            try {
                validateSource(encoding, written, { font: encoding.font });
                const converted = encodeWithLanguage(encoding, written, {
                    font: encoding.font,
                    lexicon: serializeLexicon(ctx.lexicons?.get(encoding.language)),
                });
                if (converted.findings.length)
                    throw new EncodingError(converted.findings[0].message);
            } catch (error) {
                if (!(error instanceof EncodingError)) throw error;
                const identity = JSON.stringify([encoding.name, form, error.message]);
                if (seen.has(identity)) continue;
                seen.add(identity);
                const position = positionOfFrontmatterPath(note.raw ?? "", ["data", ...keys]);
                if (position.line !== undefined && position.column !== undefined)
                    position.column =
                        [
                            ...((note.raw ?? "").split("\n")[position.line - 1] ?? "").slice(
                                0,
                                position.column - 1,
                            ),
                        ].length + 1;
                findings.push({
                    file: note.file,
                    ...position,
                    severity: "error",
                    message: `\`${form}\` is not valid Roman spelling for encoding \`${encoding.name}\`: ${error.message}`,
                });
            }
        }
    return findings;
}
