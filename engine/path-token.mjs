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
 * Names that become one segment of a cache path.
 *
 * A dependency id and the version its manifest reports name a cache directory.
 * Both come from files a forge serves, so each is one plain token: it starts
 * with a letter or digit and holds only letters, digits, `.`, `+`, `_` and `-`,
 * with no `..`. A separator, an absolute path, a leading dot, a NUL or an empty
 * value cannot name a directory outside the cache.
 *
 * @module engine/path-token
 */

const PATH_TOKEN = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/u;

/**
 * Whether a value is a plain token that is safe as one path segment.
 *
 * @param {unknown} value - The value.
 * @returns {boolean} True for a plain token.
 */
export function isPathToken(value) {
    return typeof value === "string" && PATH_TOKEN.test(value) && !value.includes("..");
}

/**
 * Refuse a value that is not a plain token.
 *
 * @param {unknown} value - The value.
 * @param {string} message - The error message.
 * @returns {string} The value.
 * @throws {Error} When the value is not a plain token.
 */
export function requirePathToken(value, message) {
    if (!isPathToken(value)) throw new Error(message);
    return /** @type {string} */ (value);
}

/**
 * The message for a value that is not one plain version.
 *
 * @param {string} subject - What the value is, such as `a: its manifest m reports version`.
 * @param {unknown} value - The value.
 * @returns {string} The message; a number is told to be written as a quoted string.
 */
export function versionMessage(subject, value) {
    return (
        `${subject} ${JSON.stringify(value)}, which is not one plain version` +
        (typeof value === "number" ? "; write the version as a quoted string" : "")
    );
}
