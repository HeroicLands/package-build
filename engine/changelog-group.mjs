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
 * Turn Changesets' output for the newest release into its final shape.
 *
 * `@heroiclands/package-build/changelog` (`changelog.cjs`) writes each
 * changeset's summary into `CHANGELOG.md` verbatim, under a
 * `### Major Changes`, `### Minor Changes` or `### Patch Changes` heading,
 * one block per changeset in whatever order Changesets read the files. A
 * release is read by subject, not by bump, so `groupChangelogText` removes
 * every one of those headings, merges the blocks that share a label into one,
 * and orders the labels as the changelog `labels` declares them. A label the list
 * does not declare follows the declared ones, in order of first appearance,
 * and `Miscellaneous`, which every repository has without declaring it, is
 * always last.
 *
 * It reuses {@link module:engine/changelog-lint.topLevelBlocks}, the block
 * model `changelog check` reads a block's label from, rather than parsing the
 * markdown a second way.
 *
 * @module
 */

import {
    MISCELLANEOUS,
    codeLineSet,
    lineColOf,
    releaseSectionRange,
    topLevelBlocks,
    topLevelBullets,
} from "./changelog-lint.mjs";

/** A `### <Bump> Changes` heading — the generated scaffold, never authored. */
const CHANGES_HEADING_RE = /^### (?:Major|Minor|Patch) Changes\s*$/;

/**
 * A block's top-level bullets and the prose or code between them, in source
 * order. A bullet retains its indented continuation and nested items.
 *
 * @param {string} text - A block's content, label line already stripped.
 * @returns {string[]}
 */
function itemsOf(text) {
    const trimmed = text.replace(/\s+$/, "");
    if (!trimmed) return [];
    const bullets = topLevelBullets(trimmed, codeLineSet(trimmed));
    if (bullets.length === 0) return [trimmed];
    const starts = [];
    let offset = 0;
    for (const line of trimmed.split("\n")) {
        starts.push(offset);
        offset += line.length + 1;
    }
    const items = [];
    const append = (part) => {
        const item = part.replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, "");
        if (item) items.push(item);
    };
    let cursor = 0;
    for (const bullet of bullets) {
        const start = starts[bullet.startLine - 1];
        append(trimmed.slice(cursor, start));
        append(bullet.text);
        cursor = start + bullet.text.length;
    }
    append(trimmed.slice(cursor));
    return items;
}

/**
 * The first occurrence of each item, exact-duplicate text dropped, order
 * preserved.
 *
 * @param {string[]} items
 * @returns {string[]}
 */
function dedupeItems(items) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
        const key = item.trim();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

/**
 * One label's blocks, folded into the single block `group` writes for it:
 * the label line, a blank line, then every bullet in file order. Bullets are
 * adjacent; any other item is separated by a blank line.
 *
 * @param {Array<{label: string|null, text: string}>} blocks - Every block
 *   sharing one label, in file order.
 * @returns {string}
 */
function mergeGroup(blocks) {
    const labelled = blocks[0].label !== null;
    const items = dedupeItems(
        blocks.flatMap((block) => {
            if (!labelled) return itemsOf(block.text);
            const [, ...rest] = block.text.replace(/\s+$/, "").split("\n");
            return itemsOf(rest.join("\n"));
        }),
    );
    const joined = items.join(items.every((item) => /^-\s/.test(item)) ? "\n" : "\n\n");
    if (!labelled) return joined;
    const labelLine = blocks[0].text.split("\n")[0].trimEnd();
    return joined ? `${labelLine}\n\n${joined}` : labelLine;
}

/**
 * Where a group sorts in its release: an unlabelled block first, then the
 * declared labels in their declared order, then any other label in order of
 * first appearance, and `Miscellaneous` last. With no vocabulary declared,
 * every label but `Miscellaneous` keeps its order of first appearance.
 *
 * @param {string|null} key - A group's label, or `null` for an unlabelled one.
 * @param {string[]} appearanceOrder - Every key, in order of first appearance.
 * @param {readonly string[]|null} labels - the changelog `labels`, or `null`.
 * @returns {[number, number]} `[tier, rank]`, compared tier first.
 */
function groupRank(key, appearanceOrder, labels) {
    if (key === null) return [-1, 0];
    if (key === MISCELLANEOUS) return [2, 0];
    if (labels) {
        const configured = labels.indexOf(key);
        return configured === -1 ? [1, appearanceOrder.indexOf(key)] : [0, configured];
    }
    return [0, appearanceOrder.indexOf(key)];
}

/**
 * `changelog group`: give the newest release its final shape.
 *
 * Every earlier release section is untouched, byte for byte. Running this on
 * its own output is a no-op.
 *
 * @param {string} text - The changelog's full contents.
 * @param {object} [opts]
 * @param {readonly string[]|null} [opts.labels] - the changelog `labels`, in
 *   display order. `null`/absent orders by first appearance and reports
 *   nothing as undeclared.
 * @returns {{text: string, findings: Array<{line: number,
 *   severity: "warning", message: string}>}}
 */
export function groupChangelogText(text, { labels = null } = {}) {
    const range = releaseSectionRange(text);
    if (!range) return { text, findings: [] };

    const section = text.slice(range.start, range.end);
    const headingEnd = section.indexOf("\n");
    if (headingEnd === -1) return { text, findings: [] };
    const heading = section.slice(0, headingEnd);

    // The scaffold headings become blank lines, so every line keeps its number.
    const codeLines = codeLineSet(section.slice(headingEnd + 1));
    const body = section
        .slice(headingEnd + 1)
        .split("\n")
        .map((line, i) => (!codeLines.has(i + 1) && CHANGES_HEADING_RE.test(line) ? "" : line))
        .join("\n");

    const blocks = topLevelBlocks(body, codeLines);
    /** @type {Array<string|null>} */
    const appearanceOrder = [];
    /** @type {Map<string|null, Array<{startLine: number, label: string|null, text: string}>>} */
    const groups = new Map();
    for (const block of blocks) {
        if (!groups.has(block.label)) {
            groups.set(block.label, []);
            appearanceOrder.push(block.label);
        }
        groups.get(block.label).push(block);
    }
    const sortedKeys = [...appearanceOrder].sort((a, b) => {
        const [aTier, aRank] = groupRank(a, appearanceOrder, labels);
        const [bTier, bRank] = groupRank(b, appearanceOrder, labels);
        return aTier - bTier || aRank - bRank;
    });

    const { line: bodyFirstLine } = lineColOf(text, range.start + headingEnd + 1);
    const findings = [];
    if (labels)
        for (const key of sortedKeys) {
            if (key === null || key === MISCELLANEOUS || labels.includes(key)) continue;
            findings.push({
                line: bodyFirstLine + (groups.get(key)[0].startLine - 1),
                severity: /** @type {const} */ ("warning"),
                message:
                    `changelog-group/unknown-label "${key}" is not declared in ` +
                    "the changelog `labels` — filed after the declared labels, in order of first appearance",
            });
        }

    const grouped = sortedKeys.map((key) => mergeGroup(groups.get(key))).join("\n\n");
    const rebuilt =
        heading + (grouped ? `\n\n${grouped}` : "") + (range.end === text.length ? "\n" : "\n\n");
    return { text: text.slice(0, range.start) + rebuilt + text.slice(range.end), findings };
}
