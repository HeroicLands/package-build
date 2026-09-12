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
 * Raw HTML in a note's prose, reported.
 *
 * **A note is markdown.** What markdown cannot say, a note does not say — it
 * gets a construct every surface can render, the way `:icon-…:` replaces a
 * pasted glyph.
 *
 * ## There is no route from `<p>` to a book
 *
 * The packs and the website both pass raw HTML through, so a tag written in a
 * note reaches them intact and looks correct. Typst is handed markdown and
 * knows nothing of HTML, so the same tag reaches the book as nothing at all, or
 * as literal angle brackets. Closing that gap would mean writing an
 * HTML-to-Typst translator — a renderer nobody wants to own for the sake of a
 * `<strong>` that markdown already spells.
 *
 * So this is the character rule one level up: the charset check refuses a glyph
 * no book face can set, and this refuses markup no book renderer can read.
 *
 * ## What it does not look at
 *
 * - **Fenced blocks and code spans.** HTML shown as an example is prose *about*
 *   HTML, and a rule that could not tell the difference would make it
 *   impossible to document any of this — including this module. Which runs
 *   count as code is {@link module:engine/code-fences.codeRegions}' rule rather
 *   than a second copy of it.
 * - **Frontmatter.** A structured value is not prose, and a field the compiler
 *   derives is its own question — see {@link module:engine/derived-fields}.
 *
 * ## A warning, like the checks around it
 *
 * A note that renders correctly on two of three surfaces today should not fail
 * a build while the third is still being built. The finding is what makes the
 * work visible; the refusal follows when there is somewhere for the content to
 * go.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { matchAllOutsideCode } from "./code-fences.mjs";
import { positionInBody } from "./diagnostics.mjs";

/**
 * A raw HTML tag, opening, closing or self-closing.
 *
 * The name must start a tag for the match to begin, which is what keeps
 * markdown's own angle brackets out of it: an autolink is `<https://…>`, and
 * `https` is followed by `:` rather than whitespace or `>`, so the pattern
 * stops. A comparison written in prose — `a < b` — has no name after the
 * bracket at all.
 *
 * Attributes are consumed as "anything but a bracket", deliberately loosely: a
 * finding names the tag, and a pattern that tried to parse attribute syntax
 * would be a second HTML parser with its own bugs, in a module whose whole
 * point is that nothing here should be parsing HTML.
 *
 * @type {RegExp}
 */
export const HTML_TAG = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/g;

/**
 * What a note carrying raw HTML is told.
 *
 * It names the tag, because a file with several is fixed one at a time, and it
 * says why rather than only what: an author who does not know the book cannot
 * render it will read the finding as pedantry about a tag that plainly works.
 *
 * @param {string} tag - The matched markup, as written.
 * @returns {string} The message, unpunctuated at the end as a finding is.
 */
export function htmlMessage(tag) {
    return (
        `\`${tag}\` is raw HTML in a note's prose — write it in markdown. ` +
        `The packs and the website pass HTML through, so this renders on both ` +
        `and reaches the book as nothing: Typst is handed markdown and knows ` +
        `no HTML. Inside a fence or a code span it is an example, and not reported`
    );
}

/**
 * Every raw HTML tag in one note's body.
 *
 * @param {string} body - The note's markdown, without its frontmatter.
 * @param {string} file - The note's path, for the finding.
 * @param {object} [opts]
 * @param {number} [opts.bodyLine=1] - The 1-based file line the body starts on.
 * @param {number} [opts.bodyColumn=1] - The 1-based file column it starts at.
 * @returns {Array<{file: string, line: number, column: number,
 *   severity: "warning", message: string}>} One finding per tag, in source
 *   order.
 */
export function checkHtml(body, file, { bodyLine = 1, bodyColumn = 1 } = {}) {
    const text = String(body ?? "");
    if (!text) return [];

    return matchAllOutsideCode(text, HTML_TAG).map((match) => ({
        file,
        ...positionInBody(text, /** @type {number} */ (match.index), { bodyLine, bodyColumn }),
        severity: /** @type {"warning"} */ ("warning"),
        message: htmlMessage(match[0]),
    }));
}

/**
 * Walk a content tree and report raw HTML in every note's prose.
 *
 * The frontmatter fence is taken off first, so what is scanned is the body and
 * the positions are still the file's. A file with no frontmatter is scanned
 * whole: it is not a note, but a stray `.md` in the tree carrying markup is the
 * same problem for the same reason.
 *
 * @param {string} contentBase - Root of the content tree.
 * @param {object} [opts]
 * @param {readonly string[]} [opts.skipDirectories] - Directory names to ignore
 *   in addition to the dot-directories always skipped.
 * @returns {{findings: Array<{file: string, line: number, column: number,
 *   severity: "warning", message: string}>, files: number}} The findings, and
 *   how many files were read.
 */
export function lintContentHtml(contentBase, { skipDirectories = [] } = {}) {
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
            findings.push(...checkHtml(...bodyOf(content, path.relative(contentBase, full))));
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
 *   arguments {@link checkHtml} takes.
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
