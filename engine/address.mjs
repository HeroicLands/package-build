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
 * The Address: one value, one parser, one renderer.
 *
 * An **Address** is the four-tuple `<package>-<system>-<type>-<shortcode>`. It
 * is the identity of everything this toolchain compiles — how a note names
 * another note, how a compendium entry is keyed, how a page's URL is derived,
 * how an asset's file is found, how a Foundry UUID is built, and what the
 * published index records.
 *
 * ## Three data types, and this module is about one of them
 *
 * - An **Address** is the four-tuple. An author may write any suffix of it, and
 *   it is always stored and rendered in full. That is what this module reads and
 *   writes.
 * - A **Shortcode** is one segment: an identity, or a key a runtime lookup
 *   takes. A note's own `shortcode:`, a custom embedded entry's
 *   `system.shortcode`, the `*Code` fields and an affiliation's
 *   `system.relations` keys are all shortcodes. **A shortcode is not a short
 *   Address.** It names nothing to expand — it is resolved among the items
 *   embedded on one actor, where packages do not exist — so it never reaches
 *   this module and nothing here qualifies one. A field the corpus writes at
 *   both lengths is an Address; a field never written qualified is a shortcode.
 * - A **Wikilink** is `[[<Address>[#<anchor>]|<text>]]` — a different thing that
 *   *contains* an Address. The anchor and the label belong to the Wikilink and
 *   are stripped before anything here sees the value; a frontmatter field holds
 *   the same tuple with no Wikilink around it.
 *
 * **How an author writes an Address is any suffix of the tuple. At the code
 * level there is one shape.**
 *
 * ```text
 * [[[<package>-]<system>-]<type>-]<shortcode>      what an author may write
 * parseAddress(written, defaults) → AddressTuple   what the code holds
 * ```
 *
 * {@link parseAddress} takes the written value and the defaults the position
 * supplies, and returns **all four segments** or a reason it cannot. No caller
 * asks which parts were written, and no caller does string surgery on an
 * address.
 *
 * ## Two questions, and they are separate
 *
 * 1. **Does it parse, and what does it name?** Uniform and universal. The
 *    position contributes the defaults and the vocabularies, nothing else.
 * 2. **Is what it names acceptable *here*?** {@link acceptsType}, taking the
 *    **set** of types the position accepts.
 *
 * The set is not the default. An art slot's default type is `icon` while its
 * accepted set is `icon` and `image`, because a faith tradition's profile art
 * is a full illustration rather than a game icon — so a rule of "the written
 * type must equal the default" would refuse authored content that is correct.
 *
 * ## Why counting segments is sound
 *
 * Parsing is plain positional counting: split on the separator and assign each
 * position its field. That rests on the charset — every segment matches
 * `ADDRESS_SEGMENT_PATTERN` (`engine/address-charset.mjs`), so a hyphen is
 * *purely* a separator and the count alone determines every field. The rule is
 * enforced at each source rather than assumed of the data: shortcodes by
 * `content-lint.mjs`, `contentPackage` by `defineConfig`, and types are bare
 * words.
 *
 * `sohl` is both a package and a system, and positional counting is what makes
 * that harmless: three segments is `<system>-<type>-<shortcode>` whatever the
 * first segment could also have named, and four is the full form. Nothing has
 * to guess which sense was meant. The cost is that `<package>-<type>-<shortcode>`
 * is **not** a written form, so a link into another package states its system.
 *
 * ## Defaults belong to the citing position
 *
 * Ordinary wikilinks default to `note`, embeds default to `none`, and typed
 * frontmatter fields supply their declared system. The authored type stays
 * the type in the complete tuple. A `doc<type>` qualifier is accepted as an
 * input spelling for a readable note and resolves to `note-<type>`.
 *
 * ## The tuple keeps no memory of how it was written
 *
 * An abbreviation is a *rendering*, not a different value: `being-kaldor` in a
 * `thalorna` note and `thalorna-note-being-kaldor` are the same Address, and
 * they parse to the same four fields. Nothing here records what the author
 * typed — a tuple that did would make identity depend on a spelling.
 *
 * The converse matters just as much: **one written string is two Addresses at
 * two positions**, because the positions supply different defaults.
 * `skill-wpnc` under `sohl.items` defaults its system from the block and names
 * the Item; the same string in body prose defaults to `note` and names the
 * readable page. Only the resolved tuple can tell them apart.
 *
 * ## What this module does not do
 *
 * A failure is a **reason**, never a diagnostic: callers build the finding and
 * locate it in the file, because only the caller knows which key or which
 * wikilink occurrence it is reporting. And package-blindness is a *projection*
 * rather than a partial tuple — a reference to an embedded item resolves on
 * `(type, shortcode)` because an actor assembles items from several packages
 * and the system matches that pair at runtime, which is a fact about the
 * runtime stated at the one call site that needs it, not about the grammar.
 *
 * @module
 */

