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

/** Indexed polity settlement facts, validation and shared table markup. @module */
import fs from "node:fs";
import { normalizeSettlementExemptions } from "../config.mjs";
import { declaredHeadings } from "./declared-sections.mjs";
import { positionOfFrontmatterPath, formatDiagnostic } from "./diagnostics.mjs";
import { FENCE_LINE } from "./code-fences.mjs";
import { nameFormsOf } from "./name-forms.mjs";
import {
    isAddressTuple,
    renderAddress,
    parseAddress,
    readQualifier,
    splitAnchor,
} from "./address.mjs";
import { addressSuffixes } from "./address-render.mjs";
import { isNoteRecord } from "./index-records.mjs";
import { isGmNote, NOTE_VOCABULARY } from "./note-vocabulary.mjs";
import { SETTLEMENT_COLUMNS, SETTLEMENT_ROW_FIELDS } from "./settlement-terms.mjs";
export {
    SETTLEMENTS_HEADING,
    SETTLEMENT_COLUMNS,
    SETTLEMENT_ROW_FIELDS,
    SETTLEMENTS_FIELD,
    SETTLEMENT_TABLE_RULES,
} from "./settlement-terms.mjs";

/** Locate body tables without reading their cells. Fenced examples do not count. */
function bodyTables(raw) {
    const lines = String(raw ?? "").split("\n");
    let i = lines[0] === "---" ? lines.indexOf("---", 1) + 1 : 0;
    const headings = new Map(declaredHeadings(raw).map((h) => [h.line - 1, h]));
    const out = [];
    let section = false;
    for (; i < lines.length; i++) {
        const fence = FENCE_LINE.exec(lines[i]);
        if (fence) {
            const close = new RegExp(`^[ \\t]*${fence[2][0]}{${fence[2].length},}[ \\t]*$`);
            while (++i < lines.length && !close.test(lines[i])) {}
            continue;
        }
        const heading = headings.get(i);
        if (heading) {
            if (heading.level <= 2)
                section =
                    ["Settlements", "Settlement index"].includes(heading.text) ||
                    ["settlements", "settlementindex"].includes(heading.id);
            continue;
        }
        if (
            section &&
            lines[i].includes("|") &&
            /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1] ?? "")
        )
            out.push(i + 1);
    }
    return out;
}
const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : "");
const map = (value) =>
    value && typeof value === "object" && !Array.isArray(value) && !isAddressTuple(value);
const ref = (value) =>
    isAddressTuple(value) ? renderAddress(value)
    : typeof value?.address === "string" ? value.address
    : text(value);
const fmOf = (note) => note?.fm ?? note?.settlementRecord ?? note ?? {};
const polity = (note) => fmOf(note).type === "affiliation" && fmOf(note).subType === "polity";
const settlement = (note) => fmOf(note).type === "place" && fmOf(note).subType === "settlement";
const population = (value) =>
    Number.isSafeInteger(value) && value > 0 && String(value).replace(/0+$/, "").length <= 2;
const namesOf = (fm) =>
    new Set(
        [typeof fm.name === "string" ? fm.name : fm.name?.full, ...nameFormsOf(fm.name)]
            .filter((v) => typeof v === "string")
            .map((v) => v.trim().toLowerCase()),
    );

// Indexes and record arrays are immutable for the lifetime of a build.
const corpusCache = new WeakMap();
const renderCache = new WeakMap();

