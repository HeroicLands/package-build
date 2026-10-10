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
 * Emitting this package's content index.
 *
 * Every content build already walks the whole note tree and parses every note's
 * frontmatter — the pack compilers, the site build, and the content-table
 * expander each do it — and every one of them throws the result away when it
 * finishes. So nothing outside a build can ask a question about the content:
 * "which beings carry no `kbcat`?", "what does this table actually select?",
 * "did that type rename leave anything behind?" have no answer short of writing
 * a throwaway script that re-walks the tree. Eight dead Bestiary tables shipped
 * for weeks behind exactly that gap.
 *
 * This module publishes the walk. One line of JSON per note, in
 * [JSON Lines](https://jsonlines.org/) — the whole frontmatter, plus where the
 * note sits in the tree.
 *
 * **The record is the note, not a projection of it.** Frontmatter is
 * heterogeneous and open: in `sohl` it spreads 242 distinct leaf paths unevenly
 * over 15 types, from 9 on a `macro` to 72 on a `being`, and adding a field to
 * one type is ordinary authoring. Any format that fixes a column set would turn
 * that authoring into a schema migration, so nothing here selects, flattens, or
 * renames — a reader addresses `sohl.system.body.weight.base` because that is
 * what the note says, which a SQL query can address directly.
 *
 * **JSON Lines rather than a database.** The artifact has to survive its build
 * and be usable by anything — a person with `jq`, an editor, a CI check,
 * another package's build. A line-per-note text file needs no server, no
 * driver, and no schema; it diffs in a pull request, so a migration that
 * quietly empties a category shows up as a diff rather than as a silently
 * different binary; and it is readable by every language without an install.
 * SQL is not forfeited by the choice — DuckDB reads JSON Lines directly, with
 * nested access — whereas a stored schema would forfeit the open shape.
 *
 * **Byte-stable, because it is meant to be rebuilt.** {@link emitContentIndex}
 * is reachable on its own (`package-build content-index`) and costs a
 * frontmatter parse, not a build, so the honest expectation is that anyone
 * regenerates it whenever they want rather than treating it as precious. That
 * only holds if two runs over an unchanged tree produce an identical file, so
 * records are ordered by content path with the note id breaking any tie — the
 * same total order {@link selectRows} imposes for the same reason — and every
 * object's keys are sorted, at every depth. A walk order is a directory-read
 * order, and directory-read order is not a fact about the content.
 *
 * **Derived, never a source.** The index is written under `build/`, is
 * gitignored with the rest of it, and nothing may be authored against it. It is
 * emphatically not in `paths.stage`: that tree is mirrored destructively into a
 * Foundry data root, so anything left there ships inside the installed system
 * to every player, and a build artifact has no business there.
 *
 * **What it deliberately does not carry: the note's text, and positions within
 * it.** The question is whether the index should record a position for every
 * frontmatter key, so that a pass reading the index could report a field defect
 * without opening the file. It should not, and the numbers are not close: over
 * `sohl`'s 1,685 notes the index is 3.0 MB and holds 50,598 leaf values, so a
 * `{line, column}` on each would add roughly 1.6 MB — **a 54% larger artifact**
 * — to carry data that is only ever read on the *failing* path.
 *
 * The rule that replaces it is the one this module was already built on:
 * **the index carries what is _about_ a note; the file carries the note's text
 * and every position within it.** Any pass needing either opens the file whose
 * path the record already names ({@link noteFile}). That costs nothing it was
 * not already paying — a check reads each note once for its body, and a
 * compiler must read the prose regardless, so while it holds the bytes a
 * position is free. Recording positions would charge every build, and every
 * reader of the artifact, for something the passes that want them get for
 * nothing.
 *
 * The exception proves the rule: an **anchor** carries its `line`, because an
 * anchor is a fact about the note's structure that a consumer addresses
 * directly, not a locator for a diagnostic about a key.
 *
 * @module
 */

import { isAddressSegment } from "./address-charset.mjs";
import { formatDiagnostic, positionOfFrontmatterPath, positionOfYamlPath } from "./diagnostics.mjs";
import {
    decodeNoteAddresses,
    decodeIndexAddresses,
    noteAddressContext,
    encodeAddresses,
    publishAddresses,
} from "./note-addresses.mjs";
import { AddressLink } from "./address-values.mjs";
import fs from "node:fs";
import path from "node:path";

import unidecode from "unidecode";

import { loadForeignIndexes, metadataFileName } from "./metadata-index.mjs";
import { collectAssetRecords } from "./asset-index.mjs";
import { checkForeignAssetBindings } from "./asset-bindings.mjs";
import { addressSlug, canonicalKey } from "./content-address.mjs";
import { isAddressTuple, ownDocumentSystem, readCanonicalKey, renderAddress } from "./address.mjs";
import { NOTE_SYSTEM } from "./systems.mjs";
import { assetAddressIndex } from "./art-fields.mjs";
import { embedRole } from "./content-embeds.mjs";
// One reader for a note's anchors, shared with the link checker and with the
// builds that emit a link. Re-exported because this is where callers
// have always addressed it.
import { collectAnchors, eventAnchors } from "./anchors.mjs";
import { NO_SYSTEM } from "./document-subtypes.mjs";

/**
 * The `<system>` a note belongs to when it belongs to none.
 *
 * The specification's word, not this module's: the canonical address carries it
 * in the same position — `harnadventures-none-being-grod` — so the index and
 * the address say "no system" the same way.
 *
 * @type {string}
 */

export { collectAnchors };
import { entriesForNote, foundryIdentities } from "./foundry-entries.mjs";
import { walkMarkdownTree } from "./helpers.mjs";
// The one statement of what an empty body means, shared with the lint and the
// SQL view that derives the ladder from the absence this writes.
import { isStubNote } from "./note-state.mjs";
import { resolveNoteId } from "./note-ids.mjs";
// The retired-field refusal and the key locator, so a note authoring a derived
// key is reported where it is rather than as a bare abort.
import { assertNoDeclaredPackage } from "./note-package.mjs";
import { locateFrontmatterKey } from "./retired-fields.mjs";
import { loadPackConfig } from "./pack-config.mjs";
// The record accessors, which live apart so that a module the compilers load
// can read a record without importing this one and closing a cycle.
// Re-exported because this is where callers have always addressed them.
import {
    authoredFrontmatter,
    DERIVED_KEYS,
    deriveRecordData,
    isAssetRecord,
    isNoteRecord,
    isStub,
    noteFile,
    recordPath,
    sortKeysDeep,
} from "./index-records.mjs";
import { isDraftNote } from "./note-vocabulary.mjs";
// A being's computed `age` — the middle state between an authored override and
// an unknown one — filled in against the package's own declared present before
// a record is built, so the index carries it without the note being written to.
import { applyComputedBeingAge, presentAmongFrontmatters } from "./being-age.mjs";
import { reckoningContext } from "./reckoning-markers.mjs";
import { resolvedDateFields } from "./note-dates.mjs";

export {
    authoredFrontmatter,
    DERIVED_KEYS,
    isAssetRecord,
    isNoteRecord,
    isStub,
    noteFile,
    recordPath,
    sortKeysDeep,
};

/**
 * The address a wikilink writes to reach a note, or `null` when it has none.
 *
 * A wikilink target is an address: `being-aurochs` locally, or
 * `sohl-being-aurochs` from another package (`readQualifier` also accepts
 * `being/aurochs`, the same two fields with a different separator). Both are
 * *partial* addresses — the canonical one this field records is
 * `sohl-sohl-being-aurochs`, and a target that omits the system is matched
 * with that segment wildcarded. Every form is already derivable from `type` and
 * `shortcode`, which every record carries, plus the system the type compiles
 * into — so this field adds no information. What it adds is the *rule*: the
 * lowercasing, the hyphen join and the system lookup live in one place, and a
 * consumer that reimplements them slightly differently gets a lookup that
 * matches nothing and says nothing about why. That is a real failure, not a
 * hypothetical one — it is precisely how a resolver keyed on a bare
 * `type/shortcode` silently misses every canonical
 * `pkg-system-type-shortcode` entry.
 *
 * Derived by the same functions the link manifest and the site build use, so an
 * index cannot disagree with either about where a note lives.
 *
 * @param {Record<string, any>} frontmatter - The note's parsed frontmatter.
 * @param {string} contentPackage - The package the tree compiles as.
 * @returns {{slug: string, canonical: string}|null} `slug` is what goes inside
 *   `[[…]]` within this package; `canonical` is the fully qualified key the
 *   manifest files the note under, carrying the package and the system as well. `null` for a note with no type or no
 *   shortcode, which has no address at all and is stated as such rather than
 *   left for every reader to rediscover.
 */
export function noteAddress(frontmatter, contentPackage) {
    let slug;
    try {
        slug = addressSlug(frontmatter);
    } catch {
        // Unaddressable is ordinary — a template, a stub, a note that carries
        // no shortcode — and not this pass's business to report. The manifest
        // emitter already reports it, where it means a missing published page.
        return null;
    }
    return {
        slug,
        canonical: canonicalKey(
            contentPackage,
            ownDocumentSystem(frontmatter.type),
            frontmatter.type,
            frontmatter.shortcode,
        ),
    };
}

/**
 * A note's display name reduced to printable 7-bit ASCII.
 *
 * Content names carry the setting's orthography — `Kûrbúl Helm`, `Hârn`,
 * `Kèthîra` — and nobody types them. A reader searching the index, or an editor
 * completing a wikilink, needs a form that matches what a keyboard produces, so
 * the record states one rather than leaving every consumer to invent it (and to
 * invent a *different* one, which is how two searches over the same data come
 * to disagree).
 *
 * **Transliterated, not stripped.** `unidecode` — the same table
 * {@link slugify} already runs, so an ASCII name and a slug can never disagree
 * about a character — carries a letter across rather than deleting it:
 * diacritics fold (`â`→`a`, `è`→`e`), ligatures expand (`æ`→`ae`, `Œ`→`OE`,
 * `ß`→`ss`), the runic letters spell out (`þ`→`th`, `Þ`→`Th`, `ð`→`d`), and
 * even a vulgar fraction becomes readable (`¾`→`3/4`). Deleting them instead
 * would collapse `Kûrbúl` to `Krbl`, which is worse than the original.
 *
 * Anything still outside printable ASCII after that becomes a space, and runs
 * of whitespace collapse — a space rather than nothing, so a character that
 * transliterates away cannot silently weld two words together.
 *
 * The value is emitted even when it equals the name, so a consumer matching on
 * it never has to branch on whether the name happened to be ASCII already.
 *
 * @param {unknown} name - The note's `name.full`.
 * @returns {string|null} The ASCII form, or `null` when there is no name, or
 *   nothing printable survives.
 */
export function asciiName(name) {
    if (typeof name !== "string") return null;
    const folded = unidecode(name)
        .replace(/[^\x20-\x7E]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return folded === "" ? null : folded;
}

/**
 * A note's `name.aliases` reduced to printable 7-bit ASCII, in order.
 *
 * An alias is the name a reader is at least as likely to reach for as the
 * canonical one — `Killer Whale` for an orca, `Ice Bear` for a polar bear,
 * `Ix'balam` for a jaguar — so anything searching or completing over the index
 * has to match them too, and needs the same keyboard-typeable form
 * {@link asciiName} gives the primary name.
 *
 * Order is the authored order, so a caller can pair an entry with the alias it
 * came from. An alias that is not a non-empty string, or that leaves nothing
 * printable behind, is dropped rather than left as a hole — the array is a set
 * of names to match, and a null in it is not one.
 *
 * @param {unknown} aliases - The note's `name.aliases`; may be absent or null.
 * @returns {Array<string>} Possibly empty, never null: a note with no aliases
 *   has an empty set of them, which is a fact rather than a missing value, and
 *   a consumer iterating it should not have to check first.
 */
export function asciiAliases(aliases) {
    if (!Array.isArray(aliases)) return [];
    return aliases.map((alias) => asciiName(alias)).filter((alias) => alias !== null);
}

/**
 * This note's Foundry addresses, or `null` where it has none.
 *
 * **Derived by the manifest's own code, not a second implementation of it.**
 * {@link module:engine/manifest-emit.entriesForNote} is what the link manifest
 * emits from, and a UUID is a function of the note's `type` and authored `id`
 * plus the pack router — frontmatter and configuration, nothing from a compiled
 * pack — so the index's frontmatter walk already has every input. Deriving it
 * twice is how two artifacts describing one note start disagreeing, which is
 * the failure the merge is meant to end.
 *
 * The shape flattens the manifest's *two* entries for an item note onto the one
 * record the index keeps per note. An item compiles into a document **and** a
 * documentation journal, and both are addressable — so the item's own UUID sits
 * at the top and the journal's beside it under `doc`, with the anchor map that
 * addresses its pages. A note that is itself a journal carries that map
 * directly.
 *
 * Every address is independently optional, exactly as the manifest has it: a
 * note that compiles to no document has no UUID, and inventing one would assert
 * a target that does not exist.
 *
 * @param {object} args - Arguments.
 * @param {object} args.frontmatter - The note's frontmatter.
 * @param {object|null} args.address - Its resolved address, or null.
 * @param {string} args.body - The note body, for anchor discovery.
 * @param {object|null} args.manifest - The manifest context, when available.
 * @returns {object|null} `{ uuid?, anchors?, doc? }`, or null when the note has
 *   no Foundry address at all.
 */
function foundryEntries({ frontmatter, address, body, manifest }) {
    // No address is not an error here — the index records every note, including
    // ones that publish nothing, and the manifest reports that case separately.
    if (!manifest || !address) return null;

    let entries;
    try {
        // The slug, not the address object: the manifest emitter takes the
        // published path as a string and builds its `url` from it.
        entries = entriesForNote(
            frontmatter,
            frontmatter?.name?.full ?? "",
            address.slug,
            body ?? "",
            manifest,
        );
    } catch {
        // A note the manifest cannot address is still a note. The index says so
        // by carrying no `foundry` block rather than by failing the walk.
        return null;
    }
    if (!entries?.length) return null;
    const [own, docEntry] = entries;
    return { own: own ?? null, doc: docEntry ?? null };
}

/**
 * The `foundry` block for one manifest entry, **keyed by the system that
 * compiles it**.
 *
 * A note may declare more than one system — 2,497 of `harn-ensemble`'s carry
 * both a `sohl:` and an `hm3:` block — and each compiles into its *own* Foundry
 * document, of that system's document type, in that system's pack. One `uuid`
 * on the record cannot name two documents, so it named whichever the single
 * shipped map produced and said nothing about the other.
 *
 * Only `sohl` can appear today, because `KNOWN_DOCUMENT_SUBTYPE_MAPS` holds one
 * map, the `hm3/` half being separate. The shape is system-keyed so
 * that adding it is one more key rather than a second breaking change to an
 * artifact consumers have already started reading.
 *
 * **Derived, and a sibling of the authored block rather than inside it.** The
 * uuid could have been synthesized onto `sohl:`/`hm3:` themselves, but those are
 * regions a note *authors*, and {@link DERIVED_KEYS} — which refuses a note that
 * writes over derived data — reaches only the top level. A note authoring
 * `sohl.uuid` would collide silently, which is the failure this index exists to
 * stop rather than to add.
 *
 * @param {object|null} entry - A manifest entry.
 * @param {string} system - The system whose document this is.
 * @returns {object|null} `{ [system]: { uuid?, anchors? } }`, or null when it
 *   addresses nothing.
 */

function foundryBlock(entry, system) {
    if (!entry) return null;
    if (entry.systemUuids && Object.keys(entry.systemUuids).length)
        return Object.fromEntries(
            Object.entries(entry.systemUuids).map(([targetSystem, uuid]) => [
                targetSystem,
                { uuid },
            ]),
        );
    const block = {};
    if (entry.uuid) block.uuid = entry.uuid;
    if (entry.anchors) block.anchors = entry.anchors;
    if (!Object.keys(block).length) return null;
    return { [system || NO_SYSTEM]: block };
}

/**
 * Refuse a note that authors a key the index derives, and say where.
 *
 * **Located, because every reader of the index is now a reporter of this.**
 * With the emitter the only pass building a record, aborting
 * with a bare message was the whole story. Now the link check and the address
 * diff read the index too, and a bare abort in one of them reports *nothing*
 * about the tree — the one malformed note takes every other finding with it,
 * and the reader is handed a stack instead of a line to open. So the error
 * carries `file` and a `position`, and a pass that collects rather than throws
 * can emit `file:line:column: error: …` like any other finding.
 *
 * **`package:` keeps its own words.** It is not a name collision but a *retired
 * field*, and the correction is to delete it, not to rename it — which is
 * what {@link module:engine/note-package.assertNoDeclaredPackage} has always
 * said, and had no caller to say it to. Deferring to it means one message for
 * one mistake rather than two that contradict each other about the fix.
 *
 * @param {object} frontmatter - The note's parsed frontmatter.
 * @param {string} relPath - The note's path within the tree, for the message.
 * @param {string} [absPath] - The file, read only on the failing path to locate
 *   the offending key.
 * @param {string} [contentPackage] - The package this tree compiles as.
 * @returns {void}
 * @throws {Error} When the note authors a derived key. `file` and `position`
 *   ride on the error.
 */
function assertNoDerivedKeys(frontmatter, relPath, absPath, contentPackage) {
    for (const key of DERIVED_KEYS) {
        if (!Object.hasOwn(frontmatter ?? {}, key)) continue;
        if (key === "package") {
            // Throws with its own wording, and its own position.
            assertNoDeclaredPackage(frontmatter, { absPath, configured: contentPackage });
        }
        const err = new Error(
            `\`${key}:\` is derived by the content index and cannot be ` +
                `authored — rename the frontmatter field`,
        );
        err.file = relPath;
        const position = absPath ? locateFrontmatterKey(absPath, key) : undefined;
        if (position) err.position = position;
        throw err;
    }
}

/**
 * Build one index record from a note's frontmatter and its place in the tree.
 *
 * The frontmatter as authored, plus what the index derives from it: the package
 * it compiles as, its address, ASCII folds of its name and aliases, the anchors
 * of its body, its Foundry block, the address of its documentation journal, and
 * where the file sits within the tree.
 *
 * @param {object} options - Options.
 * @param {Record<string, any>} options.frontmatter - The note's parsed frontmatter.
 * @param {string} options.relPath - Its path below the content root, POSIX-separated.
 * @param {string} [options.absPath] - The file, read only on the failing path to
 *   locate the offending key.
 * @param {string} options.contentPackage - The package the tree compiles as.
 * @param {string} [options.body] - The note's markdown body, for its anchors
 *   and for the one question that decides whether the note publishes a page. A
 *   caller that states no body is stating an empty one, and the note is a stub.
 * @param {number} [options.bodyLine] - The 1-based file line the body starts on.
 * @param {object} [options.manifest] - The package manifest, which the Foundry
 *   entries are derived against.
 * @param {object} [options.addressContext] - Address resolution context.
 * @param {object} [options.dateContext] - Calendar conversion context.
 * @param {(address: string) => string|undefined} [options.resolveRole] - From
 *   a picture's address to the role its asset declares, so a figure anchor's
 *   `name` reads `Map 1` rather than `Figure 1` where it is due — see
 *   {@link module:engine/content-figures.scanFigures}.
 * @returns {Record<string, any>} The record, keys sorted at every depth. A
 *   **stub** — a note with an empty body, on a type an empty body suppresses —
 *   carries `address` and `anchors` as `null`: it publishes no page, so it
 *   holds no address and offers no anchor. It keeps its `id`, and a `foundry`
 *   block naming every document that was made — which is every document
 *   derived from `data:`, and no journal, because a journal of an empty body
 *   would be empty and is not created.
 * @throws {Error} When the note carries a key this module derives, which would
 *   otherwise be overwritten without a word. `file` and, where the file was
 *   read, `position` ride on the error.
 */
export function buildIndexRecord({
    frontmatter,
    relPath,
    absPath,
    contentPackage,
    body,
    bodyLine,
    manifest,
    addressContext,
    dateContext,
    resolveRole,
}) {
    assertNoDerivedKeys(frontmatter, relPath, absPath, contentPackage);

    const posix = relPath.split(path.sep).join("/");
    const folder = posix.includes("/") ? posix.slice(0, posix.lastIndexOf("/")) : "";
    try {
        decodeNoteAddresses(frontmatter, addressContext ?? { package: contentPackage });
    } catch (error) {
        error.file = absPath ?? relPath;
        if (absPath && error.keyPath) {
            const yamlText = fs
                .readFileSync(absPath, "utf8")
                .match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
            const position = positionOfYamlPath(yamlText, error.keyPath, { key: error.addressKey });
            if (position.line) position.line++;
            error.position = position;
        }
        throw error;
    }
    const address = noteAddress(frontmatter, contentPackage);
    // Derived from the address the note *would* hold, because a stub still
    // compiles every document derived from `data:` — an unwritten arcane talent
    // is its Item. The one document it has none of is the one that would be
    // empty, and `entriesForNote` withholds that UUID, so this block names
    // nothing that was not made.
    const entries = foundryEntries({ frontmatter, address, body, manifest });
    // A stub — an empty body on a type an empty body suppresses — publishes no
    // page, so it holds no address and offers no anchor to link to. **The
    // absent address is the signal**, and it is the column the table renderer
    // already reads through `_ref`. Everything else the note declares is kept:
    // its file is what the author edits and what every diagnostic names, and
    // its `id` is the identity every diagnostic and every table reads.
    const stub = isStubNote(frontmatter, body);
    const resolvedDates = dateContext ? resolvedDateFields(frontmatter, dateContext) : {};

    return /** @type {Record<string, any>} */ (
        decodeIndexAddresses(
            {
                ...frontmatter,
                ...(Object.keys(resolvedDates).length ? { resolvedDates } : {}),
                package: contentPackage,
                address: stub ? null : address,
                nameAscii: asciiName(frontmatter?.name?.full),
                aliasesAscii: asciiAliases(frontmatter?.name?.aliases),
                // Each anchor carries the link that reaches it, so a section is
                // addressable from the index without anyone re-deriving how an
                // anchor is spelled — its file line, so an editor can jump
                // there rather than search for the heading — and its kind, so
                // a field accepting only an event can tell one from a heading.
                // The note's events join the body's anchors: one namespace.
                anchors:
                    stub ? null : (
                        [
                            ...collectAnchors(body, bodyLine, resolveRole),
                            ...eventAnchors(frontmatter, rawNote(absPath)),
                        ]
                            .sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
                            .map((a) => ({
                                ...a,
                                link:
                                    address ?
                                        new AddressLink(
                                            readCanonicalKey(address.canonical),
                                            a.slug,
                                            a.kind,
                                        )
                                    :   null,
                            }))
                    ),
                foundry: foundryBlock(entries?.own, ownDocumentSystem(frontmatter?.type)),
                // Forward link to the note's documentation journal, which is its
                // own record. Named rather than nested, because the journal is a
                // separate document with its own address — see `buildDocRecord`.
                documentation: entries?.doc?.key ?? null,
                file: {
                    // Relative to the content root, and deliberately not absolute.
                    // An absolute path is a fact about the machine that built the
                    // index, not about the content: it would differ between two
                    // checkouts of the same tree, so the file would stop being
                    // byte-stable, and a published copy would carry someone's home
                    // directory and be wrong for every reader. Anyone holding the
                    // index knows the root it was built from, and `root + path` is
                    // the absolute form whenever it is wanted.
                    path: posix,
                    folder,
                    name: path.basename(posix, ".md"),
                },
            },
            addressContext ?? { package: contentPackage },
        )
    );
}

/**
 * A note's full text, for the line an event's `id` sits on; `undefined` when
 * there is no file to read, so the line is dropped rather than guessed.
 *
 * @param {string} [absPath] - The note's file.
 * @returns {string|undefined} Its contents.
 */
function rawNote(absPath) {
    if (!absPath || !fs.existsSync(absPath)) return undefined;
    return fs.readFileSync(absPath, "utf8");
}

/**
 * The record for an item note's **documentation journal**.
 *
 * An item note compiles into two documents — the item, and a JournalEntry
 * holding its prose — and the second is a document in its own right: its own
 * canonical `note` address with the authored type, its own UUID and pages.
 * So it gets its own record, and resolving `docaffliction/blkdth` is the same
 * lookup as resolving anything else. Nested inside the item's record it would
 * be the one address in the index reachable only by knowing to look somewhere
 * else, which every consumer would have to special-case.
 *
 * **Lean, and deliberately not the note's frontmatter.** The item's `sohl:`
 * block describes the *item*; copying it onto the journal would assert things
 * about the journal that are not true, and double the file to do it. What the
 * journal has of its own is its addresses, its **id**, its name, and the file
 * it came from — plus `documents`, naming the record it is the documentation
 * for, so the link is navigable in both directions.
 *
 * On the web both addresses resolve to one page — the item note renders as the
 * page that *is* its documentation — so the slug is shared and only the
 * canonical key differs.
 *
 * @param {object} args - Arguments.
 * @param {object} args.frontmatter - The item note's frontmatter.
 * @param {object} args.address - The item's own address.
 * @param {object} args.entry - The manifest's doc entry.
 * @param {object} args.file - The `file` block of the item's record.
 * @param {string} args.contentPackage - The package the note belongs to.
 * @param {Array<object>} args.anchors - The web anchors of the note body.
 * @returns {Record<string, any>} The documentation journal's index record.
 */
function buildDocRecord({ frontmatter, address, entry, file, contentPackage, anchors }) {
    // **The entry names a document only where one was made**, and where it does
    // not, nothing on this record may name one either: no id, no address and no
    // anchors. The record itself stays, because the index records what a note
    // produces and `null` is how it says a document was not produced — the same
    // signal a stub's absent address already is.
    const made = Boolean(entry.uuid);
    return /** @type {Record<string, any>} */ (
        sortKeysDeep({
            package: contentPackage,
            type: frontmatter.type,
            shortcode: frontmatter.shortcode,
            name: frontmatter.name,
            // The journal's own `_id`, taken from the entry rather than
            // re-derived: every entry the index gives an identity to publishes
            // both the id and the UUID, computed once by whatever owns that
            // entry's derivation.
            id: made ? entry.id : null,
            nameAscii: asciiName(frontmatter?.name?.full),
            address: made ? { slug: address.slug, canonical: entry.key } : null,
            // The record this is the documentation *for*. `documentation` is
            // the forward link on that record, so either end reaches the other.
            documents: address.canonical,
            anchors: made ? anchors : null,
            foundry: foundryBlock(entry, NOTE_SYSTEM),
            file,
        })
    );
}

/** Derive every index record belonging to one parsed note. */
export function indexRecordsForNote({
    frontmatter,
    body,
    bodyLine,
    relPath,
    absPath,
    contentPackage,
    manifest,
    addressContext,
    dateContext,
    resolveRole,
}) {
    resolveNoteId(frontmatter, { pkg: contentPackage });
    const record = buildIndexRecord({
        frontmatter,
        body,
        bodyLine,
        relPath,
        absPath,
        contentPackage,
        manifest,
        addressContext,
        dateContext,
        resolveRole,
    });
    const records = [decodeIndexAddresses(record, addressContext ?? { package: contentPackage })];
    const address = noteAddress(frontmatter, contentPackage);
    const doc = foundryEntries({ frontmatter, address, body, manifest })?.doc;
    if (doc?.key && address) {
        records.push(
            buildDocRecord({
                frontmatter,
                address,
                entry: doc,
                file: record.file,
                contentPackage,
                anchors: record.anchors ?? [],
            }),
        );
    }
    return records;
}

/** The `lore` subType that is a culture, and so is its own. */
const CULTURE_SUBTYPE = "culture";

/** The `doc` subType whose culture is its own value. */
const SETTING_GUIDE_SUBTYPE = "settingguide";

/** The `affiliation` subType that also takes the culture of the places it holds. */
const POLITY_SUBTYPE = "polity";

/** The types whose culture is their own value and nothing else. */
const OWN_CULTURE_TYPES = new Set(["lore", "being", "doc"]);

/** The types that inherit a culture through `data.parents`. */
const INHERITING_TYPES = new Set(["place", "affiliation"]);

/** A resolution that yields no culture. */
const NO_CULTURE = Object.freeze({ culture: undefined, errored: false });

/**
 * The canonical key an Address names, without any anchor.
 *
 * @param {unknown} value - A tuple, an {@link AddressLink}, or anything else.
 * @returns {string|undefined} The key, or `undefined` for a value that is not a
 *   decoded Address.
 */
function addressKey(value) {
    const tuple = value instanceof AddressLink ? value.target : value;
    return isAddressTuple(tuple) ? renderAddress(tuple) : undefined;
}

/**
 * The culture Address a value states, as a tuple.
 *
 * @param {unknown} value - A `data.culture` value.
 * @returns {object|undefined} The tuple, or `undefined` when the value is not a
 *   decoded Address.
 */
function cultureTuple(value) {
    const tuple = value instanceof AddressLink ? value.target : value;
    return isAddressTuple(tuple) ? tuple : undefined;
}

/**
 * Write each note's resolved culture into its record, as `data.culture`.
 *
 * A note's culture is:
 *
 * - its own `data.culture`, when it states one;
 * - for a `lore` note of `subType: culture`, its own canonical Address;
 * - for a `place` or an `affiliation`, else the resolved cultures of its
 *   `data.parents`;
 * - for a `polity` affiliation, else the resolved cultures of its places: its
 *   `data.seat` pooled with every place whose `data.government` names it, as
 *   one set;
 * - else nothing. A `being`, a `doc` and any other `lore` note have their own
 *   value only; every other type has none.
 *
 * A parent's culture is its own resolved culture, found recursively; a parent
 * resolving to nothing is ignored, as is one in another package that its index
 * gives none. Sources that agree give that culture. Sources that differ, on a
 * note with no value of its own, give it none and one error finding, at
 * `data.parents`, or for a polity's places at `data.seat`, else at its `data:`
 * line. A note whose parent raised that error treats the parent as resolving to
 * nothing, so a disagreement is reported once, where it is. A cycle resolves to
 * nothing.
 *
 * A parent in another package is read through `foreignRecord`, whose published
 * entry already carries that parent's resolved culture, so a foreign chain is
 * never walked.
 *
 * The record's `data` is replaced by a copy carrying the culture, never
 * assigned into, because the compile steps read the frontmatter it was spread
 * from; and the authored `data` stays what
 * {@link module:engine/index-records.authoredFrontmatter} returns, so a lint or
 * a compile reading the record reads no culture the note did not write. A note
 * resolving to nothing gains no `culture` key.
 *
 * @param {Array<Record<string, any>>} records - Index records, every Address a
 *   tuple. Records that are not notes are passed over.
 * @param {object} options - Options.
 * @param {string} options.contentPackage - The package the records belong to.
 * @param {string} [options.contentBase] - The content tree, for opening a
 *   conflicting note to locate the finding. Without it a finding names the
 *   note's path within the tree and no position.
 * @param {(key: string) => ({culture?: unknown}|undefined)} [options.foreignRecord] -
 *   Another package's entry for a canonical address. Asked only for an
 *   immediate parent whose package is not this one.
 * @param {object[]} [options.problems] - Receives each conflict as a finding.
 *   Omitted, every conflict is collected and one Error lists them all.
 * @returns {Array<Record<string, any>>} The same records.
 * @throws {Error} When `problems` is omitted and any note's sources disagree.
 */
export function resolveCultures(records, { contentPackage, contentBase, foreignRecord, problems }) {
    // Each note under every key a link may name it by: its record's canonical
    // address, and its page address in the `note` system, which is what a
    // `data.parents`, `data.seat` or `data.government` link names.
    const notes = new Map();
    const pageKey = new Map();
    for (const record of records) {
        if (!isNoteRecord(record) || !isAddressSegment(String(record.shortcode ?? ""))) continue;
        const page = canonicalKey(contentPackage, NOTE_SYSTEM, record.type, record.shortcode);
        const own =
            record.address ?
                addressKey(record.address.canonical)
            :   noteAddress(record, contentPackage)?.canonical;
        pageKey.set(record, page);
        for (const key of [page, own]) if (key && !notes.has(key)) notes.set(key, record);
    }
    const recordOf = (value) => notes.get(addressKey(value));

    // The places each polity governs, read once from the places that name it.
    const governed = new Map();
    for (const record of pageKey.keys()) {
        if (record.type !== "place") continue;
        const polity = recordOf(record.data?.government);
        if (!polity) continue;
        if (!governed.has(polity)) governed.set(polity, []);
        governed.get(polity).push(record);
    }

    const memo = new Map();
    const inProgress = new Set();
    const findings = [];

    /**
     * A source Address's culture: a local note's resolved one, or the one a
     * foreign entry publishes. A foreign item type is published under its
     * system's address as well as its page's, so both are asked for.
     *
     * @param {unknown} value - The Address.
     * @returns {object|undefined} The culture tuple.
     */
    const cultureThrough = (value) => {
        const key = addressKey(value);
        if (!key) return undefined;
        const tuple = value instanceof AddressLink ? value.target : value;
        if (tuple.package === contentPackage) {
            const record = recordOf(tuple);
            return record ? resolve(record).culture : undefined;
        }
        if (!foreignRecord) return undefined;
        const entry =
            foreignRecord(key) ??
            foreignRecord(
                canonicalKey(
                    tuple.package,
                    ownDocumentSystem(tuple.type),
                    tuple.type,
                    tuple.shortcode,
                ),
            );
        return cultureTuple(entry?.culture);
    };

    /**
     * Agree the cultures of a set of sources.
     *
     * @param {Array<unknown>} sources - Addresses, in the order they are named.
     * @returns {{culture?: object, distinct: Array<{key: string, via: unknown}>}}
     *   The one culture they agree on, or each distinct culture with the first
     *   source it came through.
     */
    const agree = (sources) => {
        const distinct = new Map();
        for (const source of sources) {
            const culture = cultureThrough(source);
            const key = addressKey(culture);
            if (key && !distinct.has(key)) distinct.set(key, { culture, via: source });
        }
        const list = [...distinct].map(([key, { culture, via }]) => ({ key, culture, via }));
        return { culture: list.length === 1 ? list[0].culture : undefined, distinct: list };
    };

    /**
     * Report a disagreement on one note.
     *
     * @param {Record<string, any>} record - The note.
     * @param {string[]} keyPath - Where the disagreement is written.
     * @param {string} subject - What disagrees, as the message opens.
     * @param {Array<{key: string, via: unknown}>} distinct - The cultures and
     *   their sources.
     * @returns {{culture: undefined, errored: true}} The resolution.
     */
    const conflict = (record, keyPath, subject, distinct) => {
        const file = contentBase ? noteFile(contentBase, record) : record.file?.path;
        const raw = contentBase && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
        let position = positionOfFrontmatterPath(raw, keyPath, { key: true });
        if (position.line === undefined && keyPath.length > 1)
            position = positionOfFrontmatterPath(raw, ["data"], { key: true });
        const via = (value) => {
            const tuple = value instanceof AddressLink ? value.target : value;
            return tuple.package === contentPackage ? tuple.shortcode : addressKey(tuple);
        };
        const named = distinct.map(({ key, via: source }) => `${key} via ${via(source)}`);
        findings.push({
            file,
            ...position,
            severity: "error",
            message:
                `${subject} resolve to different cultures (${named.join(", ")}); ` +
                `state data.culture`,
        });
        return { culture: undefined, errored: true };
    };

    /**
     * One note's resolution, by the rules above.
     *
     * @param {Record<string, any>} record - The note's record.
     * @returns {{culture?: object, errored: boolean}} Its culture, and whether
     *   it raised a conflict.
     */
    const resolveRecord = (record) => {
        const type = String(record.type ?? "");
        const subType = String(record.subType ?? "").toLowerCase();
        if (type === "lore" && subType === CULTURE_SUBTYPE)
            return { culture: readCanonicalKey(pageKey.get(record)), errored: false };
        if (!OWN_CULTURE_TYPES.has(type) && !INHERITING_TYPES.has(type)) return NO_CULTURE;
        if (type === "doc" && subType !== SETTING_GUIDE_SUBTYPE) return NO_CULTURE;
        const own = cultureTuple(record.data?.culture);
        if (own) return { culture: own, errored: false };
        if (!INHERITING_TYPES.has(type)) return NO_CULTURE;

        const parents = Array.isArray(record.data?.parents) ? record.data.parents : [];
        const fromParents = agree(parents);
        if (fromParents.distinct.length > 1)
            return conflict(record, ["data", "parents"], "data.parents", fromParents.distinct);
        if (fromParents.culture) return { culture: fromParents.culture, errored: false };

        if (type !== "affiliation" || subType !== POLITY_SUBTYPE) return NO_CULTURE;
        const seat = addressKey(record.data?.seat) ? record.data.seat : undefined;
        const seatRecord = seat ? recordOf(seat) : undefined;
        const places = [
            ...(seat ? [seat] : []),
            ...(governed.get(record) ?? [])
                .filter((place) => place !== seatRecord)
                .map((place) => pageKey.get(place))
                .sort()
                .map((key) => readCanonicalKey(key)),
        ];
        const fromPlaces = agree(places);
        if (fromPlaces.distinct.length > 1)
            return conflict(
                record,
                seat ? ["data", "seat"] : ["data"],
                seat ?
                    "data.seat and the places this polity governs"
                :   "the places this polity governs",
                fromPlaces.distinct,
            );
        return fromPlaces.culture ? { culture: fromPlaces.culture, errored: false } : NO_CULTURE;
    };

    /**
     * A local note's resolution, memoised; a note already being resolved is a
     * cycle and resolves to nothing.
     *
     * @param {Record<string, any>} record - The note's record.
     * @returns {{culture?: object, errored: boolean}} Its resolution.
     */
    const resolve = (record) => {
        if (memo.has(record)) return memo.get(record);
        if (inProgress.has(record)) return NO_CULTURE;
        inProgress.add(record);
        const result = resolveRecord(record);
        inProgress.delete(record);
        memo.set(record, result);
        return result;
    };

    // Walked in address order, so which note of a cycle is met first is a fact
    // about the content rather than about directory-read order.
    const ordered = [...pageKey].sort(([, a], [, b]) =>
        a < b ? -1
        : a > b ? 1
        : 0,
    );
    for (const [record] of ordered) {
        const { culture } = resolve(record);
        if (culture && addressKey(culture) !== addressKey(record.data?.culture))
            deriveRecordData(record, { ...record.data, culture });
    }

    findings.sort(
        (a, b) =>
            String(a.file).localeCompare(String(b.file), "en") ||
            (a.line ?? 0) - (b.line ?? 0) ||
            (a.column ?? 0) - (b.column ?? 0),
    );
    if (problems) problems.push(...findings);
    else if (findings.length)
        // Each line already starts with its path, so it is printed unprefixed.
        throw Object.assign(new Error(findings.map(formatDiagnostic).join("\n")), {
            located: true,
        });
    return records;
}

/**
 * Read a content tree into index records, in the order they will be written.
 *
 * An item note yields two records — the item, and the documentation journal
 * that is a document in its own right.
 *
 * **The asset roots are walked in the same pass.** A package's addressable files
 * sit beside `content/` rather than inside it, and they publish into the same
 * index under the same address grammar — so there is no second walk, no second
 * artifact, and no notion of an "art module" anywhere in the toolchain. A
 * package whose tree holds only assets is one by consequence.
 *
 * @param {string} contentBase - The content tree to walk.
 * @param {object} options - Options.
 * @param {string} options.contentPackage - The package the tree compiles as.
 * @param {readonly string[]} options.skipDirectories - The walk's scope, stated
 *   by the caller. An absent one is the caller's omission, and
 *   {@link module:engine/helpers.walkMarkdownTree} throws on it.
 * @param {string} [options.assetsBase] - The package's asset directory, holding
 *   the three asset roots. Omitted, no asset is indexed — which is what a caller
 *   walking a bare content fixture wants, and what an asset-free package gets
 *   anyway.
 * @param {object} [options.manifest] - The package manifest, which the Foundry
 *   entries are derived against.
 * @param {object} [options.addressContext] - Address resolution context.
 * @param {object[]} [options.problems] - Supplied by a **reader**: a note that
 *   cannot be recorded is pushed here as a diagnostic and skipped. Omitted, the
 *   note throws — the contract the emitter needs, since an index missing a note
 *   asserts that it does not exist. The same holds for a culture conflict: a
 *   reader receives each as a finding, and the emitter throws once, listing
 *   every one.
 * @param {(key: string) => ({culture?: unknown}|undefined)} [options.foreignRecord] -
 *   Another package's entry for a canonical address, read for a parent that
 *   package publishes; see {@link resolveCultures}.
 * @returns {Array<Record<string, any>>} The records, in a total order that does
 *   not depend on directory-read order.
 */
export function collectContentIndex(
    contentBase,
    {
        contentPackage,
        skipDirectories,
        assetsBase,
        manifest,
        problems,
        addressContext,
        foreignRecord,
    },
) {
    const records = [];
    // Passed through rather than defaulted away: an absent scope is the
    // caller's omission, and `walkMarkdownTree` says so.
    const walkOpts = { skipDirectories };

    // A package may ship assets and no notes at all, in which case there is no
    // tree to walk and the index is its asset records. The caller decides
    // whether an absent tree is a mistake; by the time the walk is reached it
    // is simply a package with nothing to compile.
    // Materialised rather than consumed lazily: the present is read from this
    // same walk before the loop below reads it a second time, and
    // `walkMarkdownTree` is a generator — a single-use one, exhausted the
    // moment anything else iterates it first.
    const notes = fs.existsSync(contentBase) ? [...walkMarkdownTree(contentBase, walkOpts)] : [];
    const parsedNotes = [];
    for (const note of notes) {
        if (!note.parseError) {
            parsedNotes.push(note);
            continue;
        }
        const problem = {
            file: note.absPath,
            ...(note.parseError.line === undefined ? {} : { line: note.parseError.line }),
            ...(note.parseError.column === undefined ? {} : { column: note.parseError.column }),
            severity: "error",
            message: note.parseError.message,
        };
        if (!problems) {
            const error = new Error(problem.message);
            error.file = problem.file;
            error.position = {
                ...(problem.line === undefined ? {} : { line: problem.line }),
                ...(problem.column === undefined ? {} : { column: problem.column }),
            };
            error.keyPath = [];
            throw error;
        }
        problems.push(problem);
    }

    // The package's declared present, read once from whichever `place` note in
    // this same walk states one — the whole tree is already in memory, so no
    // second read is needed to answer a question about all of it.
    const present = presentAmongFrontmatters(parsedNotes.map((n) => n.frontmatter));
    // Carried on the same context `resolvedDateFields` reads: a recurring
    // event's `next` is computed against this present exactly as a being's
    // `age` already is, above.
    const dates = {
        ...reckoningContext({ notes: parsedNotes.map((n) => n.frontmatter) }),
        present,
    };

    // Walked ahead of the notes, rather than after them as the records
    // themselves are emitted: a note's anchors are collected below, and a
    // figure fence's `map` counter needs this package's own asset roles
    // before the first note is read, the same precedent the book's own
    // cross-file numbering sets. A package with no `assetsBase` resolves no
    // role, which is the one it would have resolved anyway.
    const assetRecords =
        assetsBase ? collectAssetRecords(assetsBase, { contentPackage, problems }) : [];
    const assetIndex = assetAddressIndex(assetRecords, { config: { contentPackage } });
    const resolveRole = (address) => embedRole(assetIndex, address);

    for (const { frontmatter, body, bodyLine, absPath } of parsedNotes) {
        const fm = frontmatter ?? {};
        applyComputedBeingAge(fm, present, dates);
        const relPath = path.relative(contentBase, absPath);
        try {
            records.push(
                ...indexRecordsForNote({
                    frontmatter: fm,
                    relPath,
                    absPath,
                    contentPackage,
                    body,
                    bodyLine,
                    manifest,
                    addressContext,
                    dateContext: dates,
                    resolveRole,
                }),
            );
        } catch (err) {
            if (fm.shortcode && !isAddressSegment(fm.shortcode) && err.keyPath) {
                err.identity = { type: fm.type, shortcode: fm.shortcode };
                err.keyPath = ["shortcode"];
                err.message = `shortcode "${fm.shortcode}" is not strictly alphanumeric — lowercase letters and digits only`;
                const yamlText = fs
                    .readFileSync(absPath, "utf8")
                    .match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
                err.position = positionOfYamlPath(yamlText, err.keyPath);
                if (err.position.line) err.position.line++;
            }
            err.file = absPath;
            // No `problems` array means the caller wants the old contract: a
            // note that cannot be recorded fails the derivation outright, which
            // is right for the *emitter* — an index quietly missing a note
            // would state that the note does not exist.
            if (!problems) throw err;
            // A reader, by contrast, reports it and carries on: one malformed
            // note must not take every other finding in the tree with it.
            problems.push({
                file: absPath,
                ...(err.position ?? {}),
                severity: "error",
                message: String(err.message),
                ...(err.identity ? { identity: err.identity } : {}),
            });
            continue;
        }
    }

    // Every note record exists and every Address in it is a tuple, so a parent
    // is found by its canonical address. Before the sort, which reads nothing
    // the pass writes.
    resolveCultures(records, { contentPackage, contentBase, foreignRecord, problems });

    // Sorted at every depth like a note's record, and for the same reason: the
    // declaration order of the `asset` fields is a fact about the emitter, not
    // about the content, and the artifact is meant to be byte-identical across
    // two runs over an unchanged tree. Collected above, ahead of the notes —
    // see `resolveRole` — rather than walked a second time here.
    for (const record of assetRecords) {
        records.push(/** @type {Record<string, any>} */ (sortKeysDeep(record)));
    }

    // Source path, then the canonical address, then the note id. The walk
    // yields in directory-read order, which is not a fact about the content,
    // and a rebuild that reordered lines would make every regeneration look
    // like a change. The address comes before the id because an item note's two
    // records share a file and carry two different ids — ordering on the id
    // first would sort the documentation against the item it documents by a
    // pair of hashes, which is no order at all.
    //
    // The path is read through {@link recordPath} because the two record shapes
    // state it differently — a note names the `.md` it was parsed from, an asset
    // the file it *is* — and both are paths within the package, so one order
    // covers them.
    records.sort(
        (a, b) =>
            recordPath(a).localeCompare(recordPath(b), "en") ||
            String(encodeAddresses(a.address?.canonical) ?? "").localeCompare(
                String(encodeAddresses(b.address?.canonical) ?? ""),
                "en",
            ) ||
            String(a.id ?? "").localeCompare(String(b.id ?? ""), "en"),
    );
    return records.map((record) =>
        decodeIndexAddresses(record, addressContext ?? { package: contentPackage }),
    );
}

/**
 * Serialize records as JSON Lines.
 *
 * @param {Array<Record<string, any>>} records - From {@link collectContentIndex}.
 * @returns {string} One compact JSON object per line, newline-terminated. An
 *   empty set serializes to the empty string rather than to a lone newline, so
 *   the file is exactly the lines it holds.
 */
export function serializeContentIndex(records) {
    if (records.length === 0) return "";
    return `${records.map((r) => JSON.stringify(sortKeysDeep(publishAddresses(r)))).join("\n")}\n`;
}

/**
 * Whether an absent content tree is a mistake.
 *
 * A package that declares a pack has notes to compile into it, so a missing
 * tree is a misconfigured path and the build says so. A package that declares
 * none ships assets and nothing else, and its index is its asset records.
 *
 * @param {object} resolved - The resolved configuration.
 * @returns {boolean} Whether a tree is required.
 */
function needsContentTree(resolved) {
    return (resolved.packs ?? []).length > 0;
}

/**
 * The index records for a content tree, without writing anything.
 *
 * The half of {@link emitContentIndex} that derives rather than emits, so a
 * pass that needs the corpus in memory — a SQL content table, the link check,
 * and in time every converted reader — builds it the same way the artifact
 * is built, rather than by walking and parsing again with its own idea of the
 * scope.
 *
 * @param {object} [opts]
 * @param {string} [opts.contentBase] - The tree, defaulting to the configured one.
 * @param {string} [opts.assetsBase] - The asset roots' parent, defaulting to
 *   the configured one. Stated separately from `contentBase` because the two
 *   move independently — a caller walking an assembled fixture tree says where
 *   that fixture's files are.
 * @param {object} [opts.config] - Resolved configuration, defaulting to ambient.
 * @param {readonly string[]} [opts.skipDirectories] - The walk's scope, for a
 *   caller that resolved one of its own; defaults to the resolved
 *   configuration's. Stated separately from `config` because a caller that was
 *   *handed* a scope must be able to pass it on rather than have it silently
 *   replaced by the one its configuration happens to carry.
 * @param {object[]} [opts.problems] - Supplied by a **reader**: a note that
 *   cannot be recorded is pushed here as a diagnostic and skipped, instead of
 *   aborting the derivation. Omitted, the note throws — which is the contract
 *   the emitter needs, since an index missing a note asserts that it does not
 *   exist.
 * @returns {object[]} One record per note, plus one per documentation entry.
 */
export function indexRecordsFor({
    contentBase,
    assetsBase,
    config,
    skipDirectories,
    problems,
} = {}) {
    const resolved = config ?? loadPackConfig();
    const tree = contentBase ?? resolved.paths.content;
    if (!fs.existsSync(tree) && needsContentTree(resolved)) {
        throw new Error(`no content tree at ${tree}`);
    }
    // Read on the first parent another package publishes, and not before, so
    // a package whose parents are all its own reads no dependency index.
    let foreign;
    const foreignRecord = (key) => {
        foreign ??= loadForeignIndexes(resolved, [resolved.contentPackage]).index;
        return foreign.get(key);
    };
    return collectContentIndex(tree, {
        contentPackage: resolved.contentPackage,
        addressContext: noteAddressContext(resolved),
        skipDirectories: skipDirectories ?? resolved.skipDirectories,
        assetsBase: assetsBase ?? resolved.paths.assets,
        // Only the identities a UUID is a function of — see emitContentIndex.
        manifest: foundryIdentities(resolved),
        problems,
        foreignRecord,
    });
}

/**
 * Emit this package's content index.
 *
 * @param {object} [options] - Options.
 * @param {string} [options.contentBase] - The content tree; defaults to the
 *   configured `paths.content`.
 * @param {string} [options.outDir] - Where to write; defaults to the configured
 *   `paths.contentIndex`.
 * @param {object} [options.config] - A resolved configuration; loaded when omitted.
 * @returns {{file: string, notes: number, assets: number, records: number,
 *   bytes: number, full: number, draft: number, stub: number}} Where it was
 *   written, how many notes and how many assets it holds, how many records that
 *   is in all, its size, and the ladder those notes sit on — so the ratio of
 *   written to unwritten is visible on every build rather than discovered in a
 *   year.
 * @throws {Error} When the content tree is absent, or when it yields no note at
 *   all — an empty index is indistinguishable from a mis-pointed tree, and a
 *   reader would take it as the authoritative statement that this package has
 *   no content.
 */
export function emitContentIndex({ contentBase, outDir, config } = {}) {
    const resolved = config ?? loadPackConfig();
    const tree = contentBase ?? resolved.paths.content;
    const dir = outDir ?? resolved.paths.contentIndex;
    const contentPackage = resolved.contentPackage;

    if (!fs.existsSync(tree) && needsContentTree(resolved)) {
        throw new Error(`no content tree at ${tree}`);
    }

    // The identities a Foundry address is derived against. Resolved once and
    // passed down, the way the manifest emission does it, so the walk stays a
    // pure function of its context. A configuration that names no Foundry
    // package yields a context whose notes simply carry no UUID.
    // Only the identities a UUID is a function of — the package id and the pack
    // router. Deliberately not the manifest's full context: whether a package
    // publishes pages is no part of an address, and depending on it would make
    // the index refuse to build for a configuration that is perfectly able to
    // state one.
    const records = indexRecordsFor({ contentBase: tree, config: resolved });
    const assetBindings = checkForeignAssetBindings(resolved);
    if (assetBindings.length)
        throw Object.assign(new Error(assetBindings.map(formatDiagnostic).join("\n")), {
            located: true,
        });
    if (records.length === 0) {
        throw new Error(
            `${tree} yielded no notes, so the index would state that this ` +
                `package has no content`,
        );
    }

    const text = serializeContentIndex(records);
    const file = path.join(dir, metadataFileName(contentPackage));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, text);

    // Counted separately because they are genuinely different numbers: an item
    // note yields a second record for its documentation journal and a file
    // yields an asset record, so reporting records as notes would overstate how
    // large the tree is.
    const noteRecords = records.filter(isNoteRecord);
    const assets = records.filter(isAssetRecord).length;
    // Read off the records rather than from a second pass over the tree: a stub
    // is the note whose address the emitter just withheld, and a draft is the
    // tag the note carries, so both are already in hand.
    const stub = noteRecords.filter(isStub).length;
    const draft = noteRecords.filter((record) => !isStub(record) && isDraftNote(record)).length;
    return {
        file,
        notes: noteRecords.length,
        assets,
        records: records.length,
        bytes: Buffer.byteLength(text),
        full: noteRecords.length - stub - draft,
        draft,
        stub,
    };
}
