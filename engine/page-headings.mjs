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
 * What makes a heading start a Foundry journal page: an H1, or a heading at
 * any level carrying an explicit `{#anchor}`.
 *
 * **A leaf, deliberately.** {@link module:engine/journals.splitPages} decides
 * page boundaries from this; `scanBlocks` and `scanCaptions` refuse one
 * written where it cannot become a page. Both have to agree on what the line
 * means, and a leaf with no imports of its own can be shared by all three
 * without reaching back into either.
 *
 * @module
 */

/** A heading of any level, the `#` run and its text. */
const HEADING = /^\s*(#{1,6})\s+(.+?)\s*#*\s*$/;

/** A heading's text, with a trailing `{#slug}` anchor split off. */
const ANCHOR = /^(.*?)\s*\{#([^}]+)\}\s*$/;

/**
 * Parse a line as a heading.
 *
 * @param {string} line - One line of a note's body.
 * @returns {{level: number, text: string, anchorSlug: string|null, startsPage: boolean}|null}
 *   `null` when the line is not a heading. `startsPage` is true for an H1, or
 *   for a heading of any level carrying `{#anchor}` — a Foundry UUID can only
 *   address a page, so a linkable section has to be one.
 */
export function parseHeadingLine(line) {
    const heading = HEADING.exec(line);
    if (!heading) return null;
    const level = heading[1].length;
    const raw = heading[2].trim();
    const anchor = ANCHOR.exec(raw);
    return {
        level,
        text: (anchor ? anchor[1] : raw).trim(),
        anchorSlug: anchor?.[2]?.trim() || null,
        startsPage: level === 1 || anchor !== null,
    };
}
