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
 * Shared helpers for the pack compilers in `packages/content-build/`.
 *
 * The HeroicLands vault is authoritative for compendium item data. Pack
 * compilers walk the vault, read markdown files with YAML frontmatter, and
 * emit Foundry-compatible JSON. These helpers handle the common shape:
 * markdown parsing, frontmatter access (including the nested `sohl:` block),
 * filename generation, and slug normalization.
 *
 * Not a standalone script — a shared helper module imported by the pack
 * generation orchestrator and compilers (generate.mjs, items.mjs,
 * journals.mjs, actors.mjs).
 */

import fs from "fs";
import crypto from "crypto";
import path from "path";
import yaml from "yaml";
import unidecode from "unidecode";
import markdownit from "markdown-it";
import log from "loglevel";

import { loadPackConfig } from "./pack-config.mjs";
import { packRouter } from "./pack-router.mjs";
import { contentPackage, foundryPackageId } from "./content-package.mjs";
import { searchableFrontmatter } from "./note-package.mjs";
import { loadForeignManifests, PACKAGE_BASE } from "./kb-manifest.mjs";
import { buildWikilinkIndex, convertWikilinks } from "./wikilinks.mjs";
// One vocabulary of link findings, and one message per class, so the three
// resolvers cannot word the same defect differently (#184).
import { linkFindingMessage } from "./wikilink-syntax.mjs";
// The declared tag vocabulary (#172), which is where `draft` is stated. Read
// from there rather than respelt, so the tag and its one reader cannot drift.
import { isDraftNote } from "./note-vocabulary.mjs";
import { expandContentTables } from "./content-tables.mjs";
import { positionInBody } from "./diagnostics.mjs";
// The pure `sohl:` frontmatter readers live in a leaf module so the item-type
// registry can import them without reaching back through this one (#1504).
// Re-exported here so every existing importer keeps its single import path.
import { getFrontmatter } from "./frontmatter.mjs";
export {
    getFrontmatter,
    sohlField,
    resolveCharges,
    resolveSkillAptitudes,
    resolveRelation,
    requireSubType,
    parseValueDesc,
} from "./frontmatter.mjs";

export const md = markdownit({ html: true });

/**
 * Parses a markdown file with YAML frontmatter.
 *
 * Returns `{ frontmatter, body, description, bodyLine, bodyColumn }` where
 * `body` is the trimmed raw markdown after the frontmatter block, and
 * `description` is `body` rendered to HTML. `bodyLine` / `bodyColumn` are the
 * 1-based **file** position of the body's first character, which is what turns
 * an offset within `body` into a position a diagnostic can name (#17) — see
 * {@link positionInBody}. If the file has no frontmatter block, returns
 * `{ frontmatter: null, body: "", description: "" }` with a warn log, and no
 * position: there is no body to have one.
 */
export function parseMarkdownFile(filePath) {
    const content = fs.readFileSync(filePath, "utf8");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!fmMatch) {
        return { frontmatter: null, body: "", description: "" };
    }
    let frontmatter;
    try {
        frontmatter = yaml.parse(fmMatch[1]) || {};
    } catch (err) {
        log.warn(`YAML parse error in ${filePath}: ${err.message}`);
        return { frontmatter: null, body: "", description: "" };
    }
    const raw = fmMatch[2];
    const body = raw.trim();
    const description = body ? md.render(body) : "";
    // Where the trimmed body starts in the *file*, so an offset within it can
    // be reported as a file position (#17). The frontmatter's lines and the
    // blank lines `trim()` removes both sit in between, and the trim can take
    // indentation off the first line as well — hence a column, not just a line.
    const bodyStart = content.length - raw.length + (raw.length - raw.trimStart().length);
    const before = content.slice(0, bodyStart);
    const bodyLine = before.split("\n").length;
    const bodyColumn = bodyStart - before.lastIndexOf("\n");
    return { frontmatter, body, description, bodyLine, bodyColumn };
}

