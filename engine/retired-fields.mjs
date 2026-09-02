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
 * Frontmatter fields a note may no longer declare.
 *
 * A retired field has exactly two possible fates, and only one of them is
 * honest. Left honoured, it keeps doing whatever it did — which is why it was
 * retired. Left *ignored*, it reads to its author as though it still works: the
 * note says one thing and the build does another, and nothing says so. So a
 * retired field is **refused**, naming the file and the line, and the message
 * says what to write instead rather than which value to correct.
 *
 * `package:` is retired the same way and is refused from `note-package.mjs`,
 * where the concept it belonged to still lives. `draft:` has no such home —
 * there is no surviving concept it was part of — so it is refused here.
 *
 * **What `draft:` did (#69).** It excluded a note from the compiled packs, from
 * the link manifest and from a consuming site build. Nothing reported the
 * consequence: `content-links.mjs`, `site-index.mjs` and `content-lint.mjs`
 * never read the field, so a link into a drafted note was indistinguishable
 * from a link to a note that does not exist, and the checkers could not say
 * which. The field's entire effect was to move a note from *published* to
 * *unresolvable*, silently — and it also suppressed real build failures, since
 * a note the compilers never reached could not fail on the defects it carried.
 *
 * @module
 */

import fs from "node:fs";

import { positionInFrontmatter } from "./diagnostics.mjs";

/**
 * What a note declaring `draft:` is told, in one place.
 *
 * Written once and shared by the compile-time refusal and the frontmatter lint,
 * because an author meets whichever of the two runs first and they should read
 * the same. It says what the field did and what to write instead, rather than
 * which value to correct: no value makes declaring it right.
 *
 * @param {string} [file] - The note's path, named in the message. Omit it where
 *   the caller emits through a diagnostic, whose locator already starts the
 *   line — repeating it prints the path twice.
 * @returns {string} The message, unpunctuated at the end as a finding is.
 */
export function draftRetiredMessage(file) {
    return (
        "`draft:` is a retired frontmatter field — delete it" +
        (file ? ` — ${file}` : "") +
        ". It excluded the note from the compiled packs, the link manifest " +
        "and the site, and no checker reported the exclusion, so every " +
        "wikilink into it read as a link to a note that does not exist. To " +
        "mark a note as unfinished, tag it `#draft` instead: the build " +
        "ignores tags, and a `FROM #draft` query still finds it"
    );
}

/**
 * Refuse a note that declares `draft:` at all.
 *
 * Presence is the whole test. `draft: false` is as retired as `draft: true` —
 * it reads as "publish this note", which is what happens either way, and is
 * exactly the belief the message exists to correct.
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
 * @returns {void}
 * @throws {Error} When the note declares the field.
 */
export function assertNoDraftField(fm, { file, absPath } = {}) {
    if (!fm || typeof fm !== "object" || !Object.hasOwn(fm, "draft")) return;

    const err = new Error(`${draftRetiredMessage(file)}.`);
    // Where the field is, so the caller's diagnostic opens on the line that has
    // to be deleted. Read here rather than carried through every walk: this is
    // the failing path, and the build stops on it.
    const position = locateFrontmatterKey(absPath, "draft");
    if (position) err.position = position;
    throw err;
}

/**
 * A frontmatter key's position in a note's file, or nothing.
 *
 * {@link positionInFrontmatter} answers the same question from the file's
 * *text*; this reads the file to ask it. Kept apart from either caller because
 * both refusals need it and a second copy is a second thing to keep correct.
 *
 * @param {string|undefined} absPath - The note's file.
 * @param {string} key - The frontmatter key.
 * @param {string} [value] - When given, prefer the occurrence whose line also
 *   carries this text — so a finding about one entry of a block opens on that
 *   entry rather than on the key that introduces it.
 * @returns {{line?: number, column?: number}|undefined} Spreadable position
 *   fields, dropped rather than guessed when the file cannot be read or the key
 *   cannot be found — as `formatDiagnostic` requires.
 */
export function locateFrontmatterKey(absPath, key, value = undefined) {
    if (!absPath) return undefined;
    let raw;
    try {
        raw = fs.readFileSync(absPath, "utf8");
    } catch {
        return undefined;
    }
    const at = positionInFrontmatter(raw, key, value);
    return at.line === undefined ? undefined : at;
}
