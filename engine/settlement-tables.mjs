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
 * Indexed settlement rows, their checks and their shared table.
 * Facts come only from data.settlements. The body is scanned solely to locate
 * a forbidden authored table, never to recover any row's facts.
 * @module
 */
import fs from "node:fs";
import { declaredHeadings } from "./declared-sections.mjs";
import { positionOfFrontmatterPath, formatDiagnostic } from "./diagnostics.mjs";
import { FENCE_LINE } from "./code-fences.mjs";
import { MARKET_CLASSES, marketClass } from "./market-class.mjs";
import { nameFormsOf } from "./name-forms.mjs";
import { isAddressTuple, renderAddress, parseAddress, readCanonicalKey } from "./address.mjs";
import { isNoteRecord } from "./index-records.mjs";

import {
    SETTLEMENTS_HEADING,
    SETTLEMENT_COLUMNS,
    SETTLEMENT_ROW_FIELDS,
    SETTLEMENTS_FIELD,
    SETTLEMENT_TABLE_RULES,
} from "./settlement-terms.mjs";
/** Public settlement vocabulary and rendering declarations. */
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
                section = heading.text === "Settlements" || heading.id === "settlements";
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
const typeOf = (hit) => String(hit?.fm?.type ?? hit?.type ?? "").toLowerCase();
const resolve = (index, value) => index.resolve?.(ref(value)) ?? index.addressHit?.(ref(value));
const count = (n) => Number(n).toLocaleString("en-US");
const marketText = (n) => {
    const c = marketClass(n);
    return c ? `${c.value} ${c.name}` : String(n);
};

function namesOf(fm) {
    const out = new Set();
    const add = (v) => {
        if (text(v)) out.add(text(v).toLowerCase());
    };
    if (typeof fm.name === "string") add(fm.name);
    else {
        add(fm.name?.full);
        for (const form of nameFormsOf(fm.name)) add(form);
    }
    return out;
}
function ancestors(places, node) {
    const seen = new Set([node.key]);
    const out = [];
    const queue = [...node.parents];
    while (queue.length) {
        const code = queue.shift();
        if (seen.has(code)) continue;
        seen.add(code);
        const parent = places.get(code);
        if (parent) {
            out.push(parent);
            queue.push(...parent.parents);
        }
    }
    return out;
}

/** A place's canonical identity retains its package and normalizes its system to note. */
function placeKey(value, index) {
    const raw = ref(value);
    const canonical = isAddressTuple(value) ? value : readCanonicalKey(raw);
    const tuple =
        canonical ??
        parseAddress(
            raw,
            {
                package: index.contentPackage,
                system: "note",
                type: "place",
                types: new Set(["place"]),
                packages: index.packages ?? new Set([index.contentPackage]),
            },
            { declared: true },
        );
    if (!isAddressTuple(tuple) || tuple.type !== "place") return undefined;
    return renderAddress({ ...tuple, system: "note" });
}