// The system vocabulary is the `<system>` segment's own registry, and
// `engine/systems.mjs` imports nothing but `engine/address-charset.mjs`, so the
// direction is toward the leaf and cannot close a cycle.
import { isAddressSegment } from "./address-charset.mjs";
import { NO_SYSTEM, NOTE_SYSTEM, assertSystemSegment, isSystemSegment } from "./systems.mjs";
// Document subtype maps identify the system of a note's own Actor or Item.
import { systemOf } from "./document-subtypes.mjs";
import { KNOWN_DOCUMENT_SUBTYPE_MAPS } from "./subtype-registry.mjs";
// `ids.mjs` is a leaf with no local imports, and `pack-config.mjs` reaches only
// the configuration loader and the diagnostics writer — neither reads an
// address, so the grammar sits below everything that consumes it.
import { currentType, ITEM_PACK, JOURNAL_TYPES, packForType } from "./ids.mjs";
import { HOMEPAGE_TYPE } from "./homepage.mjs";
import { loadPackConfig } from "./pack-config.mjs";

export { NO_SYSTEM };

/**
 * The one character that separates an Address's segments.
 *
 * Named because it is the *grammar*, not an implementation detail: it is what a
 * change to the address form would move, and what a reader of that change has
 * to find.
 *
 * @type {string}
 */
export const ADDRESS_SEPARATOR = "-";

/**
 * How many segments a canonical Address has, and therefore how many
 * {@link readCanonicalKey} counts.
 *
 * @type {number}
 */
export const CANONICAL_KEY_SEGMENTS = 4;

/** The accepted `doc<type>` input prefix for readable note links. */
export const ITEM_DOC_PREFIX = "doc";

/** Package, system and type are one spelling each, so they fold to lowercase. */
const norm = (s) => String(s).toLowerCase().trim();

/**
 * A complete Address: four segments, with no memory of the authored form.
 *
 * @typedef {object} AddressTuple
 * @property {string} package - The owning **content** package.
 * @property {string} system - `note`, `none`, or a game system id.
 * @property {string} type - The type segment of the canonical Address.
 * @property {string} shortcode - The note's `shortcode`.
 */

/**
 * Why a written value is not an Address.
 *
 * The vocabulary is shared with the resolvers, so one authored mistake gets one
 * verdict however many surfaces report it.
 *
 * - `not-an-address` — the value does not parse as one, which for body prose is
 *   an ordinary note name rather than a mistake.
 * - `no-type` — the `<type>` segment is omitted and the position declares no
 *   default to fill it in, so nothing says what the value names.
 * - `unknown-type` — the value is definitely qualified and names no known type.
 * - `no-content-index` — the package named publishes no content index, so there
 *   is nothing to resolve the rest of the target against.
 * - `not-lowercase` — a package, system or type segment carries a capital.
 * - `invalid-segment` — a declared Address contains a malformed segment.
 * - `no-package` — a declared Address cannot supply its package.
 * - `invalid-system` — a declared Address cannot supply a registered system.
 *
 * @typedef {{reason: string, package?: string}} AddressProblem
 */

