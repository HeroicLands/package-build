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
 * The owned CDN origin, re-exported by site-config beside the chrome addresses.
 * Kept in a leaf because site-config reaches pathnames through configuration and
 * content rendering; importing site-config from pathnames would close that cycle.
 *
 * @module
 */

/** The canonical public origin whose asset URLs follow the selected build host. */
export const CANONICAL_CDN_ORIGIN = "https://cdn.heroiclands.org";
