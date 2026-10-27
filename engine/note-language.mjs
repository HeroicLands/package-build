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
 * **The language a note is in**, a code `languages:` declares or `en`. A
 * note's language is the first of:
 *
 * 1. its own `data.lang`;
 * 2. its `data.culture`'s language: the culture note it names, resolved by
 *    these same rules;
 * 3. its `data.parents`, nearest first, each resolved by these same rules;
 * 4. `en`.
 *
 * Steps 2 and 3 take only a language some note states: a culture or parent
 * that itself falls through to `en` contributes nothing, and the chain goes on.
 * A parent in another package contributes the language its published entry
 * carries.
 *
 * The content index writes the result onto every note record as `lang`, and
 * every reader of a note's language reads it from there. The configured
 * language note of each code carries that code as `languageCode`, so a reader
 * holding only records maps a code to its note.
 *
 * Findings, each an error:
 *
 * - a `data.lang` naming no declared code, at its value;
 * - a `data.culture` whose culture resolves to no language, at its value;
 * - every `data.parents` entry on a cycle, at the entry, whether or not a walk
 *   reaches it. A cycle among culture notes is reported by the culture
 *   hierarchy check instead.
 *
 * @module
 */

import fs from "node:fs";

import { canonicalKey, isAddressTuple, parseAddress, renderAddress } from "./address.mjs";
import { isAddressSegment } from "./address-charset.mjs";
import { AddressLink } from "./address-values.mjs";
import { formatDiagnostic, positionOfFrontmatterPath } from "./diagnostics.mjs";
import { isNoteRecord, noteFile } from "./index-records.mjs";
import { FALLBACK_LANGUAGE } from "./name-forms.mjs";
import { NOTE_SYSTEM } from "./systems.mjs";

/**
 * The canonical key an Address names, without any anchor.
 *
 * @param {unknown} value - A tuple, an {@link AddressLink}, or anything else.
 * @returns {string|undefined} The key, or `undefined` for anything else.
 */
function addressKey(value) {
    const tuple = value instanceof AddressLink ? value.target : value;
    return isAddressTuple(tuple) ? renderAddress(tuple) : undefined;
}

/**
 * Whether a record is a culture note.
 *
 * @param {Record<string, any>|undefined} record - An index record.
 * @returns {boolean} Whether it is a `lore` note with `subType: culture`.
 */
function isCultureNote(record) {
    return record?.type === "lore" && String(record.subType ?? "").toLowerCase() === "culture";
}

/**
 * Write each note's language onto its record as `lang`, and each configured
 * language note's code onto its record as `languageCode`.
 *
 * Reads each note's authored `data.lang`, `data.culture` and `data.parents`,
 * so it runs before the index writes a resolved culture over `data.culture`.
 *
 * @param {Array<Record<string, any>>} records - Index records, every Address a
 *   tuple. Records that are not notes are passed over.
 * @param {object} options - Options.
 * @param {string} options.contentPackage - The package the records belong to.
 * @param {Readonly<Record<string, {note?: string}>>} [options.languages] - The
 *   configured languages, by code.
 * @param {string} [options.contentBase] - The content tree, for opening a note
 *   to locate a finding.
 * @param {(key: string) => Record<string, any>|undefined} [options.foreignRecord] -
 *   Another package's entry for a canonical address.
 * @param {object[]} [options.problems] - Receives each finding. Omitted, the
 *   findings are collected and one Error lists them all.
 * @param {Map<string, {raw: string}>} [options.parsed] - Notes already read, keyed by file.
 * @returns {Array<Record<string, any>>} The same records.
 * @throws {Error} When `problems` is omitted and anything is reported.
 */