/** Build one canonical graph from indexed frontmatter, including dependency notes. */
function corpusOf(index) {
    if (corpusCache.has(index)) return corpusCache.get(index);
    const nodes = new Map();
    const byRecord = new Map();
    const notes = [...(index.notes ?? []), ...(index.foreign?.index?.values() ?? [])];
    const types = new Set([...Object.keys(NOTE_VOCABULARY), ...(index.types ?? [])]);
    const packages = new Set(
        [
            index.contentPackage,
            ...(index.packages ?? []),
            ...notes.map((note) => fmOf(note).package),
        ].filter(Boolean),
    );
    const explicit = (value) => {
        if (isAddressTuple(value)) return true;
        const qualifier = readQualifier(splitAnchor(ref(value)).address, types, packages);
        return (
            qualifier !== null &&
            (qualifier.reason === undefined || qualifier.reason === "shortcode-not-lowercase")
        );
    };
    const keyOf = (value, type, sourcePackage = index.contentPackage) => {
        const tuple =
            isAddressTuple(value) ? value : (
                parseAddress(
                    splitAnchor(ref(value)).address,
                    {
                        package: sourcePackage,
                        system: "note",
                        type,
                        types,
                        packages,
                    },
                    { declared: true },
                )
            );
        return isAddressTuple(tuple) ? renderAddress({ ...tuple, system: "note" }) : undefined;
    };
    for (const note of notes) {
        const fm = fmOf(note);
        if (!isNoteRecord(fm) || !fm.shortcode) continue;
        const key = renderAddress({
            package: fm.package ?? index.contentPackage,
            system: "note",
            type: fm.type,
            shortcode: fm.shortcode,
        });
        if (!nodes.has(key)) {
            const node = { key, note, fm, names: namesOf(fm), parents: [], direct: [] };
            nodes.set(key, node);
            byRecord.set(fm, node);
        }
    }
    const resolve = (value, type, sourcePackage) => {
        const key = keyOf(value, type, sourcePackage);
        if (key && nodes.has(key)) return nodes.get(key);
        const hit = index.resolve?.(ref(value)) ?? index.addressHit?.(ref(value));
        if (!hit) return undefined;
        const fm = fmOf(hit);
        const found = byRecord.get(fm);
        return (
            found ?? {
                key: key ?? ref(value),
                note: hit,
                fm,
                names: namesOf(fm),
                parents: [],
                direct: [],
            }
        );
    };
    for (const node of nodes.values())
        if (polity(node.fm))
            node.parents = [
                ...new Set(
                    (Array.isArray(node.fm.data?.parents) ? node.fm.data.parents : [])
                        .map((v) => resolve(v, "affiliation", node.fm.package))
                        .filter((p) => p && polity(p.fm))
                        .map((p) => p.key),
                ),
            ];
    const ancestorCache = new Map();
    const ancestors = (key) => {
        if (ancestorCache.has(key)) return ancestorCache.get(key);
        const seen = new Set();
        const pending = [...(nodes.get(key)?.parents ?? [])];
        while (pending.length) {
            const parent = pending.pop();
            if (seen.has(parent)) continue;
            seen.add(parent);
            pending.push(...(nodes.get(parent)?.parents ?? []));
        }
        ancestorCache.set(key, seen);
        return seen;
    };
    for (const node of nodes.values())
        node.direct = node.parents.filter(
            (parent) =>
                !node.parents.some((other) => other !== parent && ancestors(other).has(parent)),
        );
    const owners = new Map();
    const children = new Map();
    const notedNames = new Set();
    const listedCounts = new Map();
    const notedByOwner = new Map();
    const addTo = (map, key, value) => {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(value);
    };
    for (const node of nodes.values()) {
        for (const row of Array.isArray(node.fm.data?.settlements) ?
            node.fm.data.settlements
        :   []) {
            if (!map(row)) continue;
            const name = text(row.settlement).toLowerCase();
            listedCounts.set(name, (listedCounts.get(name) ?? 0) + 1);
        }
        if (polity(node.fm)) {
            for (const key of [node.key, ...ancestors(node.key)]) addTo(owners, key, node);
            for (const key of node.direct) addTo(children, key, node);
            const seat = resolve(node.fm.data?.seat, "place", node.fm.package);
            if (seat && settlement(seat.fm)) addTo(notedByOwner, node.key, seat);
        }
        if (settlement(node.fm)) {
            for (const name of node.names) notedNames.add(name);
            const government = resolve(node.fm.data?.government, "affiliation", node.fm.package);
            if (government) addTo(notedByOwner, government.key, node);
        }
    }
    const order = new Map([...nodes.keys()].map((key, i) => [key, i]));
    const corpus = {
        nodes,
        byRecord,
        keyOf,
        resolve,
        ancestors,
        explicit,
        owners,
        children,
        notedNames,
        listedCounts,
        notedByOwner,
        order,
    };
    corpusCache.set(index, corpus);
    return corpus;
}

/** Actual settlements in a polity's territory, each listed or noted identity counted once. */
function rowsOf(corpus, owner, recursive) {
    const owners = recursive ? (corpus.owners.get(owner.key) ?? []) : [owner];
    const rows = [];
    const seen = new Set();
    const add = (identity, row) => {
        if (!seen.has(identity)) {
            seen.add(identity);
            rows.push(row);
        }
    };
    for (const node of owners)
        for (const row of Array.isArray(node.fm.data?.settlements) ? node.fm.data.settlements : [])
            if (map(row))
                add(`name:${text(row.settlement).toLowerCase()}`, { ...row, source: node });
    const noted = new Map();
    for (const node of owners)
        for (const place of corpus.notedByOwner.get(node.key) ?? []) noted.set(place.key, place);
    for (const node of [...noted.values()].sort(
        (a, b) => corpus.order.get(a.key) - corpus.order.get(b.key),
    )) {
        const government = corpus.resolve(node.fm.data?.government, "affiliation", node.fm.package);
        add(node.key, {
            ...node.fm.data,
            settlement: node.key,
            polity: government?.key,
            location: node.fm.data?.parents?.[0],
            source: node,
            noted: true,
        });
    }
    return rows;
}

