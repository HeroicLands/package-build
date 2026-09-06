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
 * Diffing a package's published item addresses against a released one (#66).
 *
 * A package's `(type, shortcode)` addresses are a **published interface**.
 * Every satellite that declares `itemCatalog: true` assembles its beings out of
 * them — `attribute:str`, `skill:awar`, `weapongear:Tabri` — resolving each one
 * against the Item packs of the release its `compatibility.verified` pins. So
 * renaming a shortcode is a breaking change to something other repositories
 * consume, and until this module there was nothing that noticed: the check that
 * got made was a repository-local grep, which cannot see the other
 * repositories and reports the reassuring answer.
 *
 * `sohl` renamed one weapon's shortcode from `Tabri` to `Taburi` two days after
 * the `v0.8.2` tag, on the stated ground that "nothing referenced the old
 * value, so the rename is self-contained". True of that repository. Both
 * satellites pin `v0.8.2` and address `weapongear:Tabri` on their copy of the
 * same character — five lookups that resolve today and fail the moment either
 * pin moves, with an error reading like a missing item.
 *
 * **The comparison is release-to-release, in the repository doing the
 * renaming.** The alternative — checking a consumer's addresses against its
 * pinned release — already exists and already fails the build (`no predefined
 * item for "weapongear:Taburi"`); what it lacks is an explanation, and it
 * cannot honestly produce one, because at the point of the miss all it holds is
 * the address string. It has no document id and no name to match a candidate
 * against, so any successor it named would be a guess at a similar-looking
 * string. Here both sides are whole documents, so the question is decidable.
 *
 * **A rename is told from a removal by the document id, and that is an identity
 * match rather than an inference.** An address that disappeared while its
 * document is still published elsewhere *is* a rename — not "probably" one.
 * When the id is published under no address at all, that is all this can say:
 * **withdrawn**, with no successor named. A split, a deletion and a merge are
 * indistinguishable from one another at that point, and inventing a "did you
 * mean" from string similarity would be worse than saying nothing, because a
 * wrong one sends the reader to the wrong fix.
 *
 * **#270 narrowed that match, and a declaration is what makes up the
 * difference.** The join rested on the id being independent of the shortcode: a
 * note authored its `_id`, so the `Tabri` → `Taburi` commit changed the
 * shortcode alone and left the id to join the two sides. Since #270 an id is
 * *derived from the canonical address*, which carries the shortcode — so
 * renaming a shortcode moves the id too, both sides of the join move together,
 * and the match finds nothing. It stays exact for a note that **pins** an `id`,
 * and pinning is still how a document keeps its identity across a rename; what
 * it cannot do is help the author who did not pin, because pinning has to
 * happen before the rename, by someone who does not yet know they will make
 * one.
 *
 * So an author who has just renamed a shortcode **says so**, with
 * `renamedFrom:` on the note that made the change (#278, and see
 * `engine/note-renames.mjs`). That is neither a guess nor an identity match but
 * testimony from the only party that knows, and the diagnostic reports which of
 * the two it had rather than blending them — a reader can verify a matched id
 * in both artefacts, and can only take a declaration on its author's word.
 *
 * **Three joins, tried in that order of authority**: the document id, then a
 * declaration, then nothing — which remains **withdrawn**. Nothing here
 * infers, so a rename that is neither pinned nor declared is still reported as
 * a withdrawal; that is the honest answer, not a gap.
 *
 * **Severity is decided per case.** A withdrawal is legitimate — content is
 * allowed to be retired — so it is reported and does not fail a build. A rename
 * is equally legitimate as a decision (#1397's charset rule forces some), which
 * is why it does not fail one either; what it must not do is happen in silence.
 * A caller that wants a gate passes `error` and treats any finding as one.
 *
 * Item packs only, because that is the address space consumers resolve
 * against: {@link foreignItemCatalogDirs} extracts nothing else, and a being's
 * embedded items are the only cross-package resolution by `(type, shortcode)`.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { formatDiagnostic, positionInFrontmatter } from "./diagnostics.mjs";
import { positionOfLiteral } from "./diagnostics.mjs";
import { assertStatedScope } from "./helpers.mjs";
// The corpus, read from the one pass that derives it (#243). Nothing in the
// index's import graph reaches this module — only `bin/` imports it — so this
// is a plain static import, as in the link checker.
import { indexRecordsFor, isNoteRecord } from "./content-index.mjs";
import { renamedFrom } from "./note-renames.mjs";
import { referencedSubtype } from "./document-subtypes.mjs";
import { KNOWN_DOCUMENT_SUBTYPE_MAPS } from "./subtype-registry.mjs";

/**
 * The one spelling of an address in this space: `type:shortcode`.
 *
 * Written by both readers — the compiled packs on each side of the diff, and
 * the declarations read out of the tree — so a predecessor a note names and an
 * address a pack publishes cannot come apart over punctuation or case. The
 * shortcode is used **verbatim**, not lowercased: `readItemAddresses` reads it
 * off the compiled document, where `Tabri` is stored as authored, and folding
 * case here would join two addresses the packs keep apart.
 *
 * @param {string} type - The Foundry document subtype, not the note type.
 * @param {string} shortcode - The address's `system.shortcode`.
 * @returns {string} The address key.
 */
export function itemAddressKey(type, shortcode) {
    return `${type}:${shortcode}`;
}

/**
 * The address space a set of compiled Item pack directories publishes.
 *
 * The directories are read as one space for the same reason the actors pass
 * reads them as one: a being names an item by `(type, shortcode)` and never by
 * the pack it happens to ship in. Both sides of a diff are built by this one
 * function, so a released catalogue extracted by `deps fetch` and a freshly
 * compiled pack are indexed identically and a difference between them is a real
 * one rather than an artefact of two readers.
 *
 * A missing directory throws rather than reading as an empty space: an empty
 * baseline would report every address in the package as withdrawn, and an empty
 * current side would report every address as gone — the loudest possible
 * output from the quietest possible mistake.
 *
 * @param {readonly string[]} dirs - Directories of item JSON.
 * @returns {Map<string, {id: string, name: string, type: string, shortcode: string, file: string}>}
 *   Every item, keyed `type:shortcode`.
 */
export function readItemAddresses(dirs) {
    const space = new Map();
    for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
            throw new Error(
                `Item source directory ${dir} does not exist — an address ` +
                    `diff reads compiled Item pack output, so those packs ` +
                    `must be compiled (or the catalogue fetched) first`,
            );
        }
        for (const name of fs.readdirSync(dir)) {
            if (!name.endsWith(".json")) continue;
            if (name.startsWith("folder_")) continue;
            const file = path.join(dir, name);
            let doc;
            try {
                doc = JSON.parse(fs.readFileSync(file, "utf8"));
            } catch {
                // Unparseable output is the compile's problem to report, not
                // this pass's; skipping it here loses one address rather than
                // failing a diff that has nothing to do with it.
                continue;
            }
            const shortcode = doc?.system?.shortcode;
            if (!doc?.type || !shortcode || !doc?._id) continue;
            space.set(itemAddressKey(doc.type, shortcode), {
                id: doc._id,
                name: doc.name ?? "",
                type: doc.type,
                shortcode,
                file,
            });
        }
    }
    return space;
}

