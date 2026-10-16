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

import path from "node:path";
import { canonicalKey, expandAddress, readCanonicalKey, readQualifier } from "./address.mjs";
import { isAddressSegment } from "./address-charset.mjs";
import { encodeAddresses } from "./address-values.mjs";
import { formatLocator } from "./diagnostics.mjs";
import { FOLDER_TYPE } from "./folder-notes.mjs";
import { isNoteRecord } from "./index-records.mjs";
import { NOTE_VOCABULARY } from "./note-vocabulary.mjs";

const WORD = /[\p{L}\p{M}\p{N}]+(?:[’'–-][\p{L}\p{M}\p{N}]+)*/gu;
const compare = (a, b) =>
    a < b ? -1
    : a > b ? 1
    : 0;

/**
 * An indexed whole-label match. Ambiguous labels retain every candidate.
 * @typedef {object} NameMatch
 * @property {string} key - Canonical page identity, or the ambiguous label identity.
 * @property {string} full - Declared full name.
 * @property {true} indexed - The identity belongs to the indexed catalog.
 * @property {boolean} [fullUse] - The label is a full-name form rather than an alias.
 * @property {NameMatch[]} [candidates] - Indexed identities sharing the label.
 * @property {string} [destination] - Canonical Address used by a resolved link.
 */

/**
 * The prepared name and declared-alias lookup.
 * @typedef {object} NameCatalog
 * @property {(label: string, preferred?: {key: string}) => NameMatch|undefined} recognize - Match a whole visible label.
 * @property {(target: string) => NameMatch|undefined} resolve - Resolve an Address target without its anchor to its indexed identity.
 */

/**
 * One captured marked-name occurrence.
 * @typedef {object} MarkedName
 * @property {string} name - Rendered visible text.
 * @property {string|null} type - Supplied valid type, or null.
 * @property {string|null} subType - Supplied valid subtype, or null.
 * @property {number} line - Original 1-based file line.
 * @property {number} column - Original 1-based UTF-16 file column.
 */

/**
 * One reported source use.
 * @typedef {object} NameUse
 * @property {string|null} owner - Canonical NOTE owner, or null for an unaddressed record.
 * @property {string|undefined} file - Stored path relative to the content root.
 * @property {number} line - Original 1-based file line.
 * @property {number} column - Original 1-based UTF-16 file column.
 */

/**
 * Unwritten names sharing one supplied kind.
 * @typedef {object} UnwrittenNameGroup
 * @property {string|null} type - Supplied type, or null.
 * @property {string|null} subType - Supplied subtype, or null.
 * @property {Array<{name: string, uses: NameUse[]}>} names - Normalized labels and every source use.
 */

/**
 * A parsed span with its original source sites and visible text.
 * @typedef {object} ParsedNameSpan
 * @property {string} visible - Text from the actual parsed children.
 * @property {ReadonlyArray<readonly [string, string]>} attrs - Retained permitted attributes.
 * @property {number} line - Original 1-based file line of the opening bracket.
 * @property {number} column - Original 1-based UTF-16 file column of the bracket.
 * @property {Readonly<Record<string, {key: {line: number, column: number}}>>} [attributePositions] - Actual attribute-key sites.
 */

/**
 * One invalid supplied name kind.
 * @typedef {object} NameKindFinding
 * @property {string} [file] - Authored source file.
 * @property {number} [line] - Actual attribute-key line when supplied by the parser.
 * @property {number} [column] - Actual attribute-key UTF-16 column when known.
 * @property {"error"} severity - Invalid supplied values fail validation.
 * @property {string} message - The invalid value and the declaration it must follow.
 */

/**
 * A marked name whose supplied kinds disagree.
 * @typedef {object} NameConflict
 * @property {string} name - Normalized visible label.
 * @property {Array<{type: string, subType: string|null, uses: NameUse[]}>} kinds - Every supplied typed use; untyped uses are excluded.
 */

/**
 * The current package's unwritten names and incompatible supplied facts.
 * @typedef {object} NamesReport
 * @property {string} package - Owning content package.
 * @property {UnwrittenNameGroup[]} unwritten - Unresolved labels grouped by supplied kind.
 * @property {NameConflict[]} conflicts - Labels with incompatible supplied kinds.
 */

/**
 * Normalize a whole visible label without folding its case.
 * @param {string} text - Visible name or declared alias.
 * @returns {string} NFC text with straight apostrophes and single spaces.
 */
export function normalizeName(text) {
    return text.normalize("NFC").replaceAll("’", "'").replace(/\s+/g, " ").trim();
}

/**
 * Whole-label possessives and regular plurals; other forms are declared aliases.
 * @param {string} text - Full name or declared alias.
 * @returns {string[]} Supported whole-label forms.
 */
export function nameForms(text) {
    const value = normalizeName(text);
    const last = [...value.matchAll(WORD)].at(-1);
    if (!last) return [value];
    const word = last[0];
    const plural =
        /[^aeiou]y$/i.test(word) ? word.slice(0, -1) + "ies"
        : /(?:s|x|z|ch|sh)$/i.test(word) ? word + "es"
        : word + "s";
    return [...new Set([word, word + "'s", plural, plural + "'s", plural + "'"])].map(
        (ending) => value.slice(0, last.index) + ending + value.slice(last.index + word.length),
    );
}

/** Stable record identity independent of a shared display name. */
function identity(record) {
    return record.address?.canonical ? encodeAddresses(record.address.canonical) : undefined;
}

/**
 * Prepare full names, declared aliases and link identities from captured records.
 * @param {object} options - The invocation's existing corpus and link index.
 * @param {readonly object[]} options.records - Captured local records.
 * @param {ReturnType<typeof import("./content-links.mjs").buildLinkIndex>} options.index - Captured address space.
 * @returns {NameCatalog} Pure whole-label and Address lookups.
 */
export function createNameCatalog({ records, index }) {
    const names = new Map(),
        byFile = new Map(),
        entries = new Map();
    const addName = (key, full, aliases = []) => {
        const entry = entries.get(key) ?? { key, full, indexed: true };
        entries.set(key, entry);
        for (const text of [full, ...aliases]) {
            if (typeof text !== "string" || !text.trim()) continue;
            for (const spelling of nameForms(text)) {
                if (!names.has(spelling)) names.set(spelling, new Map());
                const targets = names.get(spelling);
                targets.set(key, {
                    ...entry,
                    fullUse:
                        targets.get(key)?.fullUse || normalizeName(text) === normalizeName(full),
                });
            }
        }
        return entry;
    };
    for (const record of records.filter(isNoteRecord)) {
        const canonical = identity(record);
        const parts = readCanonicalKey(canonical);
        const full = record.name?.full;
        if (!parts || parts.type === FOLDER_TYPE || typeof full !== "string") continue;
        const page = canonicalKey(parts.package, "note", parts.type, parts.shortcode);
        const entry = addName(index.resolve(page) ? page : canonical, full, record.name.aliases);
        entries.set(canonical, entry);
        if (index.resolve(page)) entries.set(page, entry);
        if (record.file?.path) byFile.set(record.file.path, entry);
    }
    for (const [canonical, hit] of index.foreign?.index ?? []) {
        const parts = readCanonicalKey(canonical);
        if (
            !parts ||
            parts.system === "none" ||
            parts.type === FOLDER_TYPE ||
            typeof hit.name !== "string"
        )
            continue;
        const page = canonicalKey(parts.package, "note", parts.type, parts.shortcode);
        const key = index.foreign.index.has(page) ? page : canonical;
        entries.set(canonical, addName(key, hit.name, hit.aliases));
    }
    return {
        recognize(label, preferred) {
            const candidates = [...(names.get(normalizeName(label))?.values() ?? [])];
            const target =
                candidates.find((entry) => entry.key === preferred?.key) ??
                (candidates.length === 1 ? candidates[0] : undefined);
            return (
                target ??
                (candidates.length ?
                    {
                        key: "name:" + normalizeName(label),
                        full: label,
                        indexed: true,
                        fullUse: true,
                        candidates,
                    }
                :   undefined)
            );
        },
        resolve(target) {
            const qualified = readQualifier(
                target,
                index.types,
                index.packages,
                index.noIndexPackages,
            );
            if (!qualified || qualified.reason) return undefined;
            const canonical = expandAddress(qualified, {
                package: index.contentPackage,
                system: "note",
            });
            const hit = index.resolve(target) ?? index.manifestHit(target);
            if (!hit) return undefined;
            const entry = entries.get(canonical) ?? byFile.get(hit.rel);
            return entry ? { ...entry, destination: canonical } : undefined;
        },
    };
}

/** Compare captured sites without inventing an absent source position. */
function compareUses(a, b) {
    return (
        compare(a.file ?? "\uffff", b.file ?? "\uffff") ||
        compare(a.line, b.line) ||
        compare(a.column, b.column)
    );
}

/** Preserve the captured site and derive only its real NOTE owner. */
function nameUse(record, occurrence) {
    const parts = readCanonicalKey(identity(record));
    return {
        owner: parts ? canonicalKey(parts.package, "note", parts.type, parts.shortcode) : null,
        file: record.file?.path,
        line: occurrence.line,
        column: occurrence.column,
    };
}

/** The first real reported site, without a package-level fallback. */
function firstNameUse(uses) {
    return uses
        .filter((use) => use.file && Number.isFinite(use.line) && Number.isFinite(use.column))
        .sort(compareUses)[0];
}

/**
 * Group unwritten marked names from captured record fields alone.
 * @param {object} options - Current package records and prepared known names.
 * @param {readonly object[]} options.records - Authored records carrying `names` entries.
 * @param {NameCatalog} options.catalog - Invocation-owned indexed name lookup.
 * @returns {{groups: UnwrittenNameGroup[], firstUse: NameUse|undefined}} Every use and the earliest located reported occurrence.
 */
export function collectUnwrittenNames({ records, catalog }) {
    const kinds = new Map();
    for (const record of records.filter(isNoteRecord)) {
        for (const occurrence of record.names ?? []) {
            if (catalog.recognize(occurrence.name)) continue;
            const type = occurrence.type,
                subType = occurrence.subType,
                kind = JSON.stringify([type, subType]);
            if (!kinds.has(kind)) kinds.set(kind, { type, subType, names: new Map() });
            const names = kinds.get(kind).names,
                name = normalizeName(occurrence.name);
            if (!names.has(name)) names.set(name, []);
            names.get(name).push(nameUse(record, occurrence));
        }
    }
    const groups = [...kinds.values()]
        .sort(
            (a, b) =>
                compare(a.type ?? "", b.type ?? "") || compare(a.subType ?? "", b.subType ?? ""),
        )
        .map(({ type, subType, names }) => ({
            type,
            subType,
            names: [...names]
                .sort(([a], [b]) => compare(a, b))
                .map(([name, uses]) => ({ name, uses: uses.sort(compareUses) })),
        }));
    const firstUse = firstNameUse(
        groups.flatMap((group) => group.names.flatMap((name) => name.uses)),
    );
    return { groups, firstUse };
}

/** Read one supplied kind against actual note declarations. */
function readNameKind(value, vocabulary, types) {
    const parts = value.split("/");
    const prefix = `data-type ${JSON.stringify(value)}`;
    if (parts.length > 2 || parts.some((part) => !isAddressSegment(part)))
        return `${prefix} must be a note type or type/subType using lowercase letters and digits`;
    const [type, subType] = parts;
    if (!Object.hasOwn(vocabulary, type) && !types.has(type))
        return `${prefix} does not name a declared note type`;
    if (subType !== undefined) {
        const entry = vocabulary[type];
        if (!entry || !Object.hasOwn(entry, "subTypes"))
            return `${prefix} supplies a subtype for ${type}, which declares no subtypes`;
        if (entry.subTypes !== null && !entry.subTypes.includes(subType))
            return `${prefix} does not name a subtype declared by ${type} (${entry.subTypes.join(", ")})`;
    }
    return { type, subType: subType ?? null };
}

/**
 * Analyze actual parsed name spans using one supplied-kind validation route.
 * @param {readonly ParsedNameSpan[]} spans - Parsed spans at original file coordinates.
 * @param {object} [options] - Existing note declarations and source context.
 * @param {string} [options.file] - Authored source file.
 * @param {Readonly<Record<string, {subTypes?: readonly string[]|null}>>} [options.vocabulary] - Actual note vocabulary.
 * @param {Iterable<string>} [options.types] - Additional bare types from configured declarations.
 * @returns {{names: MarkedName[], findings: NameKindFinding[]}} Valid occurrence fields and every invalid supplied attribute.
 */
export function analyzeNameSpans(spans, { file, vocabulary = NOTE_VOCABULARY, types = [] } = {}) {
    const names = [],
        findings = [],
        declared = new Set(types);
    for (const span of spans) {
        if (
            !span.attrs.some(
                ([key, value]) => key === "class" && value.split(/\s+/).includes("name"),
            )
        )
            continue;
        const attribute = span.attrs.find(([key]) => key === "data-type");
        const kind =
            attribute ?
                readNameKind(attribute[1], vocabulary, declared)
            :   { type: null, subType: null };
        if (typeof kind === "string") {
            const site = span.attributePositions?.["data-type"]?.key;
            findings.push({
                ...(file === undefined ? {} : { file }),
                ...(Number.isFinite(site?.line) ? { line: site.line } : {}),
                ...(Number.isFinite(site?.column) ? { column: site.column } : {}),
                severity: "error",
                message: kind,
            });
            continue;
        }
        names.push({
            name: span.visible,
            type: kind.type,
            subType: kind.subType,
            line: span.line,
            column: span.column,
        });
    }
    return { names, findings };
}

/**
 * Build one package report from captured explicit names and the prepared catalog.
 * Untyped facts and matching parent/subtype refinements are compatible.
 * @param {object} options - Existing package corpus and lookup.
 * @param {string} options.package - Owning content package.
 * @param {readonly object[]} options.records - Captured current-package records.
 * @param {NameCatalog} options.catalog - Invocation-owned indexed name lookup.
 * @returns {NamesReport} Deterministic structured groups without diagnostics or I/O.
 */
export function createNamesReport({ package: contentPackage, records, catalog }) {
    const names = new Map();
    for (const record of records.filter(isNoteRecord))
        for (const occurrence of record.names ?? []) {
            if (occurrence.type === null) continue;
            const name = normalizeName(occurrence.name);
            if (!names.has(name)) names.set(name, new Map());
            const kinds = names.get(name),
                key = JSON.stringify([occurrence.type, occurrence.subType]);
            if (!kinds.has(key))
                kinds.set(key, { type: occurrence.type, subType: occurrence.subType, uses: [] });
            kinds.get(key).uses.push(nameUse(record, occurrence));
        }
    const conflicts = [];
    for (const [name, kinds] of [...names].sort(([a], [b]) => compare(a, b))) {
        const parents = new Map();
        for (const kind of kinds.values()) {
            if (!parents.has(kind.type)) parents.set(kind.type, new Set());
            if (kind.subType !== null) parents.get(kind.type).add(kind.subType);
        }
        if (parents.size < 2 && ![...parents.values()].some((values) => values.size > 1)) continue;
        conflicts.push({
            name,
            kinds: [...kinds.values()]
                .sort(
                    (a, b) => compare(a.type, b.type) || compare(a.subType ?? "", b.subType ?? ""),
                )
                .map((kind) => ({ ...kind, uses: kind.uses.sort(compareUses) })),
        });
    }
    return {
        package: contentPackage,
        unwritten: collectUnwrittenNames({ records, catalog }).groups,
        conflicts,
    };
}

/**
 * Format one readable advisory containing every reported source use.
 * @param {NamesReport} report - Structured package report.
 * @param {object} [options] - Source-path context for the caller's diagnostics.
 * @param {string} [options.contentBase] - Content root for stored relative paths.
 * @returns {{file?: string, line?: number, column?: number, severity: "warning", message: string}|undefined} One advisory, or none when both groups are empty.
 */
export function namesReportFinding(report, { contentBase } = {}) {
    if (!report.unwritten.length && !report.conflicts.length) return undefined;
    const located = (use) => ({
        ...use,
        file: contentBase && use.file ? path.resolve(contentBase, use.file) : use.file,
    });
    const kindLabel = ({ type, subType }) =>
        type ? type + (subType ? `/${subType}` : "") : "untyped";
    const usesText = (uses) =>
        uses.map((use) => formatLocator(located(use)) || "source location unavailable").join("; ");
    const count = new Set(
        report.unwritten.flatMap((group) => group.names.map((entry) => entry.name)),
    ).size;
    const summary = [];
    if (count) summary.push(`${count} unwritten name${count === 1 ? "" : "s"}`);
    if (report.conflicts.length)
        summary.push(
            `${report.conflicts.length} conflicting name${report.conflicts.length === 1 ? "" : "s"}`,
        );
    const lines = [`names: ${summary.join("; ")}.`];
    for (const group of report.unwritten) {
        lines.push(`  Unwritten ${kindLabel(group)}:`);
        for (const entry of group.names) lines.push(`    ${entry.name} — ${usesText(entry.uses)}`);
    }
    for (const conflict of report.conflicts) {
        lines.push(`  Incompatible ${conflict.name}:`);
        for (const kind of conflict.kinds)
            lines.push(`    ${kindLabel(kind)} — ${usesText(kind.uses)}`);
    }
    const firstUse = firstNameUse([
        ...report.unwritten.flatMap((group) => group.names.flatMap((entry) => entry.uses)),
        ...report.conflicts.flatMap((conflict) => conflict.kinds.flatMap((kind) => kind.uses)),
    ]);
    const at = firstUse ? located(firstUse) : {};
    return {
        ...(at.file === undefined ? {} : { file: at.file }),
        ...(at.line === undefined ? {} : { line: at.line }),
        ...(at.column === undefined ? {} : { column: at.column }),
        severity: "warning",
        message: lines.join("\n"),
    };
}