/**
 * Track settlement exceptions against actual findings in local notes.
 * @param {readonly {address?: string, prefix?: string, reason: string}[]} entries - Reasoned selectors.
 * @param {string} contentPackage - The local package.
 * @returns {object} Finding filter, count and stale-entry reporter.
 */
export function settlementExemptionTracker(entries = [], contentPackage = "local") {
    const used = new Set();
    let count = 0;
    return {
        filter(note, findings) {
            if (!findings.some((finding) => finding.settlementExemptible)) return findings;
            const fm = fmOf(note);
            if (!fm.type || !fm.shortcode || (fm.package && fm.package !== contentPackage))
                return findings;
            const typed = addressSuffixes({
                package: contentPackage,
                system: "note",
                type: fm.type,
                shortcode: fm.shortcode,
            })[1];
            const matched = [];
            for (const [i, entry] of entries.entries()) {
                let matches = false;
                if (entry.prefix) matches = typed.startsWith(entry.prefix);
                else
                    matches = addressSuffixes({
                        package: contentPackage,
                        system: "note",
                        type: fm.type,
                        shortcode: fm.shortcode,
                    })
                        .slice(1)
                        .includes(entry.address);
                if (matches) matched.push(i);
            }
            if (!matched.length) return findings;
            for (const i of matched) used.add(i);
            count++;
            return findings.filter((finding) => !finding.settlementExemptible);
        },
        get count() {
            return count;
        },
        stale(file) {
            return entries.flatMap((entry, i) =>
                used.has(i) ?
                    []
                :   [
                        {
                            file,
                            line: 1,
                            column: 1,
                            severity: "error",
                            message: `settlement exemption ${JSON.stringify(entry.address ?? entry.prefix)} matches no settlement violation`,
                        },
                    ],
            );
        },
    };
}

/**
 * Check settlement facts and political hierarchy at their authored positions.
 * @param {object} note - The indexed note and its source.
 * @param {{index?: any, settlementExemptions?: any}} [options] - The address index and optional exemption tracker.
 * @returns {object[]} Findings at known positions.
 */
