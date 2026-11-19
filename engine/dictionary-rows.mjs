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
 * The rows of the SQL `dictionary` and `terms` relations: the words a
 * dictionary sets, and the terms a glossary sets.
 *
 * **`dictionary` is one row per word per language it is listed under.** A
 * language lists its own words at `depth` 0 and the words it inherits through
 * `data.family` above that, nearest first, so `WHERE language = X` is a
 * language's whole word list and `WHERE depth = 0` lists every word once,
 * under the language that states it. A daughter's own word is the entry where
 * a parent states the same NFC form and normalized class. Words of class `name`, `stem` and `pref` are
 * no entry.
 *
 * **`terms` is one row per term and matching class per owning note**: a culture's or an
 * affiliation's `data.glossary` entry, or an affiliation's rank or office. A
 * rank and an office of one title in one body are one row, the rank's sense
 * first; identical descriptions are one sense. Each row lists in `cultures`
 * every culture it reaches: a culture's own terms reach the culture, and an
 * affiliation's reach its culture and the cultures of every affiliation above
 * it through `data.parents`.
 *
 * **A rank or office title of one word** (Subject, Member) is a term only
 * where a glossary entry of its body, or of a culture it reaches, names it, or
 * where it is a word of its language compared without case. A title of
 * several words, joined by a space or a hyphen, always is.
 *
 * **A glossary entry naming a dictionary spelling** carries every matching
 * class on its own row and a link to the spelling group in the resolved language's dictionary. Without a
 * `definition` it carries the word's senses; with one it carries that sense
 * instead. An owner's own rank or office contributes its descriptions after
 * the word's senses, unless the entry states a definition. An entry naming
 * another body's rank or office carries its senses on the entry's own row.
 * `common`, `name_sort` and `pronunciation` belong to each owner's entry;
 * nothing a glossary states changes a dictionary word.
 *
 * @module
 */

import { pluralOf, pluralByRule } from "./word-inflections.mjs";
import { standingOffices } from "./standings.mjs";
export { pluralOf, pluralByRule } from "./word-inflections.mjs";
import { createHash } from "node:crypto";
import { parseAddress, renderAddress } from "./address.mjs";
import { glossaryLanguage } from "./glossary-language.mjs";
import { languageNotesByCode } from "./note-language.mjs";
import { isNoteRecord } from "./index-records.mjs";
import {
    parseWordClass,
    normalizedWordClass,
    wordIdentity,
    WORD_CLASS_BASES,
} from "./word-classes.mjs";
import { citationLookup, isLanguageRecord, lineageChain, pieceGlosses } from "./word-rows.mjs";
import { glossSenses } from "./word-terms.mjs";

/** Every column of the `dictionary` relation, in order. */
export const DICTIONARY_COLUMNS = Object.freeze([
    "language",
    "language_tag",
    "name",
    "name_sort",
    "letter",
    "pronunciation",
    "class",
    "plural",
    "field",
    "etymology",
    "senses",
    "usage",
    "verbs",
    "depth",
]);

/** Every column of the `terms` relation, in order. */
export const TERM_COLUMNS = Object.freeze([
    "owner",
    "owner_kind",
    "language",
    "language_tag",
    "name",
    "name_sort",
    "letter",
    "pronunciation",
    "class",
    "word",
    "senses",
    "usage",
    "common",
    "origins",
    "cultures",
]);

/** The keys of a word's `etymology`, in order. */
export const ETYMOLOGY_KEYS = Object.freeze([
    "kind",
    "language",
    "language_tag",
    "form",
    "parts",
    "root",
    "frame",
]);

/** The bases whose words stand in a dictionary. */
const GLOSSARY_BASES = new Set(
    WORD_CLASS_BASES.filter((item) => item.glossary).map((item) => item.token),
);

/** A rank's sense before an office's, within one row. */
const KIND_ORDER = Object.freeze({ rank: 0, office: 1 });

/** Whether a value is a plain map. */
const isMap = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** A headword as entries are matched on it: NFC, case kept. */
const nfc = (text) => String(text ?? "").normalize("NFC");

/** Code-point order, so a sort is the same on every machine. */
const compare = (a, b) =>
    a < b ? -1
    : a > b ? 1
    : 0;