/**
 * Recursively yields every `.md` file under `rootDir`, parsed.
 * Yields `{ frontmatter, body, description, file, absPath, bodyLine,
 * bodyColumn }` for each match — the last two from
 * {@link parseMarkdownFile}, so a caller can report a position inside the
 * body as a position in the file (#17).
 * Silently skips directories that don't exist.
 *
 * Directory names in `skipDirectories` are ignored wherever they appear. The
 * walk itself knows nothing about what they mean: `Templates/` is an Obsidian
 * templater convention this repository's vault happens to use, not a property
 * of a content tree, so it is configured rather than hard-coded (#1508).
 *
 * @param {string} rootDir - Root of the tree to walk.
 * @param {object} [opts]
 * @param {readonly string[]} [opts.skipDirectories] - Directory names to ignore.
 *   Defaults to the configured list.
 */
export function* walkMarkdownTree(
    rootDir,
    { skipDirectories = loadPackConfig().skipDirectories } = {},
) {
    if (!fs.existsSync(rootDir)) return;
    const stack = [rootDir];
    while (stack.length > 0) {
        const dir = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (err) {
            log.warn(`Cannot read directory ${dir}: ${err.message}`);
            continue;
        }
        for (const entry of entries) {
            const absPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (skipDirectories.includes(entry.name)) continue;
                stack.push(absPath);
            } else if (entry.isFile() && entry.name.endsWith(".md")) {
                yield {
                    ...parseMarkdownFile(absPath),
                    file: entry.name,
                    absPath,
                };
            }
        }
    }
}

/**
 * Resolve the required `sohl.archetype` frontmatter for an Item/Actor entry
 * (the archetype contract, #604). The property is a nullable number that
 * authors must state explicitly:
 *   - a number → the document is an archetype of that priority.
 *   - `null`   → the document is not an archetype.
 *   - absent   → an authoring error (throws), so "not an archetype" is never
 *                silently assumed.
 *
 * Reads `sohl.archetype`, falling back to a top-level `archetype` key to match
 * {@link sohlField}'s nested-then-top-level resolution.
 *
 * @param {object} fm      Parsed frontmatter.
 * @param {string} label   Human-readable context for error messages.
 * @returns {number|undefined}  The archetype priority, or `undefined` when null.
 * @throws {Error} When `sohl.archetype` is absent or is not a number/null.
 */
export function resolveArchetype(fm, label) {
    const sohl = fm != null && typeof fm.sohl === "object" ? fm.sohl : null;
    const inSohl = sohl != null && "archetype" in sohl;
    const inTop = fm != null && typeof fm === "object" && "archetype" in fm;
    if (!inSohl && !inTop) {
        throw new Error(
            `Missing required sohl.archetype for ${label} — set a number (this is an archetype) or null (it is not)`,
        );
    }
    const raw = inSohl ? sohl.archetype : fm.archetype;
    if (raw === null) return undefined;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
        throw new Error(
            `Invalid sohl.archetype for ${label}: expected a number or null, got ${JSON.stringify(raw)}`,
        );
    }
    return raw;
}

/**
 * The value a document's `system.archetype` carries, from the required
 * `sohl.archetype` frontmatter (#126, sohl#1780).
 *
 * A **schema field**, so the tri-state is written out in full rather than
 * expressed by a key's presence: a number is an archetype at that priority,
 * and `null` is not an archetype. This is where {@link resolveArchetype}'s
 * `undefined` becomes the field's `null` — an emitted `undefined` would be
 * dropped by `JSON.stringify`, leaving the compiled document with no
 * `archetype` at all and the tri-state readable as two.
 *
 * **`0` is an archetype.** It is the priority SoHL's own archetypes ship at,
 * and it is falsy, so this returns it unchanged and every caller must ask
 * `typeof v === "number"` rather than testing truthiness.
 *
 * @param {object} fm      Parsed frontmatter.
 * @param {string} label   Human-readable context for error messages.
 * @returns {number|null}  The archetype priority, or `null` for a document
 *   that is not an archetype.
 * @throws {Error} When `sohl.archetype` is absent or invalid.
 */
