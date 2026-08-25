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
 * The shared markdownlint rules, as a markdownlint-cli2 options module.
 *
 * `content-build markdown` applies these without a consumer declaring
 * anything; this is for an editor's markdownlint extension, and for a consumer
 * that wants to *extend* the set rather than replace it:
 *
 * ```js
 * // .markdownlint-cli2.mjs
 * import shared from "@heroiclands/package-build/markdownlint";
 * export default { ...shared, config: { ...shared.config, MD013: true } };
 * ```
 *
 * Spread rather than mutated: {@link MARKDOWNLINT_CONFIG} is frozen, so a
 * consumer that edited it in place would fail loudly rather than change the
 * rules for everything else in its process.
 *
 * @module
 */

import {
    MARKDOWNLINT_CONFIG,
    MARKDOWN_GLOBS,
    MARKDOWN_IGNORES,
} from "./engine/prose-config.mjs";

export default {
    config: MARKDOWNLINT_CONFIG,
    globs: [...MARKDOWN_GLOBS],
    ignores: [...MARKDOWN_IGNORES],
    gitignore: true,
};
