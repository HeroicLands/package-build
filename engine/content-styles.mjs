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
