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
 * **It is the repository's configured `contentPackage`.** A content tree holds
 * exactly one package's notes — every package is single-sourced in the
 * repository that ships it — so the package is a property of the *repository*,
 * not of the note.
 *
 * It used to be a property of the note, and a **selector**: the compile loop
 * read `package:` out of frontmatter and skipped anything that did not match
 * the configured value. That is the defect this module exists to remove
 * (#56). The skip was silent and it was bucketed as "belongs to another pass",
 * so a tree whose notes named a package no configuration answered to compiled
 * **zero notes and exited 0** — which is exactly the state the un-migrated
 * `hm-loc-*` / `hm-adv-*` repositories are in today.
 *
 * So the field is being retired, in three steps, of which this is the first:
 *
 * 1. **Optional here.** An absent `package:` is normal and the note compiles; a
 *    present one is accepted while it agrees, and is a loud, named error when
 *    it does not. Non-breaking, so a consumer adopts it before changing a note.
 * 2. **Swept** out of every content tree in the org, on this version.
 * 3. **Rejected outright**, as a major, once the sweeps have merged.
 *
 * The distinction between the two functions here is which question is being
 * asked. {@link assertNotePackage} is for a site that used to *select* — it
 * answers "may this build compile this note", and a disagreement is a finding.
 * {@link notePackage} is for a site that *derives an address* — it answers
 * "which package's namespace does this address sit in", where a disagreement
 * has already been reported by the compile pass and repeating it would print
 * the same fault twice.
 *
 * @module
 */

import { contentPackage } from "./content-package.mjs";

/**
 * The package a note belongs to.
 *
 * Non-validating: the answer for a note that declares nothing, and for one that
 * declares the configured package, is the same value. A note declaring some
 * *other* package is answered literally here rather than corrected — the
 * compile pass reports that, once, through {@link assertNotePackage}.
 *
 * @param {object|null|undefined} fm - Parsed frontmatter, or nothing when it
 *   could not be parsed.
 * @param {string} [configured] - The package this build compiles. Defaults to
 *   the configured `contentPackage`; passed explicitly by callers that already
 *   carry it in a context object, so a caller's configuration drives every read.
 * @returns {string} The package.
 */
export function notePackage(fm, configured) {
    const declared = fm?.package;
    // A blank is a declaration of nothing, not a package named "".
    if (declared != null && declared !== "") return declared;
    // Resolved only when it is needed, so a caller holding a note that declares
    // one never touches the configuration (#2).
    return configured ?? contentPackage();
}

/**
 * A note's frontmatter as a generated table searches it — its package present
 * whether or not the note declares one.
 *
 * A `dataview` query resolves `package` out of frontmatter like any other
 * field, so a collection note that scopes itself with `WHERE … and package =
 * "sohl"` matches nothing once the field is deleted, and renders an **empty
 * table** in silence. Deriving the value here keeps the two spellings
 * equivalent, so a sweep that deletes the field is mechanical rather than a
 * trap (#56) — and a query that never mentions `package` is unaffected either
 * way.
 *
 * The declared value is left alone when there is one, so nothing about an
 * unswept tree changes.
 *
 * @param {object|null|undefined} fm - Parsed frontmatter.
 * @param {string} [configured] - The package this build compiles.
 * @returns {object|null|undefined} The frontmatter itself when it declares a
 *   package, else a shallow copy carrying the derived one.
 */
export function searchableFrontmatter(fm, configured) {
    if (!fm || typeof fm !== "object") return fm;
    if (fm.package != null && fm.package !== "") return fm;
    return { ...fm, package: notePackage(fm, configured) };
}

/**
 * The package a note belongs to, refusing one that names another package.
 *
 * @param {object|null|undefined} fm - Parsed frontmatter.
 * @param {object} [options] - Options.
 * @param {string} [options.file] - The note's path, named in the message. Omit
 *   it where the caller emits through a diagnostic, which puts the locator at
 *   the start of the line already — repeating it prints the path twice.
 * @param {string} [options.configured] - The package this build compiles.
 *   Defaults to the configured `contentPackage`.
 * @returns {string} The package, which is always `configured`.
 * @throws {Error} When the note declares a different package.
 */
export function assertNotePackage(fm, { file, configured } = {}) {
    const target = configured ?? contentPackage();
    const pkg = notePackage(fm, target);
    if (pkg === target) return target;
    throw new Error(
        `note declares \`package: ${pkg}\`, but this repository compiles ` +
            `"${target}"` +
            (file ? ` — ${file}` : "") +
            `. A note's package is the configured \`contentPackage\`, so the ` +
            `field is redundant and is being retired: delete it, or correct ` +
            `\`contentPackage\` in package-build.config.yaml.`,
    );
}
