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
 * **BCP 47 language tags** (RFC 5646), checked without the IANA registry.
 *
 * A tag is accepted when it is well-formed by the RFC's grammar and meets the
 * two validity rules that need no registry: no variant subtag appears twice,
 * and no extension singleton appears twice. Matching is case-insensitive, as
 * the RFC requires. Whether each subtag is registered is not checked.
 *
 * A constructed language takes `art-x-<name>`: `art` is the registered
 * collective code for artificial languages, and the private-use part names
 * which one.
 *
 * @module
 */

const ALPHANUM = "[a-z0-9]";

/** What separates a tag's subtags: RFC 5646's own separator, not an Address's. */
const SUBTAG_SEPARATOR = "-";

/** `langtag`, with each part captured so the validity rules can read them. */
const LANGTAG = new RegExp(
    "^" +
        // language: 2–3 letters with up to three extlangs, 4 letters, or 5–8 letters
        "(?:[a-z]{2,3}(?:-[a-z]{3}){0,3}|[a-z]{4}|[a-z]{5,8})" +
        // script
        "(?:-[a-z]{4})?" +
        // region
        "(?:-(?:[a-z]{2}|[0-9]{3}))?" +
        // variants
        `((?:-(?:${ALPHANUM}{5,8}|[0-9]${ALPHANUM}{3}))*)` +
        // extensions: a singleton other than x, then subtags of 2–8
        `((?:-[0-9a-wy-z](?:-${ALPHANUM}{2,8})+)*)` +
        // private use
        `(?:-x(?:-${ALPHANUM}{1,8})+)?` +
        "$",
    "i",
);

/** A tag that is private use alone. */
const PRIVATE_USE = new RegExp(`^x(?:-${ALPHANUM}{1,8})+$`, "i");

/** RFC 5646's grandfathered tags, which the grammar does not otherwise admit. */
const GRANDFATHERED = new Set([
    "en-gb-oed",
    "i-ami",
    "i-bnn",
    "i-default",
    "i-enochian",
    "i-hak",
    "i-klingon",
    "i-lux",
    "i-mingo",
    "i-navajo",
    "i-pwn",
    "i-tao",
    "i-tay",
    "i-tsu",
    "sgn-be-fr",
    "sgn-be-nl",
    "sgn-ch-de",
    "art-lojban",
    "cel-gaulish",
    "no-bok",
    "no-nyn",
    "zh-guoyu",
    "zh-hakka",
    "zh-min",
    "zh-min-nan",
    "zh-xiang",
]);

/**
 * Whether a value is a BCP 47 language tag.
 *
 * @param {unknown} value - The value to test.
 * @returns {boolean} Whether it is a well-formed tag with no repeated variant
 *   or extension singleton.
 */
export function isLanguageTag(value) {
    if (typeof value !== "string" || value === "") return false;
    const tag = value.toLowerCase();
    if (GRANDFATHERED.has(tag) || PRIVATE_USE.test(tag)) return true;
    const match = LANGTAG.exec(tag);
    if (!match) return false;
    const variants = match[1].split(SUBTAG_SEPARATOR).filter(Boolean);
    if (new Set(variants).size !== variants.length) return false;
    const singletons = match[2].split(SUBTAG_SEPARATOR).filter((part) => part.length === 1);
    return new Set(singletons).size === singletons.length;
}