/**
 * Every rename the tree's notes **declare**, as old address → where it went.
 *
 * Read from the content tree rather than from compiled output, because a
 * declaration is authored and the compiled document does not carry it: nothing
 * downstream consumes `renamedFrom:`, so emitting it into every pack to let one
 * diagnostic read it back would put a build-time note in shipped data forever.
 * The tree is already read by this module for the same reason
 * ({@link noteFilesById}) — to place a finding where its author can fix it.
 *
 * **A declaration is keyed by document subtype, not by note type.** The address
 * space is the one consumers resolve against, and it is spelled in compiled
 * documents: `hm3` compiles a `projectilegear` note into a `missilegear` item,
 * so that is the address a rename of it moves. {@link referencedSubtype} is the
 * function that already answers this for a being's embedded `(type, shortcode)`
 * references, so both sides read the same rule rather than a second copy of it.
 *
 * **An entry is emitted for every system that maps the type**, whether or not
 * the note declares that system's block. Over-emitting is inert — the diff uses
 * an entry only when the baseline published the old address *and* this build
 * publishes the new one, and a system the note does not compile for satisfies
 * neither — while asking which blocks a note declares would put a second,
 * subtly different answer to that question in a third place.
 *
 * **First claim wins on a collision.** Two notes naming one predecessor is a
 * contradiction — an address has one successor — and it is reported as an error
 * by `engine/content-lint.mjs`, where both notes are in hand and can both be
 * named. Picking one here keeps this a map; it is not a resolution, and nothing
 * rests on which one it picked.
 *
 * @param {string} contentBase - Root of the content tree.
 * @param {object} opts
 * @param {readonly string[]} [opts.skipDirectories] - The corpus scope. Stated
 *   by the caller, never defaulted — see {@link addressCorpus}.
 * @param {readonly object[]} [opts.maps] - The document-subtype maps.
 * @param {object} [opts.config] - The resolved build configuration.
 * @param {readonly object[]} [opts.records] - Index records the caller already
 *   derived, shared with {@link noteFilesById} so one command reads one corpus.
 * @returns {Map<string, {to: string, file: string, shortcode: string}>} Old
 *   address → the address the declaring note publishes at now, and that note.
 */
