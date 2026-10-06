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
 * Compare published Item addresses between a released package and its current
 * build. The `(type, shortcode)` pair is the address consumers resolve from
 * package indexes.
 *
 * A departed address is a rename when its document id is still published under
 * another address. Otherwise it is reported as withdrawn. Since an id derived
 * from a note's canonical address changes with its shortcode, that kind of
 * rename produces a withdrawal finding; the added address has no finding.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { formatDiagnostic, positionInFrontmatter } from "./diagnostics.mjs";
import { positionOfLiteral } from "./diagnostics.mjs";
import { assertStatedScope } from "./helpers.mjs";
// The corpus, read from the one pass that derives it. Nothing in the
// index's import graph reaches this module — only `bin/` imports it — so this
// is a plain static import, as in the link checker.
import { indexRecordsFor, isNoteRecord, noteFile } from "./content-index.mjs";

/**
 * The one spelling of an address in this space: `type:shortcode`.
 *
 * Used for addresses read from compiled documents. The shortcode is used
 * **verbatim**, not lowercased: folding case would join two addresses the packs
 * keep apart.
 *
 * @param {string} type - The Foundry document subtype, not the note type.
 * @param {string} shortcode - The address's `system.shortcode`.
 * @returns {string} The address key.
 */
export function itemAddressKey(type, shortcode) {
    return `${type}:${shortcode}`;
}

/**
 * The address space a set of compiled Item pack directories publishes.
 *
 * The directories are read as one space for the same reason the actors pass
 * reads them as one: a being names an item by `(type, shortcode)` and never by
 * the pack it happens to ship in. Both sides of a diff are built by this one
 * function, so a released catalogue extracted by `deps fetch` and a freshly
 * compiled pack are indexed identically and a difference between them is a real
 * one rather than an artefact of two readers.
 *
 * A missing directory throws rather than reading as an empty space: an empty
 * baseline would report every address in the package as withdrawn, and an empty
 * current side would report every address as gone — the loudest possible
 * output from the quietest possible mistake.
 *
 * @param {readonly string[]} dirs - Directories of item JSON.
 * @returns {Map<string, {id: string, name: string, type: string, shortcode: string, file: string}>}
 *   Every item, keyed `type:shortcode`.
 */
export function readItemAddresses(dirs) {
    const space = new Map();
    for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
            throw new Error(
                `Item source directory ${dir} does not exist — an address ` +
                    `diff reads compiled Item pack output, so those packs ` +
                    `must be compiled (or the catalogue fetched) first`,
            );
        }
        for (const name of fs.readdirSync(dir)) {
            if (!name.endsWith(".json")) continue;
            if (name.startsWith("folder_")) continue;
            const file = path.join(dir, name);
            let doc;
            try {
                doc = JSON.parse(fs.readFileSync(file, "utf8"));
            } catch {
                // Unparseable output is the compile's problem to report, not
                // this pass's; skipping it here loses one address rather than
                // failing a diff that has nothing to do with it.
                continue;
            }
            const shortcode = doc?.system?.shortcode;
            if (!doc?.type || !shortcode || !doc?._id) continue;
            space.set(itemAddressKey(doc.type, shortcode), {
                id: doc._id,
                name: doc.name ?? "",
                type: doc.type,
                shortcode,
                file,
            });
        }
    }
    return space;
}

/**
 * Read the scoped content corpus as content-index records.
 *
 * @param {string} contentBase - Root of the content tree.
 * @param {object} opts - Options.
 * @param {readonly string[]} [opts.skipDirectories] - The stated corpus scope.
 * @param {object} [opts.config] - The resolved build configuration.
 * @param {readonly object[]} [opts.records] - Records the caller derived.
 * @param {object[]} [opts.problems] - Collects notes the index cannot record.
 * @returns {readonly object[]} The index records.
 */
function addressCorpus(contentBase, { skipDirectories, config, records, problems } = {}) {
    if (records) return records;
    assertStatedScope(skipDirectories, "reading the address corpus");
    if (!fs.existsSync(contentBase)) return [];
    return indexRecordsFor({ contentBase, config, skipDirectories, problems });
}

/**
 * Every address the baseline published that this build does not.
 *
 * An address that arrived is not a finding. A departed address is a rename
 * only when its document id appears at another current address; otherwise it
 * is a withdrawal.
 *
 * @param {Map<string, object>} baseline - The released address space.
 * @param {Map<string, object>} current - This build's address space.
 * @param {object} opts
 * @param {string} opts.baseline - What the baseline is, for the message.
 * @returns {Array<object>} One finding per departed address, in address order.
 */
