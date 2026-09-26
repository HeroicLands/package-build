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
 * **A page's URL is its address** — `<package>/<type>-<shortcode>/`, and
 * it carries **no `<system>` segment** even though the canonical address does.
 * That is not an omission: a note publishes one page however many
 * systems' documents it compiles into, so there is nothing for the segment to
 * distinguish, and adding it would split one page's URL in two. The canonical
 * address names a *document*; this names a *page*. It
 * is not derived from `name.full`, which would make a display string load-bearing
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

// The system vocabulary is the `<system>` segment's own registry, and
// `engine/systems.mjs` imports nothing but `engine/address-charset.mjs`, so
// the direction is toward the leaf and cannot close a cycle.
import { NO_SYSTEM, NOTE_SYSTEM, isSystemId } from "./systems.mjs";

// The address grammar, which sits below this module: a page URL is derived from
// an address, so the rule for reading and writing one is stated there and
// applied here.
import { canonicalKey } from "./address.mjs";

// `ids.mjs` is a leaf with no local imports — the module note there says why —
// so an address may hash itself without any risk of closing a cycle.
import { makeId } from "./ids.mjs";

export { DEFAULT_ADDRESS_SCHEME };

/**
 * Re-exported so the address grammar and the system vocabulary are one fact:
 * {@link canonicalKey} writes this segment, and `engine/systems.mjs` decides
 * what may appear in it.
 */
export { NO_SYSTEM };

/**
 * The address grammar, under the names its callers hold it by.
 *
 * One parser, one renderer and one reader, all of them in `engine/address.mjs`:
 * {@link canonicalKey} renders the four segments, `expandAddress` applies a
 * position's defaults to a written value and renders the result, and
 * `readCanonicalKey` reads a rendered address back.
 */
export {
    canonicalKey,
    expandAddress,
    readCanonicalKey,
    CANONICAL_KEY_SEGMENTS,
} from "./address.mjs";

/** The knowledgebase's mount within this package's site. */
export const KB_PREFIX = "kb/";

/**
 * The single path segment a note is addressed by: `type-shortcode`.
 *
 * Lowercased and hyphen-joined by the same rule as the note's canonical key
 * ({@link canonicalKey} lowercases too), so it is that
 * key's **last two segments** — which is what makes a manifest entry's `path`
 * derivable from the key it is filed under rather than transported beside it.
 *
 * It is not the key's whole tail: the key carries a
 * `<system>` segment, so its tail is now `system-type-shortcode` and a slug is
 * the tail with that segment dropped. The behaviour here is unchanged, and
 * deliberately — a page has no system to name (see the module note above), so
 * the two forms diverge rather than one having fallen behind the other. A
 * consumer deriving a `path` from a key drops the *package and the system*, not
 * the package alone.
 *
 * The hyphen is a separator and never occurs inside a segment: a shortcode
 * matches `ADDRESS_SEGMENT_PATTERN` (`engine/address-charset.mjs`, enforced by
 * `content-lint.mjs`) and a type is a bare word. That is the same charset
 * guarantee positional key parsing rests on, so the address and the key
 * cannot disagree about where one ends and the other begins.
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
 * A note's address: `<type>-<shortcode>/`, e.g. `affliction-aconite/`.
 *
 * This is the one form a note is addressed by. It is what the link manifest
 * records as an entry's `path` and what the site build emits the page at, and
 * it is one function because those two must agree — a manifest asserting an
 * address the site does not publish resolves at build time and 404s for the
 * reader, which is the failure this module exists to prevent.
 *
 * **The address is relative to the package**, and to nothing finer. A consumer
 * composing a URL prepends where the package is served (`/<package>/`); a
 * consumer composing a manifest entry measures against that same base. Nothing
 * else is prepended: `prefix` says where the content tree *mounts inside the
 * package* — the Hugo directory its pages are written under — and an address is
 * `(type, shortcode)`, a package-wide identity that takes no mount, so `sohl`
 * publishes `/sohl/affliction-aconite/` from a file written under `kb/`. The
 * `type-` half is what keeps that flat namespace clear of the package's fixed
 * mounts — `/<package>/` for the landing, `/<package>/api/` for generated API
 * docs, neither of which contains a hyphen or names a type.
 *
 * **It is a pure function of the frontmatter**, and takes no options. Nothing
 * about the file the note was read from reaches it: the `README.md` convention
 * that made one note address a whole section is retired with the section itself,
 * so every note is addressed alike and there is one rule and no branch.
 * It takes no address scheme; the `landing` rule it once validated is
 * discarded; with that key retired, `prefix` was the only thing left in the
 * scheme and the paragraph above is the reason it never applied.
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

/**
 * Which system a frontmatter key path is written under.
 *
 * The **enclosing system block** decides, at any depth within it, and nothing
 * else does: `sohl.items[3].model` and `sohl.system.body.structure` are both
 * `sohl` because both sit under `sohl:`. Everywhere else takes
 * {@link NOTE_SYSTEM}; fields declared for assets or folders supply their own
 * `none` default at the field parser.
 *
 * The first segment must **be** a declared system, not merely look like one:
 * `sohlish.items` is a key called `sohlish`, and `notes.sohl.thing` names no
 * block at all.
 *
 * @param {string} [keyPath] - The dotted frontmatter key path, or `undefined`
 *   for body prose.
 * @returns {string} The system id, or `none`.
 */