/**
 * The configured types whose prose compiles into a separate JournalEntry.
 * The journal has a `note` Address with the authored type segment.
 *
 * @returns {ReadonlySet<string>} The configured doc-carrying types.
 */
export function docEntryTypes() {
    return loadPackConfig().docEntryTypes;
}

/**
 * Whether a content note's type is one whose prose becomes a JournalEntry of
 * its own.
 *
 * @param {string} type - The note's `type` frontmatter.
 * @returns {boolean} True for an item type, an actor type, a map type and
 *   `macro`; false for `doc`.
 */
export function hasDocEntry(type) {
    // Through {@link currentType}, because the set is derived from the item
    // registry's keys and those are the *current* spelling of a note type. A
    // note still on a renamed one carries its documentation journal exactly as
    // before — this is the one lookup between an item compiling and its prose
    // silently compiling into nothing.
    return docEntryTypes().has(String(currentType(type)));
}

/** The segment of a note's own document. */
export function ownDocumentSystem(type) {
    return JOURNAL_TYPES.has(String(type)) || type === HOMEPAGE_TYPE ?
            NOTE_SYSTEM
        :   systemOf(type, KNOWN_DOCUMENT_SUBTYPE_MAPS);
}

/**
 * Read a `doc<type>` input qualifier as the underlying authored type.
 * A real type with that spelling takes precedence.
 *
 * @param {string} qualifier - The type segment from the input.
 * @param {Set<string>} types - Types in the content tree.
 * @returns {string|null} The underlying type, or `null`.
 */
export function resolveItemDocType(qualifier, types) {
    if (types.has(qualifier)) return null; // a real type owns its own name
    if (!qualifier.startsWith(ITEM_DOC_PREFIX)) return null;
    const base = qualifier.slice(ITEM_DOC_PREFIX.length);
    if (!base || !types.has(base)) return null;
    if (hasDocEntry(base)) return base;
    return packForType(base).docType === ITEM_PACK.docType ? base : null;
}

/**
 * The vocabularies a written Address is read against.
 *
 * These are the tree's, not the position's — every position reads against the
 * same ones — and they travel beside the defaults so that reading an Address is
 * one call.
 *
 * @typedef {object} AddressVocabulary
 * @property {Set<string>} [types] - Every type the content tree contains.
 * @property {Set<string>} [packages] - Every package an Address may name.
 *   Omitted by callers that resolve within one package, where the fully
 *   qualified form cannot occur.
 * @property {Set<string>} [noIndexPackages] - Packages declared
 *   `contentIndex: false` — a Foundry dependency only, with no fetched index. A
 *   fully qualified target naming one is refused with `no-content-index` before
 *   its type is even considered.
 */

/**
 * What a position contributes: the defaults for the segments an author may omit.
 *
 * `package` and `system` are always supplied; `type` is supplied only by a
 * position that accepts exactly one, and a position accepting several declares
 * none, so a value omitting the `<type>` segment is refused rather than guessed
 * at.
 *
 * @typedef {AddressVocabulary & {package?: string, system?: string,
 *   type?: string}} AddressDefaults
 */

/**
 * Parse a written Address into the one complete tuple it names.
 *
 * **An omitted segment defaults from where the value is written** — it is not a
 * wildcard, and resolution is not a search. So every short form has exactly one
 * expansion, computed before anything is looked up, and there is no candidate
 * set to disambiguate.
 *
 * @param {unknown} written - The value as authored, with any Wikilink anchor and
 *   label already removed.
 * @param {AddressDefaults} [defaults] - The position's defaults and the tree's
 *   vocabularies.
 * @param {{declared?: boolean, legacyShortcodeCase?: boolean}} [options] - A declared Address validates every
 *   segment and requires complete defaults. Package membership is a separate
 *   resolution question in this mode; prose recognition keeps its vocabulary checks.
 *   `legacyShortcodeCase` accepts case-insensitive model Shortcodes while the
 *   completed tuple contains their canonical lowercase identity.
 * @returns {AddressTuple|AddressProblem} The complete Address, or why there is
 *   none.
 */
