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
 * **Anchored body sections** — the `# Heading {#anchor}` convention, and how a
 * compiler pulls one section out of a note's prose.
 *
 * The content format gives two anchors a document meaning: `{#appearance}` and
 * `{#dossier}`. *Which field* each lands in is a system's
 * business — SoHL writes the first to an actor's `appearance`, HM3 to an
 * actor's and an item's `description` — but *finding* it is not, so the
 * extraction lives here where every compiler reaches it.
 *
 * It was a pair of private functions inside the SoHL actors pass, which is
 * where the convention was first needed and not where it belongs: the anchors
 * are stated in `docs/content-format.md`, alongside secret fences and heading
 * attributes, as part of the format every note is written in.
 *
 * @module
 */

import { renderFoundryMarkdown } from "./helpers.mjs";
import { collectAnchors } from "./anchors.mjs";
import { splitHeadingAttributes } from "./heading-attributes.mjs";

/**
 * Extract the body of an H1 section whose heading carries the explicit
 * anchor decorator `{#<anchorId>}`. Captures every line after the H1 up
 * to (but not including) the next H1 — nested H2/H3 etc. and their bodies
 * are included. The H1 line itself is discarded. Returns "" if no such
 * heading exists. Fenced code blocks are respected so `# foo` inside
 * ``` blocks does not trigger a match.
 *
 * An anchor declared on a lower heading is found by {@link collectAnchors}
 * but not by the `#\s+` match below, so it extracts as absent rather than as
 * wrong — {@link misplacedAnchorSection} is the check a caller runs first to
 * tell the two apart.
 *
 * @param {string} body - The note body.
 * @param {string} anchorId - The anchor to find.
 * @returns {string} The section's markdown, or "".
 */
export function extractAnchorSection(body, anchorId) {
    const lines = String(body ?? "").split("\n");
    const captured = [];
    let inCodeBlock = false;
    let capturing = false;
    const wanted = String(anchorId).toLowerCase();
    for (const line of lines) {
        if (line.trim().startsWith("```")) {
            inCodeBlock = !inCodeBlock;
            if (capturing) captured.push(line);
            continue;
        }
        const h1Match = !inCodeBlock ? line.match(/^\s*#\s+(.+?)\s*#*\s*$/) : null;
        if (h1Match) {
            const id = splitHeadingAttributes(h1Match[1]).id.toLowerCase() || null;
            if (capturing) break;
            if (id === wanted) {
                capturing = true;
                continue;
            }
        }
        if (capturing) captured.push(line);
    }
    return captured.join("\n").trim();
}

/**
 * Render an extracted markdown section to HTML, or "" if empty.
 *
 * @param {string} body - The note body.
 * @param {string} anchorId - The anchor to find.
 * @returns {string} The rendered HTML, or "".
 */
export function renderSection(body, anchorId) {
    const slice = extractAnchorSection(body, anchorId);
    return slice ? renderFoundryMarkdown(slice) : "";
}

/**
 * Where an `{#appearance}` or `{#dossier}` anchor sits on a heading below the
 * top level, which {@link extractAnchorSection} cannot read.
 *
 * {@link module:engine/anchors.collectAnchors} finds the anchor at any
 * level, because a lower heading legitimately starts a journal page. It does
 * not feed an actor field: an H1-only extractor reads nothing from one, and a
 * caller that trusts the empty result as "no such section" rather than
 * "found, but unreadable" compiles a blank field with nothing to say why.
 *
 * @param {string} body - The note body.
 * @param {string} anchorId - The anchor to check, case-insensitively.
 * @param {number} [bodyLine=1] - The 1-based file line the body starts on.
 * @returns {{line: number}|null} The misplaced anchor's line, or `null` when
 *   it is absent or already on an H1.
 */
export function misplacedAnchorSection(body, anchorId, bodyLine = 1) {
    const wanted = String(anchorId).toLowerCase();
    const found = collectAnchors(body, bodyLine).find(
        (anchor) => anchor.slug.toLowerCase() === wanted,
    );
    if (!found || found.level === 1) return null;
    return { line: found.line };
}
