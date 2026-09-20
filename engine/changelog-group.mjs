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
 * Fold a release's changeset blocks together by their bold label.
 *
 * `@heroiclands/package-build/changelog` (`changelog.cjs`) writes each
 * changeset's summary into `CHANGELOG.md` as its own block, verbatim, under
 * `### <Bump> Changes` — one per changeset, in whatever order Changesets
 * happened to read the files. A repository that groups its release prose by
 * subject (`**Compendiums**`, `**Website**`) ends up with the same label
 * opening several scattered blocks instead of one, because nothing ever
 * merges them: three pull requests touching compendium content each write
 * their own `**Compendiums**` block, and the release reads as three
 * unrelated entries rather than one.
 *
 * `groupChangelogText` merges same-label blocks into one, in the display
 * order `changelog.labels` declares, with the unlabelled lead paragraph
 * first and any label absent from that vocabulary last. It reuses
 * {@link module:engine/changelog-lint.topLevelBlocks} — the same block
 * model `changelog check` reads a block's label from — rather than parsing
 * the markdown a second way.
 *
 * @module
 */

import {
    codeLineSet,
    lineColOf,
    releaseSectionRange,
    topLevelBlocks,
    topLevelBullets,
} from "./changelog-lint.mjs";

/** A `### <Bump> Changes` heading — the generated scaffold, never authored. */
const CHANGES_HEADING_RE = /^### (?:Major|Minor|Patch) Changes$/gm;

/**
 * A labelled block's own `**Label**` line, split from everything after it.
 *
 * @param {string} blockText - One block, as {@link topLevelBlocks} collects
 *   it — its first line is the label line for a labelled block.
 * @returns {{labelLine: string, rest: string}} `rest` has its leading blank
 *   line dropped; a block with nothing but the label line yields `""`.
 */
function splitLabelLine(blockText) {
    const nl = blockText.indexOf("\n");
    if (nl === -1) return { labelLine: blockText, rest: "" };
    return { labelLine: blockText.slice(0, nl), rest: blockText.slice(nl + 1).replace(/^\n+/, "") };
}

/**
 * A block's top-level items: its bullets, or — when it carries none — the
 * whole thing as one paragraph item. This is what merging concatenates and
 * deduplicates, so a bulleted `**Compendiums**` block and a prose one merge
 * on the same footing.
 *
 * @param {string} text - A block's content, label line already stripped (or
 *   a lead block's whole text).
 * @returns {string[]}
 */
function itemsOf(text) {
    const trimmed = text.replace(/\s+$/, "");
    if (!trimmed) return [];
    const bullets = topLevelBullets(trimmed, codeLineSet(trimmed));
    if (bullets.length === 0) return [trimmed];
    return bullets.map((bullet) => bullet.text.replace(/\s+$/, ""));
}

/**
 * The first occurrence of each item, exact-duplicate text dropped, order
 * preserved — the "an exact-duplicate bullet once" rule.
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
 * Join a merged group's items the way its own shape calls for: bullets
 * adjacent, one to a line; a paragraph or a mix of paragraphs separated by a
 * blank line, the same spacing a changeset's own multi-paragraph summary
 * already uses.
 *
 * @param {string[]} items
 * @returns {string}
 */
function joinItems(items) {
    if (items.length === 0) return "";
    const allBullets = items.every((item) => /^-\s/.test(item));
    return items.join(allBullets ? "\n" : "\n\n");
}

/**
 * One label's blocks (or every unlabelled one), folded into the single
 * block `group` writes for it.
 *
 * @param {Array<{label: string|null, text: string}>} blocks - Every block
 *   sharing one label, in file order. All carry the same `label`.
 * @returns {string}
 */
function mergeGroup(blocks) {
    if (blocks[0].label === null) {
        return joinItems(dedupeItems(blocks.flatMap((block) => itemsOf(block.text))));
    }
    const { labelLine } = splitLabelLine(blocks[0].text);
    const items = dedupeItems(blocks.flatMap((block) => itemsOf(splitLabelLine(block.text).rest)));
    return items.length ? `${labelLine}\n\n${joinItems(items)}` : labelLine;
}