export function systemArchetype(fm, label) {
    const archetype = resolveArchetype(fm, label);
    return archetype === undefined ? null : archetype;
}

/**
 * Generates a compendium-source filename: `Name_id.json` with non-
 * alphanumeric runs replaced by underscores.
 */
export function makeFilename(name, id) {
    return `${unidecode(name)}_${id}`.replace(/[^0-9a-zA-Z]+/g, "_") + ".json";
}

/**
 * Standardize a name into a slug: lowercase, apostrophes removed,
 * non-alphanumerics collapsed to single hyphens.
 */

/**
 * Translate a content-relative image path into its Foundry-relative form.
 *
 * Content frontmatter (`img` / `portrait`) authors a single path that has to
 * work for Foundry, the knowledgebase, and the website. For Foundry the bundled
 * asset roots — `icons/...` and `images/...` — are served from the package
 * directory, so they are rewritten to `<assetRoot>/<path>` — `systems/sohl/assets`
 * for this repository, `modules/<id>/assets` for a module (#1508). Any other
 * path (already package-rooted, an absolute URL) is returned unchanged.
 *
 * **Two empties, and they mean opposite things (#218).** `null` — or an absent
 * key, which reaches here as `undefined` — means _unset_: the note names no art
 * and the caller's default applies. `""` means _blank on purpose_: the note
 * names no art **and wants none**, so no default may replace it. Both come back
 * distinguishable, `null` and `""` respectively, and neither is invented from
 * the other.
 *
 * This used to open `if (!raw) return ""`, which made the two one case: every
 * caller then applied its default with `||`, so a deliberate blank was
 * unspellable and an unset key and an empty string compiled identically. That
 * is the convention the project already rejects for an optional "not specified"
 * DataModel string, where `nullable, initial: null` keeps "unset" a single
 * honest value rather than two.
 *
 * **`title` does not follow this rule**, and must not be made to. On a
 * `type: affiliation` note `title` is *also* a declared item field whose default
 * is `""` (`sohl/item-fields.mjs`), resolved from the very same shared top-level
 * key the site emitter reads as the page title — so `title: null` stringifies
 * into the compiled document as the literal `"null"`. One key, two destinations
 * that disagree about what empty means; see #218.
 *
 * This is translation only: the default for an unset path is domain-specific
 * (actors default differently from items, and gear differently again), so each
 * compiler owns its own default and applies it to the result with **nullish**
 * coalescing — `resolveImg(fm.img) ?? <default>`. Not `||`: that would collapse
 * a deliberate blank back into the default and undo the distinction. For items
 * that default is the art paired with the type's builder, reached through
 * `itemArt()`, which runs the path back through this function so a registry
 * entry and a note's `img:` are spelled the same way (#7).
 *
 * @param {string | null | undefined} raw - content-relative path from frontmatter.
 * @param {{assetRoot: string}} [config] - The resolved build configuration.
 *   Defaults to this repository's.
 * @returns {string | null} the Foundry-relative path; `""` for a deliberate
 *   blank, and `null` when the note names no art at all.
 */
export function resolveImg(raw, config = loadPackConfig()) {
    // Unset — the caller's default applies. An absent key arrives as
    // `undefined`, an authored one as `null`; they say the same thing.
    if (raw == null) return null;
    const s = String(raw);
    // Blank on purpose — the caller's default must not apply.
    if (s === "") return "";
    if (s.startsWith("icons/") || s.startsWith("images/")) {
        return `${config.assetRoot}/${s}`;
    }
    return s;
}

/**
 * Resolves the display name from frontmatter, preferring `name.full`,
 * falling back to `name` (if string), then `defaultValue`.
 */
export function resolveName(fm, defaultValue = "Unnamed") {
    const fullName = getFrontmatter(fm, "name.full", null);
    if (fullName) return String(fullName);
    if (typeof fm?.name === "string") return fm.name;
    return defaultValue;
}