/**
 * The corpus both reads below share, as content-index records.
 *
 * **One walk, not two.** `addresses diff` reads the tree twice — once for the
 * declarations and once to place its findings — and until #243 those were two
 * independent walks that each parsed every note. They are now one derivation,
 * shared: the caller derives the records and hands them to both, so the two
 * halves of a single command cannot disagree about which files the corpus is,
 * or about the ids in it.
 *
 * **The id is why it matters, and not only tidiness.** `noteFilesById` joins
 * tree-side ids against ids read out of the *compiled packs*. Since #270 an id
 * is derived from the canonical address, whose first segment is the content
 * package — and the tree side used to derive it through `resolveNoteId(fm)`
 * with no package, which falls back to `contentPackage()` and so to whichever
 * configuration the working directory answers with. The compiled side is
 * produced by a compiler running on the configuration the *build* resolved. Let
 * those differ — under `PACKAGE_BUILD_CONFIG`, in a worktree, in a test — and
 * every id fails to join, so every rename degrades to a withdrawal and every
 * finding loses the note it should have been reported against. Reading the
 * index derives both sides from the one resolved configuration.
 *
 * A tree that is not there yields no records rather than throwing, which is
 * what the walk this replaces did: an absent tree is a caller's business, and
 * these two functions have never been the ones to report it.
 *
 * @param {string} contentBase - Root of the content tree.
 * @param {object} opts - Options.
 * @param {readonly string[]} [opts.skipDirectories] - The scope, required
 *   unless `records` supplies the corpus outright.
 * @param {object} [opts.config] - The resolved configuration.
 * @param {readonly object[]} [opts.records] - Records the caller derived.
 * @returns {readonly object[]} The index records.
 */
function addressCorpus(contentBase, { skipDirectories, config, records } = {}) {
    if (records) return records;
    assertStatedScope(skipDirectories, "reading the address corpus");
    if (!fs.existsSync(contentBase)) return [];
    return indexRecordsFor({ contentBase, config, skipDirectories });
}

/**
 * The file a record was read from, as an absolute path.
 *
 * The index records a path *relative* to the content root deliberately — an
 * absolute one is a fact about the machine that built it — and a diagnostic
 * needs the absolute form. The root is in hand, so this is the composition the
 * index's own documentation names.
 *
 * @param {string} contentBase - Root of the content tree.
 * @param {object} record - An index record.
 * @returns {string} The absolute path.
 */
function fileOf(contentBase, record) {
    return path.join(contentBase, ...String(record.file.path).split("/"));
}

export function declaredPredecessors(
    contentBase,
    { skipDirectories, maps = KNOWN_DOCUMENT_SUBTYPE_MAPS, config, records } = {},
) {
    const byOldAddress = new Map();
    for (const record of addressCorpus(contentBase, { skipDirectories, config, records })) {
        // A documentation journal is a document this tree emits, not a note in
        // it: it has no file and declares nothing.
        if (!isNoteRecord(record)) continue;
        // The record carries the note's frontmatter, so a declaration is read
        // off it exactly as it was read off the parse.
        const declared = renamedFrom(record);
        if (!declared.length) continue;
        const shortcode = typeof record.shortcode === "string" ? record.shortcode.trim() : "";
        // A note with no address of its own has nowhere for a predecessor to
        // have gone, so it declares a rename to nothing. Reported by the lint;
        // silently skipped here rather than indexed as a rename to `type:`.
        if (!shortcode) continue;
        const absPath = fileOf(contentBase, record);
        for (const map of maps) {
            const { subType } = referencedSubtype(map, record.type, "Item");
            if (!subType) continue;
            const to = itemAddressKey(subType, shortcode);
            for (const old of declared) {
                const from = itemAddressKey(subType, old);
                // A note naming its own current address declares nothing, and
                // indexing it would make every such address look renamed to
                // itself. The lint reports it.
                if (from === to) continue;
                if (!byOldAddress.has(from)) {
                    byOldAddress.set(from, { to, file: absPath, shortcode: old });
                }
            }
        }
    }
    return byOldAddress;
}

