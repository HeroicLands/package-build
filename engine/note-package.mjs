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
 * Which content package a note belongs to.
 *
 * **It is the repository's configured `contentPackage`, and nothing else.** A
 * content tree holds exactly one package's notes — every package is
 * single-sourced in the repository that ships it — so the package is a property
 * of the *repository*, not of the note, and no note declares it.
 *
 * It is not a property of the note, and not a **selector**: a compile loop that
 * skipped notes naming another package would compile zero notes and exit 0 on a
 * tree whose notes named a package no configuration answered to. A note
 * declaring the field fails the build naming the file, whatever the value
 * says: there is no value that makes writing it correct, so the diagnostic
 * says what to write instead rather than which value to change.
 *
 * SQL queries can refer to the configured package. Search readers receive that
 * derived value without adding a field to authored frontmatter.
 *
 * @module
 */

import { contentPackage } from "./content-package.mjs";
import { locateFrontmatterKey } from "./diagnostics.mjs";

/**
 * A copy of frontmatter carrying the configured package for query evaluation.
 * @param {object|null|undefined} fm - Parsed frontmatter.
 * @param {string} [configured] - The package this build compiles.
 * @returns {object|null|undefined} Frontmatter with a derived package value.
 */
export function searchableFrontmatter(fm, configured) {
    if (!fm || typeof fm !== "object") return fm;
    return { ...fm, package: configured ?? contentPackage() };
}

/**
 * Refuse a note that declares `package:` at all.
 *
 * Presence is the whole test — a declaration that *agrees* with the
 * configuration is refused like one that disagrees, and an empty one
 * (`package:`, which parses as `null`) is still the field.
 *
 * @param {object|null|undefined} fm - Parsed frontmatter, or nothing when it
 *   could not be parsed.
 * @param {object} [options] - Options.
 * @param {string} [options.file] - The note's path, named in the message. Omit
 *   it where the caller emits through a diagnostic, which puts the locator at
 *   the start of the line already — repeating it prints the path twice.
 * @param {string} [options.absPath] - The note's file on disk, read only on the
 *   failing path to locate the offending line and column. The position rides on
 *   the thrown error as `position`, for a caller that emits a diagnostic.
 * @param {string} [options.raw] - Source text already read by the caller.
 * @param {string} [options.configured] - The package this build compiles.
 *   Defaults to the configured `contentPackage`.
 * @returns {void}
 * @throws {Error} When the note declares the field.
 */
export function assertNoDeclaredPackage(fm, { file, absPath, configured, raw } = {}) {
    if (!fm || typeof fm !== "object" || !Object.hasOwn(fm, "package")) return;

    const target = configured ?? contentPackage();
    const declared = fm.package;
    const wrote =
        declared === null || declared === undefined || declared === "" ?
            "`package:`"
        :   `\`package: ${declared}\``;

    const err = new Error(
        `${wrote} is not a frontmatter field — delete it` +
            (file ? ` — ${file}` : "") +
            `. A note's package is this repository's configured ` +
            `\`contentPackage\` ("${target}", in package-build.config.yaml), ` +
            `and every note in the tree belongs to it.`,
    );
    const position = locateFrontmatterKey(absPath, "package", undefined, { raw });
    if (position) err.position = position;
    throw err;
}
