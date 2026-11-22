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
 * The validity rules for User-Agent contact values, shared by the configuration
 * loader and the header builder. This module imports nothing.
 */

/** The wording every refusal of a contact value uses. */
export const CONTACT_RULE = "must be visible ASCII without parentheses, semicolons or backslashes";

/** The wording every refusal of a host suffix uses. */
export const HOST_RULE =
    "must be a domain suffix of at least two labels ending in a letter-bearing label, such as wikimedia.org";

/**
 * Whether a URL or email can sit inside the header's parenthesised comment.
 * @param {string} text - The candidate value.
 * @returns {boolean} True when it is acceptable.
 */
export function contactIsValid(text) {
    return /^[\x21-\x7e]+$/u.test(text) && !/[();\\]/u.test(text);
}

/**
 * Reduce a host suffix to its bare lowercase form: a `*.` or `.` prefix is
 * accepted and dropped, and a trailing dot is dropped.
 * @param {string} text - The authored entry.
 * @returns {string} The bare suffix.
 */
export function bareHostSuffix(text) {
    return text
        .trim()
        .toLowerCase()
        .replace(/^\*?\./u, "")
        .replace(/\.$/u, "");
}

/**
 * Whether a host suffix is acceptable: at least two labels, each a valid DNS
 * label, and a final label that is not all digits, so it cannot match an
 * address or a whole top-level domain.
 * @param {string} text - The authored entry.
 * @returns {boolean} True when it is acceptable.
 */
export function hostSuffixIsValid(text) {
    const labels = bareHostSuffix(text).split(".");
    return (
        labels.length >= 2 &&
        labels.every((label) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/u.test(label)) &&
        /[a-z]/u.test(labels[labels.length - 1])
    );
}