/** Whether a title is one word: no space and no hyphen in it. */
const isSingleWord = (title) => !/[\s\-‐‑]/u.test(title);

/** Whether a glossary entry states a definition. */
const defines = (entry) => typeof entry.definition === "string" && entry.definition.trim() !== "";

/**
 * The stable prose anchor of a word in one language's dictionary. The exact
 * language and NFC form identify the spelling group, including case and accents.
 * A class identifies one entry within a homograph group; omit it for a unique entry.
 *
 * @param {string} language - The language's canonical note Address.
 * @param {string} name - The dictionary headword.
 * @param {string} [wordClass] - The class of an entry in a homograph group.
 * @returns {string} The anchor slug.
 */
export function dictionaryEntryAnchor(language, name, wordClass) {
    return `word-${createHash("sha256")
        .update(
            JSON.stringify(
                wordClass === undefined ?
                    [language, nfc(name)]
                :   [language, nfc(name), normalizedWordClass(wordClass)],
            ),
        )
        .digest("hex")}`;
}

/**
 * The heading letter of a sort key: its first letter or digit, accents taken
 * off and apostrophes skipped, in capitals; `#` where it has none.
 *
 * @param {unknown} text - The sort key.
 * @returns {string} The letter.
 */
export function dictionaryLetter(text) {
    const folded = String(text ?? "")
        .normalize("NFD")
        .replace(/\p{M}/gu, "");
    const first = folded.match(/[\p{L}\p{N}]/u);
    return first ? first[0].toUpperCase() : "#";
}

/**
 * A record's Address as a reference to it is written: in the `note` system.
 *
 * @param {Record<string, any>} record - An index record.
 * @returns {string|undefined}
 */
function noteKey(record) {
    if (!record?.package || !record.type || !record.shortcode) return undefined;
    return renderAddress({
        package: String(record.package),
        system: "note",
        type: String(record.type),
        shortcode: String(record.shortcode),
    });
}

/**
 * A written reference's canonical Address in the `note` system.
 *
 * @param {unknown} value - The value as the record holds it.
 * @param {string} pkg - The package a short form defaults to.
 * @param {string} type - The type a bare shortcode defaults to.
 * @param {Set<string>} types - The note types a written type segment is read against.
 * @returns {string|undefined}
 */
function refKey(value, pkg, type, types) {
    if (typeof value !== "string" || !value) return undefined;
    const tuple = parseAddress(
        value,
        { package: pkg, system: "note", type, types },
        { declared: true },
    );
    if (tuple.reason) return undefined;
    return renderAddress({ ...tuple, system: "note", anchor: undefined });
}

/**
 * The `dictionary` and `terms` rows of a set of index records.
 *
 * @param {Iterable<Record<string, any>>} records - Index records, every
 *   Address a string, already narrowed to the audience being published to.
 * @param {Iterable<Record<string, any>>} [all] - Every record of the package,
 *   for resolving a language or a culture through a note the audience does not
 *   see.
 * @returns {{dictionary: object[], terms: object[]}} The rows: `dictionary`
 *   sorted by language, `name_sort`, name and normalized class, `terms` by owner,
 *   `name_sort`, name and normalized class, each carrying every column of {@link DICTIONARY_COLUMNS} or
 *   {@link TERM_COLUMNS}.
 */
