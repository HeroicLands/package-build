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
 * The anchors a note declares on headings and captioned blocks.
 *
 * **A leaf, deliberately.** This is asked by the link checker, by the content
 * index, and by the builds that emit a link, and they cannot all import one
 * another: `helpers.mjs` is imported by the compilers, while the index imports
 * the manifest emitter, which imports them back. A reader that imports nothing
 * can be shared by all three — which is the point, because the question "what
 * anchors does this note declare?" had two answers and they disagreed on
 * `{#CalendarFormat}`.
 *
 * The suffix itself is read by {@link module:engine/heading-attributes}, which
 * {@link module:engine/journals.splitPages} also reads it through — so the index
 * cannot name an anchor the pages do not carry.
 *
 * @module
 */

import { scanCaptions } from "./content-captions.mjs";
import { HEADING_LINE, splitHeadingAttributes } from "./heading-attributes.mjs";

/**
 * The `{#slug}` and `:::caption {#slug}` anchors a note declares.
 *
 * A bare `#` heading starts a journal page without declaring a slug. Captioned
 * blocks declare a slug and start an addressable journal page.
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

        const heading = HEADING_LINE.exec(lines[i]);
        if (!heading) continue;
        const attributes = splitHeadingAttributes(heading[2]);
        if (!attributes.id) continue;
        anchors.push({
            slug: attributes.id,
            name: attributes.text,
            level: heading[1].length,
            line: bodyLine + i,
        });
    }
    for (const caption of scanCaptions(body).captions) {
        anchors.push({
            slug: caption.id,
            name: caption.label,
            level: 1,
            line: bodyLine + caption.line - 1,
        });
    }
    return anchors.sort((a, b) => a.line - b.line);
}
