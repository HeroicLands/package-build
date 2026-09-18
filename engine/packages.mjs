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
 * The `<package>` segment's own registry: the names no repository may claim.
 *
 * A content package names itself, so the registry is open — and exactly one
 * name is held back from it.
 *
 * **`packagebuild` is a package that is not a package.** package-build is an npm
 * package rather than a system or a module, and it ships a set of images —
 * section banners chiefly — that many packages draw on. Addressing them as
 * `packagebuild-none-image-<shortcode>` lets a note reach one without declaring a
 * dependency on some parent system or module it otherwise has no relationship
 * with, which is the whole point: the alternative is every package depending on
 * one of the others just to borrow a banner.
 *
 * So nothing may create a real package that collides with the name, and its
 * resolution is special-cased, because no installed directory sits behind it.
 *
 * This module is a **leaf with no local imports**, so the configuration
 * validator can name it without closing a cycle around `content-config.mjs`.
 *
 * @module
 */

/**
 * The address namespace package-build's own assets publish under.
 *
 * @type {string}
 */
export const PACKAGEBUILD_PACKAGE = "packagebuild";

/**
 * Every package name a repository may not claim.
 *
 * @type {ReadonlySet<string>}
 */
export const RESERVED_PACKAGES = Object.freeze(new Set([PACKAGEBUILD_PACKAGE]));

/**
 * Whether a package name is held back from the open registry.
 *
 * @param {unknown} pkg - The candidate `contentPackage`.
 * @returns {boolean} True when the name is reserved.
 */
export function isReservedPackage(pkg) {
    return typeof pkg === "string" && RESERVED_PACKAGES.has(pkg.toLowerCase());
}
