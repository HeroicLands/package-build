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
 * A language's words: `data.words` on a `skill` note of `subType: language`,
 * with the `data.classModifiers`, `data.fields` and `data.affixes` they are
 * read against. The language of a word is the note it sits on.
 *
 * The inner-key check holds every entry to its declared keys and kinds. This
 * check owns what the values mean, each finding located at the key at fault:
 *
 * - no skill of another subType states these keys;
 * - a word's `class` is a master-set base followed by master-set modifiers,
 *   each declared in `data.classModifiers`, and a declared modifier no word
 *   uses is a warning;
 * - a word's `field` is one of `data.fields`;
 * - a `borrowed` source names its `language`;
 * - no form stands twice in one language;
 * - a word's `gloss` states at least one sense;
 * - an affix that `replaces` the stem's close does not also `lengthen` it;
 * - a word's `frame` names a frame of `data.sounds.frames`, its language's or
 *   an ancestor's;
 * - every source language resolves, and names a language skill;
 * - a pronunciation is a respelling;
 * - a `built` piece no word or affix of the language glosses is a warning.
 *
 * {@link checkLanguageFamily} owns `data.family`, the parent language a
 * daughter reads words from: it is stated only on a language, names a
 * language, and its chain never returns to the note it starts from.
 * {@link checkLanguageAbbreviation} owns `data.abbreviation`, the tag a
 * dictionary prints for the language: it is stated only on a language, and is
 * not blank.
 *
 * @module
 */

import { pathLabel as label } from "./data-keys.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { readCanonicalKey } from "./address.mjs";
import { addressKeyOf, ownKey } from "./culture-reach.mjs";
import {
    BORROWED_SOURCE_KIND,
    LANGUAGE_SUBTYPE,
    WORD_DATA_KEYS,
    glossSenses,
    pronunciationProblem,
} from "./word-terms.mjs";
import { WORD_CLASS_MODIFIERS, parseWordClass } from "./word-classes.mjs";
import { lineageChain, pieceGlosses } from "./word-rows.mjs";

const MODIFIER_TOKENS = new Set(WORD_CLASS_MODIFIERS.map((item) => item.token));

/** Whether a value is a plain map. */
const isMap = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** A list value, or an empty one. */
const listOf = (value) => (Array.isArray(value) ? value : []);

/**
 * Check a `skill` note's words against what they mean.
 *
 * @param {object} note - A `skill` note.
 * @param {{index?: object}} [context] - The index, for whether an Address
 *   resolves. Without one, only what the note says of itself is checked.
 * @returns {object[]} The findings.
 */
