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
 * Which package's notes this repository compiles, and which Foundry package
 * ships them — read from the repository's `package-build.config.yaml`.
 *
 * Both values are **derived**, not declared: `config.mjs` is the single place
 * the configuration is resolved (#1508). This module survives as the import
 * path the link resolver and the compilers have always used, so that the values
 * can still be mocked in one place and so no consumer has to learn a new
 * spelling for them.
 */

import { loadPackConfig } from "./pack-config.mjs";

/**
 * The **content** package: the distribution unit this repository's notes belong
 * to, and the **address namespace** every one of them is published under.
 *
 * It is the first segment of every canonical key (`sohl-skill-clmb`), the name
 * of the link manifest this build emits (`sohl.json`), and the package a
 * cross-package wikilink writes to reach one of these notes. So it is the
 * repository's identity in the address space, not a switch — and never dead
 * configuration, whatever else changes.
 *
 * It was also, until #56, a **selector**: a note declared the same value in its
 * `package:` frontmatter and the compilers kept the ones that matched. Every
 * content tree is single-package — each is single-sourced in the repository that
 * ships it — so the field restated this constant once per note while a value
 * that matched nothing filtered the whole tree out in silence. That field is
 * retired and declaring it now fails the build; this value stays, here, where
 * it is declared once.
 *
 * Stable across compilation targets. If this content were ever compiled for a
 * second game system, it would still be published as `sohl` — only the Foundry
 * package below would differ.
 *
 * An accessor rather than a hoisted constant, so that importing this module
 * needs no configuration (#2).
 *
 * @returns {string} The configured `contentPackage`.
 */
export function contentPackage() {
    return loadPackConfig().contentPackage;
}

/**
 * The **Foundry package** this repository's packs are shipped in — the `id` in
 * `assets/templates/system.template.json`, and the first segment of every
 * compendium UUID the compilers emit.
 *
 * Distinct from {@link contentPackage}, and equal to it only by coincidence
 * here: a note is published under `sohl` and its documents are addressed as
 * `Compendium.sohl.<pack>.<Type>.<id>`. In `sohl-thalorna` the two differ
 * (`thalorna` vs `sohl-thalorna`), which is why they are separate values rather
 * than one — treating them as interchangeable is what #1498 was.
 *
 * Configured rather than read from the manifest so the link resolver stays
 * filesystem-free and unit-testable. `assertPackageIdMatchesManifestFile` in
 * `package-manifest.mjs` — called from `generatePacksJson`, before any entry is
 * written — fails the build if this value and the manifest's `id` ever drift.
 *
 * An accessor rather than a hoisted constant, so that importing this module
 * needs no configuration (#2).
 *
 * @returns {string} The configured `foundryPackage`.
 */
export function foundryPackageId() {
    return loadPackConfig().foundryPackage;
}
