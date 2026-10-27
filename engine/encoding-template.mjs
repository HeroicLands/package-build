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

/** Compile the closed encoding-note template into the engine's internal row program. */
import { STANDARD_ROWS, STANDARD_CONTROLS } from "./encoding-standard.mjs";
import { assertUniqueOutputs } from "./encoding-integrity.mjs";

const map = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const scalar = (value) =>
    typeof value === "string" &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const base = (value) => value.normalize("NFD").replace(/\p{M}/gu, "");
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const codeName = /^[A-Za-z0-9_]+$/;

/**
 * Validate note data and resolve its code references without reading files.
 * @param {any} data - Encoding-note data, excluding ordinary document metadata.
 * @param {{codes?: Record<string,string>, name?: string}} options - Selected font codes and document identity.
 * @param {(key:string,message:string)=>never} fault - Schema-error constructor supplied by the engine.
 */
export function templateProgram(data, options, fault) {
    const closed = (value, allowed, key) => {
        if (!map(value)) fault(key, `${key || "Encoding data"} must be an object`);
        for (const name of Object.keys(value))
            if (!allowed.includes(name))
                fault(key ? `${key}.${name}` : name, `Unknown encoding key ${name}`);
    };
    const exact = (value, expected, key) => {
        if (value !== expected) fault(key, `${key} must be ${JSON.stringify(expected)}`);
    };
    const fixed = (value, fields, key) => {
        closed(value, Object.keys(fields), key);
        for (const [name, expected] of Object.entries(fields))
            exact(value[name], expected, `${key}.${name}`);
    };
    closed(data, ["language", "font", "accepts", "vowels", "mappings", "rules"], "");
    closed(options, ["codes", "name"], "options");
    for (const key of ["language", "font"])
        if (typeof data[key] !== "string" || !slug.test(data[key]))
            fault(key, `${key} must be a lowercase slug`);
    if (options.name !== undefined && (!scalar(options.name) || !options.name))
        fault("options.name", "name must be a nonempty document identity");
    if (!map(options.codes)) fault("options.codes", "Supply the selected font's glyph code table");
    for (const [name, target] of Object.entries(options.codes)) {
        if (!codeName.test(name))
            fault(`options.codes.${name}`, "A glyph code must be a short named code");
        if (!scalar(target) || !target)
            fault(
                `options.codes.${name}`,
                "A glyph code must resolve to nonempty Unicode scalar text",
            );
    }
    const resolve = (value, key, allowEmpty = false) => {
        const sequence = typeof value === "string" ? [value] : value;
        if (!Array.isArray(sequence) || (!sequence.length && !allowEmpty))
            fault(
                key,
                "A mapping is a glyph code or a code sequence; an empty sequence requires canonical round trips",
            );
        return sequence
            .map((name) => {
                if (
                    typeof name !== "string" ||
                    !codeName.test(name) ||
                    !Object.hasOwn(options.codes, name)
                )
                    fault(key, `Unknown glyph code ${String(name)}`);
                return options.codes[name];
            })
            .join("");
    };
    closed(
        data.rules,
        [
            "normalization",
            "matching",
            "roundTrip",
            "word-separators",
            "case",
            "stress",
            "vowel-groups",
            "diaeresis",
            "grave-accent",
            "contextual-mappings",
            "y",
        ],
        "rules",
    );
    const rules = data.rules;
    exact(rules.normalization, "NFC", "rules.normalization");
    exact(rules.matching, "longest-first", "rules.matching");
    if (rules.roundTrip !== undefined && !["exact", "canonical"].includes(rules.roundTrip))
        fault("rules.roundTrip", "roundTrip is exact or canonical");
    const canonical = rules.roundTrip === "canonical";
    if (rules.case !== undefined)
        fixed(
            rules.case,
            {
                "single-letter": "preserve",
                "consonant-group": "lowercase-or-initial-uppercase",
                "other-group-cases": "forbidden",
            },
            "rules.case",
        );
    for (const key of ["diaeresis", "grave-accent"])
        if (rules[key] !== undefined) {
            closed(rules[key], ["allowed"], `rules.${key}`);
            if (typeof rules[key].allowed !== "boolean")
                fault(`rules.${key}.allowed`, "allowed must be true or false");
        }
    const vowels = data.vowels ?? "";
    if (!scalar(vowels)) fault("vowels", "vowels must be a Unicode scalar string");
    const vowelSet = new Set([...vowels].map(base));
    if (rules.y !== undefined) {
        fixed(rules.y, { kind: "consonant", sound: "y in yes", "vowel-reading": false }, "rules.y");
        if (/[yY]/u.test(vowels)) fault("rules.y", "Consonant y cannot be declared a vowel");
    }
    let vowelGroups = [];
    if (rules["vowel-groups"] !== undefined) {
        const block = rules["vowel-groups"];
        closed(
            block,
            ["reading", "allow-splitting", "unrecognized-adjacent-vowels", "groups"],
            "rules.vowel-groups",
        );
        exact(block.reading, "established", "rules.vowel-groups.reading");
        exact(block["allow-splitting"], false, "rules.vowel-groups.allow-splitting");
        exact(
            block["unrecognized-adjacent-vowels"],
            "separate",
            "rules.vowel-groups.unrecognized-adjacent-vowels",
        );
        if (!Array.isArray(block.groups))
            fault("rules.vowel-groups.groups", "List established vowel groups explicitly");
        const seen = new Set();
        vowelGroups = block.groups
            .map((group, i) => {
                const key = `rules.vowel-groups.groups.${i}`;
                if (
                    !scalar(group) ||
                    [...group].length < 2 ||
                    group !== group.toLowerCase() ||
                    base(group) !== group ||
                    [...group].some((c) => !vowelSet.has(c)) ||
                    seen.has(group)
                )
                    fault(
                        key,
                        "A vowel group is a unique lowercase sequence of declared unaccented vowels",
                    );
                seen.add(group);
                return group;
            })
            .sort((a, b) => [...b].length - [...a].length);
    }
    let stress;
    if (rules.stress !== undefined) {
        const block = rules.stress;
        closed(
            block,
            [
                "modifier",
                "position",
                "printing",
                "effect",
                "changes-sound",
                "changes-length",
                "vowel-group-position",
            ],
            "rules.stress",
        );
        for (const [name, value] of Object.entries({
            position: "after-stressed-vowel",
            printing: false,
            effect: "stress-only",
            "changes-sound": false,
            "changes-length": false,
            "vowel-group-position": "first-vowel",
        }))
            exact(block[name], value, `rules.stress.${name}`);
        stress = resolve(block.modifier, "rules.stress.modifier");
        if (stress !== "\u{E0114}")
            fault("rules.stress.modifier", "Stress is the nonprinting U+E0114 modifier");
        if (!vowels) fault("vowels", "Stress rules require declared vowels");
    }
    closed(data.mappings, Object.keys(map(data.mappings) ? data.mappings : {}), "mappings");
    const validateSource = (from, key) => {
        if (!scalar(from) || !from || from !== from.normalize("NFC"))
            fault(key, "Mapping sources must be nonempty NFC Unicode scalar text");
        if (/[\p{White_Space}⟦⟧]/u.test(from))
            fault(key, "Whitespace and literal markers belong to the shared standard");
        const decomposed = from.normalize("NFD");
        if (rules.diaeresis?.allowed === false && decomposed.includes("\u0308"))
            fault(key, "Diaeresis is forbidden");
        if (rules["grave-accent"]?.allowed === false && decomposed.includes("\u0300"))
            fault(key, "Grave accents are forbidden");
    };
    const validateOutput = (from, to, key) => {
        if (/[\u{E010D}\u{E010E}\u{E0112}\u{E0113}\u{E0115}]/u.test(to))
            fault(key, "Structural controls cannot be mapping outputs");
        if (from.normalize("NFD").includes("\u0301") && stress) {
            const plain = from.normalize("NFD").replaceAll("\u0301", "").normalize("NFC");
            if (
                [...from].length !== 1 ||
                !vowelSet.has(base(from)) ||
                !Object.hasOwn(data.mappings, plain) ||
                to !== resolve(data.mappings[plain], key) + stress
            )
                fault(
                    key,
                    "An acute vowel must emit its unchanged vowel followed by the stress modifier",
                );
        } else if (stress && to.includes(stress))
            fault(key, "The stress modifier belongs only after an acute vowel");
    };
    const mappings = [];
    for (const [from, output] of Object.entries(data.mappings)) {
        const key = `mappings.${from}`;
        validateSource(from, key);
        const to = resolve(output, key, canonical);
        validateOutput(from, to, key);
        mappings.push([from, to]);
    }
    const separators = [];
    if (rules["word-separators"] !== undefined) {
        if (!Array.isArray(rules["word-separators"]))
            fault("rules.word-separators", "word-separators must be a list");
        const seen = new Set();
        for (const [i, from] of rules["word-separators"].entries()) {
            const key = `rules.word-separators.${i}`;
            validateSource(from, key);
            if (
                [...from].some(
                    (char) =>
                        "^/{}".includes(char) || /[\p{Cc}\p{Cf}\u{E0100}-\u{E01EF}]/u.test(char),
                ) ||
                STANDARD_ROWS.some((row) => (Array.isArray(row) ? row[0] : row.from) === from)
            )
                fault(
                    key,
                    "Word separators cannot replace shared punctuation or contain structural controls",
                );
            if (seen.has(from)) fault(key, "A word separator is stated twice");
            if (Object.hasOwn(data.mappings, from))
                fault(key, "A word separator cannot also have an ordinary mapping");
            seen.add(from);
            separators.push({ from, to: STANDARD_CONTROLS.wordSeparator });
        }
    }
    const contextual = [];
    if (rules["contextual-mappings"] !== undefined) {
        if (!Array.isArray(rules["contextual-mappings"]))
            fault("rules.contextual-mappings", "Contextual mappings must be a list");
        const seen = new Set();
        for (const [i, row] of rules["contextual-mappings"].entries()) {
            const key = `rules.contextual-mappings.${i}`;
            closed(row, ["match", "before", "at", "emit"], key);
            if (!scalar(row.match) || !row.match || row.match !== row.match.normalize("NFC"))
                fault(`${key}.match`, "A contextual match must be nonempty NFC text");
            if (row.before === undefined && row.at === undefined)
                fault(key, "A contextual mapping requires before or at");
            if (row.before !== undefined && !["vowel", "consonant"].includes(row.before))
                fault(`${key}.before`, "before is vowel or consonant");
            if (row.at !== undefined && !["start", "end", "line-start"].includes(row.at))
                fault(`${key}.at`, "at is start, end or line-start");
            if (row.before && !vowels)
                fault(
                    `${key}.before`,
                    "Before-vowel or before-consonant mappings require declared vowels",
                );
            const condition = JSON.stringify([row.match, row.before ?? null, row.at ?? null]);
            if (seen.has(condition))
                fault(
                    `${key}.match`,
                    "A contextual mapping repeats the same source and conditions",
                );
            validateSource(row.match, `${key}.match`);
            const to = resolve(row.emit, `${key}.emit`, canonical);
            validateOutput(row.match, to, `${key}.emit`);
            seen.add(condition);
            contextual.push({
                from: row.match,
                to,
                ...(row.before !== undefined ? { before: row.before } : {}),
                ...(row.at !== undefined ? { at: row.at } : {}),
            });
        }
    }
    if (rules.case)
        for (const [from] of [...mappings, ...contextual.map((r) => [r.from])]) {
            if ([...from].length < 2 || !/^\p{L}+$/u.test(from)) continue;
            const lower = from.toLowerCase(),
                initial = [...lower][0].toUpperCase() + [...lower].slice(1).join("");
            if (from !== lower && from !== initial)
                fault(`mappings.${from}`, "A group must be lowercase or initial uppercase");
        }
    const overridden = new Set(mappings.map(([from]) => from));
    const rows = [
        ...STANDARD_ROWS.filter((row) => !overridden.has(Array.isArray(row) ? row[0] : row.from)),
        ...contextual,
        ...mappings,
        ...separators,
    ];
    const sourceKey = (row) => {
        if (Array.isArray(row)) return `mappings.${row[0]}`;
        const separator = separators.indexOf(row);
        if (separator >= 0) return `rules.word-separators.${separator}`;
        const context = contextual.indexOf(row);
        return context < 0 ? "rules" : `rules.contextual-mappings.${context}`;
    };
    if (!canonical)
        assertUniqueOutputs(
            [
                ...rows.map((row) =>
                    Array.isArray(row) ?
                        { from: row[0], to: row[1], key: sourceKey(row) }
                    :   { ...row, key: sourceKey(row) },
                ),
                { from: " ", to: " ", key: "rules" },
            ],
            fault,
        );
    const accepts = data.accepts ?? [
        ...new Set([
            ...Object.keys(data.mappings).join(""),
            ...contextual.map((r) => r.from).join(""),
            ...separators.map((row) => row.from).join(""),
        ]),
    ];
    if (!Array.isArray(accepts)) fault("accepts", "accepts must be a list of characters or ranges");
    return {
        definition: {
            name: "encoding-note",
            fonts: [data.font],
            accepts: [...accepts, ...STANDARD_ROWS.map((r) => (Array.isArray(r) ? r[0] : r.from))],
            separator: " ",
            roundTrip: canonical ? "canonical" : "exact",
            vowels,
            rows,
            codes: Object.entries(options.codes),
            controls: STANDARD_CONTROLS,
            ...(rules.case ? { groupCase: "initial" } : {}),
        },
        rowKeys: rows.map(sourceKey),
        metadata: {
            name: options.name ?? `${data.language}-${data.font}`,
            language: data.language,
            font: data.font,
            template: Object.freeze({
                normalization: "NFC",
                vowelGroups: Object.freeze(vowelGroups),
                maxVowelGroup: Math.max(0, ...vowelGroups.map((group) => [...group].length)),
                stress,
                diaeresis: rules.diaeresis?.allowed === false,
                grave: rules["grave-accent"]?.allowed === false,
            }),
        },
    };
}