export function parseAddress(
    written,
    defaults = {},
    { declared = false, legacyShortcodeCase = false } = {},
) {
    if (isAddressTuple(written)) return written;
    if (declared) {
        if (typeof written !== "string") return { reason: "not-an-address" };
        const segments =
            written.includes("/") ? written.split("/") : written.split(ADDRESS_SEPARATOR);
        if (
            !segments.every((segment, index) =>
                isAddressSegment(
                    legacyShortcodeCase && index === segments.length - 1 ? norm(segment) : segment,
                ),
            )
        )
            return { reason: "invalid-segment" };
    }
    const read = readWritten(written, defaults, declared);
    if (read.reason) return read;
    const tuple = completeAddress(read, defaults);
    if (declared && !isAddressSegment(tuple.package)) return { reason: "no-package" };
    if (declared && !isSystemSegment(tuple.system)) return { reason: "invalid-system" };
    return tuple;
}

/** The values created by the Address reader, distinct from authored mappings. */
const TUPLES = new WeakSet();

/**
 * Whether a value is an internally parsed Address.
 * @param {unknown} value - A property value.
 * @returns {boolean} Whether it is a typed tuple.
 */
export function isAddressTuple(value) {
    return value !== null && typeof value === "object" && TUPLES.has(value);
}

/**
 * Construct a complete, immutable Address value.
 * @param {AddressTuple} value - The four segments.
 * @returns {AddressTuple} The typed value.
 */
function addressTuple(value) {
    if (
        !isAddressSegment(value.package) ||
        !isSystemSegment(value.system) ||
        !isAddressSegment(value.type) ||
        !isAddressSegment(value.shortcode)
    )
        return value;
    TUPLES.add(value);
    return Object.freeze(value);
}

/**
 * Render a complete Address as its canonical string.
 *
 * Lowercased, because an Address has one spelling: two names differing only in
 * case are two names nobody can tell apart.
 *
 * @param {AddressTuple} tuple - The complete Address.
 * @returns {string} `package-system-type-shortcode`.
 */
export function renderAddress(tuple) {
    const { package: pkg, system, type, shortcode } = tuple;
    // Checked where an address is *written*, not where one is read: a fetched
    // index naming a system this build has never heard of is data to report,
    // while emitting one is a defect in this build. The registry is closed, so
    // an unknown value here can only be a typo or a system nobody declared.
    assertSystemSegment(system, `the address of ${type}-${shortcode}`);
    return `${pkg}-${system}-${type}-${shortcode}`.toLowerCase();
}

/**
 * Whether the canonical type an Address names is accepted at this position.
 *
 * @param {AddressTuple} tuple - A complete Address.
 * @param {Iterable<string>} allowed - Accepted types.
 * @returns {boolean} Whether the type is accepted.
 */
export function acceptsType(tuple, allowed) {
    const type = norm(tuple?.type ?? "");
    if (!type) return false;
    for (const one of allowed ?? []) {
        const want = norm(one);
        if (!want) continue;
        if (type === want) return true;
    }
    return false;
}

/**
 * Apply the defaults to a partial reading, giving a complete Address.
 *
 * Complete a parsed Address using the citing position's package and system.
 *
 * @param {{type: string, shortcode: string, package?: string, system?: string,
 *   itemDoc?: boolean}} read - A partial reading, as {@link readQualifier}
 *   returns one.
 * @param {{package?: string, system?: string}} [where] - The citing context: the
 *   tree's own content package, and the system of the block the value sits in.
 * @returns {AddressTuple} The complete Address.
 */
