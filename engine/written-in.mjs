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
 * **The script a language is written in.** A language note — a `skill` of
 * `subType: language` — names the map and the face its text is written in:
 *
 * ```yaml
 * data:
 *   writtenIn: { map: semaron, font: semaron-kuriale }
 * ```
 *
 * These are native-presentation defaults, not an effect of identifying a
 * language. A rendering run requests them with its own `.nativefont` class
 * and explicit `lang=`; plain `[Zaron tholmeza]{lang=vyl}` stays Roman.
 * The renderer fills the map and font independently, honoring explicit
 * overrides and reporting an incompatible pair rather than silently omitting
 * a default. A nested marked run makes its own presentation choice.
 *
 * The low-level `fromWrittenIn` helper also serves explicit conversion
 * commands. It returns compatible default suggestions to those callers;
 * rendering opt-in and its required-font diagnostics belong to the run reader.
 *
 * @module
 */

import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { nearest } from "./near-miss.mjs";
import { compileMap } from "./text-maps.mjs";
import { LANGUAGE_SUBTYPE } from "./word-terms.mjs";

/** The `data` key a language note names its script in. */
export const WRITTEN_IN_KEY = "writtenIn";

/**
 * A language's script.
 *
 * @typedef {object} WrittenIn
 * @property {string} map - The `data.map.name` of the mapping note.
 * @property {string} font - The slug of the face, one the map is drawn in.
 */

/** Whether a value is a plain map. */
const isMap = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * Whether a map is drawn in a face: it lists the face, or lists none.
 *
 * @param {import("./text-maps.mjs").TextMap} map - The map.
 * @param {string} font - The face's slug.
 * @returns {boolean} Whether the map may set text in it.
 */
export function drawnIn(map, font) {
    return !map.fonts.size || map.fonts.has(font);
}

/** A list of names as prose: `a`, `a` and `b`, `a`, `b` and `c`. */
function said(names) {
    const quoted = names.map((name) => `\`${name}\``);
    return quoted.length < 2 ?
            quoted.join("")
        :   `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

/**
 * The script each configured language's note names, where the map is known
 * and is drawn in the face. A default that names an unknown map or a face its
 * map is not drawn in is the note's finding, and fills no run.
 *
 * @param {ReadonlyMap<string, Record<string, any>>} byName - Each configured
 *   language's note record, by language name, from
 *   {@link module:engine/map-lexicon.languageRecordsByName}.
 * @param {ReadonlyMap<string, import("./text-maps.mjs").TextMap>} maps - The
 *   maps by name.
 * @returns {Map<string, WrittenIn>} The scripts, by language name.
 */
export function writtenInOf(byName, maps) {
    const out = new Map();
    for (const [name, record] of byName ?? []) {
        const value = record?.data?.[WRITTEN_IN_KEY];
        if (!isMap(value) || typeof value.map !== "string" || typeof value.font !== "string")
            continue;
        const map = maps?.get(value.map);
        if (!map || !drawnIn(map, value.font)) continue;
        out.set(name, Object.freeze({ map: value.map, font: value.font }));
    }
    return out;
}

/**
 * The keys a run takes from its language's script: each of `map` and `font`
 * the run does not state, where it agrees with the one the run does.
 *
 * @param {{lang?: string, map?: string, font?: string}} keys - The run's keys,
 *   its own and those it inherits.
 * @param {ReadonlyMap<string, WrittenIn>|undefined} scripts - Each language's
 *   script, from {@link writtenInOf}.
 * @param {ReadonlyMap<string, import("./text-maps.mjs").TextMap>|undefined} maps -
 *   The maps by name.
 * @returns {{map?: string, font?: string}} What the run takes; empty when it
 *   takes nothing.
 */
export function fromWrittenIn(keys, scripts, maps) {
    if (keys.lang === undefined || (keys.map !== undefined && keys.font !== undefined)) return {};
    const script = scripts?.get(keys.lang);
    if (!script) return {};
    if (keys.map === undefined && keys.font === undefined) return { ...script };
    if (keys.map === undefined) {
        const map = maps?.get(script.map);
        return map && drawnIn(map, /** @type {string} */ (keys.font)) ? { map: script.map } : {};
    }
    const map = maps?.get(keys.map);
    return map && drawnIn(map, script.font) ? { font: script.font } : {};
}

/** The maps each lint index's notes declare, read once. */
const declaredMaps = new WeakMap();

/**
 * Each map the index's notes declare, by name; the first note to declare a
 * name keeps it.
 *
 * @param {{notes?: Iterable<{fm?: Record<string, any>}>}} index - The lint index.
 * @returns {Map<string, import("./text-maps.mjs").TextMap>} The maps.
 */
function mapsIn(index) {
    const known = declaredMaps.get(index);
    if (known) return known;
    const maps = new Map();
    for (const note of index.notes ?? []) {
        const map = compileMap(note?.fm?.data?.map);
        if (map && !maps.has(map.name)) maps.set(map.name, map);
    }
    declaredMaps.set(index, maps);
    return maps;
}

/**
 * Check a note's `data.writtenIn`: that the note is a language, that `map`
 * names a map a mapping note declares, and that the map is drawn in `font`.
 * The data-key check owns the keys and their kinds.
 *
 * @param {{file: string, raw?: string, fm?: Record<string, any>}} note - The note.
 * @param {{index?: {notes?: Iterable<object>}}} [context] - The lint index;
 *   without one, only the note's `subType` is checked.
 * @returns {object[]} The findings, each at its key or value.
 */
export function checkWrittenIn(note, { index } = {}) {
    const value = note?.fm?.data?.[WRITTEN_IN_KEY];
    if (value === undefined || value === null) return [];
    const raw = note.raw ?? "";
    /**
     * @param {Array<string|number>} keyPath - Where the fault is.
     * @param {string} message - What is wrong.
     * @param {boolean} [key] - Locate the key rather than its value.
     */
    const finding = (keyPath, message, key = false) => ({
        file: note.file,
        ...positionOfFrontmatterPath(raw, ["data", WRITTEN_IN_KEY, ...keyPath], { key }),
        severity: "error",
        message,
    });
    if (String(note.fm?.subType ?? "").toLowerCase() !== LANGUAGE_SUBTYPE)
        return [
            finding(
                [],
                `\`data.${WRITTEN_IN_KEY}\` names the script a language is written in, and this ` +
                    `note's \`subType\` is not \`${LANGUAGE_SUBTYPE}\``,
                true,
            ),
        ];
    if (!index || !isMap(value) || typeof value.map !== "string") return [];
    const maps = mapsIn(index);
    const map = maps.get(value.map);
    if (!map) {
        const near = nearest(value.map, [...maps.keys()]);
        return [
            finding(
                ["map"],
                `\`data.${WRITTEN_IN_KEY}.map\` is \`${value.map}\`, which no mapping note's ` +
                    "`data.map.name` declares" +
                    (near ? `; did you mean \`${near}\`?` : ""),
            ),
        ];
    }
    if (typeof value.font !== "string" || drawnIn(map, value.font)) return [];
    return [
        finding(
            ["font"],
            `\`data.${WRITTEN_IN_KEY}.font\` is \`${value.font}\`, which the map \`${map.name}\` ` +
                `is not drawn in; it is drawn in ${said([...map.fonts.keys()])}`,
        ),
    ];
}
