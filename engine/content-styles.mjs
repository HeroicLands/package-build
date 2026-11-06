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
 * **The shared rules of the content stylesheet**, rescoped for a surface that
 * is not Foundry.
 *
 * `assets/styles/content-base.css` styles what the renderer emits, scoped to
 * the roots a Foundry journal and its editors use. Two other surfaces reuse its
 * rules without a second copy: the editor preview takes the stretches marked
 * `preview:shared`, and a site takes the highlighted-code rules. Both read the
 * one file and replace the scope, so a colour changed there changes everywhere.
 *
 * @module
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { baseStylesheetSource } from "./base-styles.mjs";

/** The roots the shipped content stylesheet scopes its rules to. */
export const CONTENT_ROOTS =
    ":is(.journal-entry-page, .journal-entry-content, .editor-content, .prosemirror)";

/** The stretches of the shipped content stylesheet other surfaces share. */
const SHARED_RULES = /\/\* preview:shared [^]*?\*\/([^]*?)\/\* \/preview:shared \*\//g;

/**
 * The rules the Foundry content stylesheet shares with other surfaces, scoped
 * to a selector.
 *
 * @param {string} scope - The selector that replaces the Foundry roots.
 * @returns {string} The rules.
 * @throws {Error} When the stylesheet marks no shared rules.
 */
export function sharedContentRules(scope) {
    const css = fs.readFileSync(baseStylesheetSource(), "utf8");
    const shared = [...css.matchAll(SHARED_RULES)].map((match) => match[1]);
    if (!shared.length) throw new Error("the content stylesheet marks no rules for the preview");
    return shared.join("").replaceAll(CONTENT_ROOTS, scope);
}

/**
 * The rules that colour highlighted code, scoped to a selector.
 *
 * A rule belongs to the set when one of its selectors names a `hljs-` token
 * class. The rules are taken from the shared stretches, so the colours, their
 * custom properties and their `light-dark()` pairs are the stylesheet's own.
 *
 * @param {string} scope - The selector that replaces the Foundry roots.
 * @returns {string} The token rules, one per block.
 */
export function highlightRules(scope) {
    const shared = sharedContentRules(scope)
        .replace(/\/\*[^]*?\*\//g, "")
        .replace(/\s*\n\s+(?=\.hljs-)/g, " ");
    return (
        shared
            .split("}")
            .map((rule) => rule.trim())
            .filter(
                (rule) => rule.includes("{") && /\.hljs-/.test(rule.slice(0, rule.indexOf("{"))),
            )
            .map((rule) => `${rule}\n}`)
            .join("\n\n") + "\n"
    );
}

/**
 * The stylesheet a site links for highlighted code.
 *
 * A site sets no colour scheme, and the token colours are `light-dark()` pairs
 * that read the scheme in force, so code is given the dark one its pages are
 * drawn in.
 *
 * @param {string} [scope] - The element the page body sits in.
 * @returns {string} The stylesheet.
 */
export function siteCodeStylesheet(scope = ".single-body") {
    return `${scope} :is(pre, code) {\n    color-scheme: dark;\n}\n\n${highlightRules(scope)}`;
}

/** The stretches of the site theme's stylesheet that style a page body. */
const NOTE_BODY_RULES = /\/\* note-body \*\/([^]*?)\/\* \/note-body \*\//g;

/**
 * The page-wide rules the site theme writes for the whole document, and the
 * selector each is given for a body shown on its own: the reset, the root
 * size the theme's `rem` lengths are measured against, the body's text and
 * the ordinary link. `keep` names the declarations that carry over; a rule
 * without one carries over whole.
 */
const PAGE_RULES = Object.freeze([
    {
        from: "*, *::before, *::after",
        to: ".single-content, .single-content *, .single-content *::before, .single-content *::after",
    },
    { from: "html", to: ":root", keep: ["font-size"] },
    {
        from: "body",
        to: ".single-content",
        keep: [
            "font-family",
            "font-weight",
            "line-height",
            "color",
            "background",
            "-webkit-font-smoothing",
        ],
    },
    { from: "a", to: ".single-content a" },
    { from: "a:hover", to: ".single-content a:hover" },
]);

/**
 * One page-wide rule of the theme, given the selector a body shown on its own
 * takes.
 *
 * @param {string} css - The theme's stylesheet.
 * @param {{from: string, to: string, keep?: readonly string[]}} rule - Which
 *   rule, and how it carries over.
 * @returns {string} The rule.
 * @throws {Error} When the stylesheet has no such rule.
 */
function scopedPageRule(css, { from, to, keep }) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const found = new RegExp(`^${escaped} \\{([^}]*)\\}`, "m").exec(css);
    if (!found) throw new Error(`the site stylesheet has no \`${from}\` rule for a page body`);
    const declarations = found[1]
        .split(";")
        .map((declaration) => declaration.trim())
        .filter(Boolean)
        .filter((declaration) => !keep || keep.includes(declaration.split(":")[0].trim()));
    return `${to} {\n${declarations.map((declaration) => `  ${declaration};`).join("\n")}\n}`;
}

/**
 * The CSS the site theme applies to a page body: its custom properties, the
 * body's text, named blocks, figures, verse, footnotes, unresolved and draft
 * links, cartouches, glyphs, alerts, spoilers, dictionary lists and faces,
 * then the highlighted-code rules a site links as `css/code.css`.
 *
 * Read from the theme's own stylesheet, the stretches it marks `note-body`,
 * so a rule changed there changes here. The rules are scoped as the theme
 * scopes them: the body sits in a `.single-body` inside a `.single-content`.
 * The theme's page-wide rules for the reset, the body's typography and the
 * ordinary link come first, scoped to `.single-content`, so a body set in that
 * wrapper reads as the page does whatever the host's own styles; the one
 * exception is the root font size, set on `:root`, since every length the
 * theme writes in `rem` is measured against it.
 *
 * @returns {string} The stylesheet.
 * @throws {Error} When the theme's stylesheet marks no body rules, or lacks
 *   one of the page-wide rules.
 */
export function noteBodyStylesheet() {
    const css = fs.readFileSync(
        fileURLToPath(new URL("../site-theme/static/css/style.css", import.meta.url)),
        "utf8",
    );
    const rules = [...css.matchAll(NOTE_BODY_RULES)].map((match) => match[1].trim());
    if (!rules.length) throw new Error("the site stylesheet marks no rules for a page body");
    const page = PAGE_RULES.map((rule) => scopedPageRule(css, rule));
    return `${[...page, ...rules].join("\n\n")}\n\n${siteCodeStylesheet()}`;
}