export function checkSettlementTables(note, { index, settlementExemptions } = {}) {
    if (settlementExemptions)
        return settlementExemptions.filter(note, checkSettlementTables(note, { index }));
    if (!index) return [];
    const fm = fmOf(note);
    const findings = [];
    const report = (rule, path, message, settlementExemptible = false) => {
        let at = Array.isArray(path) ? {} : path;
        if (Array.isArray(path))
            for (let length = path.length; length; length--) {
                at = positionOfFrontmatterPath(note.raw ?? "", path.slice(0, length), {
                    key: true,
                });
                if (at.line) break;
            }
        findings.push({
            file: note.file,
            ...at,
            severity: "error",
            ...(settlementExemptible ? { settlementExemptible: true } : {}),
            message: `${rule}: ${message}`,
        });
    };
    const base = ["data", "settlements"];
    const declaration = fm.data?.settlements;
    for (const line of bodyTables(note.raw))
        report(
            "body settlements table",
            { line },
            "declare settlement facts in frontmatter; the build supplies the table",
        );
    if (!polity(fm) && !settlement(fm) && declaration === undefined) return findings;
    const corpus = corpusOf(index);
    const self = corpus.byRecord.get(fm);
    const checkRef = (value, types, at, requirePolity = false, allowName = false) => {
        if (allowName && text(value) && !corpus.explicit(value)) return;
        const type = types.length === 1 ? types[0] : undefined;
        const hit = corpus.keyOf(value, type) ? corpus.resolve(value, type) : undefined;
        if (!hit || !types.includes(hit.fm.type) || (requirePolity && !polity(hit.fm)))
            report(
                "unresolved settlement reference",
                at,
                `${at.at(-1)} must resolve to ${requirePolity ? "a polity" : types.join(" or ")}: ${ref(value) || "missing"}`,
            );
    };
    const checkFacts = (row, at, listed) => {
        for (const field of SETTLEMENT_ROW_FIELDS) {
            const key = field.name;
            const value = row[key];
            if (!listed && ["settlement", "polity", "location"].includes(key)) continue;
            const required =
                listed ?
                    field.required
                :   key === "notes" || (row.population > 0 && ["type", "market"].includes(key));
            if (value == null && field.nullable) continue;
            if (value === undefined && !required) continue;
            if (key === "population") {
                if (!(value === 0 && !listed) && !population(value))
                    report(
                        "people figure",
                        [...at, key],
                        "population is a positive whole number with at most two significant digits",
                    );
            } else if (field.allowed) {
                if (!field.allowed.includes(value))
                    report(
                        "settlement field",
                        [...at, key],
                        `${key} must be ${field.allowed.join(", ")}${field.nullable ? ", or null" : ""}`,
                        key === "type" || key === "market",
                    );
            } else if (key === "location") checkRef(value, ["place"], [...at, key]);
            else if (key === "polity") checkRef(value, ["affiliation"], [...at, key], true, true);
            else if (key === "holder")
                checkRef(value, ["affiliation", "being"], [...at, key], false, true);
            else if (!text(value))
                report(
                    "settlement field",
                    [...at, key],
                    `${key} is nonempty short text`,
                    key === "notes",
                );
        }
    };
    if (declaration !== undefined) {
        if (!polity(fm) || !Array.isArray(declaration)) {
            report("settlements shape", base, "data.settlements is a list on a polity");
        } else
            for (const [i, row] of declaration.entries()) {
                const at = [...base, i];
                if (!map(row)) {
                    report("settlements shape", at, "a settlement row is a map");
                    continue;
                }
                if (
                    Object.keys(row).some(
                        (key) => !SETTLEMENT_ROW_FIELDS.some((f) => f.name === key),
                    )
                )
                    report(
                        "settlements shape",
                        at,
                        `a row carries only ${SETTLEMENT_ROW_FIELDS.map((f) => f.name).join(", ")}`,
                    );
                checkFacts(row, at, true);
                const name = text(row.settlement).toLowerCase();
                const named = corpus.resolve(row.settlement, "place");
                if (corpus.explicit(row.settlement))
                    report(
                        "settlement field",
                        [...at, "settlement"],
                        "settlement is a name without a note; noted settlements are derived from government",
                    );
                const noted = corpus.notedNames.has(name) || (named && settlement(named.fm));
                const listed = (corpus.listedCounts.get(name) ?? 0) > 1;
                if (name && (noted || listed))
                    report(
                        "duplicate settlement",
                        [...at, "settlement"],
                        `${row.settlement} is already listed or noted; each settlement has one source`,
                    );
            }
    }
    const headings = declaredHeadings(note.raw ?? "").filter(
        (h) => h.id === "settlements" || h.text === "Settlements",
    );
    if (headings.length > 1 || headings.some((h) => h.id && h.id !== "settlements"))
        report(
            "settlements shape",
            { line: headings.at(-1).line },
            "use one Settlements heading with the #settlements anchor",
        );
    if (settlement(fm)) {
        checkFacts(fm.data ?? {}, ["data"], false);
        if (fm.data?.population > 0)
            checkRef(fm.data?.government, ["affiliation"], ["data", "government"], true);
        return findings;
    }
    if (!polity(fm) || !self) return findings;
    for (const [i, parent] of (Array.isArray(fm.data?.parents) ? fm.data.parents : []).entries())
        checkRef(parent, ["affiliation"], ["data", "parents", i], true);
    if (corpus.ancestors(self.key).has(self.key))
        report("polity cycle", ["data", "parents"], "the subordinate chain returns to this polity");
    if (Array.isArray(fm.data?.parents) && fm.data.parents.length > 1)
        report("polity superior", ["data", "parents"], "a polity declares at most one superior");
    const total = fm.data?.territorial_population;
    if (
        total === undefined &&
        (declaration !== undefined || fm.data?.seat !== undefined || corpus.children.has(self.key))
    )
        report(
            "territorial population",
            ["data", "territorial_population"],
            "a polity with settlements, a seat, or subordinate polities requires a territorial population",
            true,
        );
    if (total !== undefined) {
        if (!population(total))
            report(
                "territorial population",
                ["data", "territorial_population"],
                "territorial population is a positive whole number with at most two significant digits",
            );
        else {
            const sum = rowsOf(corpus, self, true).reduce(
                (sum, row) => sum + (Number.isFinite(row.population) ? row.population : 0),
                0,
            );
            if (Math.abs(sum - total) > total * 0.05)
                report(
                    "territorial population",
                    ["data", "territorial_population"],
                    `settlements account for ${sum.toLocaleString("en-US")} people against territorial population ${total.toLocaleString("en-US")}; the allowed difference is five percent; list the settlements or declare a reasoned packageBuild.settlementExemptions entry for that polity.`,
                    true,
                );
        }
    }
    return findings;
}

