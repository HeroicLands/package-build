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

import { isDeepStrictEqual } from "node:util";
import { canonicalKey, parseAddress, renderAddress } from "./address.mjs";
import { positionOfFrontmatterPath, formatDiagnostic } from "./diagnostics.mjs";

const fields = ["appearanceProfile"];
const payload = (note) => note.fm ?? note;
const dataOf = (note) => payload(note).data ?? payload(note);
const culture = (note) => payload(note).type === "lore" && payload(note).subType === "culture";
const parentsOf = (note) => (Array.isArray(dataOf(note).parents) ? dataOf(note).parents : []);

/** Read a culture parent against the field's Address defaults. */
function address(value, index) {
    const tuple = parseAddress(value, {
        package: index.contentPackage,
        system: "note",
        type: "lore",
        types: index.types,
        packages: index.packages,
    });
    return tuple.reason ? undefined : tuple;
}

/** The authored edge graph, with every cyclic edge identified. */
function graph(index) {
    const out = new Map();
    const queue = [...(index.notes ?? [])].filter(culture);
    while (queue.length) {
        const note = queue.pop();
        if (out.has(note)) continue;
        const edges = [];
        out.set(note, edges);
        parentsOf(note).forEach((value, position) => {
            const tuple = address(value, index);
            if (!tuple || tuple.type !== "lore") return;
            const target = index.addressHit?.(renderAddress(tuple));
            if (!target || !culture(target)) return;
            edges.push({ target, position });
            queue.push(target);
        });
    }
    const reaches = (start, end) => {
        const seen = new Set();
        const queue = [start];
        while (queue.length) {
            const current = queue.pop();
            if (current === end) return true;
            if (seen.has(current)) continue;
            seen.add(current);
            queue.push(...(out.get(current) ?? []).map((edge) => edge.target));
        }
        return false;
    };
    const cyclic = new Map();
    for (const [note, edges] of out)
        cyclic.set(
            note,
            new Set(
                edges.filter((edge) => reaches(edge.target, note)).map((edge) => edge.position),
            ),
        );
    return { out, cyclic };
}

/** A located hierarchy finding with the Address of the culture it concerns. */
function finding(note, index, path, message) {
    const fm = payload(note);
    return {
        file: note.file,
        ...positionOfFrontmatterPath(note.raw ?? "", ["data", "parents", ...path]),
        severity: "error",
        code: "culture-parents",
        cultureAddress: canonicalKey(index.contentPackage, "note", "lore", fm.shortcode),
        parentIndex: path[0],
        message,
    };
}

/** Validate subtype scope and culture targets; unresolved targets use the ordinary reference check. */
function parentFindings(note, index, analysis, unresolved) {
    const data = dataOf(note);
    if (data.parents === undefined || data.parents === null) return [];
    if (!culture(note))
        return [finding(note, index, [], "data.parents is stated by only culture lore notes")];
    const findings = [];
    parentsOf(note).forEach((value, position) => {
        const tuple = address(value, index);
        if (!tuple) return;
        const key = renderAddress(tuple);
        const target = tuple.type === "lore" ? index.addressHit?.(key) : undefined;
        if (tuple.type !== "lore") {
            if (unresolved)
                findings.push(
                    finding(
                        note,
                        index,
                        [position],
                        `data.parents.${position} accepts lore, not ${tuple.type}`,
                    ),
                );
        } else if (!target) {
            if (unresolved)
                findings.push(
                    finding(
                        note,
                        index,
                        [position],
                        `data.parents.${position} names ${key}, which does not resolve in this package or its declared dependencies`,
                    ),
                );
        } else if (!culture(target))
            findings.push(
                finding(
                    note,
                    index,
                    [position],
                    `data.parents.${position} names ${key}, whose subType is not culture`,
                ),
            );
        else if (analysis.cyclic.get(note)?.has(position))
            findings.push(
                finding(
                    note,
                    index,
                    [position],
                    `data.parents.${position} forms a culture parent cycle; a culture is never its own ancestor`,
                ),
            );
    });
    return findings;
}

const graphs = new WeakMap();
const hierarchyProblems = new WeakMap();
const inheritedFields = new WeakMap();
const inheritedSources = new WeakMap();

/** The authored source of one inherited field, retained outside the published record. */
export function cultureFieldSource(records, key, field) {
    const record = records.find(
        (entry) =>
            entry.type === "lore" &&
            entry.subType === "culture" &&
            canonicalKey(entry.package, "note", "lore", entry.shortcode) === key,
    );
    return record && inheritedSources.get(record)?.get(field);
}