export function resolveNoteLanguages(
    records,
    { contentPackage, languages, contentBase, foreignRecord, problems, parsed },
) {
    const codes = new Set([FALLBACK_LANGUAGE, ...Object.keys(languages ?? {})]);
    const notes = new Map();
    for (const record of records) {
        if (!isNoteRecord(record) || !isAddressSegment(String(record.shortcode ?? ""))) continue;
        const key = canonicalKey(contentPackage, NOTE_SYSTEM, record.type, record.shortcode);
        if (!notes.has(key)) notes.set(key, record);
    }
    const localOf = (value) => {
        const tuple = value instanceof AddressLink ? value.target : value;
        if (!isAddressTuple(tuple) || tuple.package !== contentPackage) return undefined;
        return notes.get(canonicalKey(contentPackage, NOTE_SYSTEM, tuple.type, tuple.shortcode));
    };

    const findings = [];
    /**
     * Report one finding on a note, at a frontmatter value.
     *
     * @param {Record<string, any>} record - The note.
     * @param {Array<string|number>} keyPath - Where the value is written.
     * @param {string} message - What is wrong.
     */
    const report = (record, keyPath, message) => {
        const file = contentBase ? noteFile(contentBase, record) : record.file?.path;
        const raw =
            parsed?.get(file)?.raw ??
            (contentBase && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined);
        findings.push({
            file,
            ...positionOfFrontmatterPath(raw, keyPath),
            severity: "error",
            message,
        });
    };

    const memo = new Map();
    const inProgress = new Set();

    /**
     * The language a source Address states: a local note's, resolved, or the
     * one a foreign entry publishes.
     *
     * @param {unknown} value - A `data.culture` or `data.parents` Address.
     * @returns {string|undefined} The code.
     */
    const statedThrough = (value) => {
        const key = addressKey(value);
        if (!key) return undefined;
        const local = localOf(value);
        if (local) return resolve(local);
        const tuple = value instanceof AddressLink ? value.target : value;
        if (tuple.package === contentPackage) return undefined;
        const lang = foreignRecord?.(key)?.lang;
        return typeof lang === "string" && lang ? lang : undefined;
    };

    /**
     * The language a note states through its own field, its culture or its
     * parents, ignoring the fallback.
     *
     * @param {Record<string, any>} record - The note.
     * @returns {string|undefined} The code.
     */
    const resolveRecord = (record) => {
        const own = record.data?.lang;
        if (own !== undefined && own !== null) {
            if (typeof own === "string" && codes.has(own)) return own;
            report(
                record,
                ["data", "lang"],
                `data.lang ${typeof own === "string" ? own : JSON.stringify(own)} names no ` +
                    `language: state a code \`languages:\` declares, or ${FALLBACK_LANGUAGE} ` +
                    `(${[...codes].sort().join(", ")})`,
            );
        }
        const culture = record.data?.culture;
        const cultureRecord = localOf(culture);
        if (addressKey(culture) && cultureRecord !== record) {
            const lang = statedThrough(culture);
            if (lang) return lang;
            if (isCultureNote(cultureRecord) && !inProgress.has(cultureRecord))
                report(
                    record,
                    ["data", "culture"],
                    `data.culture ${cultureRecord.type}-${cultureRecord.shortcode} resolves to ` +
                        "no language: state data.lang on the culture or on a parent culture",
                );
        }
        const parents = Array.isArray(record.data?.parents) ? record.data.parents : [];
        for (const [position, parent] of parents.entries()) {
            const target = localOf(parent);
            if (target && inProgress.has(target)) continue;
            const lang = statedThrough(parent);
            if (lang) return lang;
        }
        return undefined;
    };

    /**
     * A local note's stated language, memoised; a note already being resolved
     * is a cycle and states nothing.
     *
     * @param {Record<string, any>} record - The note.
     * @returns {string|undefined} The code.
     */
    const resolve = (record) => {
        if (memo.has(record)) return memo.get(record);
        if (inProgress.has(record)) return undefined;
        inProgress.add(record);
        const result = resolveRecord(record);
        inProgress.delete(record);
        memo.set(record, result);
        return result;
    };

    // Walked in address order, so which note of a cycle is met first is a fact
    // about the content rather than about directory-read order.
    for (const key of [...notes.keys()].sort()) resolve(notes.get(key));

    // Every `data.parents` entry on a cycle, whether or not a walk reached it.
    for (const { record, position, target } of cyclicParents(notes, localOf))
        if (!(isCultureNote(record) && isCultureNote(target)))
            report(
                record,
                ["data", "parents", position],
                `data.parents.${position} names ${target.type}-${target.shortcode}, ` +
                    "which closes a parents cycle; a note is never its own ancestor",
            );
    for (const record of records) {
        if (!isNoteRecord(record) || !isAddressSegment(String(record.shortcode ?? ""))) continue;
        const own = notes.get(
            canonicalKey(contentPackage, NOTE_SYSTEM, record.type, record.shortcode),
        );
        record.lang = memo.get(own) ?? FALLBACK_LANGUAGE;
    }

    // Each configured language note carries its code.
    const types = new Set(["skill", ...records.map((record) => String(record.type ?? ""))]);
    for (const [code, spec] of Object.entries(languages ?? {})) {
        if (typeof spec?.note !== "string") continue;
        const tuple = parseAddress(spec.note, {
            package: contentPackage,
            system: NOTE_SYSTEM,
            type: "skill",
            types,
        });
        const record = tuple.reason ? undefined : localOf(tuple);
        if (record) record.languageCode = code;
    }

    findings.sort(
        (a, b) =>
            String(a.file).localeCompare(String(b.file), "en") ||
            (a.line ?? 0) - (b.line ?? 0) ||
            (a.column ?? 0) - (b.column ?? 0),
    );
    if (problems) problems.push(...findings);
    else if (findings.length)
        throw Object.assign(new Error(findings.map(formatDiagnostic).join("\n")), {
            located: true,
        });
    return records;
}