export function completeAddress(read, where = {}) {
    if (isAddressTuple(read)) return read;
    const written = read.type;
    const pkg = read.package ?? where.package;
    const system = read.itemDoc ? NOTE_SYSTEM : (read.system ?? where.system ?? NOTE_SYSTEM);
    return addressTuple({ package: pkg, system, type: written, shortcode: read.shortcode });
}

/**
 * Expand a written Address to the one canonical Address it names.
 *
 * {@link completeAddress} and {@link renderAddress} under one name, for the
 * index keys and cache keys that hold an Address as a string.
 *
 * @param {{type: string, shortcode: string, package?: string, system?: string,
 *   itemDoc?: boolean}} read - A partial reading, as {@link readQualifier}
 *   returns one.
 * @param {{package: string, system?: string}} where - The citing context.
 * @returns {string} The canonical `package-system-type-shortcode`.
 */
export function expandAddress(read, where) {
    return renderAddress(completeAddress(read, where));
}

/**
 * The canonical Address of a document, from its four segments.
 *
 * Global uniqueness is what lets a dependency's index merge straight into a
 * local one: the keys cannot collide by accident, so a key already present on
 * merge is a real conflict rather than an artefact of two packages sharing a
 * namespace. `(type, shortcode)` alone is unique only *within* a package, and
 * two independently authored packages reaching for the same short string is a
 * matter of time.
 *
 * **The system segment.** A package may ship content for more than one system,
 * and one note then compiles into a document per system — an actor in
 * `actors-sohl` *and* an actor in `actors-hm3`. Without a system segment both
 * land on one key, so the address cannot name either of them.
 *
 * The value is a system id, or the literal **`none`** for a document no game
 * system defines: a journal, a macro, a scene, and an item's documentation
 * journal — which is `none` however many systems the item itself declares,
 * because it is one journal. `none` rather than `any`, because every segment of
 * an address is an exact literal and `any` reads as a wildcard, which a
 * resolver written to that misreading would act on silently; and not `null` or
 * `~`, both of which are YAML nulls that parse to an absent value and drop the
 * segment entirely.
 *
 * @param {string} pkg - The owning **content** package (`sohl`, `thalorna`) —
 *   not the Foundry package, which varies per compilation target.
 * @param {string} system - The system whose document this addresses, or `none`.
 * @param {string} type - The note's `type`.
 * @param {string} shortcode - The note's `shortcode`.
 * @returns {string} `package-system-type-shortcode`, lowercased.
 */
export function canonicalKey(pkg, system, type, shortcode) {
    return renderAddress({ package: pkg, system, type, shortcode });
}

/**
 * Reads a canonical Address back into its segments.
 *
 * **Nothing to read and nothing readable are different answers.** An Address
 * that cannot be canonical — `harn-adventures-sohl-skill-melee`, five segments,
 * because the package name carries the separator — yields `null`, while an
 * absent or blank input yields `undefined`. Both are falsy, so every call site
 * is unaffected; the distinction is there so a caller reporting "this address is
 * unreadable" can tell that it has one to report about.
 *
 * @param {unknown} key - A canonical Address, or nothing.
 * @returns {{package: string, system: string, type: string, shortcode: string}
 *   |null|undefined}
 *   The segments; `null` when there is a string that is not in canonical form;
 *   `undefined` when there is no Address at all.
 */
export function readCanonicalKey(key) {
    if (isAddressTuple(key)) return key;
    if (key == null || key === "") return undefined;
    const parts = String(key).split(ADDRESS_SEPARATOR);
    if (parts.length !== CANONICAL_KEY_SEGMENTS) return null;
    const [pkg, system, type, shortcode] = parts;
    if (!pkg || !system || !type || !shortcode) return null;
    return addressTuple({ package: pkg, system, type, shortcode });
}