/**
 * The oldest Foundry core this package supports, stamped into every compiled
 * document as `_stats.coreVersion`.
 *
 * **Derived, never written twice.** `_stats.coreVersion` is what Foundry gates
 * its migration shims on: a record stamped older than a shim is rewritten by it
 * on load. Every pack once shipped `coreVersion: "14"`, which sorts *below*
 * every v14 build and so left all shipped content permanently eligible for
 * every v14 migration (#1533).
 *
 * **Read from the configuration, not from the shipped manifest.** It used to
 * open `paths.packageManifest` and take `compatibility.minimum` out of it,
 * because the configuration had no way to state the fact. Now that it does, the
 * manifest is generated *from* the configuration — so reading it back would be
 * a round trip through an artifact that need not exist yet: `build:db` can run
 * before the manifest is written.
 *
 * Absent is a hard failure, not a default. A guessed floor is stamped into
 * every document in the pack and stays invisible until something migrates on
 * it, which is exactly why the manifest read threw rather than falling back.
 *
 * @param {{compatibility: {minimum: string}|null}} [config] - The resolved
 *   configuration. Defaults to this repository's.
 * @returns {string} The declared `compatibility.minimum`.
 * @throws {Error} When the configuration declares no `compatibility.minimum`.
 */
export function supportedCoreVersion(config = loadPackConfig()) {
    const minimum = config.compatibility?.minimum;
    if (!minimum) {
        throw new Error(
            "package-build: the configuration declares no " +
                "`compatibility.minimum`, so compiled documents have no " +
                "honest core version to stamp. Declare it at the top level of " +
                "package-build.config.yaml.",
        );
    }
    return String(minimum);
}

/**
 * Default `_stats` block for compiled compendium entries.
 *
 * Every stamped identity is configuration (#1508): four compilers used to pass
 * the same frozen `"0.6.0"` literal, and `systemId` / `lastModifiedBy` were
 * written into this function. `coreVersion` alone is *not* configuration — it
 * comes from {@link supportedCoreVersion}, the configured Foundry floor,
 * so a document never claims to predate the migrations that would rewrite it.
 *
 * @param {string} [systemVersion] - The system version to stamp. Defaults to the
 *   configured one.
 * @param {{stats: {systemId: string, systemVersion: string,
 *   lastModifiedBy: string}, paths: {packageManifest: string}}} [config] -
 *   The resolved build configuration. Defaults to this repository's.
 * @returns {object} The `_stats` block.
 */
export function buildStats(systemVersion = undefined, config = loadPackConfig()) {
    return {
        systemId: config.stats.systemId,
        systemVersion: systemVersion ?? config.stats.systemVersion,
        coreVersion: supportedCoreVersion(config),
        createdTime: 0,
        modifiedTime: 0,
        lastModifiedBy: config.stats.lastModifiedBy,
    };
}

/**
 * The `_stats` block for one pack, stamped with the system that pack is for
 * (#48).
 *
 * **`systemId` travels with `systemVersion`.** They are one decision, so where
 * one is omitted both are. Stamping a per-pack version against a package-wide
 * id would emit `systemId: sohl, systemVersion: 1.6.3` on HM3 documents — a
 * *plausible lie*, which is worse than the missing value #43 fixed, because
 * nothing about it looks wrong.
 *
 * Resolution, in order:
 *
 * 1. The pack's own `system:`, looked up in the `systems:` block. That is the
 *    case a module shipping for two systems needs, and the one no
 *    package-wide value could express.
 * 2. Failing that, the package-wide `stats` — a package whose packs are all for
 *    one system, which is every package that worked before this existed.
 *
 * A pack naming a system is validated against `systems:` at configuration time,
 * so an unresolvable name never reaches here.
 *
 * @param {string|null|undefined} packSystem - The pack's declared `system:`.
 * @param {object} [config] - The resolved configuration.
 * @returns {object} The `_stats` block for that pack.
 */
