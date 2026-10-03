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
 * A list item opened with `[ ]` or `[x]`, reported.
 *
 * **The format has no checkbox.** A list is written in plain markdown, and
 * `[ ]` or `[x]` right after the marker is read as the start of the item's own
 * text on every surface — stating what is done belongs in the words, not in a
 * bracket.
 *
 * ## What it does not look at
 *
 * - **Fenced blocks and code spans.** A checklist shown as a markup example is
 *   prose *about* the two characters, not an authored list — this module's own
 *   documentation is written out of such examples. Which runs count as code is
 *   {@link module:engine/code-fences.codeRegions}' rule rather than a second
 *   copy of it.
 * - **A bracket anywhere else in a line.** Only the marker that opens a list
 *   item is read this way; the same two characters in the middle of a sentence
 *   are prose.
 *
 * ## A warning, like the checks around it
 *
 * Nothing here is miscompiled — every surface sets the marker as the item's
 * own text, and all three agree. The finding is for the author: the two
 * characters read as an interactive control only on one surface, and nowhere
 * else, so a list reaching for that meaning should say what is done in words
 * instead.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { matchAllOutsideCode } from "./code-fences.mjs";
import { positionInBody } from "./diagnostics.mjs";

/**
 * A list item's marker, immediately followed by `[ ]` or `[x]` and a space —
 * bulleted (`-`, `*`, `+`) or ordered (`1.` or `1)`), at the start of a line.
 *
 * The leading indentation is a lookbehind rather than part of the match, so a
 * nested item's finding points at the marker itself, not at the line's first
 * column.
 *
 * @type {RegExp}
 */
export const TASK_LIST_MARKER = /(?<=^[ \t]*)(?:[-*+]|\d+[.)])[ \t]+\[[ xX]\][ \t]/gm;

/**
 * What a note opening a list item with `[ ]` or `[x]` is told.
 *
 * @param {string} marker - The matched marker, as written.
 * @returns {string} The message, unpunctuated at the end as a finding is.
 */
export function taskListMessage(marker) {
    return (
        `\`${marker.trim()}\` opens a list item with no checkbox to become — ` +
        "write a checklist as an ordinary list, stating what is done in the " +
        "item's own words. Inside a fence or a code span it is an example, and " +
        "not reported"
    );
}

/**
 * Every list item opened with `[ ]` or `[x]` in one note's body.
 *
 * @param {string} body - The note's markdown, without its frontmatter.
 * @param {string} file - The note's path, for the finding.
 * @param {object} [opts]
 * @param {number} [opts.bodyLine=1] - The 1-based file line the body starts on.
 * @param {number} [opts.bodyColumn=1] - The 1-based file column it starts at.
 * @returns {Array<{file: string, line: number, column: number,
 *   severity: "warning", message: string}>} One finding per item, in source
 *   order.
 */
export function checkTaskLists(body, file, { bodyLine = 1, bodyColumn = 1 } = {}) {
    const text = String(body ?? "");
    if (!text) return [];

    return matchAllOutsideCode(text, TASK_LIST_MARKER).map((match) => ({
        file,
        ...positionInBody(text, /** @type {number} */ (match.index), { bodyLine, bodyColumn }),
        severity: /** @type {"warning"} */ ("warning"),
        message: taskListMessage(match[0]),
    }));
}

/**
 * Walk a content tree and report every list item opened with `[ ]` or `[x]`.
 *
 * The frontmatter fence is taken off first, so what is scanned is the body and
 * the positions are still the file's. A file with no frontmatter is scanned
 * whole: it is not a note, but a stray `.md` in the tree carrying the marker is
 * the same problem for the same reason.
 *
 * A finding names its file **relative to the working directory**, which is
 * where a reader is standing and what `formatDiagnostic` emits. The content
 * root is where the walk starts, not what a path is measured from.
 *
 * @param {string} contentBase - Root of the content tree.
 * @param {object} [opts]
 * @param {readonly string[]} [opts.skipDirectories] - Directory names to ignore
 *   in addition to the dot-directories always skipped.
 * @returns {{findings: Array<{file: string, line: number, column: number,
 *   severity: "warning", message: string}>, files: number}} The findings, and
 *   how many files were read.
 */
export function lintContentTaskLists(contentBase, { skipDirectories = [] } = {}) {
    const skip = new Set(skipDirectories);
    /** @type {Array<{file: string, line: number, column: number, severity: "warning", message: string}>} */
    const findings = [];
    let files = 0;

    /** @param {string} dir - Directory to descend into. */
    const walk = (dir) => {
        /** @type {import("node:fs").Dirent[]} */
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name.startsWith(".") || skip.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (!/\.(md|markdown)$/i.test(entry.name)) continue;
            let content;
            try {
                content = fs.readFileSync(full, "utf8");
            } catch {
                continue;
            }
            files += 1;
            findings.push(
                ...checkTaskLists(...bodyOf(content, path.relative(process.cwd(), full))),
            );
        }
    };

    walk(contentBase);
    return { findings, files };
}

/**
 * A file's body, its path, and where the body starts in the file.
 *
 * The same split {@link module:engine/helpers.parseMarkdownFile} makes, without
 * parsing the YAML: this check has no use for the frontmatter's *values*, and
 * reading them would make an unparseable note silently unscanned.
 *
 * @param {string} content - The whole file.
 * @param {string} file - Its path, for the finding.
 * @returns {[string, string, {bodyLine: number, bodyColumn: number}]} The
 *   arguments {@link checkTaskLists} takes.
 */
function bodyOf(content, file) {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) return [content, file, { bodyLine: 1, bodyColumn: 1 }];

    const raw = match[2];
    const body = raw.trim();
    const bodyStart = content.length - raw.length + (raw.length - raw.trimStart().length);
    const before = content.slice(0, bodyStart);
    return [
        body,
        file,
        {
            bodyLine: before.split("\n").length,
            bodyColumn: bodyStart - before.lastIndexOf("\n"),
        },
    ];
}