/** Read the corpus exclusively through the index's frontmatter projection. */
function corpusOf(index) {
    const places = new Map();
    const byNote = new Map();
    for (const note of index.notes ?? []) {
        const fm = note.fm ?? {};
        if (typeOf(note) !== "place") continue;
        const shortcode = String(fm.shortcode ?? "").toLowerCase();
        if (!shortcode) continue;
        const key =
            index.contentPackage ?
                renderAddress({
                    package: index.contentPackage,
                    system: "note",
                    type: "place",
                    shortcode,
                })
            :   undefined;
        const node = {
            note,
            key,
            code: shortcode,
            kind: fm.subType,
            title: fm.name?.full ?? fm.name ?? shortcode,
            names: namesOf(fm),
            parents: (Array.isArray(fm.data?.parents) ? fm.data.parents : [])
                .map((value) => placeKey(value, index))
                .filter(Boolean),
            declaration: fm.data?.settlements,
        };
        if (key) places.set(key, node);
        byNote.set(note, node);
    }
    const covers = new Map();
    for (const node of places.values()) {
        if (node.kind !== "settlement") continue;
        const home = ancestors(places, node).find((n) => n.declaration !== undefined);
        if (home) {
            const list = covers.get(home.key) ?? [];
            list.push(node);
            covers.set(home.key, list);
        }
    }
    const rowedIn = new Map();
    for (const region of [...places.values()].sort((a, b) =>
        String(a.note.file).localeCompare(String(b.note.file), "en"),
    )) {
        for (const row of Array.isArray(region.declaration?.rows) ? region.declaration.rows : []) {
            if (!map(row) || !row.place) continue;
            const hit = resolve(index, row.place);
            if (!hit || typeOf(hit) !== "place") continue;
            const list = rowedIn.get(hit) ?? [];
            if (!list.includes(region.note)) list.push(region.note);
            rowedIn.set(hit, list);
        }
    }
    return { places, byNote, covers, rowedIn };
}

/**
 * Check indexed rows, locating each finding in its original YAML.
 * @param {object} note - Indexed note and original locator text.
 * @param {object} [opts] - Captured context.
 * @param {object} [opts.index] - Complete local and dependency reference index.
 * @returns {object[]} Located findings.
 */