export function statsForPack(packSystem, config = loadPackConfig()) {
    const declared = packSystem ? config.systems?.[packSystem] : null;
    if (!declared) return buildStats(undefined, config);
    return {
        systemId: packSystem,
        systemVersion: declared.compatibility.verified,
        coreVersion: supportedCoreVersion(config),
        createdTime: 0,
        modifiedTime: 0,
        lastModifiedBy: config.stats.lastModifiedBy,
    };
}

/** Memoised {@link defaultStats}. */
let cachedDefaultStats;

/**
 * The `_stats` block every compiler stamps on an entry it emits, built once.
 *
 * Each compiler used to hoist `const STATS = buildStats()` at module scope,
 * which read the shipped package manifest the moment the module was imported —
 * so importing a compiler required a manifest to exist even when nothing was
 * going to be compiled (#2). Deferred to first use and memoised here, the
 * cost and the identity are what they always were; only the moment moved.
 *
 * @returns {object} The default `_stats` block, shared by every compiler.
 */
export function defaultStats() {
    cachedDefaultStats ??= buildStats();
    return cachedDefaultStats;
}

/**
 * Stable 16-char hex id derived from `${namespace}:${value}`.
 *
 * Defined in {@link sohl.utils.packs.ids} — a leaf module, so that the link
 * resolver this one imports can derive ids too — and re-exported here for the
 * passes that have always reached it through `helpers`.
 */
// The one slug rule, re-exported so callers keep a single import path.
export { slugify } from "./content-slug.mjs";

export { makeId } from "./ids.mjs";

// The content-type → document-type map, which decides *which* pack list a
// note's own document is routed against.
import { assertTypeNotRetired, packForType } from "./ids.mjs";

/* ------------------------------------------------------------------------ */
/*  Wikilink resolution: the content-wide link index                        */
/* ------------------------------------------------------------------------ */

/**
 * Indexes **every** note in the content tree so any pack compiler can resolve a
 * wikilink to any other document. Shared by all three compilers: a skill links
 * to another skill, a journal to a creature, a creature to a rules page, and
 * each target's own **type** decides which pack the UUID points into.
 *
 * Each note's pack is resolved here, once, and stored on its index entry: a
 * UUID carries a pack name, so a repository shipping several packs of one type
 * (#1566) would otherwise address every one of them as the first. A note whose
 * declaration is unroutable is indexed against the conventional name and left
 * for the compile pass to report — the index has no business failing a build,
 * and the pass fails it with a far better message. The one exception is a
 * **retired** content type (SoHL#1580): this walk is the first to see every
 * note together with its path, and unlike an unroutable declaration there is
 * no pass that would ever claim such a note and report it.
 *
 * @param {string} contentBase - Root of the content tree.
 * @param {object} [router] - The pack router. Supplied by the calling pass so
 *   the index and the compile agree about where each note landed; defaults to
 *   this repository's own.
 * @returns {{byShortcode: Map, types: Set}} From `buildWikilinkIndex`.
 */
export function buildContentLinkIndex(contentBase, router = packRouter()) {
    const docs = [];
    for (const { frontmatter: fm, absPath } of walkMarkdownTree(contentBase)) {
        if (!fm?.id) continue;
        // The first walk of every note in the tree, and the only one holding
        // both the declared type and the file that declares it — so a note
        // left on a retired type is reported here, by name, rather than
        // several frames deeper with nothing to go on (SoHL#1580).
        assertTypeNotRetired(fm.type, absPath);
        const base = path.basename(absPath, ".md").replace(/_/g, " ");
        docs.push({
            type: fm.type,
            id: fm.id,
            // Where this note's own document lands, and where the JournalEntry
            // its prose compiles into lands — two documents, two packs (#1362).
            pack: router.resolveOrNull(fm, packForType(fm.type).docType),
            docPack: router.resolveOrNull(fm, "JournalEntry"),
            shortcode: fm.shortcode ?? null,
            name: fm.name?.full ?? base,
            // Whether the note is tagged `draft` (#183). Read from the tag
            // vocabulary that declares it, and used for one thing: a link
            // *into* this note renders marked. It takes no part in resolution,
            // so the note is indexed, compiled and published as any other.
            draft: isDraftNote(fm),
        });
    }
    // Packages this build links *into* but does not publish. Their manifests
    // are vendored and committed, so a contributor without every repository
    // checked out resolves the same links CI does (#1446, #1499).
    // Packages this repository links into but does not publish; their vendored
    // manifests live at the configured location (#1446, #1499).
    const { index: foreign, stale } = loadForeignManifests(
        loadPackConfig().paths.manifests,
        [contentPackage()],
        PACKAGE_BASE,
    );
    if (stale.length) {
        for (const st of stale) {
            log.error(`Unusable link manifest for "${st.package}": ${st.reason}`);
        }
        throw new Error(
            "Cross-package links cannot be resolved from a stale manifest; " +
                "re-vendor it from that package's build.",
        );
    }
    log.debug(
        `Wikilink index: ${docs.length} local document(s), ` +
            `${foreign.size} foreign address(es)`,
    );
    return buildWikilinkIndex(docs, foundryPackageId(), foreign, contentPackage());
}