export function dictionaryAndTermRows(records, all = records) {
    const byKey = new Map();
    for (const record of all) {
        if (!isNoteRecord(record)) continue;
        const key = noteKey(record);
        if (key && !byKey.has(key)) byKey.set(key, record);
    }
    const visible = new Map();
    for (const record of records) {
        if (!isNoteRecord(record)) continue;
        const key = noteKey(record);
        if (key && !visible.has(key)) visible.set(key, record);
    }
    const types = new Set(["affiliation", "being", "lore", "skill"]);
    for (const record of byKey.values())
        if (typeof record.type === "string") types.add(record.type);
    const ref = (value, pkg, type) => refKey(value, pkg, type, types);
    /** An Address a row may cite: not a note of this package the audience does not see. */
    const citable = (key) => visible.has(key) || !byKey.has(key);
    const languageNotes = languageNotesByCode(byKey.values(), noteKey);
    const reader = {
        keyOf: (value) => (typeof value === "string" && value ? value : undefined),
        noteOf: (code) => languageNotes.get(code),
    };

    // ── Languages ────────────────────────────────────────────────────────────
    const languages = new Map();
    for (const [key, record] of byKey) if (isLanguageRecord(record)) languages.set(key, record);
    const tagOf = (language) => {
        const record = language ? languages.get(language) : undefined;
        if (!record) return null;
        const abbreviation = record.data?.abbreviation;
        if (typeof abbreviation === "string" && abbreviation.trim()) return abbreviation.trim();
        const full = record.name?.full;
        return typeof full === "string" && full ? full : null;
    };
    const lineage = (language) =>
        lineageChain(language, {
            has: (key) => languages.has(key),
            parentOf: (key) => {
                const family = languages.get(key).data?.family;
                return typeof family === "string" && family ? family : undefined;
            },
        });
    const ownWords = new Map();
    for (const [key, record] of languages) {
        const list = [];
        for (const word of Array.isArray(record.data?.words) ? record.data.words : []) {
            if (!isMap(word) || typeof word.form !== "string") continue;
            const parsed = parseWordClass(word.class);
            if (parsed.reason || !GLOSSARY_BASES.has(parsed.base)) continue;
            list.push(word);
        }
        ownWords.set(key, list);
    }
    // Each complete entry inherits independently, nearest visible declaration first.
    const byLowerForm = new Map(
        [...ownWords].map(([key, list]) => [
            key,
            new Set(list.map((word) => nfc(word.form).toLowerCase())),
        ]),
    );
    const byForm = new Map();
    for (const [language, words] of ownWords) {
        const forms = new Map();
        for (const word of words) {
            const form = nfc(word.form);
            if (!forms.has(form)) forms.set(form, []);
            forms.get(form).push(word);
        }
        byForm.set(language, forms);
    }
    const wordsIn = (language, name) => {
        const found = new Map();
        const chain = lineage(language);
        for (let depth = 0; depth < chain.length; depth++) {
            if (!visible.has(chain[depth])) continue;
            for (const word of byForm.get(chain[depth]).get(name) ?? []) {
                const identity = wordIdentity(word.form, word.class);
                if (!found.has(identity))
                    found.set(identity, { word, statedIn: chain[depth], depth });
            }
        }
        return [...found.values()];
    };
    const hasWordIgnoringCase = (language, name) => {
        const lower = name.toLowerCase();
        return lineage(language).some((key) => byLowerForm.get(key).has(lower));
    };

    // ── Cultures and affiliations ────────────────────────────────────────────
    const isCulture = (record) => record?.type === "lore" && record?.subType === "culture";
    const isAffiliation = (record) => record?.type === "affiliation";
    const languageOf = (record, key, entry) =>
        glossaryLanguage(entry, record, { ...reader, self: key }) ?? null;
    const cultureOf = (key) => {
        const record = byKey.get(key);
        return record ? (ref(record.data?.culture, record.package, "lore") ?? null) : null;
    };
    /** Every culture an affiliation's terms reach: its own, and every parent's. */
    const culturesOf = (body) => {
        const out = new Set();
        const seen = new Set();
        const queue = [body];
        while (queue.length) {
            const key = queue.shift();
            if (seen.has(key)) continue;
            seen.add(key);
            const record = byKey.get(key);
            if (!isAffiliation(record)) continue;
            const culture = cultureOf(key);
            if (culture) out.add(culture);
            for (const parent of Array.isArray(record.data?.parents) ? record.data.parents : []) {
                const parentKey = ref(parent, record.package, "affiliation");
                if (parentKey) queue.push(parentKey);
            }
        }
        return [...out].sort(compare);
    };
    const beings = [...visible].filter(([, record]) => record.type === "being");
    const membersOf = (body, test) =>
        beings
            .filter(([, record]) => {
                const standing =
                    isMap(record.data?.affiliations) ? record.data.affiliations[body] : undefined;
                return isMap(standing) && test(standing);
            })
            .map(([key]) => key);
    const glossaryOf = (key) => {
        const entries = byKey.get(key)?.data?.glossary;
        return (Array.isArray(entries) ? entries : []).filter(
            (entry) => isMap(entry) && typeof entry.name === "string" && entry.name.trim(),
        );
    };

    // ── Ranks and offices ────────────────────────────────────────────────────
    /** Every rank and office row, keyed by owner then name, whether or not it enters. */
    const governance = new Map();
    for (const [body, record] of byKey) {
        if (!isAffiliation(record) || !visible.has(body)) continue;
        const language = languageOf(record, body, undefined);
        const cultures = culturesOf(body);
        const rows = new Map();
        const add = (kind, title, text, usage) => {
            if (typeof title !== "string" || !title.trim()) return;
            const name = nfc(title);
            if (!rows.has(name))
                rows.set(name, {
                    owner: body,
                    ownerKind: "affiliation",
                    language,
                    name,
                    cultures,
                    pieces: [],
                    usage: new Set(),
                    marks: [],
                    definition: undefined,
                    named: false,
                });
            const row = rows.get(name);
            row.pieces.push({ kind, text: typeof text === "string" ? text : null });
            for (const value of [body, ...usage]) row.usage.add(value);
        };
        const gov = isMap(record.data?.governance) ? record.data.governance : {};
        for (const rung of Array.isArray(gov.ranks) ? gov.ranks : []) {
            if (!isMap(rung)) continue;
            add(
                "rank",
                rung.title,
                rung.description,
                membersOf(body, (standing) => standing.rank === rung.level),
            );
        }
        if (isMap(gov.offices))
            for (const [title, office] of Object.entries(gov.offices)) {
                const holders =
                    isMap(office) && Array.isArray(office.holders) ?
                        office.holders
                            .map((holder) =>
                                isMap(holder) ?
                                    ref(holder.being, record.package, "being")
                                :   undefined,
                            )
                            .filter(Boolean)
                    :   [];
                add("office", title, isMap(office) ? office.description : office, [
                    ...holders,
                    ...membersOf(body, (standing) => standingOffices(standing).includes(title)),
                ]);
            }
        governance.set(body, rows);
    }
    const allGovernance = [...governance.values()].flatMap((rows) => [...rows.values()]);

    // ── Word rows ────────────────────────────────────────────────────────────
    const wordRows = new Map();
    const wordKey = (language, name) => `${language}\0${name}`;
    for (const [language] of languages) {
        if (!visible.has(language)) continue;
        for (const ancestor of lineage(language)) {
            if (ancestor !== language && !visible.has(ancestor)) continue;
            for (const word of ownWords.get(ancestor)) {
                const name = nfc(word.form);
                const key = wordKey(language, name);
                if (wordRows.has(key)) continue;
                wordRows.set(key, { language, name, found: wordsIn(language, name) });
            }
        }
    }

    // ── Glossary entries ─────────────────────────────────────────────────────
    const owned = [];
    const owners = [...visible]
        .filter(([, record]) => isCulture(record) || isAffiliation(record))
        .sort((a, b) => compare(a[0], b[0]));
    for (const [note, record] of owners) {
        const culture = isCulture(record);
        const reach =
            culture ?
                allGovernance.filter((row) => row.cultures.includes(note))
            :   [...(governance.get(note)?.values() ?? [])];
        glossaryOf(note).forEach((entry, position) => {
            const name = nfc(entry.name);
            const language = languageOf(record, note, entry);
            const mark = { note, position, entry };
            const matches = wordRows.get(wordKey(language, name))?.found ?? [];
            const found = matches[0];
            const own = !culture ? governance.get(note)?.get(name) : undefined;
            if (own) {
                own.language = language;
                own.found = found;
                own.matches = matches;
                if (defines(entry)) own.definition = mark;
                own.marks.push(mark);
                own.named = true;
                return;
            }
            const reached = reach.filter((row) => row.name === name);
            const preferred = reached.filter((row) => row.language === language);
            const providers = preferred.length ? preferred : reached;
            if (!defines(entry)) for (const row of providers) row.named = true;
            if (defines(entry) || found || providers.length)
                owned.push({
                    owner: note,
                    ownerKind: culture ? "culture" : "affiliation",
                    language,
                    name,
                    cultures: culture ? [note] : culturesOf(note),
                    found,
                    matches,
                    providers: found || defines(entry) ? [] : providers,
                    mark,
                });
        });
    }

    // ── Finishing ────────────────────────────────────────────────────────────
    const marked = (marks, key) => {
        const hit = marks.find(
            (one) => typeof one.entry[key] === "string" && one.entry[key] !== "",
        );
        return hit ? hit.entry[key] : undefined;
    };
    // One piece lookup per language, shared by every word that language states.
    const glossers = new Map();
    const glossesFor = (language) => {
        if (!glossers.has(language))
            glossers.set(
                language,
                pieceGlosses(...lineage(language).map((key) => languages.get(key).data)),
            );
        return glossers.get(language);
    };
    const etymologyOf = ({ word, statedIn, depth }) => {
        const blank = Object.fromEntries(ETYMOLOGY_KEYS.map((key) => [key, null]));
        if (depth > 0)
            return {
                ...blank,
                kind: "inherited",
                language: statedIn,
                language_tag: tagOf(statedIn),
                form: word.form,
            };
        const source = isMap(word.source) ? word.source : {};
        const built = Array.isArray(word.built) ? word.built.map(String) : [];
        const out = {
            ...blank,
            kind: typeof source.kind === "string" ? source.kind : null,
            language: typeof source.language === "string" ? source.language : null,
            form: typeof source.form === "string" ? source.form : null,
            parts:
                built.length ?
                    built.map((form) => ({ form, gloss: glossesFor(statedIn)(form) }))
                :   null,
            root: typeof word.root === "string" ? word.root : null,
            frame: typeof word.frame === "string" ? word.frame : null,
        };
        out.language_tag = tagOf(out.language);
        return ETYMOLOGY_KEYS.some((key) => out[key] !== null) ? out : null;
    };

    const citedBy = citationLookup(byKey.values());
    const dictionary = [];
    const wordUsage = ({ word, statedIn }) =>
        [...new Set(citedBy(statedIn, word.form).filter(citable))].sort(compare);
    for (const { language, name, found: matches } of wordRows.values())
        for (const found of matches) {
            const { word, depth } = found;
            const grammar = languages.get(language)?.data?.grammar;
            const nameSort =
                typeof word.name_sort === "string" && word.name_sort ? word.name_sort : name;
            dictionary.push({
                language,
                language_tag: tagOf(language),
                name,
                name_sort: nameSort,
                letter: dictionaryLetter(nameSort),
                pronunciation: typeof word.pronunciation === "string" ? word.pronunciation : null,
                class: typeof word.class === "string" ? word.class : null,
                plural: pluralOf(word, grammar),
                field: typeof word.field === "string" ? word.field : null,
                etymology: etymologyOf(found),
                senses: glossSenses(word.gloss).map((text) => ({ text, bodies: [] })),
                usage: wordUsage(found),
                verbs: isMap(grammar?.verbs) ? grammar.verbs : null,
                depth,
            });
        }

    const dictionaryTargets = new Map();
    const hasDictionary = (language) =>
        visible.has(language) &&
        Array.isArray(languages.get(language)?.data?.words) &&
        languages.get(language).data.words.length > 0;
    /** One real dictionary target for every class of a spelling-only reference. */
    const dictionaryTarget = (language, name, found) => {
        if (!found) return undefined;
        if (hasDictionary(language)) return language;
        const key = wordKey(language, name);
        if (!dictionaryTargets.has(key)) {
            const matches = wordRows.get(key)?.found ?? [];
            const target =
                matches.length > 1 ?
                    lineage(language).find((ancestor) => {
                        if (!hasDictionary(ancestor)) return false;
                        const shown = wordRows.get(wordKey(ancestor, name))?.found ?? [];
                        return matches.every((match) =>
                            shown.some((entry) => entry.word === match.word),
                        );
                    })
                :   found.statedIn;
            dictionaryTargets.set(key, target);
        }
        return dictionaryTargets.get(key);
    };

    const terms = [];
    const termRow = (
        { owner, ownerKind, language, name, cultures, found },
        senses,
        usage,
        marks,
        origins,
    ) => {
        const word = found?.word;
        const wordLanguage = dictionaryTarget(language, name, found);
        const nameSort =
            marked(marks, "name_sort") ??
            (typeof word?.name_sort === "string" && word.name_sort ? word.name_sort : name);
        terms.push({
            owner,
            owner_kind: ownerKind,
            language,
            language_tag: tagOf(language),
            name,
            name_sort: nameSort,
            letter: dictionaryLetter(nameSort),
            pronunciation: marked(marks, "pronunciation") ?? word?.pronunciation ?? null,
            class: word?.class ?? null,
            word: found ? `${wordLanguage}#${dictionaryEntryAnchor(wordLanguage, name)}` : null,
            senses,
            usage: [...new Set(usage)].filter(citable).sort(compare),
            common: marks.some((one) => one.entry.common === true),
            origins: [...new Set(origins)].sort(compare),
            cultures,
        });
    };
    const combineSenses = (senses) => {
        const combined = [];
        for (const sense of senses) {
            const same = combined.find((one) => one.text === sense.text);
            if (!same) combined.push({ ...sense, bodies: [...sense.bodies] });
            else
                for (const body of sense.bodies)
                    if (!same.bodies.includes(body)) same.bodies.push(body);
        }
        return combined;
    };
    const governanceSenses = (row) => {
        if (row.definition) return [{ text: row.definition.entry.definition, bodies: [row.owner] }];
        return combineSenses([
            ...glossSenses(row.found?.word.gloss).map((text) => ({ text, bodies: [] })),
            ...[...row.pieces]
                .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
                .filter((piece) => piece.text?.trim())
                .map((piece) => ({ text: piece.text, bodies: [row.owner] })),
        ]);
    };
    for (const row of allGovernance) {
        const enters =
            !isSingleWord(row.name) ||
            row.named ||
            (row.language !== null && hasWordIgnoringCase(row.language, row.name));
        if (!enters) continue;
        for (const found of row.matches?.length ? row.matches : [row.found])
            termRow(
                { ...row, found },
                governanceSenses({ ...row, found }),
                [...row.usage],
                row.marks,
                [
                    ...row.pieces.map((piece) => piece.kind),
                    ...(row.marks.length ? ["glossary"] : []),
                ],
            );
    }
    for (const original of owned)
        for (const found of original.matches.length ? original.matches : [undefined]) {
            const one = { ...original, found };
            const defined = defines(one.mark.entry);
            const senses =
                defined ? [{ text: one.mark.entry.definition, bodies: [one.owner] }]
                : one.found ?
                    glossSenses(one.found.word.gloss).map((text) => ({ text, bodies: [] }))
                :   combineSenses(one.providers.flatMap(governanceSenses));
            const usage =
                defined ? [one.owner]
                : one.found ? wordUsage(one.found)
                : [one.owner, ...one.providers.flatMap((row) => [...row.usage])];
            termRow(one, senses, usage, [one.mark], ["glossary"]);
        }

    dictionary.sort(
        (a, b) =>
            compare(a.language, b.language) ||
            compare(a.name_sort, b.name_sort) ||
            compare(a.name, b.name) ||
            compare(normalizedWordClass(a.class), normalizedWordClass(b.class)),
    );
    terms.sort(
        (a, b) =>
            compare(a.owner, b.owner) ||
            compare(a.name_sort, b.name_sort) ||
            compare(a.name, b.name) ||
            compare(normalizedWordClass(a.class), normalizedWordClass(b.class)),
    );
    return { dictionary, terms };
}

/**
 * Rows as a datafile holds them: one JSON object per line, keys sorted at
 * every depth, newline-terminated; the empty string for none.
 *
 * @param {readonly object[]} rows - From {@link dictionaryAndTermRows}.
 * @returns {string} The JSON Lines.
 */
export function serializeRows(rows) {
    if (!rows.length) return "";
    const sorted = (value) => {
        if (Array.isArray(value)) return value.map(sorted);
        if (!isMap(value)) return value;
        return Object.fromEntries(
            Object.keys(value)
                .sort(compare)
                .map((key) => [key, sorted(value[key])]),
        );
    };
    return `${rows.map((row) => JSON.stringify(sorted(row))).join("\n")}\n`;
}
