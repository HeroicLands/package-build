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
 * **A page's URL is its address** — `<package>/<type>-<shortcode>/` (#181), and
 * it carries **no `<system>` segment** even though the canonical address does
 * (#59). That is not an omission: a note publishes one page however many
 * systems' documents it compiles into, so there is nothing for the segment to
 * distinguish, and adding it would split one page's URL in two. The canonical
 * address names a *document*; this names a *page*. It
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

// The system vocabulary is the `<system>` segment's own registry, and
// `engine/systems.mjs` imports nothing but `engine/address-charset.mjs`, so
// the direction is toward the leaf and cannot close a cycle.
import { NO_SYSTEM, assertSystemSegment, isSystemSegment } from "./systems.mjs";
import { systemOf } from "./document-subtypes.mjs";
import { KNOWN_DOCUMENT_SUBTYPE_MAPS } from "./subtype-registry.mjs";

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

/** The knowledgebase's mount within this package's site (#1470). */
export const KB_PREFIX = "kb/";

/**
 * The single path segment a note is addressed by: `type-shortcode`.
 *
 * Lowercased and hyphen-joined by the same rule as the note's canonical key
 * ({@link canonicalKey}, below, lowercases too), so it is that
 * key's **last two segments** — which is what makes a manifest entry's `path`
 * derivable from the key it is filed under rather than transported beside it.
 *
 * It was once the key's whole tail, and #59 ended that: the key gained a
 * `<system>` segment, so its tail is now `system-type-shortcode` and a slug is
 * the tail with that segment dropped. The behaviour here is unchanged, and
 * deliberately — a page has no system to name (see the module note above), so
 * the two forms diverge rather than one having fallen behind the other. A
 * consumer deriving a `path` from a key drops the *package and the system*, not
 * the package alone.
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
 * that made one note address a whole section is retired with the section itself
 * (#204), so every note is addressed alike and there is one rule and no branch.
 * It took an address scheme until #215, to validate a `landing` rule it then
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
 * The **canonical** address of a note: fully qualified, one spelling per
 * document, and globally unique.
 *
 * The written form of a link is a **partial** address: it may omit leading
 * segments, and each one it omits is filled in by rule rather than left
 * unconstrained. An omitted package (`[[skill-lang]]`) defaults to the citing
 * note's own, so an unqualified link resolves locally and only locally, and a
 * link into another package must name it. An omitted **system** is a
 * *wildcard*, not a default — most links target items, which belong to a
 * system — and the resolver requires exactly one match: none is a dead link,
 * more than one is an ambiguity reported with every candidate named.
 * Everything internal — index keys, cache keys, every lookup — uses this fully
 * qualified form instead, so no consumer has to know what a short form
 * defaulted to or matched.
 *
 * Global uniqueness is what lets a dependency's index merge straight into a
 * local one: the keys cannot collide by accident, so a key already present on
 * merge is a real conflict rather than an artefact of two packages sharing a
 * namespace. `(type, shortcode)` alone is unique only *within* a package, and
 * two independently authored packages reaching for the same short string is a
 * matter of time (#1499).
 *
 * **The system segment (#59).** A package may ship content for more than one
 * system, and one note then compiles into a document per system — an actor in
 * `actors-sohl` *and* an actor in `actors-hm3`. Without a system segment both
 * land on one key, so the address cannot name either of them. `harn-ensemble`
 * carries 2,497 such notes.
 *
 * The value is a system id, or the literal **`none`** for a document no game
 * system defines: a journal, a macro, a scene, and an item's documentation
 * journal — which is `none` however many systems the item itself declares,
 * because it is one journal.
 *
 * `none` rather than `any`: every segment of an address is an exact literal,
 * and `any` reads as a wildcard — "matches under any system" — which is not
 * what it does. A resolver written to that misreading would fail silently,
 * since a lookup miss already returns nothing rather than erroring. And not
 * `null` or `~`, both of which are YAML nulls that parse to an absent value and
 * drop the segment entirely.
 *
 * @param {string} pkg - The owning **content** package (`sohl`, `thalorna`) —
 *   not the Foundry package, which varies per compilation target.
 * @param {string} system - The system whose document this addresses, or `none`.
 * @param {string} type - The note's `type`.
 * @param {string} shortcode - The note's `shortcode`.
 * @returns {string} `package-system-type-shortcode`, lowercased.
 */
export function canonicalKey(pkg, system, type, shortcode) {
    // Checked where an address is *written*, not where one is read: a fetched
    // index naming a system this build has never heard of is data to report,
    // while emitting one is a defect in this build. The registry is closed, so
    // an unknown value here can only be a typo or a system nobody declared.
    assertSystemSegment(system, `the address of ${type}-${shortcode}`);
    return `${pkg}-${system}-${type}-${shortcode}`.toLowerCase();
}

/**
 * Which system a frontmatter key path is written under.
 *
 * The **enclosing system block** decides, at any depth within it, and nothing
 * else does: `sohl.items[3].model` and `sohl.system.body.structure` are both
 * `sohl` because both sit under `sohl:`. Everywhere else is {@link NO_SYSTEM} —
 * top-level frontmatter, the shared `data:` container, and body prose, which has
 * no key path at all and passes `undefined`.
 *
 * It is the block rather than the field, so a `WikiLink` field needs no opinion
 * about systems and no per-field table has to be kept in step with the schema.
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
    if (typeof keyPath !== "string" || !keyPath) return NO_SYSTEM;
    const first = keyPath.split(".")[0].trim().toLowerCase();
    return isSystemSegment(first) && first !== NO_SYSTEM ? first : NO_SYSTEM;
}

/**
 * Expand a written address to the one canonical address it names.
 *
 * **An omitted segment defaults from where the link is written** (#336) — it is
 * not a wildcard, and resolution is not a search. Package omitted means the
 * citing note's own; system omitted means {@link blockSystem} of the key path it
 * was written under. So every short form has exactly one expansion, computed
 * before anything is looked up, and there is no candidate set to disambiguate.
 *
 * **Under `none`, a system-bearing type addresses its documentation journal.**
 * A note's `none` address *is* its `doc<type>` entry — the Item is the one with
 * a system — so a prose `[[affiliation-sirvadar|…]]` names the page, which is
 * almost always what prose means. A link that means the Item states the system
 * and gets it. This is the defaulting rule applied, not an exception carved out
 * of it.
 *
 * **Only a type whose own document carries a system is redirected.** A `macro`
 * and the map types have documentation journals too, but their own documents
 * are core ones and already live at `none` — so `<pkg>-none-macro-x` names the
 * Macro and `<pkg>-none-docmacro-x` its journal, two live addresses that the
 * redirect would collapse into one. The test is the note type's own system,
 * not merely whether it has a doc entry.
 *
 * A `doc<type>` written explicitly is `none` **wherever** it appears, even
 * inside a system block: no game system defines a JournalEntry, so there is no
 * other system for one to belong to.
 *
 * @param {{type: string, shortcode: string, package?: string, system?: string,
 *   itemDoc?: boolean}} read - A qualifier, as `readQualifier` returns one.
 * @param {{package: string, system?: string}} where - The citing context: the
 *   tree's own content package, and the system of the block the link sits in.
 * @returns {string} The canonical `package-system-type-shortcode`.
 */
export function expandAddress(read, where) {
    const pkg = read.package ?? where.package;
    // A documentation journal is a core document, so it is `none` however it was
    // reached; otherwise the block's system, which body prose reports as `none`.
    const system = read.itemDoc ? NO_SYSTEM : (read.system ?? where.system ?? NO_SYSTEM);
    const redirected = system === NO_SYSTEM && isSystemBearing(read.type);
    const type = read.itemDoc || redirected ? `doc${read.type}` : read.type;
    return canonicalKey(pkg, system, type, read.shortcode);
}

/**
 * Whether a note type's **own** document carries a game system.
 *
 * True for the types some shipped map compiles into an Item or an Actor; false
 * for the core-document types — `doc`, `lore`, `place`, `scenario`, `macro` and
 * the map types — whose documents Foundry itself defines and which therefore
 * already live at `none`.
 *
 * It is what {@link expandAddress} tests rather than {@link hasDocEntry}: a
 * `macro` has a documentation journal *and* a `none` address of its own, so
 * redirecting on "has a doc entry" would collapse two live addresses into one
 * and a `[[macro-autoattack|]]` would stop naming the Macro.
 *
 * @param {string} type - The note type.
 * @returns {boolean} True when the type compiles into a system document.
 */
function isSystemBearing(type) {
    return systemOf(type, KNOWN_DOCUMENT_SUBTYPE_MAPS) !== NO_SYSTEM;
}

/**
 * How many segments a canonical key has, and therefore how many the reader
 * below counts.
 *
 * Named rather than written as a literal because it is the *grammar*, not an
 * implementation detail of one function: it is the number a change to the
 * address form would move, and the thing a reader of that change has to find.
 *
 * @type {number}
 */
export const CANONICAL_KEY_SEGMENTS = 4;

/**
 * Reads a canonical key back into its parts.
 *
 * Parsing is plain positional counting: split on the separator, require
 * {@link CANONICAL_KEY_SEGMENTS} of them, and assign each position its field.
 * **The charset rule is what makes that sound** — every segment is
 * `^[A-Za-z0-9]+$` (`ADDRESS_SEGMENT_PATTERN` in `engine/address-charset.mjs`),
 * so the hyphen is purely a separator and the count alone determines every
 * field. That is enforced at each of the three sources rather than assumed of
 * the data: shortcodes by `content-lint.mjs` (#1397), `contentPackage` by
 * `defineConfig` (#59), and types are bare words. Were any of them free to
 * carry a hyphen, no amount of counting would recover the fields and the reader
 * would need a vocabulary to match against instead.
 *
 * **Nothing to read and nothing readable are different answers.** A key that
 * cannot be canonical — `harn-adventures-sohl-skill-melee`, five segments,
 * because the package name carries the separator — yields `null`, while an
 * absent or blank input yields `undefined`. Both are falsy, so
 * every call site (all of which test the result for truthiness) is unaffected;
 * the distinction is there so a caller reporting "this key is unreadable" can
 * tell that it has a key to report about.
 *
 * @param {unknown} key - A canonical key, or nothing.
 * @returns {{package: string, system: string, type: string, shortcode: string}
 *   |null|undefined}
 *   The parts; `null` when there is a string that is not in canonical form;
 *   `undefined` when there is no key at all.
 */
export function readCanonicalKey(key) {
    if (key == null || key === "") return undefined;
    const parts = String(key).split("-");
    if (parts.length !== CANONICAL_KEY_SEGMENTS) return null;
    const [pkg, system, type, shortcode] = parts;
    if (!pkg || !system || !type || !shortcode) return null;
    return { package: pkg, system, type, shortcode };
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
 * canonical address (#270).
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