/**
 * Read a written Address as the **partial** reading, before any default applies.
 *
 * The first of the two questions, giving the segments the author supplied and
 * nothing more. It exists for the callers that still hold a partial; the Address
 * is completed by {@link completeAddress}, and **nothing an omitted segment does
 * here is a wildcard.** Every omitted segment expands from the position's
 * defaults, exactly as the specification's table states, so a short form names
 * exactly one canonical Address and a lookup finds one entry or none. There is no
 * candidate set and no ambiguity by construction.
 *
 * Two separators are accepted, and they are **not** interchangeable in how
 * confidently they mark a value as qualified:
 *
 * - **`type-shortcode`** and its qualified forms — the canonical spelling.
 *   Obsidian reads `/` inside a wikilink as a *path* and resolves it against the
 *   vault's folders, so a slash-qualified link is a broken link in the editor
 *   where the content is authored.
 * - **`type/shortcode`** — resolved so that a link written before the vault
 *   migrated does not silently die. A slash is *unconditionally* a qualifier:
 *   nothing else uses one, so an unknown type before it is reported rather than
 *   guessed at. The split is at the **last** slash.
 *
 * **Package, system and type are lowercase; the shortcode is not.** A shortcode
 * is routinely mixed — `Clb`, `LtShoe`, `HsTunic` — and is folded rather than
 * refused. The three segments in front of it are closed vocabularies with one
 * spelling each, and accepting `Skill` beside `skill` would bless two ways of
 * writing one address, so a capital there is reported. It is tested only once
 * the value *parses*: a note name is full of capitals (`[[Shock State]]`), and
 * calling that a badly-cased address rather than not an address would name the
 * wrong mistake.
 *
 * @param {string} target - The value as authored, anchor already removed.
 * @param {Set<string>} types - Every type the content tree contains.
 * @param {Set<string>} [packages] - Every package an Address may name.
 * @param {Set<string>} [noIndexPackages] - Packages declared
 *   `contentIndex: false`.
 * @returns {{type: string, shortcode: string, itemDoc: boolean,
 *   package?: string, system?: string, reason?: undefined}
 *   | AddressProblem | null}
 *   The partial reading, carrying only the segments written; a `reason` when the
 *   value is definitely qualified but names no known type, no fetched index or a
 *   badly-cased segment; or `null` when it is not an Address at all.
 */
export function readQualifier(target, types, packages, noIndexPackages) {
    if (isAddressTuple(target)) return target;
    const read = readWritten(target, { types, packages, noIndexPackages });
    // A value naming no type at all is a note name, not a badly written
    // address, and the resolvers depend on telling the two apart: prose is full
    // of names, and reporting each one as a dead link would bury the real ones.
    if (read.reason === "not-an-address" || read.reason === "no-type") return null;
    return read;
}

/**
 * The grammar and the vocabularies, with every failure carrying a reason.
 *
 * @param {unknown} written - The value as authored.
 * @param {AddressVocabulary & {type?: string}} vocabulary - The tree's
 *   vocabularies and the position's default type.
 * @param {boolean} [declared] - Whether package membership is checked separately.
 * @returns {object|AddressProblem} The partial reading, or a reason.
 */
function readWritten(written, vocabulary, declared = false) {
    const target = typeof written === "string" ? written : String(written ?? "");
    if (!target) return { reason: "not-an-address" };
    const read = readWrittenCased(target, vocabulary, declared);
    if (!read.reason && qualifyingSegments(target).some((s) => /[A-Z]/.test(s))) {
        return { reason: "not-lowercase" };
    }
    return read;
}

/**
 * The segments of a written value that must be lowercase — everything but the
 * shortcode, which keeps whatever the note declares.
 *
 * @param {string} target - The value as authored.
 * @returns {string[]} The package / system / type segments, as written.
 */
