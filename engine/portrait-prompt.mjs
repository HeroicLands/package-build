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
 * The text a being's portrait was generated from.
 *
 * `data.portrait.prompt` holds that text exactly as it was given to the image
 * model, so the picture is a record of what the note said. A note with no
 * `data.portrait` block has no portrait yet, and nothing is reported for it.
 * The block exists only once a portrait does; image facts such as the model
 * and seed stay in the picture itself.
 *
 * @module
 */

import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { isPlainMap } from "./data-keys.mjs";

/**
 * The frontmatter lint's check of `data.portrait.prompt`.
 *
 * The prompt is held to what can be checked without reading it as prose: a
 * string with something in it. A value of another kind is the declared shape's
 * finding, and an absent block or an absent prompt key is not a finding here.
 *
 * @param {object} note - The note: `file`, `raw` and parsed `fm`.
 * @returns {object[]} Findings, located at the value.
 */
export function checkPortraitPrompt(note) {
    const portrait = note?.fm?.data?.portrait;
    if (!isPlainMap(portrait)) return [];
    const prompt = portrait.prompt;
    if (typeof prompt !== "string" || prompt.trim() !== "") return [];
    return [
        {
            ...(note.file ? { file: note.file } : {}),
            ...positionOfFrontmatterPath(note.raw ?? "", ["data", "portrait", "prompt"]),
            severity: "error",
            message:
                "`data.portrait.prompt` is blank; it holds the text the portrait was generated from",
        },
    ];
}