export function checkSettlementTables(note, { index } = {}) {
    if (!index || typeOf(note) !== "place") return [];
    const findings = [];
    const location = (path) => {
        if (!Array.isArray(path)) return path;
        for (let length = path.length; length; length--) {
            const at = positionOfFrontmatterPath(note.raw ?? "", path.slice(0, length), {
                key: true,
            });
            if (at.line) return at;
        }
        return { line: 1, column: 1 };
    };
    const report = (rule, path, message) =>
        findings.push({
            file: note.file,
            ...location(path),
            severity: "error",
            message: `${rule}: ${message}`,
        });
    for (const line of bodyTables(note.raw))
        report(
            "body settlements table",
            { line },
            "declare the rows in data.settlements; a body table supplies no settlement facts",
        );
    const declaration = note.fm?.data?.settlements;
    if (declaration === undefined) return findings;
    const base = ["data", "settlements"];
    const ownHeadings = declaredHeadings(note.raw ?? "").filter(
        (h) => h.id === "settlements" || h.text === "Settlements",
    );
    if (ownHeadings.length > 1)
        report(
            "settlements shape",
            { line: ownHeadings[1].line },
            "declare one Settlements heading with the canonical #settlements anchor",
        );
    for (const heading of ownHeadings)
        if (heading.id && heading.id !== "settlements")
            report(
                "settlements shape",
                { line: heading.line },
                "the declared Settlements section uses the canonical #settlements anchor",
            );
    if (note.fm.subType !== "region" || !map(declaration) || !Array.isArray(declaration.rows)) {
        report(
            "settlements shape",
            base,
            "data.settlements on a region is a map with rows and tail",
        );
        return findings;
    }
    if (Object.keys(declaration).some((key) => !["rows", "tail"].includes(key)))
        report("settlements shape", base, "data.settlements carries only rows and tail");
    if (!text(declaration.tail))
        report(
            "no tail",
            base,
            "data.settlements.tail is a sentence stating what the table leaves out",
        );
    const corpus = corpusOf(index);
    const self = corpus.byNote.get(note);
    const covered = corpus.covers.get(self?.key) ?? [];
    const rowed = new Set();
    const seen = new Set();
    for (const [i, row] of declaration.rows.entries()) {
        const at = [...base, "rows", i];
        if (!map(row)) {
            report("settlements shape", at, "a row is a map");
            continue;
        }
        if (
            Object.keys(row).some(
                (key) => !SETTLEMENT_ROW_FIELDS.some((field) => field.name === key),
            )
        )
            report(
                "settlements shape",
                at,
                "a row carries only place, name, market, population, heldBy and for",
            );
        for (const key of ["name", "for"])
            if (Object.hasOwn(row, key) && typeof row[key] !== "string")
                report("settlements shape", [...at, key], `${key} is plain text`);
        const label = text(row.name) || ref(row.place) || `row ${i + 1}`;
        let settlement;
        if (Boolean(row.place) === Boolean(text(row.name))) {
            report(
                "settlements shape",
                at,
                "state exactly one of place (an Address) and name (plain text)",
            );
        }
        if (row.place) {
            const hit = resolve(index, row.place);
            if (!hit)
                report(
                    "unresolved settlement reference",
                    [...at, "place"],
                    `${ref(row.place)} does not resolve`,
                );
            if (hit) {
                if (typeOf(hit) !== "place")
                    report(
                        "not a settlement",
                        [...at, "place"],
                        `${label} names a ${typeOf(hit)}; link the settlement's place note`,
                    );
                else settlement = hit;
            }
        } else if (text(row.name)) {
            const match = covered.find((n) => n.names.has(text(row.name).toLowerCase()));
            if (match) {
                rowed.add(match.note);
                report(
                    "unlinked settlement",
                    [...at, "name"],
                    `${row.name} has a note; use place: place-${match.code}`,
                );
            }
        }
        const identity =
            row.place ?
                `link:${placeKey(row.place, index) ?? ref(row.place)}`
            :   `name:${text(row.name).toLowerCase()}`;
        if (seen.has(identity))
            report(
                "duplicate settlement",
                [...at, row.place ? "place" : "name"],
                `${label} already has a row in this table`,
            );
        else if (settlement) {
            const tables = corpus.rowedIn.get(settlement) ?? [];
            const node = corpus.byNote.get(settlement);
            const home =
                (node &&
                    ancestors(corpus.places, node)
                        .map((n) => n.note)
                        .find((n) => tables.includes(n))) ??
                tables[0];
            if (home && home !== note)
                report(
                    "duplicate settlement",
                    [...at, "place"],
                    `${label} already has a row in ${corpus.byNote.get(home)?.title ?? home.file}`,
                );
        }
        seen.add(identity);
        if (settlement) rowed.add(settlement);
        const market = Number.isInteger(row.market) ? marketClass(row.market) : undefined;
        if (!market)
            report(
                "market class",
                [...at, "market"],
                `${row.market} is not a market class; use ${MARKET_CLASSES.map((c) => c.value + " " + c.name).join(", ")}`,
            );
        const population =
            (
                typeof row.population === "number" &&
                Number.isSafeInteger(row.population) &&
                row.population > 0
            ) ?
                row.population
            :   undefined;
        if (population === undefined)
            report("people figure", [...at, "population"], "population is a positive whole number");
        if (settlement) {
            const own = (settlement.fm ?? settlement).data ?? settlement;
            const title = (settlement.fm ?? settlement).name?.full ?? label;
            if (population !== undefined && own.population !== population)
                report(
                    "figure disagrees",
                    [...at, "population"],
                    `${title} is carried at ${count(population)} here and ${own.population > 0 ? count(own.population) + " on its own note" : "its own note states none"}`,
                );
            const ownMarket = marketClass(own.market);
            if (market && (!ownMarket || ownMarket.value !== market.value))
                report(
                    "market disagrees",
                    [...at, "market"],
                    `${title} is carried as ${marketText(row.market)} here and ${ownMarket ? marketText(ownMarket.value) + " on its own note" : "its own note states none"}`,
                );
        }
        if (row.heldBy) {
            const hit = resolve(index, row.heldBy);
            if (!hit)
                report(
                    "unresolved settlement reference",
                    [...at, "heldBy"],
                    `${ref(row.heldBy)} does not resolve`,
                );
            if (hit) {
                const type = typeOf(hit);
                if (!["affiliation", "being"].includes(type))
                    report(
                        "not a holder",
                        [...at, "heldBy"],
                        `${ref(row.heldBy)} is a ${type}; a holder is an affiliation or a being`,
                    );
            }
        }
    }
    for (const node of covered)
        if (!rowed.has(node.note))
            report(
                "missing row",
                [...base, "rows"],
                `${node.title} (place-${node.code}) stands in this region and has no row`,
            );
    return findings;
}

