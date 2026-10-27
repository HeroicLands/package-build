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
 * **The words a script note and a language note state emphasis and direction
 * by.** Read by the vocabulary as it is declared, so this module imports
 * nothing; the checks and the conventions' use are in
 * {@link module:engine/script-emphasis} and {@link module:engine/script-direction}.
 *
 * @module
 */

/** The conventions a script states its emphasis by. */
export const EMPHASIS_CONVENTIONS = Object.freeze(["rubric", "overline"]);

/** The class each convention gives an `<em>` or a `<strong>`. */
export const EMPHASIS_CLASSES = Object.freeze({
    rubric: "emph-rubric",
    overline: "emph-overline",
});

/**
 * The conventions a language note states, which override its script's.
 * `words` marks emphasis with a word, so a mark in its text is a finding.
 */
export const LANGUAGE_EMPHASES = Object.freeze(["words", ...EMPHASIS_CONVENTIONS]);

/**
 * The directions a script states it is written in. `vertical-rl` is columns,
 * top to bottom, read from the right; a script stating none is written in
 * lines.
 */
export const SCRIPT_DIRECTIONS = Object.freeze(["vertical-rl"]);

/** The `subType` of a script note. */
export const SCRIPT_SUBTYPE = "script";

/** The ordinary prose families accepted by font=. */
export const GENERIC_FAMILIES = Object.freeze(["mono", "serif", "sans"]);