export function diffItemAddresses(baseline, current, { baseline: label }) {
    if (!baseline.size) {
        throw new Error(
            `${label} publishes no addressable item — no document in its Item ` +
                `packs carries a \`system.shortcode\`. A diff against it can ` +
                `only report that nothing changed, whatever this build does, ` +
                `so it is refused rather than passed`,
        );
    }
    const currentById = new Map();
    for (const [address, entry] of current) {
        if (!currentById.has(entry.id)) currentById.set(entry.id, address);
    }

    const findings = [];
    for (const [address, entry] of baseline) {
        if (current.has(address)) continue;
        const to = currentById.get(entry.id);
        findings.push({
            kind: to ? "renamed" : "withdrawn",
            address,
            ...(to ? { to } : {}),
            id: entry.id,
            name: entry.name,
            shortcode: entry.shortcode,
            baselineFile: entry.file,
            baseline: label,
        });
    }
    findings.sort((a, b) => (a.address < b.address ? -1 : 1));
    return findings;
}

/**
 * Every content note in a tree, indexed by the document id it compiles under.
 *
 * The address space is read from compiled output because that is what actually
 * ships; the tree is read only to place a finding somewhere a reader can open
 * and fix it. Each source answers the question it is good at, and the id is the
 * exact key that joins them.
 *
 * @param {string} contentBase - Root of the content tree.
 * @param {object} [opts]
 * @param {readonly string[]} [opts.skipDirectories] - The corpus scope, stated
 *   by the caller — see {@link addressCorpus}.
 * @param {object} [opts.config] - The resolved build configuration, which the
 *   id is derived against. See {@link addressCorpus} for why that matters.
 * @param {readonly object[]} [opts.records] - Index records the caller already
 *   derived by the caller.
 * @param {object[]} [opts.problems] - Collects the notes the index cannot
 *   record, so one of them does not abort the diff before it reports.
 * @returns {Map<string, string>} Document id → the note's absolute path.
 */
export function noteFilesById(contentBase, { skipDirectories, config, records, problems } = {}) {
    const byId = new Map();
    for (const record of addressCorpus(contentBase, {
        skipDirectories,
        config,
        records,
        problems,
    })) {
        // A documentation journal shares its note's file and has no id of its
        // own, so indexing it would file one path under two identities.
        if (!isNoteRecord(record)) continue;
        // Derived by the index, against the configuration this build resolved —
        // which is the same configuration the compiled ids on the other side of
        // the join were produced under. See {@link addressCorpus}.
        //
        // First record wins, and the records are in content-path order, so
        // which note answers for a duplicated id is now a stable fact about the
        // tree rather than an artefact of directory-read order.
        if (record.id && !byId.has(record.id)) byId.set(record.id, noteFile(contentBase, record));
    }
    return byId;
}

/**
 * Where to send the reader for one finding.
 *
 * A matched document is located at its current `shortcode:` line. A withdrawal
 * is located in the baseline artifact, the remaining evidence for its address.
 * When neither source has a usable position, the location is dropped.
 *
 * @param {object} finding - One finding from {@link diffItemAddresses}.
 * @param {Map<string, string>} noteFiles - From {@link noteFilesById}.
 * @returns {{file?: string, line?: number, column?: number}} Position fields.
 */
export function locateAddressFinding(finding, noteFiles) {
    const note = noteFiles?.get(finding.id);
    if (note) {
        try {
            const raw = fs.readFileSync(note, "utf8");
            return { file: note, ...positionInFrontmatter(raw, "shortcode") };
        } catch {
            return { file: note };
        }
    }
    if (!finding.baselineFile) return {};
    try {
        const raw = fs.readFileSync(finding.baselineFile, "utf8");
        return {
            file: finding.baselineFile,
            ...positionOfLiteral(raw, `"${finding.shortcode}"`),
        };
    } catch {
        return { file: finding.baselineFile };
    }
}

/**
 * What one finding says, without a locator or a severity.
 *
 * A matched document names the address where it now appears. A withdrawal
 * names no successor because the current build publishes no document with
 * that identity.
 *
 * @param {object} finding - One finding from {@link diffItemAddresses}.
 * @returns {string} The message.
 */
export function addressFindingMessage(finding) {
    if (finding.kind === "renamed") {
        return (
            `since ${finding.baseline}, ${finding.address} is no longer ` +
            `published; the same document (${finding.id}) is now published as ${finding.to}. ` +
            `Every package that resolves ${finding.address} breaks when it moves past ${finding.baseline}`
        );
    }
    return (
        `since ${finding.baseline}, ${finding.address} is no longer ` +
        `published, and its document (${finding.id}) is published under no ` +
        `other address`
    );
}

/**
 * One finding, in the standard `file:line:column: severity: message` form.
 *
 * @param {object} finding - One finding from {@link diffItemAddresses}.
 * @param {{file?: string, line?: number, column?: number}} at - From
 *   {@link locateAddressFinding}.
 * @param {"warning"|"error"} [severity] - `error` when the caller is gating.
 * @returns {string} The formatted diagnostic, path first on the line.
 */
export function formatAddressFinding(finding, at, severity = "warning") {
    return formatDiagnostic({
        ...at,
        severity,
        message: addressFindingMessage(finding),
    });
}
