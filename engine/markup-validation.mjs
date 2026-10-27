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

import { scanBlocks } from "./content-blocks.mjs";
import { scanAlerts } from "./content-alerts.mjs";
import { scanRuns } from "./content-scripts.mjs";
import { matchAllOutsideCode } from "./code-fences.mjs";

/** The opening of a shortcode: `{{<` or `{{%`. */
const SHORTCODE = /\{\{[<%]/g;

/**
 * Locate every shortcode outside code.
 * @param {string} body - Markdown with its frontmatter masked.
 * @returns {Array<{line: number, column: number, message: string}>} One error per shortcode.
 */
function shortcodeErrors(body) {
    return matchAllOutsideCode(body, SHORTCODE).map((match) => {
        const before = body.slice(0, match.index);
        return {
            line: before.split("\n").length,
            column: match.index - before.lastIndexOf("\n"),
            message: "A shortcode is not supported; write `[x]{.glyph}` or `[signs]{.cartouche}`",
        };
    });
}

/**
 * Validate authored block syntax with positions in the original file.
 * Frontmatter is masked so literal YAML values cannot become body markup.
 * @param {string} source - Complete Markdown source, optionally with frontmatter.
 * @param {string} file - Diagnostic filename.
 * @param {import("./content-session.mjs").ContentSyntax} [syntax] - Exact-text scanner projections.
 * @param {import("./content-scripts.mjs").RunContext} [runs] - The package's
 *   languages, faces and maps. Given, text marked with `lang=`, `font=` and
 *   `enc=` is checked against them; a caller with no package configuration
 *   leaves it out.
 * @returns {Array<{file: string, line: number, column: number, severity: string, message: string}>} Syntax errors,
 *   then warnings.
 */
export function markupFindings(source, file, syntax, runs) {
    const body = String(source ?? "").replace(
        /^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,
        (frontmatter) => frontmatter.replace(/[^\r\n]/g, " "),
    );
    const scanned = syntax?.(body);
    const marked = runs ? scanRuns(body, runs, syntax) : undefined;
    const errors = [
        ...(scanned?.blocks ?? scanBlocks(body)).errors,
        ...(scanned?.alerts ?? scanAlerts(body)).errors,
        ...(marked?.errors ?? []),
        ...shortcodeErrors(body),
    ].map((error) => ({
        file,
        ...error,
        severity: "error",
    }));
    const warnings = (marked?.warnings ?? []).map((warning) => ({
        file,
        ...warning,
        severity: "warning",
    }));
    return [...errors, ...warnings];
}
