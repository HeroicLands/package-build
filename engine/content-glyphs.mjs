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
 * The vocabulary of the two picture constructs a note writes for a sign.
 *
 * Both are spans, set in a line of text:
 *
 * ```
 * The name [Ra]{.glyph slug=ra} is written with one sign, and
 * [Au'Khelathu]{.cartouche slug=aukhelathu height=10rem align=right caption="Au'Khelathu"}
 * is sealed in a frame.
 * ```
 *
 * A span's label is its alt text; with an empty label the humanized slug
 * stands in. A cartouche's caption is an attribute.
 *
 * The picture is a file the package ships, addressed by the one pathname rule
 * every picture follows, so each target serves the address it can: `icons/<slug>.svg`
 * for a glyph and `images/cartouches/<slug>.svg` for a cartouche. Both
 * closed vocabularies below are refused when departed from, because an
 * attribute that cannot mean anything must not read as one that worked.
 *
 * @module
 */

/**
 * Text safe inside a double-quoted attribute or an element.
 * @param {string} value - Authored text.
 * @returns {string} The text with markup characters escaped.
 */
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** The frames a glyph may sit in. */
export const GLYPH_FRAMES = Object.freeze(["tablet"]);

/** The sizes a glyph may take. */
export const GLYPH_SIZES = Object.freeze(["inline", "block"]);

/** The sides a cartouche may float to; absent, it is centred. */
export const CARTOUCHE_ALIGNS = Object.freeze(["left", "right"]);

/** The attribute keys a glyph takes. */
export const GLYPH_KEYS = Object.freeze(["slug", "frame", "size"]);
/** The attribute keys a cartouche takes. */
export const CARTOUCHE_KEYS = Object.freeze(["slug", "align", "height", "caption"]);

/**
 * The units a cartouche height may be written in: every one a printed page
 * can honour as well as a screen.
 */
export const HEIGHT_UNITS = Object.freeze(["rem", "em", "px", "pt", "cm", "mm", "in"]);

const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const HEIGHT = new RegExp(`^(\\d+(?:\\.\\d+)?)(${HEIGHT_UNITS.join("|")})$`);

/**
 * The pathname of a glyph's picture.
 * @param {string} slug - The glyph's slug.
 * @returns {string} The authored pathname.
 */
export function glyphPathname(slug) {
    return `icons/${slug}.svg`;
}

/**
 * The pathname of a cartouche's picture.
 * @param {string} slug - The cartouche's slug.
 * @returns {string} The authored pathname.
 */
export function cartouchePathname(slug) {
    return `images/cartouches/${slug}.svg`;
}

/**
 * A slug as words, for the alt text of a sign whose author wrote none.
 * @param {string} slug - The slug.
 * @returns {string} Title-cased words.
 */
export function humanizeSlug(slug) {
    return String(slug)
        .split(/[-_]+/)
        .filter(Boolean)
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join(" ");
}

/**
 * What is wrong with an attribute list common to both constructs.
 * @param {{id: string, classes: string[], values: Record<string, string>}} parsed - The parsed attributes.
 * @param {string} noun - `glyph` or `cartouche`.
 * @param {readonly string[]} keys - The keys the construct takes.
 * @returns {string[]} One message per problem.
 */
function sharedProblems({ id, classes, values }, noun, keys) {
    const problems = [];
    if (id) problems.push(`a ${noun} takes no #id`);
    for (const name of classes.filter((name) => name !== noun))
        problems.push(`a ${noun} takes no class besides .${noun}; .${name} is not one`);
    for (const key of Object.keys(values))
        if (!keys.includes(key) && !/^on/i.test(key) && !["id", "class"].includes(key))
            problems.push(`a ${noun} takes ${keys.join(", ")}; \`${key}\` is not one of them`);
    if (!Object.hasOwn(values, "slug"))
        problems.push(`a ${noun} needs slug="…" naming its picture`);
    else if (!SLUG.test(values.slug))
        problems.push(`slug \`${values.slug}\` must be letters, digits, \`-\` and \`_\``);
    return problems;
}

