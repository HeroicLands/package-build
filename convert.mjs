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
/** Browser conversion from one module's versioned, self-contained data file. */
import { renderAddress } from "./engine/address-render.mjs";
import { compileEncoding, encodeText, decodeText, EncodingError } from "./engine/encoding.mjs";
import { encodeWithLanguage, decodeWithLanguage } from "./engine/encoding-language.mjs";
/**
 * @typedef {{language:string,data:Record<string,any>}} ConverterLexicon
 * @typedef {{name:string,lexicon?:ConverterLexicon}} ConverterLanguage
 * @typedef {{format:2,contentPackage:string,encodings:Record<string,any>,languages:Record<string,ConverterLanguage>}} ConverterData
 * @typedef {{enc?:string,font?:string,verse?:boolean}} ConversionOptions
 */
const compiled = new WeakMap();
const validated = new WeakSet();
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function keys(value, allowed, where) {
    if (!object(value)) throw new TypeError(`${where} must be an object`);
    for (const key of Object.keys(value))
        if (!allowed.includes(key)) throw new TypeError(`${where}.${key} is unknown`);
}
function definition(value, name) {
    if (!object(value)) throw new TypeError("An encoding definition must be an object");
    keys(value, ["data", "codes"], `encodings.${name}`);
    let known = compiled.get(value);
    if (!known) {
        known = compileEncoding(value.data, { codes: value.codes, name });
        compiled.set(value, known);
    }
    return known;
}

function lexicalData(value, where) {
    keys(value, ["words", "affixes", "grammar", "register"], where);
    for (const field of ["words", "affixes", "register"]) {
        if (value[field] === undefined) continue;
        if (!Array.isArray(value[field])) throw new TypeError(`${where}.${field} must be an array`);
        for (const row of value[field]) {
            const name = field === "register" ? "name" : "form";
            if (!object(row) || typeof row[name] !== "string" || !row[name])
                throw new TypeError(`${where}.${field} needs ${name}`);
            if (
                row.native !== undefined &&
                (!Array.isArray(row.native) ||
                    row.native.some(
                        (native) =>
                            !object(native) ||
                            typeof native.enc !== "string" ||
                            typeof native.text !== "string" ||
                            (native.font !== undefined && typeof native.font !== "string"),
                    ))
            )
                throw new TypeError(`${where}.${field} has invalid native writings`);
        }
    }
    if (value.grammar !== undefined && !object(value.grammar))
        throw new TypeError(`${where}.grammar must be an object`);
}

/** Validate the format-2 converter data without opening files or using Node.
 * @param {ConverterData} data Parsed JSON, treated as read-only.
 * @returns {ConverterData} The validated data.
 */
export function validateData(data) {
    if (validated.has(data)) return data;
    keys(data, ["format", "contentPackage", "encodings", "languages"], "data");
    if (data.format !== 2) throw new TypeError("Converter data format must be 2");
    if (
        typeof data.contentPackage !== "string" ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(data.contentPackage)
    )
        throw new TypeError("Converter data needs its canonical contentPackage");
    if (!object(data.encodings) || !object(data.languages))
        throw new TypeError("Converter encodings and languages must be objects");
    for (const [name, value] of Object.entries(data.encodings)) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*-note-doc-[a-z0-9]+$/u.test(name))
            throw new TypeError(`Invalid encoding document Address ${name}`);
        const encoding = definition(value, name);
        if (!Object.hasOwn(data.languages, encoding.language))
            throw new TypeError(`Encoding ${name} needs configured language ${encoding.language}`);
    }
    for (const [language, value] of Object.entries(data.languages)) {
        keys(value, ["name", "lexicon"], `languages.${language}`);
        if (typeof value.name !== "string")
            throw new TypeError(`Language ${language} needs its name`);
        if (value.lexicon !== undefined) {
            keys(value.lexicon, ["language", "data"], `languages.${language}.lexicon`);
            if (typeof value.lexicon.language !== "string" || !object(value.lexicon.data))
                throw new TypeError(`Language ${language} has invalid lexicon inputs`);
            lexicalData(value.lexicon.data, `languages.${language}.lexicon.data`);
        }
    }
    validated.add(data);
    return data;
}

function conversion(data, language, text, options, direction) {
    validateData(data);
    if (typeof text !== "string") throw new TypeError("Conversion input must be text");
    let entry = language === null || language === undefined ? undefined : data.languages[language];
    if (language !== null && language !== undefined && !Object.hasOwn(data.languages, language))
        throw new TypeError(`Unknown language ${language}`);
    const name = options.enc ?? "default";
    if (name === "default") return { text, findings: [] };
    const short = /^(?:(?:note-)?doc-|doc\/)?([a-z0-9]+)$/u.exec(name);
    const selected =
        Object.hasOwn(data.encodings, name) ? name
        : short ?
            renderAddress({
                package: data.contentPackage,
                system: "note",
                type: "doc",
                shortcode: short[1],
            })
        :   undefined;
    if (!selected || !Object.hasOwn(data.encodings, selected))
        throw new TypeError(`Unknown encoding document ${name}`);
    const encoding = definition(data.encodings[selected], selected);
    if (entry && language !== encoding.language)
        throw new TypeError(`Encoding ${selected} writes ${encoding.language}, not ${language}`);
    entry ??= data.languages[encoding.language];
    const settings = {
        font: options.font ?? encoding.font,
        verse: options.verse,
        lexicon: entry?.lexicon,
    };
    if (entry?.lexicon)
        return direction === "encode" ?
                encodeWithLanguage(encoding, text, settings)
            :   decodeWithLanguage(encoding, text, settings);
    try {
        return {
            text:
                direction === "encode" ?
                    encodeText(encoding, text, settings)
                :   decodeText(encoding, text, settings),
            findings: [],
        };
    } catch (error) {
        if (!(error instanceof EncodingError)) throw error;
        return {
            text: "",
            findings: [
                {
                    severity: "error",
                    message: error.message,
                    offset: error.offset ?? 0,
                    line: error.line ?? 1,
                    column: error.column ?? 1,
                },
            ],
        };
    }
}

/** Encode with the selected encoding document's language, optionally stated explicitly.
 * @param {ConverterData} data The module's parsed converter data.
 * @param {string|null|undefined} language A language key, or null to infer it from the encoding.
 * @param {string} text Roman input.
 * @param {ConversionOptions} [options] Encoding, face or verse overrides.
 */
export function encode(data, language, text, options = {}) {
    return conversion(data, language, text, options, "encode");
}
/** Decode with the selected encoding document's optional language lexicon.
 * @param {ConverterData} data The module's parsed converter data.
 * @param {string|null|undefined} language A language key, or null to infer it from the encoding.
 * @param {string} text Encoded Unicode input.
 * @param {ConversionOptions} [options] Encoding or face overrides.
 */
export function decode(data, language, text, options = {}) {
    return conversion(data, language, text, options, "decode");
}