export function checkLanguageWords(note, { index } = {}) {
    const fm = note?.fm ?? {};
    const data = isMap(fm.data) ? fm.data : {};
    const raw = note.raw ?? "";
    const finding = (path, severity, message, key = false) => ({
        file: note.file,
        ...positionOfFrontmatterPath(raw, path, { key }),
        severity,
        message,
    });
    const stated = (key) => data[key] !== undefined && data[key] !== null;

    if (String(fm.subType ?? "").toLowerCase() !== LANGUAGE_SUBTYPE)
        return WORD_DATA_KEYS.filter(stated).map((key) =>
            finding(
                ["data", key],
                "error",
                `\`data.${key}\` holds a language's words, and this note's \`subType\` is not ` +
                    `\`${LANGUAGE_SUBTYPE}\``,
                true,
            ),
        );

    const findings = [];

    const declared = new Map();
    listOf(data.classModifiers).forEach((token, i) => {
        if (typeof token === "string" && MODIFIER_TOKENS.has(token) && !declared.has(token))
            declared.set(token, i);
    });
    const fieldNames = new Set(
        listOf(data.fields)
            .filter((field) => isMap(field) && typeof field.name === "string")
            .map((field) => field.name),
    );
    /**
     * Whether an Address resolves, and, for a language, names a language skill.
     *
     * @param {unknown} value - The Address as the note holds it.
     * @param {Array<string|number>} path - Where it sits.
     * @param {string} type - The type a bare shortcode defaults to.
     * @returns {object[]} The findings.
     */
    function addressFindings(value, path, type) {
        if (!index?.addressHit || value === undefined || value === null) return [];
        const key = addressKeyOf(value, index, type);
        if (!key)
            return [
                finding(
                    path,
                    "error",
                    `\`${label(path)}\` is not an Address: ${JSON.stringify(value)}`,
                ),
            ];
        const target = index.addressHit(key);
        if (!target)
            return [
                finding(
                    path,
                    "error",
                    `\`${label(path)}\` names ${key}, which does not resolve in this package or ` +
                        "its declared dependencies",
                ),
            ];
        return [{ target, key }];
    }

    /** As {@link addressFindings}, and the target must be a language skill. */
    function languageFindings(value, path) {
        const out = [];
        for (const result of addressFindings(value, path, "skill")) {
            if (!result.target) {
                out.push(result);
                continue;
            }
            const target = result.target.fm ?? result.target;
            if (target.type === "skill" && target.subType === "language") continue;
            out.push(
                finding(
                    path,
                    "error",
                    `\`${label(path)}\` names ${result.key}, which is not a skill whose subType ` +
                        "is language",
                ),
            );
        }
        return out;
    }

    // The language's own entries, then each ancestor's through `data.family`.
    const ownAddress = ownKey(note, index);
    const dataAt = (key) => {
        const hit = index?.addressHit?.(key);
        const target = hit?.fm ?? hit;
        return target?.subType === LANGUAGE_SUBTYPE && isMap(target.data) ? target.data : undefined;
    };
    const ancestors =
        index?.addressHit && stated("family") ?
            lineageChain(addressKeyOf(data.family, index, "skill"), {
                has: (key) => key !== ownAddress && dataAt(key) !== undefined,
                parentOf: (key) => addressKeyOf(dataAt(key).family, index, "skill"),
            }).map((key) => dataAt(key))
        :   [];
    const glossOf = pieceGlosses(data, ...ancestors);
    // The frames a word may be set in: its language's, then each ancestor's.
    const frames = new Set();
    for (const one of [data, ...ancestors]) {
        const sounds = isMap(one?.sounds) ? one.sounds : {};
        for (const frame of listOf(sounds.frames))
            if (isMap(frame) && typeof frame.frame === "string") frames.add(frame.frame);
    }
    const used = new Set();
    const forms = new Map();
    listOf(data.words).forEach((word, i) => {
        if (!isMap(word)) return;
        const at = (key) => ["data", "words", i, key];

        if (typeof word.class === "string") {
            const parsed = parseWordClass(word.class);
            if (parsed.reason)
                findings.push(
                    finding(at("class"), "error", `the class \`${word.class}\`: ${parsed.reason}`),
                );
            else
                for (const token of parsed.modifiers) {
                    used.add(token);
                    if (!declared.has(token))
                        findings.push(
                            finding(
                                at("class"),
                                "error",
                                `the modifier \`${token}\` in \`${word.class}\` is not declared in ` +
                                    "`data.classModifiers`",
                            ),
                        );
                }
        }

        if (typeof word.field === "string" && !fieldNames.has(word.field))
            findings.push(
                finding(
                    at("field"),
                    "error",
                    `the field \`${word.field}\` is not one of this language's \`data.fields\``,
                ),
            );

        if (typeof word.form === "string") {
            const key = word.form.normalize("NFC");
            if (forms.has(key))
                findings.push(
                    finding(
                        at("form"),
                        "error",
                        `\`${word.form}\` stands twice in this language, first at ` +
                            `\`data.words[${forms.get(key)}]\``,
                    ),
                );
            else forms.set(key, i);
        }

        if (isMap(word.source)) {
            if (word.source.kind === BORROWED_SOURCE_KIND && (word.source.language ?? "") === "")
                findings.push(
                    finding(
                        at("source"),
                        "error",
                        "a `borrowed` source names the tongue the word was borrowed from in its `language`",
                    ),
                );
            findings.push(...languageFindings(word.source.language, [...at("source"), "language"]));
        }

        if (typeof word.frame === "string" && !frames.has(word.frame))
            findings.push(
                finding(
                    at("frame"),
                    "error",
                    `the frame \`${word.frame}\` of \`${word.form}\` is not one of this language's ` +
                        "`data.sounds.frames`",
                ),
            );

        if (Array.isArray(word.gloss) && !glossSenses(word.gloss).length)
            findings.push(
                finding(at("gloss"), "error", "a `gloss` list states at least one sense"),
            );

        if (typeof word.pronunciation === "string") {
            const problem = pronunciationProblem(word.pronunciation);
            if (problem)
                findings.push(
                    finding(
                        at("pronunciation"),
                        "error",
                        `\`data.words[${i}].pronunciation\` is not a respelling: ${problem}`,
                    ),
                );
        }

        listOf(word.built).forEach((piece, j) => {
            if (typeof piece !== "string" || glossOf(piece) !== null) return;
            findings.push(
                finding(
                    [...at("built"), j],
                    "warning",
                    `the piece \`${piece}\` of \`${word.form}\` matches no word or affix of this ` +
                        "language or its ancestors, so it prints with no gloss",
                ),
            );
        });
    });

    listOf(data.affixes).forEach((affix, i) => {
        if (!isMap(affix) || affix.lengthens !== true || affix.replaces == null) return;
        findings.push(
            finding(
                ["data", "affixes", i, "lengthens"],
                "error",
                `\`${affix.form}\`: an affix that replaces the stem's close does not also lengthen ` +
                    "its last vowel; state one",
                true,
            ),
        );
    });

    for (const [token, i] of declared)
        if (!used.has(token))
            findings.push(
                finding(
                    ["data", "classModifiers", i],
                    "warning",
                    `the modifier \`${token}\` is declared, and no word uses it`,
                ),
            );

    return findings;
}

