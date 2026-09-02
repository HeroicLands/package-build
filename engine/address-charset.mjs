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
 * The one charset every segment of a canonical address is held to (#59).
 *
 * An address is a hyphen-joined tuple — `sohl-skill-clmb` — and it is read back
 * by **counting segments**, with a fixed meaning per position. That is sound
 * for exactly one reason: the hyphen is *purely* a separator, because no
 * segment may contain one. Take that away and reading an address needs a
 * vocabulary to match against, a longest-match rule, and an answer for every
 * name that is a prefix of another — none of which exist.
 *
 * So the charset is not a tidiness rule. It is the premise the address grammar
 * rests on, and the issue's word for how it should be held is **enforced rather
 * than assumed**: a value that breaks it is refused where it is written, not
 * discovered later as addresses that fail to parse and report nothing about
 * why. `harn-adventures` was that case — its keys read as four segments and
 * failed as a `null` return.
 *
 * This module is a **leaf with no local imports**, so the validator a
 * consumer's `package-build.config.mjs` reaches (`content-config.mjs`) can name
 * it without closing a cycle around that file.
 *
 * @module
 */

/**
 * The shape every address segment must match: ASCII letters and digits only.
 *
 * Case is deliberately **not** constrained. Hundreds of authored shortcodes are
 * mixed-case and collide with nothing, and case has no bearing on the
 * separator, which is the whole of what this pattern is protecting.
 *
 * @type {RegExp}
 */
export const ADDRESS_SEGMENT_PATTERN = /^[A-Za-z0-9]+$/;

/**
 * Whether a value is a well-formed address segment.
 *
 * A blank value is **not** valid: this answers "is this an acceptable segment",
 * never "is a segment present". Presence is a separate question, asked
 * wherever the value is required, and conflating the two would report a missing
 * key as a charset violation.
 *
 * @param {unknown} value - The candidate segment.
 * @returns {boolean} `true` when it matches {@link ADDRESS_SEGMENT_PATTERN}.
 */
export function isAddressSegment(value) {
    return typeof value === "string" && ADDRESS_SEGMENT_PATTERN.test(value);
}
