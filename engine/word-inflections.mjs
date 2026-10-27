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

import { parseWordClass } from "./word-classes.mjs";

/**
 * A noun's stated plural, or the first literal ending replacement that fits.
 *
 * @param {{form: string, class?: unknown, plural?: unknown}} word - A word of
 *   `data.words`.
 * @param {Record<string, any>|undefined} grammar - Its language's
 *   `data.grammar`.
 * @returns {string|null} The plural, or `null` for a word that is no noun or
 *   that no rule fits.
 */
export function pluralOf(word, grammar) {
    if (parseWordClass(word.class).base !== "n") return null;
    if (typeof word.plural === "string" && word.plural) return word.plural;
    return pluralByRule(word.form, grammar);
}

/**
 * The plural a language's `data.grammar.plural` rule gives a form: the first
 * literal ending replacement that fits, whatever the form's class.
 *
 * @param {string} form - The form.
 * @param {Record<string, any>|undefined} grammar - Its language's
 *   `data.grammar`.
 * @returns {string|null} The plural, or `null` where no rule fits.
 */
export function pluralByRule(form, grammar) {
    for (const rule of Array.isArray(grammar?.plural) ? grammar.plural : []) {
        if (typeof rule?.ending !== "string" || typeof rule.becomes !== "string") continue;
        if (form.endsWith(rule.ending))
            return (rule.ending ? form.slice(0, -rule.ending.length) : form) + rule.becomes;
    }
    return null;
}
