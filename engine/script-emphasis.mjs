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
 * **How a script marks emphasis.** A script note — a `skill` of
 * `subType: script` — names the faces it is written in and its scribal
 * convention for a stressed word:
 *
 * ```yaml
 * data:
 *   script:
 *     fonts: [semaron-kuriale]
 *     emphasis: rubric
 *     strongEmphasis: overline
 * ```
 *
 * - **`fonts`** lists installed faces by the slug `font=` names them by. A
 *   face belongs to one script.
 * - **`emphasis`** is `rubric` (red text) or `overline` (a line above the
 *   word), and sets both `*…*` and `**…**`.
 * - **`strongEmphasis`**, where stated, sets `**…**` alone.
 *
 * Inside a run in one of those faces, `*…*` and `**…**` stay an `<em>` and a
 * `<strong>` on the site and in Foundry, carrying {@link module:engine/script-emphasis-terms.EMPHASIS_CLASSES}'s
 * class, and the book sets them in its rubric ink or under an overline. A face
 * no script note lists sets its emphasis plain: the element with no class, in
 * the face's Regular. See {@link module:engine/content-scripts.renderRuns}.
 *
 * @module
 */

import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { isNoteRecord } from "./index-records.mjs";
import { nearest } from "./near-miss.mjs";
import { FONTS_PACKAGE } from "./script-fonts.mjs";
import {
    EMPHASIS_CONVENTIONS,
    LANGUAGE_EMPHASES,
    SCRIPT_SUBTYPE,
} from "./script-emphasis-terms.mjs";
import { GENERIC_FAMILIES } from "./text-maps.mjs";
import { LANGUAGE_SUBTYPE } from "./word-terms.mjs";

export {
    EMPHASIS_CLASSES,
    EMPHASIS_CONVENTIONS,
    LANGUAGE_EMPHASES,
} from "./script-emphasis-terms.mjs";

/**
 * One face's conventions, one for each level of emphasis.
 *
 * @typedef {object} Emphasis
 * @property {"rubric"|"overline"} em - What `*…*` is set by.
 * @property {"rubric"|"overline"} strong - What `**…**` is set by.
 */

/**
 * A convention a language note states.
 *
 * @typedef {"words"|"rubric"|"overline"} LanguageEmphasis
 */

/** Whether a value is a plain map. */
const isMap = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Whether a value is one of the conventions. */
const isConvention = (value) => EMPHASIS_CONVENTIONS.includes(value);

/**
 * Each face's conventions, from the script notes among the index records. The
 * first note to list a face keeps it; a second is the lint's to report, and a
 * note whose convention is unknown gives none.
 *
 * @param {Iterable<Record<string, any>>|undefined} records - Index records.
 * @returns {Map<string, Emphasis>} The conventions, by face slug.
 */
export function emphasesFromRecords(records) {
    const out = new Map();
    for (const record of records ?? []) {
        if (!record || !isNoteRecord(record)) continue;
        if (
            record.type !== "skill" ||
            String(record.subType ?? "").toLowerCase() !== SCRIPT_SUBTYPE
        )
            continue;
        const script = record.data?.script;
        if (!isMap(script) || !Array.isArray(script.fonts) || !isConvention(script.emphasis))
            continue;
        const strong =
            script.strongEmphasis === undefined || script.strongEmphasis === null ?
                script.emphasis
            :   script.strongEmphasis;
        if (!isConvention(strong)) continue;
        const emphasis = Object.freeze({ em: script.emphasis, strong });
        for (const slug of script.fonts)
            if (typeof slug === "string" && !out.has(slug)) out.set(slug, emphasis);
    }
    return out;
}

/**
 * The convention each language's note states.
 *
 * @param {ReadonlyMap<string, Record<string, any>>} byName - Each configured
 *   language's note record, by language name, from
 *   {@link module:engine/map-lexicon.languageRecordsByName}.
 * @returns {Map<string, LanguageEmphasis>} The conventions, by language name;
 *   a language whose note states none, or one the build does not know, is
 *   absent.
 */
export function languageEmphasesOf(byName) {
    const out = new Map();
    for (const [name, record] of byName ?? [])
        if (LANGUAGE_EMPHASES.includes(record?.data?.emphasis)) out.set(name, record.data.emphasis);
    return out;
}

/**
 * Refuse `data.emphasis` on a skill that is not a language, at its key.
 *
 * @param {{file: string, raw?: string, fm?: Record<string, any>}} note - The note.
 * @returns {object[]} The findings.
 */
export function checkLanguageEmphasis(note) {
    const value = note?.fm?.data?.emphasis;
    if (value === undefined || value === null) return [];
    if (String(note.fm?.subType ?? "").toLowerCase() === LANGUAGE_SUBTYPE) return [];
    return [
        {
            file: note.file,
            ...positionOfFrontmatterPath(note.raw ?? "", ["data", "emphasis"], { key: true }),
            severity: "error",
            message:
                "`data.emphasis` states how a language marks emphasis, and this note's " +
                `\`subType\` is not \`${LANGUAGE_SUBTYPE}\``,
        },
    ];
}

/** The notes listing each face, read once per lint index. */
const listedFaces = new WeakMap();

