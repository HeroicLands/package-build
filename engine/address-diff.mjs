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
 * Diffing a package's published item addresses against a released one (#66).
 *
 * A package's `(type, shortcode)` addresses are a **published interface**.
 * Every satellite that declares `itemCatalog: true` assembles its beings out of
 * them — `attribute:str`, `skill:awar`, `weapongear:Tabri` — resolving each one
 * against the Item packs of the release its `compatibility.verified` pins. So
 * renaming a shortcode is a breaking change to something other repositories
 * consume, and until this module there was nothing that noticed: the check that
 * got made was a repository-local grep, which cannot see the other
 * repositories and reports the reassuring answer.
 *
 * `sohl` renamed one weapon's shortcode from `Tabri` to `Taburi` two days after
 * the `v0.8.2` tag, on the stated ground that "nothing referenced the old
 * value, so the rename is self-contained". True of that repository. Both
 * satellites pin `v0.8.2` and address `weapongear:Tabri` on their copy of the
 * same character — five lookups that resolve today and fail the moment either
 * pin moves, with an error reading like a missing item.
 *
 * **The comparison is release-to-release, in the repository doing the
 * renaming.** The alternative — checking a consumer's addresses against its
 * pinned release — already exists and already fails the build (`no predefined
 * item for "weapongear:Taburi"`); what it lacks is an explanation, and it
 * cannot honestly produce one, because at the point of the miss all it holds is
 * the address string. It has no document id and no name to match a candidate
 * against, so any successor it named would be a guess at a similar-looking
 * string. Here both sides are whole documents, so the question is decidable.
 *
 * **A rename is told from a removal by the document id, and that is an identity
 * match rather than an inference.** A note authors its `_id` in frontmatter; it
 * is not derived from the shortcode, and the `Tabri` → `Taburi` commit changed
 * the shortcode alone. So an address that disappeared while its document is
 * still published elsewhere *is* a rename — not "probably" one. When the id is
 * published under no address at all, that is all this can say: **withdrawn**,
 * with no successor named. A split, a deletion and a merge are indistinguish-
 * able from one another at that point, and inventing a "did you mean" from
 * string similarity would be worse than saying nothing, because a wrong one
 * sends the reader to the wrong fix.
 *
 * **Severity is decided per case.** A withdrawal is legitimate — content is
 * allowed to be retired — so it is reported and does not fail a build. A rename
 * is equally legitimate as a decision (#1397's charset rule forces some), which
 * is why it does not fail one either; what it must not do is happen in silence.
 * A caller that wants a gate passes `error` and treats any finding as one.
 *
 * Item packs only, because that is the address space consumers resolve
 * against: {@link foreignItemCatalogDirs} extracts nothing else, and a being's
 * embedded items are the only cross-package resolution by `(type, shortcode)`.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { formatDiagnostic, positionInFrontmatter } from "./diagnostics.mjs";
import { positionOfLiteral } from "./diagnostics.mjs";
import { walkMarkdownTree } from "./helpers.mjs";

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
            space.set(`${doc.type}:${shortcode}`, {
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
 * Every address the baseline published that this build does not.
 *
 * An address that merely *arrived* is not a finding: adding one breaks nobody.
 * The arrivals are read only to answer the one question that matters about a
 * departure — is the document still here under another name?
 *
 * @param {Map<string, object>} baseline - The released address space.
 * @param {Map<string, object>} current - This build's address space.
 * @param {object} opts
 * @param {string} opts.baseline - What the baseline is, for the message —
 *   conventionally `<package>@<version>`.
 * @returns {Array<object>} One finding per departed address, in address order
 *   so two runs read the same. `kind` is `"renamed"` (with `to`) or
 *   `"withdrawn"`.
 */
export function diffItemAddresses(baseline, current, { baseline: label }) {
    // A baseline that yields no address at all cannot produce a finding, so it
    // reports a clean result for every possible input — the one failure a check
    // like this can never catch, and the same one `foreign-manifests.mjs` exists
    // to stop. It is a real state, not a hypothetical: `sohl-kethira-basic@0.5.3`
    // shipped 307 items carrying no `system.shortcode` between them.
    if (!baseline.size) {
        throw new Error(
            `${label} publishes no addressable item — no document in its Item ` +
                `packs carries a \`system.shortcode\`. A diff against it can ` +
                `only report that nothing changed, whatever this build does, ` +
                `so it is refused rather than passed`,
        );
    }
    // Where each still-published document lives now. Built once: a rename is
    // decided by identity, so this is the whole evidence base.
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
 * Every content note in a tree, indexed by the document id it authors.
 *
 * The address space is read from compiled output because that is what actually
 * ships; the tree is read only to place a finding somewhere a reader can open
 * and fix it. Each source answers the question it is good at, and the id is the
 * exact key that joins them.
 *
 * @param {string} contentBase - Root of the content tree.
 * @param {object} [opts]
 * @param {readonly string[]} [opts.skipDirectories] - Passed to the walk.
 * @returns {Map<string, string>} Document id → the note's absolute path.
 */
export function noteFilesById(contentBase, { skipDirectories } = {}) {
    const byId = new Map();
    const walkOpts = skipDirectories ? { skipDirectories } : undefined;
    for (const { frontmatter: fm, absPath } of walkMarkdownTree(
        contentBase,
        walkOpts,
    )) {
        if (fm?.id && !byId.has(fm.id)) byId.set(fm.id, absPath);
    }
    return byId;
}

/**
 * Where to send the reader for one finding.
 *
 * A rename is fixed in the note that made it, so a finding whose id is still in
 * this tree is reported at that note's `shortcode:` line — the line the author
 * just edited. A withdrawal has no such note by definition, so it degrades to
 * the baseline document, which is the only artefact left that records the
 * address existing. When neither is readable the position is **dropped**, never
 * defaulted to `1:1`.
 *
 * @param {object} finding - One finding from {@link diffItemAddresses}.
 * @param {Map<string, string>} noteFiles - From {@link noteFilesById}.
 * @returns {{file?: string, line?: number, column?: number}} Spreadable
 *   position fields for {@link formatDiagnostic}.
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
 * The rename message names the identity it matched on, because that is what
 * separates this from a spelling suggestion: the reader can check the id in
 * both artefacts. The withdrawal message names no successor, because none is
 * known — and says so, rather than leaving the reader to wonder whether one was
 * looked for.
 *
 * @param {object} finding - One finding from {@link diffItemAddresses}.
 * @returns {string} The message.
 */
export function addressFindingMessage(finding) {
    if (finding.kind === "renamed") {
        return (
            `since ${finding.baseline}, ${finding.address} is no longer ` +
            `published; the same document (${finding.id}) is now published ` +
            `as ${finding.to}. Every package that resolves ${finding.address} ` +
            `breaks when it moves past ${finding.baseline}`
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