/**
 * Check a `skill` note's `data.abbreviation`: an error on a skill of another
 * subType, at the key, and on a blank value, at the value.
 *
 * @param {object} note - A `skill` note.
 * @returns {object[]} The findings.
 */
export function checkLanguageAbbreviation(note) {
    const fm = note?.fm ?? {};
    const value = isMap(fm.data) ? fm.data.abbreviation : undefined;
    if (value === undefined || value === null) return [];
    const finding = (message, key = false) => ({
        file: note.file,
        ...positionOfFrontmatterPath(note.raw ?? "", ["data", "abbreviation"], { key }),
        severity: "error",
        message,
    });
    if (String(fm.subType ?? "").toLowerCase() !== LANGUAGE_SUBTYPE)
        return [
            finding(
                "`data.abbreviation` is the tag a dictionary prints for a language, and this " +
                    `note's \`subType\` is not \`${LANGUAGE_SUBTYPE}\``,
                true,
            ),
        ];
    if (typeof value === "string" && !value.trim())
        return [
            finding("`data.abbreviation` is blank; state the tag, as `Prov.`, or leave it out"),
        ];
    return [];
}

/**
 * Check a `skill` note's `data.family`.
 *
 * An Address that does not resolve is the reference check's to report, so this
 * speaks about a key on the wrong subType, a target that is not a language, and
 * a chain of parents that returns to this note.
 *
 * @param {object} note - A `skill` note.
 * @param {{index?: object}} [context] - The index, for what the chain reaches.
 * @returns {object[]} The findings.
 */
export function checkLanguageFamily(note, { index } = {}) {
    const fm = note?.fm ?? {};
    const value = isMap(fm.data) ? fm.data.family : undefined;
    if (value === undefined || value === null) return [];
    const raw = note.raw ?? "";
    const finding = (message, key = false) => ({
        file: note.file,
        ...positionOfFrontmatterPath(raw, ["data", "family"], { key }),
        severity: "error",
        message,
    });
    if (String(fm.subType ?? "").toLowerCase() !== LANGUAGE_SUBTYPE)
        return [
            finding(
                "`data.family` names the parent of a language, and this note's `subType` is " +
                    `not \`${LANGUAGE_SUBTYPE}\``,
                true,
            ),
        ];
    if (!index?.addressHit) return [];
    const key = addressKeyOf(value, index, "skill");
    const target = key ? index.addressHit(key) : undefined;
    if (!target) return [];
    // The type is the Address's own; the subType is the target's.
    const isLanguage = (address, hit) =>
        readCanonicalKey(address)?.type === "skill" &&
        (hit?.fm ?? hit)?.subType === LANGUAGE_SUBTYPE;
    if (!isLanguage(key, target))
        return [
            finding(`\`data.family\` names ${key}, which is not a skill whose subType is language`),
        ];
    const own = ownKey(note, index);
    const seen = new Set();
    let current = key;
    while (current && !seen.has(current)) {
        if (current === own)
            return [
                finding(
                    `\`data.family\` names ${key}, and the chain of parents returns to this ` +
                        "language: a family is a cycle",
                ),
            ];
        seen.add(current);
        const hit = index.addressHit(current);
        if (!isLanguage(current, hit)) break;
        const payload = hit.fm ?? hit;
        current = addressKeyOf(payload.data?.family, index, "skill");
    }
    return [];
}