/**
 * Where a group sorts, relative to the others in its section.
 *
 * The unlabelled lead group always sorts first, whether or not
 * `changelog.labels` is declared — it is the summary a changeset writes with
 * no category, and reads like the section's own opening line. A declared
 * vocabulary then orders everything else by its position in that list, with
 * an undeclared label sorted after every declared one; with no vocabulary
 * declared at all, every labelled group keeps the order its label first
 * appeared in.
 *
 * @param {string|null} key - A group's label, or `null` for the lead group.
 * @param {string[]} appearanceOrder - Every key, in the order its first
 *   block appeared in the section.
 * @param {readonly string[]|null} labels - `changelog.labels`, or `null`.
 * @returns {[number, number]} `[tier, rank]`, compared tier first.
 */
function groupRank(key, appearanceOrder, labels) {
    if (key === null) return [-1, 0];
    if (labels) {
        const configured = labels.indexOf(key);
        return configured === -1 ? [1, appearanceOrder.indexOf(key)] : [0, configured];
    }
    return [0, appearanceOrder.indexOf(key)];
}

/**
 * Fold one `### <Bump> Changes` section's blocks together by label.
 *
 * @param {string} bodyText - Everything after the heading, up to the next
 *   one or the end of the release section.
 * @param {readonly string[]|null} labels - `changelog.labels`, in display
 *   order, or `null` when the repository declares none.
 * @returns {{text: string, unknown: Array<{label: string, startLine: number}>}}
 *   The regrouped body (no leading or trailing blank lines), and every label
 *   it wrote that `labels` does not declare, each at its merged block's
 *   first-occurring line within `bodyText` — empty when `labels` is `null`,
 *   since nothing is "unknown" against no vocabulary.
 */
function groupSection(bodyText, labels) {
    const codeLines = codeLineSet(bodyText);
    const blocks = topLevelBlocks(bodyText, codeLines);
    if (blocks.length === 0) return { text: "", unknown: [] };

    /** @type {string[]} */
    const appearanceOrder = [];
    /** @type {Map<string|null, Array<{label: string|null, text: string}>>} */
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

    const unknown =
        labels === null ?
            []
        :   sortedKeys
                .filter((key) => key !== null && !labels.includes(key))
                .map((key) => ({ label: key, startLine: groups.get(key)[0].startLine }));

    const text = sortedKeys.map((key) => mergeGroup(groups.get(key))).join("\n\n");
    return { text, unknown };
}

/**
 * `changelog group`: fold the newest release's changeset blocks together by
 * their bold label, order them, and file an undeclared one last.
 *
 * Every earlier release section is untouched, byte for byte — only the
 * first `## <version>` section's `### <Bump> Changes` bodies are rewritten,
 * each independently (a label groups within its own bump level, never
 * across one). Running this on its own output is a no-op: a release already
 * in label order, with each label merged to one block, groups to itself.
 *
 * @param {string} text - The changelog's full contents.
 * @param {object} [opts]
 * @param {readonly string[]|null} [opts.labels] - `changelog.labels`, in
 *   display order. `null`/absent orders every group by first appearance
 *   instead, lead paragraph first, and files nothing as unknown.
 * @returns {{text: string, findings: Array<{line: number,
 *   severity: "warning", message: string}>}}
 */
export function groupChangelogText(text, { labels = null } = {}) {
    const range = releaseSectionRange(text);
    if (!range) return { text, findings: [] };

    const section = text.slice(range.start, range.end);
    const headings = [...section.matchAll(CHANGES_HEADING_RE)];
    if (headings.length === 0) return { text, findings: [] };

    let rebuilt = section.slice(0, headings[0].index);
    /** @type {Array<{line: number, severity: "warning", message: string}>} */
    const findings = [];

    for (let i = 0; i < headings.length; i++) {
        const heading = headings[i];
        const bodyStart = heading.index + heading[0].length;
        const bodyEnd = i + 1 < headings.length ? headings[i + 1].index : section.length;
        const { text: grouped, unknown } = groupSection(section.slice(bodyStart, bodyEnd), labels);

        const isVeryLast = i === headings.length - 1 && range.end === text.length;
        rebuilt += heading[0] + (grouped ? `\n\n${grouped}` : "") + (isVeryLast ? "\n" : "\n\n");

        const { line: bodyFirstLine } = lineColOf(text, range.start + bodyStart);
        for (const { label, startLine } of unknown) {
            findings.push({
                line: bodyFirstLine + (startLine - 1),
                severity: "warning",
                message:
                    `changelog-group/unknown-label "${label}" is not declared in ` +
                    "`changelog.labels` — filed last, in order of first appearance",
            });
        }
    }

    return { text: text.slice(0, range.start) + rebuilt + text.slice(range.end), findings };
}