/**
 * Fail publishing before invalid settlement facts become output.
 * @param {object[]} records - Indexed notes.
 * @param {{fileOf?: Function, foreignIndex?: Map<string, object>, rawOf?: Function, config?: object}} [options] - Source, configuration and dependency access.
 * @returns {void}
 */
export function assertSettlementRecords(
    records,
    { fileOf, foreignIndex = new Map(), rawOf, config } = {},
) {
    const notes = records.filter(isNoteRecord).map((fm) => {
        const file = fileOf(fm);
        return {
            fm,
            file,
            raw: rawOf?.(file) ?? (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""),
        };
    });
    const index = {
        notes: [...notes, ...new Set([...foreignIndex.values()].map((record) => fmOf(record)))],
        contentPackage: records.find((r) => r.package)?.package,
    };
    const tracker = settlementExemptionTracker(
        normalizeSettlementExemptions(config?.packageBuild?.settlementExemptions),
        index.contentPackage,
    );
    const findings = notes.flatMap((note) =>
        checkSettlementTables(note, { index, settlementExemptions: tracker }),
    );
    if (findings.length)
        throw Object.assign(new Error(findings.map(formatDiagnostic).join("\n")), {
            located: true,
            findings,
        });
}

/** Render a polity's direct subjects or all settlements beneath it. */
export function settlementMarkdown(record, records = [record], { recursive = false } = {}) {
    if (!polity(record)) return "";
    let indexes = renderCache.get(records);
    if (!indexes) {
        indexes = new Map();
        renderCache.set(records, indexes);
    }
    const visibility = isGmNote(record) ? "all" : "public";
    const cacheKey = `${record.package ?? ""}:${visibility}`;
    if (!indexes.has(cacheKey))
        indexes.set(cacheKey, {
            notes: records.filter((n) => visibility === "all" || !isGmNote(fmOf(n))),
            contentPackage: record.package,
        });
    const corpus = corpusOf(indexes.get(cacheKey));
    const owner = corpus.byRecord.get(record);
    if (!owner) return "";
    const rows = rowsOf(corpus, owner, recursive);
    if (!recursive)
        for (const child of corpus.children.get(owner.key) ?? []) {
            const seat = corpus.resolve(child.fm.data?.seat, "place", child.fm.package);
            if (seat && settlement(seat.fm)) {
                if (!rows.some((r) => r.noted && r.settlement === seat.key))
                    rows.push({
                        ...seat.fm.data,
                        settlement: seat.key,
                        polity: child.key,
                        location: seat.fm.data?.parents?.[0],
                        noted: true,
                    });
            } else
                rows.push({
                    settlement: child.key,
                    polity: child.key,
                    population: child.fm.data?.territorial_population,
                    noted: true,
                });
        }
    if (!rows.length) return "";
    const escape = (value) =>
        String(value ?? "")
            .replace(/([\\`*_[\]<>{}|#!~])/g, "\\$1")
            .replace(/\s*\n\s*/g, " ");
    const link = (value) => `[[${ref(value)}\\|]]`;
    const named = (value) =>
        !value ? ""
        : corpus.keyOf(value) ? link(value)
        : `[${escape(value)}]{.name}`;
    const label = (value) =>
        value == null ? "None" : String(value).replace(/\b\w/g, (c) => c.toUpperCase());
    const columns = SETTLEMENT_COLUMNS.map((c) => c.name);
    const lines = [`| ${columns.join(" | ")} |`, `| ${columns.map(() => "---").join(" | ")} |`];
    for (const row of rows)
        lines.push(
            `| ${[
                row.noted ? link(row.settlement) : `[${escape(row.settlement)}]{.name}`,
                named(row.polity),
                row.location ? link(row.location) : "",
                row.type ? label(row.type) : "",
                label(row.fortification),
                label(row.stronghold),
                named(row.holder),
                row.population == null ? "" : row.population.toLocaleString("en-US"),
                row.market ? label(row.market) : "",
                escape(row.notes),
            ].join(" | ")} |`,
        );
    return lines.join("\n");
}