/**
 * Every address the baseline published that this build does not.
 *
 * An address that merely *arrived* is not a finding: adding one breaks nobody.
 * The arrivals are read only to answer the one question that matters about a
 * departure — is the document still here under another name?
 *
 * @param {Map<string, object>} baseline - The released address space.
 * @param {Map<string, object>} current - This build's address space.
 * @param {object} opts
 * @param {string} opts.baseline - What the baseline is, for the message —
 *   conventionally `<package>@<version>`.
 * @param {Map<string, {to: string, file: string}>} [opts.predecessors] - The
 *   declared renames, from {@link declaredPredecessors}. Omitted, the diff
 *   falls back to the id join alone and reports an unpinned rename as a
 *   withdrawal, which is what it did before #278.
 * @returns {Array<object>} One finding per departed address, in address order
 *   so two runs read the same. `kind` is `"renamed"` (with `to`, and `declared`
 *   when it was the note's word rather than an id match) or `"withdrawn"`.
 */
export function diffItemAddresses(baseline, current, { baseline: label, predecessors }) {
    // A baseline that yields no address at all cannot produce a finding, so it
    // reports a clean result for every possible input — the one failure a check
    // like this can never catch, and the same one `foreign-manifests.mjs` exists
    // to stop. It is a real state, not a hypothetical: `sohl-kethira-basic@0.5.3`
    // shipped 307 items carrying no `system.shortcode` between them.
    if (!baseline.size) {
        throw new Error(
            `${label} publishes no addressable item — no document in its Item ` +
                `packs carries a \`system.shortcode\`. A diff against it can ` +
                `only report that nothing changed, whatever this build does, ` +
                `so it is refused rather than passed`,
        );
    }
    // Where each still-published document lives now. Built once: a rename is
    // decided by identity, so this is the whole evidence base.
    const currentById = new Map();
    for (const [address, entry] of current) {
        if (!currentById.has(entry.id)) currentById.set(entry.id, address);
    }

    const findings = [];
    for (const [address, entry] of baseline) {
        if (current.has(address)) continue;

        // The id first, because it is the strongest answer available: a match
        // is an identity, and a reader can check it in both artefacts.
        const matched = currentById.get(entry.id);
        // Then the author's word, and only where it checks out — the note that
        // claims this address as a predecessor must itself be publishing now.
        // A declaration pointing at an address this build does not publish
        // describes a rename that did not survive to the packs, and naming it
        // as the successor would send the reader somewhere nothing is.
        const claim = matched ? undefined : predecessors?.get(address);
        const declared = claim && current.has(claim.to) ? claim : undefined;
        const to = matched ?? declared?.to;

        findings.push({
            kind: to ? "renamed" : "withdrawn",
            address,
            ...(to ? { to } : {}),
            // Set only on a declared rename, so a reader of a finding can tell
            // testimony from an identity match without re-deriving which it was.
            ...(matched ? {}
            : declared ? { declared: true, noteFile: declared.file }
            : {}),
            id: entry.id,
            name: entry.name,
            shortcode: entry.shortcode,
            baselineFile: entry.file,
            baseline: label,
        });
    }
    findings.sort((a, b) => (a.address < b.address ? -1 : 1));
    return findings;
}

/**
 * Every content note in a tree, indexed by the document id it authors.
 *
 * The address space is read from compiled output because that is what actually
 * ships; the tree is read only to place a finding somewhere a reader can open
 * and fix it. Each source answers the question it is good at, and the id is the
 * exact key that joins them.
 *
 * @param {string} contentBase - Root of the content tree.
 * @param {object} [opts]
 * @param {readonly string[]} [opts.skipDirectories] - The corpus scope, stated
 *   by the caller — see {@link addressCorpus}.
 * @param {object} [opts.config] - The resolved build configuration, which the
 *   id is derived against. See {@link addressCorpus} for why that matters.
 * @param {readonly object[]} [opts.records] - Index records the caller already
 *   derived, shared with {@link declaredPredecessors}.
 * @returns {Map<string, string>} Document id → the note's absolute path.
 */