/**
 * Converts the wikilinks in one note's markdown, reporting any that have no
 * target in the content tree. Every compiler funnels through this so the
 * diagnostic text and the leave-it-alone fallback are identical everywhere.
 *
 * Each report names the **file, line and column** the link sits on (#17), so
 * it can be opened and fixed — and so two identical links on one note are
 * tellable apart. That needs `file` and the note's `bodyLine` / `bodyColumn`;
 * without them the diagnostic still reports, one field shorter, rather than
 * inventing a position.
 *
 * @param {string} body - The note's markdown body, tables already expanded.
 * @param {object} ctx - `{ type, id, pack, docPack, index, name }` — `name` is
 *   used in the message, and the two pack names address a `[[#slug]]`
 *   self-link, whose target is the source note itself and so has no index
 *   entry. Position is carried by `{ file, bodyLine, bodyColumn, lineMap }`,
 *   the last from {@link expandNoteTables}.
 * @returns {{markdown: string, unresolved: Array<object>}}
 * @throws {Error} On any link that does not resolve — an unlabelled one, a
 *   target that is not an address, or an address nothing publishes. The error
 *   carries `file` and `position`, so a caller reports it in the same form
 *   rather than re-deriving one.
 */
export function convertNoteWikilinks(
    body,
    { type, id, pack, docPack, index, name, file, bodyLine, bodyColumn, lineMap },
) {
    const result = convertWikilinks(body ?? "", {
        type,
        id,
        pack,
        docPack,
        index,
    });
    /**
     * Where one unresolved link sits, in file coordinates.
     *
     * @param {object} u - An entry of `result.unresolved`.
     * @returns {{line?: number, column?: number, generated?: boolean}} Empty
     *   when the caller supplied no position to resolve against.
     */
    const locate = (u) =>
        bodyLine === undefined || u.offset === undefined ?
            {}
        :   positionInBody(body ?? "", u.offset, {
                bodyLine,
                bodyColumn,
                lineMap,
            });

    /**
     * Fails the note, carrying the position for the caller to report.
     *
     * @param {object} u - The offending link.
     * @param {string} message - What is wrong.
     * @returns {never}
     */
    const fail = (u, message) => {
        const at = locate(u);
        // A link this build wrote is not at any authored position, so say
        // where it came from rather than implying an edit site.
        const err = new Error(
            at.generated ? `${message} Emitted by the content table on this line.` : message,
        );
        err.file = file;
        err.position = at;
        throw err;
    };

    for (const u of result.unresolved) {
        // Every class fails, and every class is worded by the shared table
        // (#184). The three resolvers read one authored link, so an author who
        // ran the pack build first and the link checker second must not be told
        // two different things about the same mistake — and a class the pack
        // build alone knew how to describe is how they came apart before.
        //
        // The note's name is appended rather than woven in: the message is the
        // defect, the name is the context this build can add.
        fail(u, `${linkFindingMessage(u)} — in "${name}".`);
    }
    return result;
}

