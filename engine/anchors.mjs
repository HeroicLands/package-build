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
 * The anchors a note declares on its headings — read in one place (#243).
 *
 * **A leaf, deliberately.** This is asked by the link checker, by the content
 * index, and by the builds that emit a link, and they cannot all import one
 * another: `helpers.mjs` is imported by the compilers, while the index imports
 * the manifest emitter, which imports them back. A reader that imports nothing
 * can be shared by all three — which is the point, because the question "what
 * anchors does this note declare?" had two answers and they disagreed on
 * `{#CalendarFormat}`.
 *
 * @module
 */

/**
 * A heading, and the `{#slug}` anchor it declares.
 *
 * Kept identical to the pair {@link splitPages} matches, because the two must
 * agree about what an anchor is: that pass decides which sections become
 * addressable journal pages, and an index naming an anchor it does not produce
 * would advertise a link that resolves nowhere. `tests/content-index.test.ts`
 * asserts the two find the same anchors, so drift fails the suite rather than
 * shipping.
 */
const HEADING = /^\s*(#{1,6})\s+(.+?)\s*#*\s*$/;
const ANCHOR = /^(.*?)\s*\{#([^}]+)\}\s*$/;
/**
 * The `{#slug}` anchors a note's body declares, with where each one sits.
 *
 * Only headings carrying an explicit anchor are collected. A bare `#` heading
 * also starts a journal page, but it declares no slug, so nothing can address
 * it with `#…` — listing it would offer a link that cannot be written.
 *
 * @param {string} body - The note's markdown body, frontmatter already removed.
 * @param {number} [bodyLine] - The 1-based file line the body starts on, from
 *   `parseMarkdownFile`. Anchors are reported at their position in the **file**,
 *   so an editor can jump straight to one; passing nothing numbers from the body.
 * @returns {Array<{slug: string, name: string, level: number, line: number}>}
 *   In document order.
 */
export function collectAnchors(body, bodyLine = 1) {
    const anchors = [];
    let inCodeBlock = false;
    const lines = String(body ?? "").split("\n");

    for (let i = 0; i < lines.length; i++) {
        // A fenced block's contents are not headings, and `#` is a comment in
        // most of what gets fenced.
        if (lines[i].trim().startsWith("```")) {
            inCodeBlock = !inCodeBlock;
            continue;
        }
        if (inCodeBlock) continue;

        const heading = HEADING.exec(lines[i]);
        if (!heading) continue;
        const anchor = ANCHOR.exec(heading[2].trim());
        if (!anchor) continue;

        const slug = anchor[2].trim();
        if (!slug) continue;
        anchors.push({
            slug,
            name: anchor[1].trim(),
            level: heading[1].length,
            line: bodyLine + i,
        });
    }
    return anchors;
}