function qualifyingSegments(target) {
    const slash = target.lastIndexOf("/");
    // The `type/shortcode` form states only a type.
    if (slash > 0) return [target.slice(0, slash)];
    const parts = target.split(ADDRESS_SEPARATOR);
    return parts.slice(0, -1);
}

/**
 * {@link readWritten} without the lowercase rule — the grammar alone.
 *
 * @param {string} target - The value as authored.
 * @param {AddressVocabulary & {type?: string}} vocabulary - The vocabularies and
 *   the position's default type.
 * @param {boolean} [declared] - Whether package membership is checked separately.
 * @returns {object|AddressProblem} The partial reading, or a reason.
 */
function readWrittenCased(target, vocabulary, declared = false) {
    const { types = new Set(), packages, noIndexPackages, type: defaultType } = vocabulary;

    // The slash form states neither package nor system, so it is read first and
    // separately. A slash is unconditionally a qualifier — nothing else uses one
    // — which is why an unknown type before it is *reported* rather than read as
    // prose.
    const slash = target.lastIndexOf("/");
    if (slash > 0) {
        const read = readTypeAndCode(target.slice(0, slash), target.slice(slash + 1), types);
        return read ?? { reason: "unknown-type" };
    }

    const parts = target.split(ADDRESS_SEPARATOR);
    switch (parts.length) {
        // `<shortcode>` — the `<type>` segment is omitted, so only a position
        // that accepts exactly one type can say what it names. A position
        // accepting several declares no default, and the value is refused
        // rather than resolved against a guess.
        case 1: {
            if (typeof defaultType !== "string" || !defaultType) return { reason: "no-type" };
            return readTypeAndCode(defaultType, parts[0], types) ?? { reason: "not-an-address" };
        }

        // `<type>-<shortcode>`
        case 2:
            return readTypeAndCode(parts[0], parts[1], types) ?? { reason: "not-an-address" };

        // `<system>-<type>-<shortcode>` — the package defaults to local.
        case 3: {
            const system = norm(parts[0]);
            if (!isSystemSegment(system)) return { reason: "not-an-address" };
            const read = readTypeAndCode(parts[1], parts[2], types);
            return read ? { ...read, system } : { reason: "not-an-address" };
        }

        // `<package>-<system>-<type>-<shortcode>` — the only form that names
        // another package, and the reason a cross-package Address states its
        // system.
        case 4: {
            const pkg = norm(parts[0]);
            // Checked before the type: a package with no fetched index has no
            // vocabulary to resolve the rest of the target against, and the fix
            // is the config declaration, not the shortcode.
            if (!declared && noIndexPackages?.has(pkg))
                return { reason: "no-content-index", package: pkg };
            if (!declared && !packages?.has(pkg)) return { reason: "not-an-address" };
            const system = norm(parts[1]);
            if (!isSystemSegment(system)) return { reason: "not-an-address" };
            const read = readTypeAndCode(parts[2], parts[3], types);
            return read ? { ...read, system, package: pkg } : { reason: "not-an-address" };
        }

        // Five or more segments is not a hyphenated shortcode but a name that
        // happens to carry separators, since no segment may contain one.
        default:
            return { reason: "not-an-address" };
    }
}

/**
 * Resolve a type segment and a shortcode, honouring the virtual `doc<type>`
 * form.
 *
 * @param {string} rawType - The type segment, as written.
 * @param {string} rawCode - The shortcode, as written.
 * @param {Set<string>} types - Every type the content tree contains.
 * @returns {{type: string, shortcode: string, itemDoc: boolean} | null}
 *   `null` when the segment names no known type, or the shortcode is empty.
 */
function readTypeAndCode(rawType, rawCode, types) {
    const shortcode = norm(rawCode);
    if (!shortcode) return null;

    const type = norm(rawType);
    const base = resolveItemDocType(type, types);
    if (base) return { type: base, shortcode, itemDoc: true };
    if (!types.has(type)) return null;
    return { type, shortcode, itemDoc: false };
}
