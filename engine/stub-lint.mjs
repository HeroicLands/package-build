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
 * An empty body must be deliberate.
 *
 * An empty body is what makes a note a **stub**, and the whole scheme turns on
 * that being on purpose rather than something somebody forgot. So four rules
 * hold the state honest, and two more report what the rules cannot decide:
 *
 * 1. **A stub states what it is.** With nothing in the body, the `description`
 *    is the only sentence a reader gets and it is what every table and index
 *    prints. An **error**.
 * 2. **A stub is not tagged `draft`.** A thing not started is not a thing in
 *    progress. An **error**.
 * 3. **A body that renders to nothing is an abandoned draft, not a stub.** This
 *    is what keeps the empty-body rule's severity honest: the softer cases are
 *    *reported* rather than silently treated as one state or the other. An
 *    **error**.
 * 4. **A short unmarked body may be a draft that forgot its marker.** A
 *    **warning**, never an error — a note reading `See [[affiliation-meivor|Mëivōr]]`
 *    says everything it has to say, and a corpus holds many of them.
 * 5. **A long-standing draft is a report, not a finding.** It is unfinished,
 *    which the tag already says, so the oldest are listed and nobody is asked
 *    to dismiss a warning they cannot clear.
 * 6. **The counts are reported**, per package and per type, so the ratio of
 *    written to unwritten is visible on every run rather than discovered in a
 *    year.
 *
 * **What this does not decide is what earns a body.** Whether a given village
 * deserves prose is a question about a setting, and it belongs in the
 * repository that ships it. The toolchain's job is to make promotion free.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { authoredFrontmatter, isNoteRecord, isStub, noteFile } from "./index-records.mjs";
import { positionInFrontmatter, positionOfLiteral } from "./diagnostics.mjs";
import { parseMarkdownFile } from "./helpers.mjs";
import { bodyWordCount, isStubNote, placeholderBody } from "./note-state.mjs";
import { isDraftNote } from "./note-vocabulary.mjs";

/**
 * The word count below which an unmarked body is asked whether it is a draft.
 *
 * A threshold, so it is a value the rule *is* rather than a census: twenty-five
 * words is about two sentences, which is where a note stops reading as a
 * statement and starts reading as a beginning.
 *
 * @type {number}
 */
export const SHORT_BODY_WORDS = 25;

/** How many of the oldest drafts the report names. */
const OLDEST_DRAFTS = 10;

/**
 * Whether a note states a description.
 *
 * @param {Record<string, any>} fm - The note's authored frontmatter.
 * @returns {boolean} Whether `description` carries a sentence.
 */
function hasDescription(fm) {
    return String(fm?.description ?? "").trim() !== "";
}

/**
 * Check one note's state, and say where the fault is.
 *
 * @param {object} note - `{ fm, body, file, raw }`.
 * @returns {object[]} The findings.
 */
function checkNote({ fm, body, file, raw }) {
    const findings = [];
    const at = (key, value) => positionInFrontmatter(raw, key, value, { topLevel: true });

    if (isStubNote(fm, body)) {
        if (!hasDescription(fm)) {
            findings.push({
                file,
                ...at("type", fm.type),
                severity: "error",
                message:
                    "this note has no body, so it is a stub — and a stub carries " +
                    "a `description`, which is the only sentence a reader gets " +
                    "and what every table listing it prints",
            });
        }
        if (isDraftNote(fm)) {
            findings.push({
                file,
                ...at("type", fm.type),
                severity: "error",
                message:
                    "this note has no body and is tagged `draft`, and a thing " +
                    "not started is not a thing in progress — remove the tag, " +
                    "or write a body",
            });
        }
        return findings;
    }

    const placeholders = placeholderBody(body);
    if (placeholders.length) {
        const [{ phrase }] = placeholders;
        findings.push({
            file,
            ...positionOfLiteral(raw, phrase),
            severity: "error",
            message:
                `this note's body says only "${phrase}", so it publishes a page ` +
                `that tells a reader nothing — empty the body to make this a ` +
                `stub, or write it`,
        });
        return findings;
    }

    if (!isDraftNote(fm)) {
        const words = bodyWordCount(body);
        if (words > 0 && words < SHORT_BODY_WORDS) {
            findings.push({
                file,
                ...at("type", fm.type),
                severity: "warning",
                message:
                    `this note's body is ${words} word(s) and carries no \`draft\` ` +
                    `tag — tag it if it is a beginning, and leave it alone if it ` +
                    `says everything it has to say`,
            });
        }
    }
    return findings;
}