/* ------------------------------------------------------------------------ */
/*  Generated tables: the searchable content universe                       */
/* ------------------------------------------------------------------------ */

/**
 * Every note in the content tree, in the shape the `dataview` table expander
 * searches: its frontmatter plus where it sits in the tree. Ordered by path so
 * a table that leaves rows tied still emits identically on every build.
 *
 * @param {string} contentBase - Root of the content tree.
 * @returns {Array<{fm: object, path: string, tld: string, folder: string,
 *   absPath: string}>}
 */
export function collectContentDocs(contentBase) {
    const docs = [];
    for (const { frontmatter: fm, absPath } of walkMarkdownTree(contentBase)) {
        if (!fm) continue;
        const segments = path.relative(contentBase, absPath).split(path.sep);
        docs.push({
            // With its package supplied for a `WHERE … package = "…"` query —
            // synthesised from the configuration, since no note declares it
            // (#56).
            fm: searchableFrontmatter(fm),
            // POSIX-separated and relative to the content root — what a
            // `path:` search term globs, on every platform.
            path: segments.join("/"),
            tld: segments[0],
            folder: segments[segments.length - 2] ?? segments[0],
            absPath,
        });
    }
    docs.sort((a, b) =>
        a.absPath < b.absPath ? -1
        : a.absPath > b.absPath ? 1
        : 0,
    );
    log.debug(`Content table index: ${docs.length} searchable note(s)`);
    return docs;
}

/**
 * A note is linkable from a generated table cell when it carries the identity
 * {@link convertWikilinks} addresses it by — a `type` and a `shortcode`. Every
 * type routes to a pack ({@link packForType}), so nothing else can make a note
 * unlinkable; a note missing either renders as plain text rather than shipping a
 * literal wikilink into a journal.
 */
const packLinkable = (doc) => Boolean(doc.fm?.shortcode) && Boolean(doc.fm?.type);

/**
 * Expand the fenced `dataview` tables in one note's markdown, before wikilinks
 * are resolved — so a generated cell may itself be a wikilink.
 *
 * A table searches the whole tree, which is one package's notes and nothing
 * else — so there is no longer a package to scope on. It used to filter, back
 * when a tree could hold several packages' notes and `package:` said which was
 * which; that field is retired and the filter with it (#56).
 *
 * @param {string} body - The note's markdown body.
 * @param {object} ctx
 * @param {Array<object>} ctx.docs - From {@link collectContentDocs}.
 * @param {string} ctx.name - The note, for the error message.
 * @param {object} [ctx.fm] - The source note's frontmatter, which is what a
 *   query's `this` reads. Its entry in `docs` supplies the path as well.
 * @param {number} [ctx.bodyLine] - 1-based file line of the body's first line,
 *   so a failing directive can be reported at its position in the file.
 * @returns {{markdown: string, lineMap: Array<{line: number,
 *   generated: boolean}>}} The body with every table expanded, and where each
 *   emitted line came from — which is what lets a diagnostic about the
 *   expanded body name an authored position (#17).
 * @throws {Error} When a query is malformed or unsupported — the note fails to
 *   compile rather than shipping a table-shaped hole. The error carries
 *   `position`, the directive's own line.
 */
export function expandNoteTables(body, { docs, name, fm, bodyLine }) {
    const self =
        fm ?
            (docs.find((d) => d.fm?.id && d.fm.id === fm.id) ?? {
                fm: searchableFrontmatter(fm),
            })
        :   undefined;
    const { markdown, errors, lineMap } = expandContentTables(body ?? "", {
        docs,
        linkable: packLinkable,
        source: name,
        self,
    });
    if (errors.length) {
        const err = new Error(errors.map((e) => `content table — ${e.reason}`).join("; "));
        // The first failing directive's line. Reporting one position for a
        // message that may name several is honest here: a caller opens the
        // file at the first thing to fix, and the message lists the rest.
        if (bodyLine !== undefined && errors[0].line !== undefined) {
            err.position = { line: bodyLine + errors[0].line };
        }
        throw err;
    }
    return { markdown, lineMap };
}

