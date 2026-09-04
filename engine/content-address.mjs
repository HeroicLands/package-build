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
 * Where a content note publishes on the web.
 *
 * One rule, in one place, because two builds need the same answer: the
 * knowledgebase build renders the page, and the link manifest records the
 * address other packages link to. Stating it twice is how a manifest comes to
 * assert a URL that resolves at build time and 404s for the reader.
 *
 * **A page's URL is its address** — `<package>/<type>-<shortcode>/` (#181). It
 * used to be derived from `name.full`, which made a display string load-bearing
 * in three separate ways: a rename moved the URL and nothing redirected, two
 * notes in one section could derive the same URL so a uniqueness check had to
 * run, and a long name had to be abbreviated through a word table to keep the
 * result short. `(type, shortcode)` is unique within a package by rule
 * (`engine/content-lint.mjs`), so the address is **unique by construction** —
 * there is no check to run, and no rename to survive.
 */

// The scheme vocabulary is part of the configuration contract — a
// repository names its scheme in `package-build.config.yaml` — so it is
// declared beside the rest of that vocabulary rather than here, and this
// module re-exports it beside the addresses it derives. `config.mjs` is the
// leaf entry point and imports nothing but `node:path` and `engine/ids.mjs`,
// so the direction cannot close a cycle (see `engine/pack-config.mjs`).
import { DEFAULT_ADDRESS_SCHEME } from "../content-config.mjs";

export { DEFAULT_ADDRESS_SCHEME };

/** The knowledgebase's mount within this package's site (#1470). */
export const KB_PREFIX = "kb/";

/**
 * The single path segment a note is addressed by: `type-shortcode`.
 *
 * Lowercased, so it is exactly the tail of the note's canonical key
 * (`canonicalKey` in `engine/kb-manifest.mjs` lowercases too) — which is what
 * makes a manifest entry's `path` derivable from the key it is filed under
 * rather than transported beside it.
 *
 * The hyphen is a separator and never occurs inside a segment: a shortcode is
 * `^[A-Za-z0-9]+$` (`ADDRESS_SEGMENT_PATTERN`, enforced by `content-lint.mjs`)
 * and a type is a bare word. That is the same charset guarantee positional key
 * parsing rests on, so the address and the key cannot disagree about where one
 * ends and the other begins.
 *
 * @param {object} fm - Parsed frontmatter.
 * @returns {string} The address segment, e.g. `weapongear-dagger`.
 * @throws {Error} When the note declares no type or no shortcode — either way
 *   it has no address, which is reported rather than papered over: inventing
 *   one would publish a page nothing can link to and record a manifest entry
 *   pointing at it.
 */
export function addressSlug(fm) {
    const type = typeof fm?.type === "string" ? fm.type.trim() : "";
    if (!type) {
        throw new Error("note declares no type, so it has no address");
    }
    const shortcode = typeof fm?.shortcode === "string" ? fm.shortcode.trim() : "";
    if (!shortcode) {
        throw new Error(
            `note declares no shortcode, so it has no address — a page is ` +
                `addressed as "${type}-<shortcode>"`,
        );
    }
    return `${type}-${shortcode}`.toLowerCase();
}

/**
 * A note's address below the knowledgebase mount, e.g. `affliction-aconite/`.
 *
 * Every note, without exception. A `README.md` used to be its section's landing
 * page and to address the section instead of itself; a section is a Hugo
 * directory concept the note format no longer carries (#204), so a file's name
 * decides nothing about where it publishes.
 *
 * @param {object} fm - Parsed frontmatter.
 * @returns {string} The mount-relative address, with a trailing slash.
 * @throws {Error} When the note has no address.
 */
export function contentAddress(fm) {
    return `${addressSlug(fm)}/`;
}

/**
 * A note's address relative to its **package**, e.g. `affliction-aconite/`.
 *
 * This is the form the link manifest records and the site build emits pages at,
 * and it is one function because those two must agree — a manifest asserting an
 * address the site does not publish resolves at build time and 404s for the
 * reader, which is the failure this module exists to prevent.
 *
 * **It is a pure function of the frontmatter.** Nothing about the file the note
 * was read from reaches it: the `README.md` convention that made one note
 * address a whole section is retired with the section itself (#204), so there
 * is one rule and no branch.
 *
 * **The prefix does not apply to a page's own address.** `prefix` says where the
 * content tree *mounts inside the package* — the Hugo directory its pages are
 * written under — and an address is `(type, shortcode)`, a package-wide identity
 * that takes no mount: `sohl` publishes `/sohl/affliction-aconite/` from a file
 * written under `kb/`. The `type-` half is what keeps that flat namespace clear
 * of the package's fixed mounts — `/<package>/` for the landing,
 * `/<package>/api/` for generated API docs, neither of which contains a hyphen
 * or names a type.
 *
 * **It takes no address scheme.** It took one until #215, to validate the
 * `landing` rule it then discarded; with that key retired, `prefix` was the
 * only thing left in the scheme and the paragraph above is the reason it never
 * applied. A parameter read by nothing is the defect this deletion is about.
 *
 * @param {object} fm - Parsed frontmatter.
 * @returns {string} The package-relative address, with a trailing slash and no
 *   leading one.
 * @throws {Error} When the note has no type or no shortcode to be addressed by.
 *   Such a note is not published, and inventing an address for one would put a
 *   dead entry in the manifest.
 */
export function packageAddress(fm) {
    return `${addressSlug(fm)}/`;
}