/**
 * Every local `data.parents` entry that lies on a cycle: its target reaches
 * its note again through `data.parents`.
 *
 * @param {Map<string, Record<string, any>>} notes - Local notes by key.
 * @param {(value: unknown) => Record<string, any>|undefined} localOf - The
 *   local note an Address names.
 * @returns {Array<{record: Record<string, any>, position: number, target: Record<string, any>}>}
 *   The entries, in note-key then list order.
 */
function cyclicParents(notes, localOf) {
    const edges = new Map();
    for (const record of notes.values()) {
        const parents = Array.isArray(record.data?.parents) ? record.data.parents : [];
        edges.set(
            record,
            parents
                .map((parent, position) => ({ position, target: localOf(parent) }))
                .filter((edge) => edge.target),
        );
    }
    // Tarjan's strongly connected components: an edge inside one component,
    // or from a note to itself, lies on a cycle.
    const index = new Map();
    const low = new Map();
    const component = new Map();
    const stack = [];
    const onStack = new Set();
    let counter = 0;
    const visit = (record) => {
        index.set(record, counter);
        low.set(record, counter);
        counter++;
        stack.push(record);
        onStack.add(record);
        for (const { target } of edges.get(record) ?? []) {
            if (!index.has(target)) {
                visit(target);
                low.set(record, Math.min(low.get(record), low.get(target)));
            } else if (onStack.has(target))
                low.set(record, Math.min(low.get(record), index.get(target)));
        }
        if (low.get(record) !== index.get(record)) return;
        let member;
        do {
            member = stack.pop();
            onStack.delete(member);
            component.set(member, record);
        } while (member !== record);
    };
    const keys = [...notes.keys()].sort();
    for (const key of keys) if (!index.has(notes.get(key))) visit(notes.get(key));
    const out = [];
    for (const key of keys) {
        const record = notes.get(key);
        for (const { position, target } of edges.get(record) ?? [])
            if (target === record || component.get(target) === component.get(record))
                out.push({ record, position, target });
    }
    return out;
}

/**
 * Each language code's note, read from records alone: the Address of every
 * record carrying a `languageCode`.
 *
 * @param {Iterable<Record<string, any>>} records - Index records, local and
 *   any dependency's, or link-index notes carrying them.
 * @param {(record: Record<string, any>) => string|undefined} addressOf - A
 *   record's Address, as the caller keys notes.
 * @returns {Map<string, string>} Code to the language note's Address; the first
 *   record naming a code wins.
 */
export function languageNotesByCode(records, addressOf) {
    const out = new Map();
    for (const record of records) {
        const code = record?.languageCode;
        if (typeof code !== "string" || out.has(code)) continue;
        const address = addressOf(record);
        if (address) out.set(code, address);
    }
    return out;
}
