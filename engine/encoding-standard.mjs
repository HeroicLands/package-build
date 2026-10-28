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

/** Shared Roman punctuation and invisible structural controls for every encoding. */
export const STANDARD_ROWS = Object.freeze(
    [
        [".", "\u{E0100}"],
        ["?", "\u{E0101}"],
        ["‼", "\u{E0102}"],
        ["!", "\u{E0103}"],
        { from: "^", to: "\u{E0104}", at: "line-start" },
        [",", "\u{E0105}"],
        ["«", "\u{E0106}"],
        ["»", "\u{E0107}"],
        ["‹", "\u{E0108}"],
        ["›", "\u{E0109}"],
        ["—", "\u{E010A}"],
        ["…", "\u{E010B}"],
        ["/", "\u{E010C}"],
        ["\\/", "\u{E010F}"],
        ["{", "\u{E0110}"],
        ["}", "\u{E0111}"],
    ].map(Object.freeze),
);
/** Controls belong to the engine and never come from font encoding files. */
export const STANDARD_CONTROLS = Object.freeze({
    verseStanza: "\u{E010D}",
    verseCanto: "\u{E010E}",
    wordSeparator: " ",
    literalOpen: "\u{E0112}",
    literalClose: "\u{E0113}",
    literalEscape: "\u{E0115}",
});