export function blockSystem(keyPath) {
    if (typeof keyPath !== "string" || !keyPath) return NOTE_SYSTEM;
    const first = keyPath.split(".")[0].trim().toLowerCase();
    return isSystemId(first) ? first : NOTE_SYSTEM;
}

/**
 * Where this build serves each package, keyed by package name.
 *
 * One line per package, and the only edit a relocation requires: point a
 * package at another path (`"/setting/thalorna/"`) or another origin
 * (`"https://thalorna.example.org/"`) and every inbound link into it follows.
 * A base is a prefix, so it must end in `/`.
 *
 * Only *foreign* packages are consulted — a package this build publishes is
 * authoritative in its own entries and never resolves through a fetched
 * index — but every linkable package is listed, because which are foreign
 * depends on the consuming repository.
 */
export const PACKAGE_BASE = Object.freeze({
    sohl: "/sohl/",
    thalorna: "/thalorna/",
});

/**
 * Asserts a base is usable as a prefix and returns it.
 *
 * Exported for the URL helpers' own callers: a build that composes a base
 * before resolving against it should reject a malformed one at the point it
 * is chosen, not at the point a link is emitted.
 *
 * @param {string} base - The package base.
 * @param {string} what - What is being resolved, for the error message.
 * @returns {string} The base.
 */
export function checkBase(base, what) {
    if (typeof base !== "string" || !base.endsWith("/")) {
        throw new Error(`${what}: package base ${JSON.stringify(base)} must end in a slash`);
    }
    return base;
}

/**
 * The package-relative address a site-absolute URL records as.
 *
 * Strips the emitting package's own base, so what is recorded says *where in
 * the package* a page is and nothing about where the package itself is
 * mounted. A URL outside the base is an error rather than a best effort: it
 * would record an address that silently resolves to the wrong place once a
 * consumer prefixes its own base.
 *
 * @param {string} url - The site-absolute URL the emitting build publishes at.
 * @param {string} base - That build's base for the package, e.g. `"/thalorna/"`.
 * @returns {string} The address relative to `base`, with no leading slash.
 */
export function packageRelative(url, base) {
    checkBase(base, "packageRelative");
    if (typeof url !== "string" || !url.startsWith(base)) {
        throw new Error(
            `packageRelative: ${JSON.stringify(url)} does not sit under base ` +
                `${JSON.stringify(base)}`,
        );
    }
    return url.slice(base.length);
}

/**
 * The URL a package-relative address resolves to in this build.
 *
 * Plain concatenation, which is what makes an absolute-origin base work: a base
 * of `"https://thalorna.example.org/"` yields an absolute link, and one of
 * `"/thalorna/"` a root-relative one, with no other rule to keep in step.
 *
 * @param {string} rel - The package-relative address from a fetched index.
 * @param {string} base - This build's base for that package.
 * @returns {string} The resolved URL.
 */
export function resolvePackageUrl(rel, base) {
    checkBase(base, "resolvePackageUrl");
    if (typeof rel !== "string" || !rel || rel.startsWith("/")) {
        throw new Error(
            `resolvePackageUrl: ${JSON.stringify(rel)} is not a package-` + `relative address`,
        );
    }
    return `${base}${rel}`;
}

/**
 * The namespace {@link documentId} hashes a canonical address under.
 *
 * Named rather than written as a literal at the one call site, because it is
 * part of the published derivation: a consumer holding a content-index entry
 * recomputes the document's id — and therefore its compendium UUID — as
 * `makeId(DOCUMENT_ID_NAMESPACE, entry.canonical)`, so the string is a fact
 * about the format rather than an implementation detail. Changing it moves
 * every id this toolchain has ever emitted.
 *
 * @type {string}
 */
export const DOCUMENT_ID_NAMESPACE = "document";

/**
 * The Foundry `_id` of the document a note compiles into, derived from its
 * canonical address.
 *
 * A note used to author this — an opaque 16-character string, one per note,
 * that said nothing its address did not and that no check guaranteed. The
 * address is the identity that *is* guaranteed: `content-lint` refuses a
 * duplicate `(type, shortcode)` across every pack of a document type, which is
 * exactly the scope a primary document's id must be unique within. So the
 * derived id inherits a guard that already exists, where the authored one had
 * none.
 *
 * **The coupling this creates, stated plainly.** The address carries the
 * shortcode, so renaming a shortcode moves the document's id — where an
 * authored id survived one. That is a real trade rather than a free win, and
 * two things make it acceptable: a rename already breaks every wikilink to the
 * note, so it is a breaking change either way; and a note that must keep its
 * identity across a rename pins an `id`, which is what the pin is for. One
 * thing genuinely degrades — `engine/address-diff.mjs` tells a rename from a
 * withdrawal by matching document ids, and can no longer do so for a note that
 * authors none. Its module note records that.
 *
 * @param {string} pkg - The owning **content** package.
 * @param {string} system - The system whose document this is, or `none`.
 * @param {string} type - The note's `type`.
 * @param {string} shortcode - The note's `shortcode`.
 * @returns {string} A 16-character Foundry id.
 */
export function documentId(pkg, system, type, shortcode) {
    return makeId(DOCUMENT_ID_NAMESPACE, canonicalKey(pkg, system, type, shortcode));
}
