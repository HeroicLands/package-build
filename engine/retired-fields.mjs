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
 * where the concept it belonged to still lives. `draft:` and the two spellings
 * of the alias list have no such home — there is no surviving concept either
 * was part of — so they are refused here.
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
 * **What `aliases:` and `name.aliases:` did (#180).** They fed the alias index,
 * which is what a bare `[[Alias]]` was looked up in. That form resolved to
 * nothing anywhere in the corpus, while the collision rule guarding it folded
 * in every note's `name.full` and so decided what a note could be named (#179).
 * The form and the index are retired together, leaving the fields with no
 * reader at all.
 *
 * **A field retired in favour of another is a third case (#142).** `draft:` and
 * `package:` were retired outright: nothing replaced them, so no value made
 * writing one right and refusal was the only honest answer. A *renamed* field
 * has a replacement, and the two spellings mean the same thing — so the note
 * still compiles, correctly, and refusing it would fail a build over a document
 * that is not wrong. Those retire in the three steps `package:` took (#56), and
 * this module carries the **first**: both spellings are read, the current one
 * wins, and the retired one is *reported* rather than refused. The sweep and
 * the refusal come later, once no tree writes it. See
 * {@link RETIRED_FIELD_ALIASES}.
 *
 * @module
 */

import fs from "node:fs";

import { positionInFrontmatter } from "./diagnostics.mjs";
import { sohlField } from "./frontmatter.mjs";

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
        "mark a note as unfinished, tag it `#draft` instead: the note still " +
        "compiles and publishes, a link into it renders marked, and a " +
        "`FROM #draft` query still finds it"
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
 * The two spellings of the retired alias list, in the order they are looked
 * for. Both named a note in the alias namespace; neither has a reader left.
 *
 * @type {readonly string[]}
 */
const ALIAS_FIELDS = Object.freeze(["aliases", "name.aliases"]);

/**
 * What a note declaring `aliases:` or `name.aliases:` is told, in one place.
 *
 * Shared by the compile-time refusal and the frontmatter lint, because an
 * author meets whichever of the two runs first and they should read the same.
 * It says what the field fed and what to write instead, rather than which value
 * to correct: no value makes declaring it right.
 *
 * **What they did (#180).** They were the authored half of the alias index —
 * the namespace a bare `[[Alias]]` was looked up in. Across the three content
 * trees not one bare link resolved through it, while the collision rule that
 * kept it unambiguous folded in every note's `name.full` and so dictated what a
 * note could be named (#179). The form is retired, so the fields feed nothing.
 *
 * @param {string} field - The spelling the note used, named in the message.
 * @param {string} [file] - The note's path, named in the message. Omit it where
 *   the caller emits through a diagnostic, whose locator already starts the
 *   line — repeating it prints the path twice.
 * @returns {string} The message, unpunctuated at the end as a finding is.
 */
export function aliasesRetiredMessage(field, file) {
    return (
        `\`${field}:\` is a retired frontmatter field — delete it` +
        (file ? ` — ${file}` : "") +
        ". It listed names the bare `[[Alias]]` form could cite, and that " +
        "form is retired: every wikilink is now an address, written " +
        "`[[type-shortcode|Text]]`. Nothing else ever read the list"
    );
}

/**
 * Refuse a note that declares either spelling of the alias list.
 *
 * Presence is the whole test. `aliases: []` is as retired as a populated one —
 * it reads as "this note claims no other names", a statement about a namespace
 * that no longer exists.
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
 * @throws {Error} When the note declares either field.
 */
export function assertNoAliasesField(fm, { file, absPath } = {}) {
    const declared = declaredAliasField(fm);
    if (!declared) return;

    const err = new Error(`${aliasesRetiredMessage(declared, file)}.`);
    // Both spellings write the key `aliases`; the nested one simply writes it
    // indented under `name:`, so one locator finds either.
    const position = locateFrontmatterKey(absPath, "aliases");
    if (position) err.position = position;
    throw err;
}

/**
 * Which spelling of the alias list a note declares, or nothing.
 *
 * @param {object|null|undefined} fm - Parsed frontmatter.
 * @returns {string|undefined} `"aliases"`, `"name.aliases"`, or nothing.
 */
export function declaredAliasField(fm) {
    if (!fm || typeof fm !== "object") return undefined;
    if (Object.hasOwn(fm, "aliases")) return ALIAS_FIELDS[0];
    const name = fm.name;
    if (
        name &&
        typeof name === "object" &&
        !Array.isArray(name) &&
        Object.hasOwn(name, "aliases")
    ) {
        return ALIAS_FIELDS[1];
    }
    return undefined;
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

/* -------------------------------------------------------------------- */
/*  Retired *in favour of another field*                                 */
/* -------------------------------------------------------------------- */

/**
 * The current field name a retired spelling was renamed to.
 *
 * Keyed by the **current** name, because that is what a type's schema declares
 * and what every reader asks for; the value is the spelling still honoured.
 * The table is therefore scoped by the schema without saying so twice: an alias
 * applies to a note only where that note's type declares the current field, so
 * `image` is retired on a map — which declares `img` — and remains an unknown
 * key anywhere else.
 *
 * **`img` (#142).** Every note type names its artwork `img`, at the note's top
 * level, and resolves it the same way. A map alone named its background art
 * `image` and read it out of the `sohl:` block — two spellings for one idea,
 * with nothing to reconcile them, and a specification that had to hedge rather
 * than state a rule. Art is not system-specific: a Scene is a core Foundry
 * document and HM3 would want the identical one, so the field belongs beside
 * every other note's `img`, not inside a system block.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const RETIRED_FIELD_ALIASES = Object.freeze({ img: "image" });

/**
 * What a note writing a renamed field is told, in one place.
 *
 * Shared by the compile-time report and the frontmatter lint, because an author
 * meets whichever runs first and they should read the same. It names the key to
 * write rather than a value to correct — no value makes the retired spelling
 * right — and it says the note compiles either way, so a reader knows this is a
 * rename to schedule rather than a build to unbreak.
 *
 * @param {string} retired - The spelling the note used.
 * @param {string} current - What to write instead.
 * @param {string} [file] - The note's path, named in the message. Omit it where
 *   the caller emits through a diagnostic, whose locator already starts the
 *   line — repeating it prints the path twice.
 * @returns {string} The message, unpunctuated at the end as a finding is.
 */
export function retiredAliasMessage(retired, current, file) {
    return (
        `\`${retired}:\` is a retired frontmatter field — write \`${current}:\` ` +
        `instead` +
        (file ? ` — ${file}` : "") +
        `. Both are read and \`${current}\` wins, so the note compiles ` +
        `identically either way; \`${retired}\` is removed in a later release`
    );
}

/**
 * Whether a note writes the retired spelling of a field, wherever it put it.
 *
 * Both regions are searched, because {@link sohlField} reads both: a note that
 * moved the key to the top level without renaming it has done half the
 * migration, and should be told so rather than passing in silence.
 *
 * @param {object|null|undefined} fm - Parsed frontmatter.
 * @param {string} current - The field's current name.
 * @returns {boolean} Whether the retired spelling is declared.
 */
export function declaresRetiredAlias(fm, current) {
    const retired = RETIRED_FIELD_ALIASES[current];
    if (!retired || !fm || typeof fm !== "object") return false;
    const block = fm.sohl;
    const inBlock =
        block &&
        typeof block === "object" &&
        !Array.isArray(block) &&
        Object.hasOwn(block, retired);
    return Boolean(inBlock) || Object.hasOwn(fm, retired);
}

/**
 * Read a field that has a retired spelling, the current name winning.
 *
 * This is the whole of the retirement window's behaviour, in one function, so
 * the compiler and the linter cannot disagree about which value a note carries.
 * Resolution within each spelling is {@link sohlField}'s — the `sohl:` block
 * first, then the note's top level — so a renamed field keeps working wherever
 * it was already written while the canonical home is the top level.
 *
 * A blank value counts as absent: `img:` cleared in an editor means the note
 * names no art there, and falling through to the retired spelling is what an
 * author part-way through the rename means by it.
 *
 * @param {object|null|undefined} fm - Parsed frontmatter.
 * @param {string} current - The field's current name.
 * @returns {any} The value, or `undefined` when neither spelling carries one.
 */
export function readAliasedField(fm, current) {
    const value = sohlField(fm, current, undefined);
    if (value !== undefined && value !== null && value !== "") return value;
    const retired = RETIRED_FIELD_ALIASES[current];
    return retired ? sohlField(fm, retired, undefined) : undefined;
}
