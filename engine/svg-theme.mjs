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
 * A staged SVG follows the reader's colour scheme.
 *
 * An icon drawn as black line art disappears against a dark background, and
 * Foundry themes its own chrome. So a shape that is explicitly black, or black
 * by default because it declares no `fill`, gets a rule that paints it the
 * ink colour for the scheme in use.
 *
 * **Named rather than pathed.** `packageBuild.assetTransform: svg-theme`
 * reaches this module. Every package that themes its icons themes them the same
 * way — the ink colours are the system's text tokens — so the transform is one
 * implementation here rather than a copy in each consumer, where the copies
 * drift and nobody sees all of them at once.
 *
 * @module
 */

import { readFileSync } from "node:fs";

/**
 * Iron-gall ink, and cream against a dark ground.
 *
 * These mirror `--sohl-color-text-primary` in the system's
 * `scss/abstracts/_tokens.scss`. Stated once here, so a token change is one
 * edit rather than one per consuming repository.
 *
 * @type {string}
 */
const INK_LIGHT = "#211d16";

/** @type {string} */
const INK_DARK = "#ece3cf";

/**
 * The shapes a theme rule may repaint.
 *
 * Explicitly black, or black by default for want of a `fill`. A shape painted
 * some other colour is deliberate — a white highlight in a two-tone badge — and
 * repainting it would destroy the drawing.
 *
 * @type {string}
 */
const SELECTOR = [
    '[fill="#000"]',
    '[fill="#000000"]',
    '[fill="black"]',
    "path:not([fill])",
    "rect:not([fill])",
    "circle:not([fill])",
    "ellipse:not([fill])",
    "polygon:not([fill])",
    "polyline:not([fill])",
    "line:not([fill])",
    "g:not([fill])",
].join(",");

/** @type {string} */
const STYLE =
    `<style>${SELECTOR}{fill:${INK_LIGHT}}` +
    `@media(prefers-color-scheme:dark){${SELECTOR}{fill:${INK_DARK}}}</style>`;

/**
 * Every `style="…"` attribute, capturing its declarations.
 *
 * @type {RegExp}
 */
const STYLE_ATTR = /style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/**
 * A `fill` *declaration* — the property itself, at the start or after a `;`.
 *
 * Deliberately not `\bfill\b`, which also matches `fill-rule`, `fill-opacity`
 * and `paint-order: fill`, none of which set a colour.
 *
 * @type {RegExp}
 */
const FILL_DECL = /(?:^|;)\s*fill\s*:/i;

/**
 * Whether any shape sets its fill inline.
 *
 * @param {string} svg - The SVG source.
 * @returns {boolean} Whether an inline `fill` declaration is present.
 */
function hasInlineFill(svg) {
    for (const [, dq, sq] of svg.matchAll(STYLE_ATTR)) {
        if (FILL_DECL.test(dq ?? sq ?? "")) return true;
    }
    return false;
}

/**
 * The SVG with a scheme-aware fill rule, or unchanged where one cannot apply.
 *
 * Three files are returned as they are. One already carrying a
 * `prefers-color-scheme` rule is themed — by this pass on an earlier run, or by
 * its author — and re-theming it would stack rules. One with an inline `fill`
 * cannot be themed at all, because an inline declaration beats a `<style>` rule
 * and the result would be a half-recoloured icon, which is worse than an
 * unthemed one. One with no `<svg>` element is not an SVG.
 *
 * @param {string} svg - The SVG source.
 * @returns {string} The themed source, or the input unchanged.
 */
export function injectAdaptiveFill(svg) {
    if (typeof svg !== "string") return svg;
    if (svg.includes("prefers-color-scheme")) return svg;
    if (hasInlineFill(svg)) return svg;

    const open = svg.match(/<svg\b[^>]*>/i);
    if (!open) return svg;

    const at = open.index + open[0].length;
    return svg.slice(0, at) + STYLE + svg.slice(at);
}

/**
 * The staging hook: theme an SVG, and pass everything else through untouched.
 *
 * @param {string} sourcePath - The file being staged.
 * @returns {string|null} The themed source, or `null` to stage the file as it
 *   is — which is what every non-SVG asset gets.
 */
export function transform(sourcePath) {
    if (!sourcePath.endsWith(".svg")) return null;
    return injectAdaptiveFill(readFileSync(sourcePath, "utf8"));
}