/* ------------------------------------------------------------------------ */
/*  Folder hierarchy: loading, resolution, emission                         */
/* ------------------------------------------------------------------------ */

/**
 * Loads a folders.yaml file as an array of folder entries. Returns []
 * when the file is missing (logging a warning) so packs without folders
 * can opt out simply by not committing the file.
 */
export function loadFolders(foldersFile) {
    if (!fs.existsSync(foldersFile)) {
        log.warn(`No folders.yaml at ${foldersFile}; no folders will be emitted`);
        return [];
    }
    const raw = fs.readFileSync(foldersFile, "utf8");
    const parsed = yaml.parse(raw);
    if (parsed == null) return [];
    if (!Array.isArray(parsed)) {
        throw new Error(`folders.yaml must contain a YAML list; got ${typeof parsed}`);
    }
    return parsed;
}

/**
 * Validates folder invariants and returns a resolver function that maps a
 * folder id to the same id (after verifying it exists). Returns `null` for
 * a null/empty input; throws for an unknown id.
 *
 * Invariants:
 *   - Every folder must have a non-empty id
 *   - Every folder must have a name
 *   - Sibling folders (same parentFolderId) must have unique names
 *   - Every parentFolderId must match an existing folder id (or be "")
 *
 * Returns { resolver, folders } where folders is the validated list.
 */
export function buildFolderResolver(folders) {
    const byId = new Map();
    for (const f of folders) {
        if (!f.id) {
            throw new Error(`Folder missing id: ${JSON.stringify(f)}`);
        }
        if (!f.name) {
            throw new Error(`Folder ${f.id} missing name`);
        }
        if (byId.has(f.id)) {
            throw new Error(`Duplicate folder id ${f.id}`);
        }
        byId.set(f.id, f);
    }

    const siblingsByParent = new Map();
    for (const f of folders) {
        const parentId = f.parentFolderId || "";
        if (parentId && !byId.has(parentId)) {
            throw new Error(
                `Folder ${f.id} (${f.name}) references unknown parentFolderId ${parentId}`,
            );
        }
        if (!siblingsByParent.has(parentId)) {
            siblingsByParent.set(parentId, new Set());
        }
        const siblings = siblingsByParent.get(parentId);
        if (siblings.has(f.name)) {
            throw new Error(
                `Sibling folders share name "${f.name}" under parent ${parentId || "(root)"} — names must be unique among siblings`,
            );
        }
        siblings.add(f.name);
    }

    function resolver(folderId) {
        if (folderId == null || folderId === "") return null;
        const id = String(folderId).trim();
        if (!id) return null;
        if (!byId.has(id)) {
            throw new Error(`Unknown folder id "${id}"`);
        }
        return id;
    }

    return { resolver, folders };
}

/**
 * Builds a compendium-source filename for a folder JSON document:
 * `folder_Name_id.json` with non-alphanumeric runs replaced by
 * underscores.
 */
export function folderFilename(name, id) {
    return `folder_${unidecode(name)}_${id}`.replace(/[^0-9a-zA-Z]+/g, "_") + ".json";
}

/**
 * Writes one JSON document per folder into `destDir`. `documentType`
 * determines the folder's Foundry `type` field — `"Item"` for the items
 * pack, `"JournalEntry"` for the journals pack.
 */
export function writeFolderDocs(folders, stats, destDir, documentType) {
    for (const folder of folders) {
        const doc = {
            name: folder.name,
            sorting: "a",
            folder: folder.parentFolderId || null,
            type: documentType,
            _id: folder.id,
            sort: 0,
            color: folder.color,
            flags: folder.flags || {},
            _stats: stats,
            _key: `!folders!${folder.id}`,
        };
        const outPath = path.join(destDir, folderFilename(folder.name, folder.id));
        fs.writeFileSync(outPath, JSON.stringify(doc, null, 2), "utf8");
    }
    log.info(`Emitted ${folders.length} folder document(s) to ${destDir}`);
}