/**
 * The state of every note in a tree, checked and counted.
 *
 * Read from the content index rather than from a walk of this pass's own, like
 * every other lint: the command derives the corpus once and hands it to each
 * pass, so no two findings are drawn from different ideas of which files the
 * content is. The **body** is read from the file, because the index carries
 * what is *about* a note and never the note's text.
 *
 * @param {string} contentBase - Root of the content tree.
 * @param {object} opts
 * @param {readonly object[]} opts.records - Index records the caller derived.
 * @param {string} [opts.contentPackage] - Named in the counts line.
 * @returns {{findings: object[], counts: {full: number, draft: number,
 *   stub: number}, byType: Array<{type: string, full: number, draft: number,
 *   stub: number}>, oldestDrafts: Array<{file: string, modified: Date}>,
 *   summary: string[]}} The findings, the ladder's counts, and the lines a
 *   reader is shown as prose rather than as findings.
 */
export function lintNoteStates(contentBase, { records, contentPackage } = {}) {
    const findings = [];
    const counts = { full: 0, draft: 0, stub: 0 };
    /** @type {Map<string, {full: number, draft: number, stub: number}>} */
    const byType = new Map();
    /** @type {Array<{file: string, modified: Date}>} */
    const drafts = [];

    for (const record of records ?? []) {
        // A documentation journal and an asset are documents rather than notes,
        // so neither has a state. A note with no `type` — vault scaffolding, a
        // README — does: it publishes no page, which is what a stub is, and
        // counting it here is what keeps this line and the index's own agreeing
        // with `SELECT state, count(*) FROM entries`. What it has no frontmatter
        // for is the **rules**, which are skipped below.
        if (!isNoteRecord(record)) continue;
        const absPath = noteFile(contentBase, record);
        const file = path.relative(process.cwd(), absPath);
        const fm = authoredFrontmatter(record);
        const { body } = parseMarkdownFile(absPath);
        const raw = fs.readFileSync(absPath, "utf8");

        // The ladder, read exactly as the `entries` view reads it: the absent
        // address is the state, not a second body test beside it. A note with
        // no `type` and no `shortcode` has no address whatever its body says,
        // and calling it anything else here would make this line disagree with
        // `SELECT state, count(*) FROM entries` — two ladders, one corpus.
        const state =
            isStub(record) ? "stub"
            : isDraftNote(fm) ? "draft"
            : "full";
        counts[state] += 1;
        // Vault scaffolding is counted under a name rather than under
        // "undefined", so the per-type table reads as a sentence.
        const type = record.type ? String(record.type) : "(no type)";
        if (!byType.has(type)) byType.set(type, { full: 0, draft: 0, stub: 0 });
        byType.get(type)[state] += 1;
        if (state === "draft") drafts.push({ file, modified: fs.statSync(absPath).mtime });

        // Held to the rules only where there is a note to hold: a file that
        // declares no type declares nothing for them to read, and asking it for
        // a `description` would report vault scaffolding as content.
        if (record.type) findings.push(...checkNote({ fm, body, file, raw }));
    }

    const oldestDrafts = drafts
        .sort((a, b) => a.modified.getTime() - b.modified.getTime())
        .slice(0, OLDEST_DRAFTS);

    const total = counts.full + counts.draft + counts.stub;
    const summary = [
        `${contentPackage ?? "this package"}: ${total} notes — ` +
            `${counts.full} full, ${counts.draft} draft, ${counts.stub} stub.`,
    ];
    if (oldestDrafts.length) {
        summary.push(
            `The drafts nothing has touched in longest: ` +
                `${oldestDrafts.map((d) => d.file).join(", ")}.`,
        );
    }

    return {
        findings,
        counts,
        byType: [...byType]
            .map(([type, c]) => ({ type, ...c }))
            .sort((a, b) => b.full + b.draft + b.stub - (a.full + a.draft + a.stub)),
        oldestDrafts,
        summary,
    };
}