/** Fields supplied by an ancestor rather than authored on this record. */
export function cultureInheritedFields(record) {
    return inheritedFields.get(record);
}

/** Read the hierarchy findings retained beside a resolved index record. */
export function cultureRecordProblems(record) {
    return hierarchyProblems.get(record);
}

/** Read hierarchy findings attached to one culture's resolved index record. */
export function cultureHierarchyProblems(records, key) {
    return records.flatMap((record) =>
        (
            record.type === "lore" &&
            record.subType === "culture" &&
            canonicalKey(record.package, "note", "lore", record.shortcode) === key
        ) ?
            (hierarchyProblems.get(record) ?? [])
        :   [],
    );
}

/**
 * Check the declared culture-parent field in the normal frontmatter lint.
 * @param {object} note - The note's frontmatter and source location.
 * @param {{index?: object}} [options] - The corpus and its Address lookup.
 * @returns {object[]} Located findings.
 */
export function checkCultureParents(note, { index } = {}) {
    if (note.reportedCultureParents) return [];
    const context = index ?? { contentPackage: undefined, notes: [note] };
    let analysis = graphs.get(context);
    if (!analysis) {
        analysis = graph(context);
        graphs.set(context, analysis);
    }
    return parentFindings(note, context, analysis, false);
}

/**
 * Resolve each omitted culture field independently, searching parents in listed depth-first order.
 * Same-depth disagreement withholds the inherited field and produces a finding.
 * @param {object} index - The authored culture nodes and Address lookup.
 * @returns {{values: Map<object, object>, findings: object[]}}
 */
export function cultureInheritance(index) {
    const analysis = graph(index);
    const findings = [];
    const values = new Map();
    for (const note of index.notes ?? []) {
        if (!culture(note)) continue;
        findings.push(...parentFindings(note, index, analysis, true));
        const inherited = {};
        const sources = new Map();
        for (const field of fields) {
            if (dataOf(note)[field] !== undefined) continue;
            const candidates = [];
            const work = [{ node: note, depth: 0 }];
            const seen = new Map();
            while (work.length) {
                const { node, depth, via } = work.pop();
                if (analysis.cyclic.get(node)?.size) continue;
                if (seen.has(node) && seen.get(node) <= depth) continue;
                seen.set(node, depth);
                const value = dataOf(node)[field];
                if (depth && value !== undefined) {
                    candidates.push({ value, depth, via, node });
                    continue;
                }
                const edges = analysis.out.get(node) ?? [];
                for (let i = edges.length - 1; i >= 0; i--) {
                    const edge = edges[i];
                    if (!analysis.cyclic.get(node)?.has(edge.position))
                        work.push({
                            node: edge.target,
                            depth: depth + 1,
                            via: depth ? via : edge.position,
                        });
                }
            }
            const atDepth = new Map();
            let conflicting;
            for (const candidate of candidates) {
                if (
                    atDepth.has(candidate.depth) &&
                    !isDeepStrictEqual(atDepth.get(candidate.depth), candidate.value)
                )
                    conflicting = candidate;
                else atDepth.set(candidate.depth, candidate.value);
            }
            if (conflicting)
                findings.push(
                    finding(
                        note,
                        index,
                        [conflicting.via],
                        `culture parents at the same depth disagree on data.${field}; state the field on this culture`,
                    ),
                );
            else if (candidates.length) {
                inherited[field] = candidates[0].value;
                const source = candidates[0].node;
                sources.set(field, { file: source.file, raw: source.raw, fm: payload(source) });
            }
        }
        inheritedSources.set(payload(note), sources);
        values.set(note, inherited);
    }
    for (const note of index.notes ?? []) {
        if (!culture(note)) continue;
        inheritedFields.set(payload(note), new Set(Object.keys(values.get(note) ?? {})));
        const relevant = new Set();
        const work = [note];
        while (work.length) {
            const current = work.pop();
            if (relevant.has(current)) continue;
            relevant.add(current);
            work.push(...(analysis.out.get(current) ?? []).map((edge) => edge.target));
        }
        const addresses = new Set(
            [...relevant].map((entry) =>
                canonicalKey(index.contentPackage, "note", "lore", payload(entry).shortcode),
            ),
        );
        hierarchyProblems.set(
            payload(note),
            findings.filter((problem) => addresses.has(problem.cultureAddress)),
        );
    }
    return { values, findings };
}

/** Emit or collect all findings from culture inheritance. */
export function reportCultureParents(findings, problems) {
    if (problems) problems.push(...findings);
    else if (findings.length)
        throw Object.assign(new Error(findings.map(formatDiagnostic).join("\n")), {
            located: true,
        });
}
