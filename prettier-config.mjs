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
 * The shared Prettier configuration, as a Prettier config module.
 *
 * `content-build format` already applies these rules without a consumer
 * declaring anything, so this exists for the **editor**: a format-on-save that
 * disagrees with the lint chain is a papercut every contributor hits, and
 * Prettier's editor integrations read a config file rather than asking this
 * package. A consumer gets both to agree with one line:
 *
 * ```js
 * // prettier.config.mjs
 * export { default } from "@heroiclands/package-build/prettier";
 * ```
 *
 * Declaring it this way is still a local config, so it wins over the shipped
 * default in the usual way — it just happens to be the same object.
 *
 * @module
 */

export { PRETTIER_CONFIG as default } from "./engine/prose-config.mjs";
