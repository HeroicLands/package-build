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
 * The content format gives three anchors a document meaning: `{#appearance}`,
 * `{#dossier}` and `{#spoilers}`. *Which field* each lands in is a system's
 * business — SoHL writes the first to an actor's `appearance`, HM3 to an
 * actor's and an item's `description` — but *finding* it is not, so the
 * extraction lives here where every compiler reaches it (#139).
 *
 * It was a pair of private functions inside the SoHL actors pass, which is
 * where the convention was first needed and not where it belongs: the anchors
 * are stated in `docs/content-format.md`, alongside secret fences and heading
 * attributes, as part of the format every note is written in.
 *
 * @module
 */

import { md } from "./helpers.mjs";

/**
 * Extract the body of an H1 section whose heading carries the explicit
 * anchor decorator `{#<anchorId>}`. Captures every line after the H1 up
 * to (but not including) the next H1 — nested H2/H3 etc. and their bodies
 * are included. The H1 line itself is discarded. Returns "" if no such
 * heading exists. Fenced code blocks are respected so `# foo` inside
 * ``` blocks does not trigger a match.
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
            const anchor = h1Match[1].match(/\{#([^}]+)\}\s*$/);
            const id = anchor?.[1]?.trim().toLowerCase() || null;
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
    return slice ? md.render(slice) : "";
}
