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
 * It is not a property of the note, and not a **selector**: as one, the compile loop
 * read `package:` out of frontmatter and skipped anything that did not match
 * the configured value. That is the defect this module exists to remove.
 * The skip was silent and it was bucketed as "belongs to another pass",
 * so a tree whose notes named a package no configuration answered to compiled
 * **zero notes and exited 0** — which is exactly the state the un-migrated
 * `hm-loc-*` / `hm-adv-*` repositories are in today.
 *
 * The field was retired in three steps, and all three have landed:
 *
 * 1. **Optional** (3.3.0). An absent `package:` was normal and a present one
 *    was accepted while it agreed. Non-breaking, so a consumer adopted it
 *    before changing a note.
 * 2. **Swept** out of every content tree on the org — 6,235 notes across
 *    `sohl`, `thalorna`, `kethira` and `harnensemble`.
 * 3. **Rejected outright**, as this major. A note declaring the field fails the
 *    build naming the file, whatever the value says.
 *
 * Step 3 is deliberately a rejection rather than continued tolerance: a field
 * accepted while it agrees is a field that grows back, one note at a time, and
 * every one of them is a line restating a constant the configuration already
 * carries. There is no value that makes writing it correct, so the diagnostic
 * says what to write instead rather than which value to change.
 *
 * SQL queries can refer to the configured package. Search readers receive that
 * derived value without adding a field to authored frontmatter.
 *
 * @module
 */

import { contentPackage } from "./content-package.mjs";
import { locateFrontmatterKey } from "./retired-fields.mjs";

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
 * configuration is as retired as one that disagrees, and an empty one
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
 * @param {string} [options.configured] - The package this build compiles.
 *   Defaults to the configured `contentPackage`.
 * @returns {void}
 * @throws {Error} When the note declares the field.
 */
export function assertNoDeclaredPackage(fm, { file, absPath, configured } = {}) {
    if (!fm || typeof fm !== "object" || !Object.hasOwn(fm, "package")) return;

    const target = configured ?? contentPackage();
    const declared = fm.package;
    const wrote =
        declared === null || declared === undefined || declared === "" ?
            "`package:`"
        :   `\`package: ${declared}\``;

    const err = new Error(
        `${wrote} is a retired frontmatter field — delete it` +
            (file ? ` — ${file}` : "") +
            `. A note's package is this repository's configured ` +
            `\`contentPackage\` ("${target}", in package-build.config.yaml), ` +
            `and every note in the tree belongs to it.`,
    );
    // Where the field is, so the caller's diagnostic opens on the line that has
    // to be deleted. Read here rather than carried through every walk: this is
    // the failing path, and the build stops on it.
    const position = locateFrontmatterKey(absPath, "package");
    if (position) err.position = position;
    throw err;
}
