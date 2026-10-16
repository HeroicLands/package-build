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

/**
 * Validate authored block syntax with positions in the original file.
 * Frontmatter is masked so literal YAML values cannot become body markup.
 * @param {string} source - Complete Markdown source, optionally with frontmatter.
 * @param {string} file - Diagnostic filename.
 * @returns {Array<{file: string, line: number, column: number, severity: string, message: string}>} Syntax errors.
 */
export function markupFindings(source, file) {
    const body = String(source ?? "").replace(
        /^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,
        (frontmatter) => frontmatter.replace(/[^\r\n]/g, " "),
    );
    return [...scanBlocks(body).errors, ...scanAlerts(body).errors].map((error) => ({
        file,
        ...error,
        severity: "error",
    }));
}