/**
 * What is wrong with a glyph's attributes.
 * @param {{id: string, classes: string[], values: Record<string, string>}} parsed - The parsed attributes.
 * @returns {string[]} One message per problem.
 */
export function glyphProblems(parsed) {
    const problems = sharedProblems(parsed, "glyph", GLYPH_KEYS);
    const { values } = parsed;
    if (Object.hasOwn(values, "alt"))
        problems.splice(
            problems.findIndex((message) => message.includes("`alt`")),
            1,
            "write a glyph's alt text as its label: [alt text]{.glyph slug=…}",
        );
    if (Object.hasOwn(values, "frame") && !GLYPH_FRAMES.includes(values.frame))
        problems.push(`frame \`${values.frame}\` is not one of ${GLYPH_FRAMES.join(", ")}`);
    if (Object.hasOwn(values, "size") && !GLYPH_SIZES.includes(values.size))
        problems.push(`size \`${values.size}\` is not one of ${GLYPH_SIZES.join(", ")}`);
    return problems;
}

/**
 * What is wrong with a cartouche's attributes.
 * @param {{id: string, classes: string[], values: Record<string, string>}} parsed - The parsed attributes.
 * @returns {string[]} One message per problem.
 */
export function cartoucheProblems(parsed) {
    const { values } = parsed;
    const problems = sharedProblems(parsed, "cartouche", CARTOUCHE_KEYS);
    if (Object.hasOwn(values, "alt"))
        problems.splice(
            problems.findIndex((message) => message.includes("`alt`")),
            1,
            "write a cartouche's alt text as its label: [alt text]{.cartouche slug=…}",
        );
    if (Object.hasOwn(values, "align") && !CARTOUCHE_ALIGNS.includes(values.align))
        problems.push(`align \`${values.align}\` is not one of ${CARTOUCHE_ALIGNS.join(", ")}`);
    if (Object.hasOwn(values, "height") && !HEIGHT.test(values.height))
        problems.push(
            `height \`${values.height}\` must be a number in ${HEIGHT_UNITS.join(", ")}, such as 10rem`,
        );
    return problems;
}

/**
 * A cartouche's height as Typst writes a length.
 * @param {string} height - A validated CSS length.
 * @returns {string} The same length in a unit Typst reads.
 */
export function typstLength(height) {
    const [, number, unit] = HEIGHT.exec(height);
    if (unit === "rem") return `${number}em`;
    if (unit === "px") return `${Number(number) * 0.75}pt`;
    return `${number}${unit}`;
}

/**
 * A glyph as HTML.
 * @param {{slug: string, alt: string, frame?: string, size?: string}} glyph - Its attributes.
 * @param {string} src - The address the target serves its picture at.
 * @returns {string} A span holding an image.
 */
export function glyphHtml({ slug, alt, frame, size }, src) {
    const classes = [
        "glyph",
        ...(frame ? [`glyph-${frame}`] : []),
        ...(size ? [`glyph-${size}`] : []),
    ];
    return `<span class="${classes.join(" ")}"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt || humanizeSlug(slug))}" loading="lazy" /></span>`;
}

/**
 * A cartouche as HTML.
 * @param {{slug: string, alt?: string, align?: string, height?: string, caption?: string}} cartouche - Its attributes.
 * @param {string} src - The address the target serves its picture at.
 * @returns {string} A figure holding an image and an optional caption, on one
 *   line so that it sits inside a paragraph without ending it.
 */
export function cartoucheHtml({ slug, alt, align, height, caption }, src) {
    const style =
        height ? ` style="height: ${escapeHtml(height)}; width: auto; max-width: none;"` : "";
    return [
        `<figure class="cartouche${align ? ` cartouche-${align}` : ""}">`,
        `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt || humanizeSlug(slug))}" loading="lazy"${style} />`,
        ...(caption ? [`<figcaption>${escapeHtml(caption)}</figcaption>`] : []),
        "</figure>",
    ].join("");
}
