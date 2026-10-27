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

/** Language-aware conversion over plain JSON lexicons, usable in browsers and Node. */
import {
    encodePieces,
    encodeText,
    decodeText,
    EncodingError,
    validateSource,
} from "./encoding.mjs";
import { writingsOf } from "./language-writings.mjs";
import { derivedForms, foldWord } from "./word-forms.mjs";
import { WORD } from "./word-pattern.mjs";

const OPEN = "\u{E0112}",
    CLOSE = "\u{E0113}",
    ESCAPE = "\u{E0115}";
const MARKS = /[\u{E0100}-\u{E01EF}]/u;
const stripMarks = (text) => text.replace(/[\u{E0100}-\u{E01EF}]/gu, "");
const list = (value) => (Array.isArray(value) ? value : []);
const letter = /\p{L}/u;
const cp = (text, at) => String.fromCodePoint(text.codePointAt(at));
const lexical = (text) => /^[\p{L}\p{M}\p{N}’'–-]+$/u.test(text);
function finding(text, offset, message) {
    return {
        severity: "error",
        offset,
        line: text.slice(0, offset).split("\n").length,
        column: [...text.slice(text.lastIndexOf("\n", offset - 1) + 1, offset)].length + 1,
        message,
    };
}
function optionsFor(enc, options) {
    return { ...options, font: options.font ?? enc.fonts[0] };
}
function initialCapital(word) {
    const first = cp(word, 0);
    return first.toUpperCase() + word.slice(first.length);
}
function capitalWriting(enc, word, native, font) {
    const first = (source) => {
        try {
            return encodePieces(enc, source, { font })[0];
        } catch (error) {
            if (!(error instanceof EncodingError) || !(error.offset > 0)) return undefined;
            try {
                return encodePieces(enc, source, { font, end: error.offset })[0];
            } catch {
                return undefined;
            }
        }
    };
    const lower = first(word.toLowerCase()),
        upper = first(word);
    return (
            lower && upper && lower.from.length === upper.from.length && native.startsWith(lower.to)
        ) ?
            upper.to + native.slice(lower.to.length)
        :   undefined;
}
function entryForms(lexicon) {
    const data = lexicon?.data ?? {};
    const derived = new Map();
    for (const entry of derivedForms(data)) {
        if (!derived.has(entry.word)) derived.set(entry.word, []);
        derived.get(entry.word).push(entry);
    }
    // Authored word order decides recovery ties. Each citation precedes its
    // own variants and derived forms, before the next word's citation.
    const words = list(data.words).filter((word) => typeof word?.form === "string");
    return [
        ...words.flatMap((word) => {
            const seen = new Set();
            const seenComponents = new Set();
            const forms = [];
            for (const form of [
                word.form,
                ...list(word.variants),
                ...(derived.get(word) ?? []).map((entry) => entry.form),
            ]) {
                if (typeof form !== "string" || !form || seen.has(form)) continue;
                seen.add(form);
                forms.push({ form, word });
                const parts = [...form.matchAll(WORD)].map(([part]) => part);
                if (parts.length > 1)
                    for (const part of parts) {
                        if (seenComponents.has(part)) continue;
                        seenComponents.add(part);
                        // Components establish recovery and known-word membership,
                        // not ownership of their expression's native spelling.
                        forms.push({ form: part, component: true });
                    }
            }
            return forms;
        }),
        ...list(data.register)
            .filter((row) => typeof row?.name === "string" && row.tongue !== "translation")
            .flatMap((row) => {
                const canonical = foldWord(row.name);
                const forms = [...new Set([row.name, canonical])].map((form) => ({
                    form,
                    name: true,
                    canonical,
                }));
                if ([...row.name.matchAll(WORD)].length > 1)
                    for (const [part] of row.name.matchAll(WORD))
                        for (const form of new Set([part, foldWord(part)]))
                            forms.push({ form, name: false, namePart: true });
                return forms;
            }),
    ];
}

function literalEnd(text, at) {
    let cursor = at + OPEN.length;
    while (cursor < text.length) {
        if (text.startsWith(ESCAPE, cursor)) {
            cursor +=
                ESCAPE.length +
                (cursor + ESCAPE.length < text.length ?
                    cp(text, cursor + ESCAPE.length).length
                :   0);
            continue;
        }
        if (text.startsWith(CLOSE, cursor)) return cursor + CLOSE.length;
        cursor += cp(text, cursor).length;
    }
    return text.length;
}

/**
 * Encode using the lexicon's own and composed writings before the encoding rows.
 * @param {ReturnType<import("./encoding.mjs").compileEncoding>} enc
 * @param {string} text
 * @param {{font?:string,verse?:boolean,lexicon?:{language:string,data:Record<string,any>}}} [options]
 * @returns {{text:string,pieces:object[],findings:object[]}}
 */
export function encodeWithLanguage(enc, text, options = {}) {
    options = optionsFor(enc, options);
    const findings = [],
        pieces = [];
    if (enc.template) {
        try {
            validateSource(enc, text, { font: options.font });
        } catch (error) {
            if (!(error instanceof EncodingError)) throw error;
            return {
                text: "",
                pieces,
                findings: [finding(text, error.offset ?? 0, error.message)],
            };
        }
    }
    const writing =
        options.lexicon ? writingsOf(options.lexicon.data, enc.name, options.font) : undefined;
    const phrases =
        options.lexicon ?
            entryForms(options.lexicon)
                .map((entry) => entry.form)
                .filter((form) => [...form.matchAll(WORD)].length > 1)
                .map((form) => ({
                    form,
                    spaces: form.match(/[\p{Zs}\u0009-\u000D]+/gu) ?? [],
                    pattern: new RegExp(
                        form
                            .split(/[\p{Zs}\u0009-\u000D]+/u)
                            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
                            .join("[\\p{Zs}\\u0009-\\u000D]+"),
                        "iuy",
                    ),
                }))
        :   [];
    let at = 0;
    const appendRows = (from, to) => {
        let cursor = from;
        while (cursor < to) {
            try {
                pieces.push(
                    ...encodePieces(enc, text, {
                        font: options.font,
                        verse: options.verse,
                        start: cursor,
                        end: to,
                    }),
                );
                return;
            } catch (error) {
                if (!(error instanceof EncodingError)) throw error;
                const offset = error.offset ?? cursor;
                findings.push(finding(text, offset, error.message));
                if (offset > cursor) {
                    try {
                        pieces.push(
                            ...encodePieces(enc, text, {
                                font: options.font,
                                verse: options.verse,
                                start: cursor,
                                end: offset,
                            }),
                        );
                    } catch {
                        /* An invalid literal is refused as one span. */
                    }
                }
                const open = text.lastIndexOf("⟦", offset),
                    close = text.lastIndexOf("⟧", offset);
                if (open > close) {
                    const end = text.indexOf("⟧", offset);
                    cursor = end < 0 ? to : end + 1;
                } else cursor = offset + (offset < text.length ? cp(text, offset).length : 1);
            }
        }
    };
    for (const match of text.matchAll(WORD)) {
        const start = match.index;
        if (start < at) continue;
        // Literal contents belong to the encoding's codes, not to a language lexicon.
        const open = text.lastIndexOf("⟦", start),
            close = text.lastIndexOf("⟧", start);
        if (open > close) continue;
        // The authored longest phrase wins before individual word overrides.
        // Match only complete words, and leave literal payloads to the codes.
        let phrase;
        for (const candidate of phrases) {
            candidate.pattern.lastIndex = start;
            const found = candidate.pattern.exec(text)?.[0];
            if (
                !found ||
                found.includes("⟦") ||
                found.includes("⟧") ||
                /[\p{L}\p{M}\p{N}’'–-]/u.test(text[start + found.length] ?? "")
            )
                continue;
            let space = 0;
            const lookup = found.replace(
                /[\p{Zs}\u0009-\u000D]+/gu,
                () => candidate.spaces[space++],
            );
            const own = writing.word(lookup);
            if (!("text" in own) && !("ambiguous" in own)) continue;
            if (!phrase || found.length > phrase.text.length) phrase = { text: found, lookup, own };
        }
        if (phrase) match[0] = phrase.text;
        const lookup = phrase?.lookup ?? match[0];
        const own = phrase?.own ?? writing?.word(lookup);
        if (own && "ambiguous" in own) {
            appendRows(at, start);
            findings.push(
                finding(
                    text,
                    start,
                    `\`${match[0]}\` has ambiguous writings in the \`${options.lexicon.language}\` lexicon: ${own.ambiguous.glosses.join("; ")}`,
                ),
            );
            at = start + match[0].length;
        } else if (own && "text" in own) {
            appendRows(at, start);
            let native = own.text;
            const exact = list(options.lexicon.data.words).some(
                (entry) => entry.form === lookup || list(entry.variants).includes(lookup),
            );
            if (!exact && match[0] !== match[0].toLowerCase()) {
                const capital =
                    match[0] === initialCapital(match[0].toLowerCase()) ?
                        capitalWriting(enc, match[0], native, options.font)
                    :   undefined;
                if (capital === undefined) {
                    findings.push(
                        finding(
                            text,
                            start,
                            `The encoding cannot capitalize the native writing of \`${match[0].toLowerCase()}\`; author \`${match[0]}\` with its own native entry`,
                        ),
                    );
                    at = start + match[0].length;
                    continue;
                }
                native = capital;
            }
            pieces.push({
                from: match[0],
                to: native,
                start,
                end: start + match[0].length,
                row: null,
                native: true,
                source: own.source,
            });
            at = start + match[0].length;
        } else if (letter.test(match[0]) && ![...enc.accepted].some((char) => letter.test(char))) {
            appendRows(at, start);
            findings.push(
                finding(
                    text,
                    start,
                    `\`${match[0]}\` has no writing in the \`${options.lexicon?.language ?? "unspecified language"}\` lexicon for \`${enc.name}\`; write it from the lexicon or as ⟦codage⟧`,
                ),
            );
            at = start + match[0].length;
        }
    }
    appendRows(at, text.length);
    return { text: findings.length ? "" : pieces.map((p) => p.to).join(""), pieces, findings };
}

/**
 * Decode with explicit writings first and recover unmarked words from the lexicon.
 * @param {ReturnType<import("./encoding.mjs").compileEncoding>} enc
 * @param {string} text
 * @param {{font?:string,lexicon?:{language:string,data:Record<string,any>}}} [options]
 * @returns {{text:string,findings:object[]}}
 */
export function decodeWithLanguage(enc, text, options = {}) {
    options = optionsFor(enc, options);
    if (!options.lexicon) {
        try {
            return { text: decodeText(enc, text, options), findings: [] };
        } catch (error) {
            if (!(error instanceof EncodingError)) throw error;
            return { text: "", findings: [finding(text, error.offset ?? 0, error.message)] };
        }
    }
    const findings = [],
        forms = entryForms(options.lexicon),
        writing = writingsOf(options.lexicon.data, enc.name, options.font);
    const own = [];
    const skeletons = new Map();
    const knownForms = new Set(
        forms.filter((entry) => !entry.name).map((entry) => foldWord(entry.form)),
    );
    for (const entry of forms) {
        const native = entry.name || entry.component ? undefined : writing.word(entry.form);
        // Keep authored senses in order; entry-specific native texts can share a spelling.
        // Derived forms instead use their composed stem and ending writing above.
        const authored =
            entry.form === entry.word?.form || list(entry.word?.variants).includes(entry.form);
        const explicit =
            authored ?
                list(entry.word?.native).filter(
                    (n) => n.enc === enc.name && (!n.font || n.font === options.font),
                )
            :   [];
        const chosen =
            explicit.find((n) => n.font === options.font) ?? explicit.find((n) => !n.font);
        if (chosen || (native && "text" in native)) {
            const target = chosen?.text ?? native.text;
            own.push({ text: target, form: entry.form, name: entry.name });
            if (entry.form === entry.form.toLowerCase()) {
                const title = initialCapital(entry.form),
                    capital = capitalWriting(enc, title, target, options.font);
                if (capital !== undefined && capital !== target)
                    own.push({ text: capital, form: title });
            }
        }
        if (entry.name) {
            const encoded = encodeWithLanguage(enc, entry.form, options);
            if (!encoded.findings.length) {
                const target = stripMarks(encoded.text);
                if (target)
                    own.push({ text: target, form: entry.canonical, name: true, recovery: true });
            }
        }
        try {
            const skeleton = decodeText(
                enc,
                stripMarks(encodeText(enc, entry.form, options)),
                options,
            );
            if (skeleton && !skeletons.has(skeleton)) skeletons.set(skeleton, entry);
        } catch (error) {
            if (!(error instanceof EncodingError)) throw error;
        }
    }
    own.sort((a, b) => [...b.text].length - [...a.text].length);
    const nativeReadings = new Map();
    for (const entry of own) {
        if (!entry.text) continue;
        const first = cp(entry.text, 0);
        if (!nativeReadings.has(first)) nativeReadings.set(first, []);
        nativeReadings.get(first).push(entry);
    }
    const reader = enc.faces.get(options.font)?.readings ?? enc.shared.readings;
    const noLetters = ![...enc.accepted].some((char) => letter.test(char));
    let out = "",
        at = 0,
        named = false;
    function plain(raw, offset) {
        try {
            return decodeText(enc, raw, options);
        } catch (error) {
            if (!(error instanceof EncodingError)) throw error;
            findings.push(finding(text, offset + (error.offset ?? 0), error.message));
            return "";
        }
    }
    const rowAt = (offset) =>
        (reader.get(cp(text, offset)) ?? []).find((row) => text.startsWith(row.to, offset));
    const wordEnd = (from) => {
        let cursor = from;
        while (cursor < text.length && !text.startsWith(OPEN, cursor)) {
            const row = rowAt(cursor);
            if (row && !lexical(row.from)) break;
            cursor += row?.to.length ?? cp(text, cursor).length;
        }
        return cursor;
    };
    const nativeAt = (offset) =>
        (nativeReadings.get(cp(text, offset)) ?? []).find((entry) => {
            if (!entry.text || !text.startsWith(entry.text, offset)) return false;
            if (noLetters) return true;
            // A shorter native spelling must not consume a prefix of a complete
            // alphabetic word. A native writing may itself cross spaces or marks.
            const end = offset + entry.text.length;
            return end === wordEnd(end);
        });
    let previousWord = false;
    const appendWord = (roman) => {
        if (noLetters && previousWord) out += " ";
        out += roman;
        previousWord = true;
    };
    while (at < text.length) {
        if (text.startsWith(OPEN, at)) {
            const end = literalEnd(text, at);
            out += plain(text.slice(at, end), at);
            at = end;
            previousWord = false;
            continue;
        }
        const native = nativeAt(at);
        if (native) {
            appendWord(native.name && !named ? `{${native.form}}` : native.form);
            at += native.text.length;
            continue;
        }
        const row = rowAt(at);
        if (row && !lexical(row.from)) {
            out += row.from;
            named =
                row.from === "{" ? true
                : row.from === "}" ? false
                : named;
            at += row.to.length;
            previousWord = false;
            continue;
        }
        const start = at;
        if (noLetters) {
            // An unknown stretch ends before the next known writing, so a
            // missing word cannot swallow the rest of a sign passage.
            at += row?.to.length ?? cp(text, at).length;
            while (at < text.length && !text.startsWith(OPEN, at) && !nativeAt(at)) {
                const following = rowAt(at);
                if (following && !lexical(following.from)) break;
                at += following?.to.length ?? cp(text, at).length;
            }
            const raw = text.slice(start, at);
            const roman = `⟦${[...raw].map((char) => `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`).join(" ")}⟧`;
            appendWord(decodeText(enc, encodeText(enc, roman, options), options));
            findings.push(
                finding(
                    text,
                    start,
                    `These signs are not a word of the \`${options.lexicon.language}\` lexicon`,
                ),
            );
            continue;
        }
        at = wordEnd(at);
        const raw = text.slice(start, at);
        const decoded = plain(raw, start);
        if (MARKS.test(raw)) {
            out += decoded;
            continue;
        }
        const recovered = skeletons.get(decoded);
        if (recovered)
            out +=
                recovered.name && !named ? `{${recovered.canonical ?? recovered.form}}`
                : recovered.name ? (recovered.canonical ?? recovered.form)
                : recovered.form;
        else if (knownForms.has(foldWord(decoded))) out += decoded;
        else {
            out += decoded;
            findings.push(
                finding(
                    text,
                    start,
                    `\`${decoded}\` is not in the \`${options.lexicon.language}\` lexicon`,
                ),
            );
        }
    }
    return { text: out, findings };
}
