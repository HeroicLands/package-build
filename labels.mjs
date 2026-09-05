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
 * The label registry has two faces that must agree.
 *
 * `.github/labels.yml` is the machine source synced to GitHub, and the §3 table
 * in `.github/ISSUE_REPORTING.md` is the documented reference a person reads.
 * Neither is derived from the other, so either can drift — or invent a label
 * the other has never heard of — and nothing notices until someone files an
 * issue against a label that does not exist, or the sync pushes a label the
 * documentation never mentions.
 *
 * **This lives here because every repository wants it and only the paths ever
 * differed.** It was a `utils/check-labels.mjs` copied per repository, which is
 * the shape a shared check takes just before it starts drifting between copies
 * — the same argument that moved the no-attribution check to a shared action.
 *
 * The checks are pure and text-in: the caller reads the two files and decides
 * what to do with the findings, so this module needs no filesystem and is
 * testable without one.
 *
 * @module
 */

import { parse } from "yaml";

/** GitHub rejects a label description beyond this with a 422. */
export const MAX_DESCRIPTION = 100;

/**
 * The line a label's `name:` entry sits on, 1-based.
 *
 * Located rather than tracked, because `yaml`'s document API would have to be
 * threaded through the parse for a value this simple to recover: a registry is
 * a flat list of `- name: <label>`, so the first line declaring that name is
 * the entry. A name that cannot be found yields no position, which
 * `reportFindings` drops rather than guessing.
 *
 * @param {string} text - The registry file's contents.
 * @param {string} name - The label name.
 * @returns {{line?: number, column?: number}} Spreadable position fields.
 */
function positionOfLabel(text, name) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
        const m = lines[i].match(/^\s*-?\s*name:\s*["']?(.+?)["']?\s*$/);
        if (m && m[1] === name) return { line: i + 1, column: lines[i].indexOf(name) + 1 };
    }
    return {};
}

/**
 * The line a label's row sits on in the documented table, 1-based.
 *
 * @param {string} text - The documentation file's contents.
 * @param {string} name - The label name.
 * @returns {{line?: number, column?: number}} Spreadable position fields.
 */
function positionOfDocRow(text, name) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
        const m = lines[i].match(/^\|\s*`([a-z][a-z-]*)`\s*\|/);
        if (m && m[1] === name) return { line: i + 1, column: lines[i].indexOf(name) + 1 };
    }
    return {};
}

/**
 * The label names the documented §3 table lists.
 *
 * A registry row is a table row whose first cell is a backticked label name,
 * which is narrow on purpose: §3 carries prose and other tables, and a looser
 * match would read a heading or an example as a label.
 *
 * @param {string} text - The documentation file's contents.
 * @returns {{names: Set<string>, found: boolean}} The names, and whether §3 was
 *   located at all — an absent section is a different failure from an empty one.
 */
export function documentedLabels(text) {
    const lines = text.split("\n");
    const start = lines.findIndex((l) => /^##\s+3\./.test(l));
    if (start < 0) return { names: new Set(), found: false };
    const after = lines.findIndex((l, i) => i > start && /^##\s+\d/.test(l));
    const section = lines.slice(start, after < 0 ? lines.length : after);
    const names = new Set();
    for (const line of section) {
        const m = line.match(/^\|\s*`([a-z][a-z-]*)`\s*\|/);
        if (m) names.add(m[1]);
    }
    return { names, found: true };
}

/**
 * Check the machine registry against the documented table.
 *
 * Findings are returned per file rather than merged, because each names a
 * position in a different document and the caller reports them against the
 * file they belong to.
 *
 * @param {object} sources
 * @param {string} sources.registryText - `.github/labels.yml`.
 * @param {string} sources.docText - `.github/ISSUE_REPORTING.md`.
 * @param {string} [sources.docPath] - The doc's path, for the message naming it.
 * @returns {{registry: object[], doc: object[], count: number}} Findings for
 *   each file, and how many labels the registry declares.
 */
export function checkLabelRegistry({
    registryText,
    docText,
    docPath = ".github/ISSUE_REPORTING.md",
}) {
    const registryFindings = [];
    const docFindings = [];

    let entries;
    try {
        entries = parse(registryText);
    } catch (error) {
        registryFindings.push({
            severity: "error",
            message: `label registry is not valid YAML — ${error.message}`,
        });
        return { registry: registryFindings, doc: docFindings, count: 0 };
    }
    if (!Array.isArray(entries)) {
        registryFindings.push({
            severity: "error",
            message: "label registry must be a list of `{ name, description }` entries",
        });
        return { registry: registryFindings, doc: docFindings, count: 0 };
    }

    // Caught here rather than mid-sync, where it surfaces as a bare 422 from
    // the GitHub API naming neither the label nor the limit.
    for (const entry of entries) {
        const length = (entry?.description ?? "").length;
        if (length > MAX_DESCRIPTION) {
            registryFindings.push({
                ...positionOfLabel(registryText, entry.name),
                severity: "error",
                message:
                    `"${entry.name}" has a ${length}-character description; ` +
                    `GitHub rejects anything over ${MAX_DESCRIPTION}`,
            });
        }
    }

    const registryNames = new Set(entries.map((e) => e?.name).filter(Boolean));
    const { names: docNames, found } = documentedLabels(docText);
    if (!found) {
        docFindings.push({
            severity: "error",
            message: `no §3 section found in ${docPath}, so the registry has nothing to agree with`,
        });
        return { registry: registryFindings, doc: docFindings, count: registryNames.size };
    }

    for (const name of registryNames) {
        if (docNames.has(name)) continue;
        registryFindings.push({
            ...positionOfLabel(registryText, name),
            severity: "error",
            message:
                `"${name}" is in the registry but not in ${docPath} §3; ` +
                `the two are edited together, so add the row`,
        });
    }
    for (const name of docNames) {
        if (registryNames.has(name)) continue;
        docFindings.push({
            ...positionOfDocRow(docText, name),
            severity: "error",
            message:
                `"${name}" is documented in §3 but absent from the registry, ` +
                `so it is never synced and an issue cannot carry it`,
        });
    }

    return { registry: registryFindings, doc: docFindings, count: registryNames.size };
}
