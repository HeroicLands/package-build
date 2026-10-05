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
 * The anchors a note declares on headings, captions, divs, poems and spans.
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

import { scanBlocks } from "./content-blocks.mjs";
import { scanPoetry } from "./content-poetry.mjs";
import { scanSpans } from "./content-spans.mjs";
import { codeRegions } from "./code-fences.mjs";
import { slugify } from "./content-slug.mjs";
import { scanFigures } from "./content-figures.mjs";
import { HEADING_LINE, splitHeadingAttributes } from "./heading-attributes.mjs";

/**
 * The identifiers a note declares on headings, captions, divs, poems and spans.
 *
 * Headings and captions may start journal pages. Div, poem and inline-span
 * anchors address locations within their containing pages.
 *
 * @param {string} body - The note's markdown body, frontmatter already removed.
 * @param {number} [bodyLine] - The 1-based file line the body starts on, from
 *   `parseMarkdownFile`. Anchors are reported at their position in the **file**,
 *   so an editor can jump straight to one; passing nothing numbers from the body.
 * @param {(address: string) => string|undefined} [resolveRole] - From a
 *   picture's address to the role its asset declares, so a figure anchor's
 *   `name` reads `Map 1` rather than `Figure 1` where it is due — see
 *   {@link module:engine/content-figures.scanFigures}.
 * @returns {Array<{slug: string, name: string, level: number, line: number}>}
 *   In document order.
 */
export function collectAnchors(body, bodyLine = 1, resolveRole) {
    const anchors = [];
    const literal = codeRegions(body, { spans: false });
    let offset = 0;
    const lines = String(body ?? "").split("\n");

    for (let i = 0; i < lines.length; i++) {
        const lineOffset = offset;
        offset += lines[i].length + 1;
        if (literal.some((region) => lineOffset >= region.start && lineOffset < region.end))
            continue;

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
    for (const figure of scanFigures(body, { resolveRole }).figures) {
        if (!figure.id) continue;
        anchors.push({
            slug: figure.id,
            name: figure.label || figure.caption,
            level: 1,
            line: bodyLine + figure.line - 1,
        });
    }
    const blockAnchors = (source, firstLine) => {
        const sourceLines = source.split("\n");
        for (const block of scanBlocks(source).blocks) {
            if (block.id)
                anchors.push({
                    slug: slugify(block.id),
                    name: block.title || block.id,
                    level: 0,
                    line: firstLine + block.start,
                });
            blockAnchors(
                sourceLines.slice(block.start + 1, block.end).join("\n"),
                firstLine + block.start + 1,
            );
        }
    };
    blockAnchors(String(body ?? ""), bodyLine);
    for (const poem of scanPoetry(body).blocks) {
        if (poem.id)
            anchors.push({
                slug: slugify(poem.id),
                name: poem.id,
                level: 0,
                line: bodyLine + poem.start,
            });
    }
    for (const span of scanSpans(body).spans) {
        if (span.id)
            anchors.push({
                slug: slugify(span.id),
                name: span.text,
                level: 0,
                line: bodyLine + span.line - 1,
            });
    }
    return anchors.sort((a, b) => a.line - b.line);
}

/** Collisions involving a div, verse or inline-span anchor.
 * Heading and caption collisions are diagnosed by their existing scanners.
 * @param {string} body - Authored Markdown.
 * @returns {Array<{line: number, column: number, message: string}>} Located collisions.
 */
export function markupAnchorFindings(body) {
    const groups = new Map();
    for (const anchor of collectAnchors(body)) {
        const slug = slugify(anchor.slug);
        if (!groups.has(slug)) groups.set(slug, []);
        groups.get(slug).push(anchor);
    }
    const errors = [];
    for (const [slug, anchors] of groups) {
        if (anchors.length < 2 || !anchors.some((anchor) => anchor.level === 0)) continue;
        for (const anchor of anchors.slice(1))
            errors.push({
                line: anchor.line,
                column: 1,
                message: `duplicate markup anchor "${slug}"`,
            });
    }
    return errors;
}
