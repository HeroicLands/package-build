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
 * The core report: for each language that must cover the core vocabulary, the
 * concepts of the list it has no word for.
 *
 * The list is the `data.concepts` of the package's `doc` notes. A language
 * must cover it where it states `data.core: true`. A word covers every
 * concept its `concept` names, and a language reads the words of its
 * `data.family` chain as its own. A missing concept is a fact to work through,
 * never a finding.
 *
 * @module
 */

import { encodeAddresses } from "./address-values.mjs";
import { isLanguageRecord, languageLineages, noteAddressOf } from "./word-rows.mjs";

/** Whether a value is a plain map. */
const isMap = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** The slug a record is written by in a reference, such as `skill-vylari`. */
const slugOf = (record) => record.address?.slug ?? record.shortcode;

/** The name a language is reported by. */
const nameOf = (record) =>
    typeof record.name?.full === "string" && record.name.full ? record.name.full : record.shortcode;

/**
 * The concept list the records state, in record then authored order. An id
 * another list repeats keeps its first place.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {Array<{id: string, gloss: string, group: string}>} The concepts.
 */
function conceptsOf(records) {
    const out = [];
    const seen = new Set();
    for (const record of records) {
        const list = record?.data?.concepts;
        if (!Array.isArray(list)) continue;
        for (const entry of list) {
            if (
                !isMap(entry) ||
                typeof entry.id !== "string" ||
                typeof entry.gloss !== "string" ||
                typeof entry.group !== "string" ||
                seen.has(entry.id)
            )
                continue;
            seen.add(entry.id);
            out.push({ id: entry.id, gloss: entry.gloss, group: entry.group });
        }
    }
    return out;
}

/** The concept ids a word serves. */
function idsOf(word) {
    const value = isMap(word) ? word.concept : undefined;
    return (Array.isArray(value) ? value : [value]).filter((id) => typeof id === "string");
}

/**
 * The core report of a set of index records.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @param {{language?: string}} [options] - A language to report alone, by its
 *   name, shortcode or reference slug whether or not it states `data.core`.
 * @returns {{concepts: number, languages: Array<{name: string, language: string, core: boolean, total: number, covered: number, missing: Array<{group: string, count: number, total: number, concepts: Array<{id: string, gloss: string}>}>}>}|{problem: string, about: string}}
 *   The report, or the problem when there is no concept list or the language
 *   asked for is none.
 */
export function coreReport(records, { language } = {}) {
    const all = [...records].map((record) => encodeAddresses(record));
    const concepts = conceptsOf(all);
    if (!concepts.length)
        return {
            about: "concepts",
            problem: "no note states `data.concepts`, so there is no core vocabulary to cover",
        };
    const languages = all.filter(isLanguageRecord);
    let chosen;
    if (language === undefined) chosen = languages.filter((record) => record.data?.core === true);
    else {
        const want = language.toLowerCase();
        chosen = languages.filter((record) =>
            [nameOf(record), record.shortcode, slugOf(record)].some(
                (key) => String(key).toLowerCase() === want,
            ),
        );
        if (!chosen.length)
            return {
                about: "language",
                problem: `\`${language}\` is no language note: name one by its name, its shortcode or its reference`,
            };
    }
    chosen.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

    const { languages: byKey, chain } = languageLineages(all);
    const groups = [...new Set(concepts.map((concept) => concept.group))];
    return {
        concepts: concepts.length,
        languages: chosen.map((record) => {
            const have = new Set();
            for (const key of chain(noteAddressOf(record) ?? ""))
                for (const word of byKey.get(key)?.data?.words ?? [])
                    for (const id of idsOf(word)) have.add(id);
            const missing = [];
            for (const group of groups) {
                const members = concepts.filter((concept) => concept.group === group);
                const lacking = members.filter((concept) => !have.has(concept.id));
                if (lacking.length)
                    missing.push({
                        group,
                        count: lacking.length,
                        total: members.length,
                        concepts: lacking.map(({ id, gloss }) => ({ id, gloss })),
                    });
            }
            const lacking = missing.reduce((sum, group) => sum + group.count, 0);
            return {
                name: nameOf(record),
                language: slugOf(record),
                core: record.data?.core === true,
                total: concepts.length,
                covered: concepts.length - lacking,
                missing,
            };
        }),
    };
}

/**
 * A core report as text: one block per language, its missing concepts under
 * their groups with counts, each concept's id and gloss tab-separated.
 *
 * @param {{concepts: number, languages: Array<object>}} report - A report from {@link coreReport}.
 * @returns {string} The text, ending in a newline.
 */
export function coreReportText(report) {
    if (!report.languages.length) return "No language states `data.core: true`.\n";
    return report.languages
        .map((one) => {
            if (!one.missing.length)
                return `${one.name} (${one.language}): all ${one.total} core concepts have a word\n`;
            const lines = [
                `${one.name} (${one.language}): ${one.total - one.covered} of ${one.total} core concepts have no word`,
            ];
            for (const group of one.missing) {
                lines.push(`  ${group.group}: ${group.count} of ${group.total}`);
                for (const concept of group.concepts)
                    lines.push(`    ${concept.id}\t${concept.gloss}`);
            }
            return `${lines.join("\n")}\n`;
        })
        .join("\n");
}