export function noteFilesById(contentBase, { skipDirectories, config, records } = {}) {
    const byId = new Map();
    for (const record of addressCorpus(contentBase, { skipDirectories, config, records })) {
        // A documentation journal shares its note's file and has no id of its
        // own, so indexing it would file one path under two identities.
        if (!isNoteRecord(record)) continue;
        // Derived by the index, against the configuration this build resolved —
        // which is the same configuration the compiled ids on the other side of
        // the join were produced under. See {@link addressCorpus}.
        //
        // First record wins, and the records are in content-path order, so
        // which note answers for a duplicated id is now a stable fact about the
        // tree rather than an artefact of directory-read order.
        if (record.id && !byId.has(record.id)) byId.set(record.id, fileOf(contentBase, record));
    }
    return byId;
}

/**
 * Where to send the reader for one finding.
 *
 * A rename is fixed in the note that made it, so a finding whose id is still in
 * this tree is reported at that note's `shortcode:` line — the line the author
 * just edited. A withdrawal has no such note by definition, so it degrades to
 * the baseline document, which is the only artefact left that records the
 * address existing. When neither is readable the position is **dropped**, never
 * defaulted to `1:1`.
 *
 * A **declared** rename knows its note without any lookup — the declaration is
 * how it was found — and is reported at the `renamedFrom:` line rather than the
 * `shortcode:` line, because that is the line the finding is about and the one
 * the author deletes once the declaration has done its work (#278).
 *
 * @param {object} finding - One finding from {@link diffItemAddresses}.
 * @param {Map<string, string>} noteFiles - From {@link noteFilesById}.
 * @returns {{file?: string, line?: number, column?: number}} Spreadable
 *   position fields for {@link formatDiagnostic}.
 */
export function locateAddressFinding(finding, noteFiles) {
    if (finding.declared && finding.noteFile) {
        try {
            const raw = fs.readFileSync(finding.noteFile, "utf8");
            return {
                file: finding.noteFile,
                ...positionInFrontmatter(raw, "renamedFrom", finding.shortcode),
            };
        } catch {
            return { file: finding.noteFile };
        }
    }
    const note = noteFiles?.get(finding.id);
    if (note) {
        try {
            const raw = fs.readFileSync(note, "utf8");
            return { file: note, ...positionInFrontmatter(raw, "shortcode") };
        } catch {
            return { file: note };
        }
    }
    if (!finding.baselineFile) return {};
    try {
        const raw = fs.readFileSync(finding.baselineFile, "utf8");
        return {
            file: finding.baselineFile,
            ...positionOfLiteral(raw, `"${finding.shortcode}"`),
        };
    } catch {
        return { file: finding.baselineFile };
    }
}

/**
 * What one finding says, without a locator or a severity.
 *
 * The rename message names the identity it matched on, because that is what
 * separates this from a spelling suggestion: the reader can check the id in
 * both artefacts. The withdrawal message names no successor, because none is
 * known — and says so, rather than leaving the reader to wonder whether one was
 * looked for.
 *
 * **A declared rename says it is declared** (#278). The two claims are not
 * equally checkable: an id match is a fact in the artefacts, while a
 * declaration is an author's word, and a reader deciding whether to trust the
 * successor needs to know which one they have. Saying "the same document" of a
 * declared rename would spend the id match's credibility on it.
 *
 * The consequence sentence is the same for both, because it is the same
 * consequence: the old address stops resolving either way, and that is what
 * the reader has to act on.
 *
 * @param {object} finding - One finding from {@link diffItemAddresses}.
 * @returns {string} The message.
 */
export function addressFindingMessage(finding) {
    if (finding.kind === "renamed") {
        const how =
            finding.declared ?
                `the note now published as ${finding.to} declares it was ` +
                `renamed from ${finding.shortcode}`
            :   `the same document (${finding.id}) is now published as ${finding.to}`;
        return (
            `since ${finding.baseline}, ${finding.address} is no longer ` +
            `published; ${how}. Every package that resolves ${finding.address} ` +
            `breaks when it moves past ${finding.baseline}`
        );
    }
    return (
        `since ${finding.baseline}, ${finding.address} is no longer ` +
        `published, and its document (${finding.id}) is published under no ` +
        `other address`
    );
}

/**
 * One finding, in the standard `file:line:column: severity: message` form.
 *
 * @param {object} finding - One finding from {@link diffItemAddresses}.
 * @param {{file?: string, line?: number, column?: number}} at - From
 *   {@link locateAddressFinding}.
 * @param {"warning"|"error"} [severity] - `error` when the caller is gating.
 * @returns {string} The formatted diagnostic, path first on the line.
 */
export function formatAddressFinding(finding, at, severity = "warning") {
    return formatDiagnostic({
        ...at,
        severity,
        message: addressFindingMessage(finding),
    });
}