/**
 * Fail every publishing surface before it writes invalid settlement output.
 * @param {object[]} records - Indexed records, including documentation projections.
 * @param {object} opts - Captured context.
 * @param {(record: object) => string} opts.fileOf - Source filename for a record.
 * @param {Map<string,object>} [opts.foreignIndex] - Dependency reference targets.
 * @param {(file: string) => string|undefined} [opts.rawOf] - Captured locator text.
 * @returns {void}
 */
export function assertSettlementRecords(records, { fileOf, foreignIndex = new Map(), rawOf } = {}) {
    const notes = records
        .filter((record) => isNoteRecord(record) && record.type === "place")
        .map((record) => {
            const file = fileOf(record);
            return {
                file,
                fm: record,
                type: record.type,
                raw: rawOf?.(file) ?? (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""),
            };
        });
    const hits = new Map();
    const allNotes = records.map(
        (record) => notes.find((n) => n.fm === record) ?? { file: fileOf(record), fm: record },
    );
    for (const record of records) {
        if (record.address)
            hits.set(
                ref(record.address.canonical),
                allNotes.find((n) => n.fm === record),
            );
    }
    const index = {
        notes,
        contentPackage: records.find((record) => record.package)?.package,
        resolve: (target) => {
            const tuple = parseAddress(
                target,
                {
                    package: records.find((record) => record.package)?.package,
                    system: "note",
                    types: new Set(
                        [...records, ...foreignIndex.values()].map((record) => record.type),
                    ),
                    packages: new Set(
                        [...records, ...foreignIndex.values()].map((record) => record.package),
                    ),
                },
                { declared: true },
            );
            if (!isAddressTuple(tuple)) return undefined;
            const key = renderAddress(tuple);
            return hits.get(key) ?? foreignIndex.get(key);
        },
    };
    const findings = notes.flatMap((note) => checkSettlementTables(note, { index }));
    if (findings.length)
        throw Object.assign(new Error(findings.map(formatDiagnostic).join("\n")), {
            located: true,
            findings,
        });
}

/**
 * Render rows once as shared Markdown; all surfaces consume the same table.
 * @param {object} record - Indexed region.
 * @returns {string} Generated table and its closing sentence.
 */
export function settlementMarkdown(record) {
    const declaration = record.data?.settlements;
    if (!map(declaration) || !Array.isArray(declaration.rows)) return "";
    const escape = (value) =>
        String(value ?? "")
            .replace(/([\\`*_[\]<>{}|#!~])/g, "\\$1")
            .replace(/\s*\n\s*/g, " ");
    const link = (value) => `[[${ref(value)}\\|]]`;
    const stated = {
        "Held by": declaration.rows.some((row) => map(row) && row.heldBy),
        For: declaration.rows.some((row) => map(row) && Object.hasOwn(row, "for")),
    };
    const columns = SETTLEMENT_COLUMNS.filter((c) => c.required || stated[c.name]).map(
        (c) => c.name,
    );
    const lines = [`| ${columns.join(" | ")} |`, `| ${columns.map(() => "---").join(" | ")} |`];
    for (const row of declaration.rows) {
        const cells = [
            row.place ? link(row.place) : escape(row.name),
            marketText(row.market),
            count(row.population),
        ];
        if (stated["Held by"]) cells.push(row.heldBy ? link(row.heldBy) : "");
        if (stated.For) cells.push(escape(row.for));
        lines.push(`| ${cells.join(" | ")} |`);
    }
    return lines.join("\n") + "\n\n" + escape(declaration.tail);
}