/**
 * Each face the index's script notes list, and the notes listing it.
 *
 * @param {{notes?: Iterable<{file: string, fm?: Record<string, any>}>}} index - The lint index.
 * @returns {Map<string, string[]>} Slug → the files that list it.
 */
function facesIn(index) {
    const known = listedFaces.get(index);
    if (known) return known;
    const faces = new Map();
    for (const note of index.notes ?? []) {
        const fm = note?.fm;
        if (fm?.type !== "skill" || String(fm.subType ?? "").toLowerCase() !== SCRIPT_SUBTYPE)
            continue;
        const fonts = fm.data?.script?.fonts;
        if (!Array.isArray(fonts)) continue;
        for (const slug of new Set(fonts.filter((value) => typeof value === "string"))) {
            if (!faces.has(slug)) faces.set(slug, []);
            faces.get(slug).push(note.file);
        }
    }
    listedFaces.set(index, faces);
    return faces;
}

/**
 * Check a note's `data.script`: that the note is a script, and that its
 * `fonts` is not empty, names no generic family, lists no face twice, and
 * lists no face another script note lists. The data-key check owns every key,
 * its kind and the conventions; whether a face is installed is
 * {@link checkScriptNoteFonts}'s.
 *
 * @param {{file: string, raw?: string, fm?: Record<string, any>}} note - The note.
 * @param {{index?: {notes?: Iterable<object>}}} [context] - The lint index.
 * @returns {object[]} The findings, each at its key or entry.
 */
export function checkScriptField(note, { index } = {}) {
    const value = note?.fm?.data?.script;
    if (value === undefined || value === null) return [];
    const raw = note.raw ?? "";
    /**
     * @param {Array<string|number>} keyPath - Where the fault is.
     * @param {string} message - What is wrong.
     * @param {boolean} [key] - Locate the key rather than its value.
     */
    const finding = (keyPath, message, key = false) => ({
        file: note.file,
        ...positionOfFrontmatterPath(raw, ["data", "script", ...keyPath], { key }),
        severity: "error",
        message,
    });
    if (String(note.fm?.subType ?? "").toLowerCase() !== SCRIPT_SUBTYPE)
        return [
            finding(
                [],
                "`data.script` states a script's faces and emphasis, and this note's " +
                    `\`subType\` is not \`${SCRIPT_SUBTYPE}\``,
                true,
            ),
        ];
    if (!isMap(value) || !Array.isArray(value.fonts)) return [];
    const { fonts } = value;
    if (!fonts.length)
        return [
            finding(
                ["fonts"],
                "`data.script.fonts` is empty; a script lists each face it is written in",
            ),
        ];
    const findings = [];
    const first = new Map();
    fonts.forEach((slug, at) => {
        if (typeof slug !== "string") return;
        if (GENERIC_FAMILIES.includes(slug)) {
            findings.push(
                finding(
                    ["fonts", at],
                    `\`data.script.fonts[${at}]\` is \`${slug}\`, a generic family; a script lists the faces it is written in`,
                ),
            );
            return;
        }
        if (first.has(slug)) {
            findings.push(
                finding(
                    ["fonts", at],
                    `\`data.script.fonts[${at}]\` lists the font \`${slug}\` a second time; the first is ` +
                        `\`data.script.fonts[${first.get(slug)}]\``,
                ),
            );
            return;
        }
        first.set(slug, at);
        if (!index) return;
        const others = (facesIn(index).get(slug) ?? []).filter((file) => file !== note.file);
        if (others.length)
            findings.push(
                finding(
                    ["fonts", at],
                    `\`data.script.fonts[${at}]\` is \`${slug}\`, which ${others.join(", ")} also lists; a face belongs to one script`,
                ),
            );
    });
    return findings;
}

/**
 * Each face a script note lists that is not installed, at its entry.
 *
 * @param {{file: string, raw?: string, fm?: Record<string, any>}} note - The note.
 * @param {{faces?: ReadonlyMap<string, unknown>}} [ctx] - The installed faces,
 *   from {@link module:engine/content-scripts.runContext}.
 * @returns {object[]} The findings.
 */
export function checkScriptNoteFonts(note, ctx) {
    const fm = note?.fm;
    if (String(fm?.subType ?? "").toLowerCase() !== SCRIPT_SUBTYPE) return [];
    const fonts = fm?.data?.script?.fonts;
    if (!Array.isArray(fonts)) return [];
    const faces = ctx?.faces ?? new Map();
    const raw = note.raw ?? "";
    const findings = [];
    const seen = new Set();
    fonts.forEach((slug, at) => {
        if (typeof slug !== "string" || seen.has(slug)) return;
        seen.add(slug);
        if (GENERIC_FAMILIES.includes(slug) || faces.has(slug)) return;
        const near = nearest(slug, [...faces.keys()]);
        findings.push({
            file: note.file,
            ...positionOfFrontmatterPath(raw, ["data", "script", "fonts", at]),
            severity: "error",
            message:
                `\`${slug}\` is not a font: \`data.script.fonts[${at}]\` names ` +
                (faces.size ? "an installed face" : (
                    `a face of ${FONTS_PACKAGE}, which this package has not installed`
                )) +
                (near ? `; did you mean \`${near}\`?` : ""),
        });
    });
    return findings;
}
