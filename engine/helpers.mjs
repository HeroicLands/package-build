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
import { iconPlugin } from "./content-icons.mjs";
import { imagePlugin } from "./content-images.mjs";
import { resolvePathname } from "./pathnames.mjs";
import log from "loglevel";

import { loadPackConfig } from "./pack-config.mjs";
import { packRouter } from "./pack-router.mjs";
import { contentPackage, foundryPackageId } from "./content-package.mjs";
import { searchableFrontmatter } from "./note-package.mjs";
import { PACKAGE_BASE } from "./content-address.mjs";
import { resolveNoteId } from "./note-ids.mjs";
import { loadForeignIndexes } from "./metadata-index.mjs";
// The record accessors only — deriving records reaches the pack router and the
// manifest emitter, which reach the compilers, which load this module. Reading
// a record needs none of that.
import { authoredFrontmatter, isAssetRecord, isNoteRecord, noteFile } from "./index-records.mjs";
import { buildWikilinkIndex, convertWikilinks } from "./wikilinks.mjs";
// One vocabulary of link findings, and one message per class, so the three
// resolvers cannot word the same defect differently.
import { linkFindingMessage } from "./wikilink-syntax.mjs";
// The declared tag vocabulary, which is where `draft` is stated. Read
// from there rather than respelt, so the tag and its one reader cannot drift.
import { isDraftNote } from "./note-vocabulary.mjs";
import { expandContentTables } from "./content-tables.mjs";
import { positionInBody } from "./diagnostics.mjs";
// The pure `sohl:` frontmatter readers live in a leaf module so the item-type
// registry can import them without reaching back through this one.
// Re-exported here so every existing importer keeps its single import path.
import { getFrontmatter } from "./frontmatter.mjs";
export {
    getFrontmatter,
    sohlField,
    folderField,
    resolveCharges,
    resolveSkillAptitudes,
    resolveRelation,
    requireSubType,
    parseValueDesc,
} from "./frontmatter.mjs";

/**
 * The markdown renderer every surface shares.
 *
 * `html: true` is long-standing and load-bearing — notes carry raw blocks — and
 * it is also why {@link module:engine/content-icons} exists rather than an
 * instruction to write `<i class="fa-solid …">` by hand: that would render on
 * the two HTML surfaces and be silently dropped by the third.
 */
export const md = markdownit({ html: true })
    .use(
        // Resolved per render, not at import: this constant is built before any
        // configuration is read, and a package's own icons live in the
        // configuration. A tree with none — or a caller with no configuration to
        // find — falls back to the shipped table.
        iconPlugin(() => {
            try {
                return loadPackConfig().icons;
            } catch {
                return undefined;
            }
        }),
    )
    // The width and position an image states, honoured as a figure. The
    // vocabularies are closed and need no configuration; the address does, and
    // is resolved per render for the reason the icon registry is — Foundry
    // serves a file from inside the install, so a body image's address is
    // translated by the same rule `img:` follows.
    .use(
        imagePlugin((src) => {
            // **Reported elsewhere, never here.** A renderer has no channel to
            // report through, and this one runs inside the very passes whose
            // job is to collect findings — a throw would take the whole lint
            // down and lose every other finding in the tree. A pathname this
            // rule refuses is a Foundry address, so emitting it unchanged is
            // right on the one surface this renderer serves, and the passes
            // that own the other three refuse it with a line and a column.
            try {
                return resolveImg(src, loadPackConfig()) ?? src;
            } catch {
                return src;
            }
        }),
    );

/**
 * Parses a markdown file with YAML frontmatter.
 *
 * Returns `{ frontmatter, body, description, bodyLine, bodyColumn }` where
 * `body` is the trimmed raw markdown after the frontmatter block, and
 * `description` is `body` rendered to HTML. `bodyLine` / `bodyColumn` are the
 * 1-based **file** position of the body's first character, which is what turns
 * an offset within `body` into a position a diagnostic can name — see
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
    // be reported as a file position. The frontmatter's lines and the
    // blank lines `trim()` removes both sit in between, and the trim can take
    // indentation off the first line as well — hence a column, not just a line.
    const bodyStart = content.length - raw.length + (raw.length - raw.trimStart().length);
    const before = content.slice(0, bodyStart);
    const bodyLine = before.split("\n").length;
    const bodyColumn = bodyStart - before.lastIndexOf("\n");
    return { frontmatter, body, description, bodyLine, bodyColumn };
}

/**
 * Refuse a corpus read whose scope its caller did not state.
 *
 * The rule in one place, so every reader of the tree refuses the same
 * way and says so in the same words. It is shared rather than repeated because
 * the corpus is no longer read only by {@link walkMarkdownTree}: a pass that
 * reads the content index instead is making the identical claim about which
 * files it is looking at, and must be held to the identical requirement — a
 * scope that quietly defaulted there would reintroduce exactly the second
 * answer the walk's requirement removed.
 *
 * @param {readonly string[]|undefined} skipDirectories - The stated scope.
 * @param {string} who - The reader, named in the message.
 * @throws {Error} When no scope was stated.
 * @returns {void}
 */
export function assertStatedScope(skipDirectories, who) {
    if (skipDirectories === undefined) {
        throw new Error(
            `${who} requires \`skipDirectories\`: the scope is the ` +
                "caller's to state, so two passes cannot disagree about which " +
                "files are the corpus",
        );
    }
}

/**
 * Refuse a corpus read whose records its caller did not supply.
 *
 * The sibling of {@link assertStatedScope}, and required for the same reason
 * one step further on. These two readers cannot derive the corpus themselves:
 * deriving it reaches the pack router and the manifest emitter, which reach the
 * compilers, which load this module — so importing the index here closes a
 * cycle. They take the records their caller already holds.
 *
 * That is not a workaround dressed up as a rule. A compile runs several passes
 * over one tree, and the whole point is that they must not each answer "which
 * files are the corpus?" for themselves. Requiring the answer to be handed in
 * makes the sharing structural rather than remembered.
 *
 * @param {readonly object[]|undefined} records - The supplied corpus.
 * @param {string} who - The reader, named in the message.
 * @throws {Error} When no corpus was supplied.
 * @returns {void}
 */
export function assertSuppliedCorpus(records, who) {
    if (!records) {
        throw new Error(
            `${who} requires \`records\`: the corpus is derived once per ` +
                "compile and handed to every pass, so no two passes can " +
                "disagree about which files it holds",
        );
    }
}

/**
 * Recursively yields every `.md` file under `rootDir`, parsed.
 *
 * Yields `{ frontmatter, body, description, file, absPath, bodyLine,
 * bodyColumn }` for each match — the last from {@link parseMarkdownFile}, so a
 * caller can report a position inside the body as a position in the file. A
 * root that does not exist yields nothing, and a directory that cannot be read
 * is warned about and skipped.
 *
 * Directory names in `skipDirectories` are ignored wherever they appear. The
 * walk itself knows nothing about what they mean: `Templates/` is an Obsidian
 * templater convention this repository's vault happens to use, not a property
 * of a content tree, so it is stated by the caller rather than hard-coded.
 *
 * @param {string} rootDir - Root of the tree to walk.
 * @param {object} opts
 * @param {readonly string[]} opts.skipDirectories - Directory names to ignore.
 *   Required: the scope is the caller's to state, so two passes cannot
 *   disagree about which files are the corpus.
 * @yields {{frontmatter: object|null, body: string, description: string,
 *   file: string, absPath: string, bodyLine?: number, bodyColumn?: number}}
 *   One entry per `.md` file found.
 * @throws {Error} When `skipDirectories` is not stated — see
 *   {@link assertStatedScope}.
 */
export function* walkMarkdownTree(rootDir, { skipDirectories } = {}) {
    // Stated by the caller, never resolved here. A default here
    // — `loadPackConfig().skipDirectories` — read whichever configuration
    // resolved from the working directory rather than the one the caller was
    // working under. In an ordinary build those are the same object and nothing
    // shows; they are not the same when a test injects a configuration, when
    // `PACKAGE_BUILD_CONFIG` names one, or when the command runs from a
    // worktree. Six of this function's twelve callers were on that default, so
    // "which files are the corpus?" had two answers depending on who asked
    // — the same defect class as `entriesForNote` reading `docEntryTypes` from
    // the ambient config rather than the passed one, which a fixture can pass
    // on indefinitely.
    assertStatedScope(skipDirectories, "walkMarkdownTree");
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
 * Every position a note may state its template priority at, for one system
 * block, in the order they answer — and whichever of them the note actually
 * wrote.
 *
 * Three places, in the order the migration runs. The specification calls this
 * `data.templatePriority`; `sohl-thalorna` already writes it there on 941
 * notes, beside the `archetype` the build reads — so a tree that has authored
 * forward is read from the key it authored, and only then does the retiring
 * spelling answer.
 *
 * **The block is a parameter because the value is shared, not per-system.** One
 * `data.templatePriority` is the note's statement that it is a template; SoHL
 * records it as `system.templatePriority` and HM3 as `flags.hm3.templatePriority`.
 * The legacy in-block position is therefore read from *the block being compiled*
 * rather than always from `sohl:`, so an HM3-only note is not asked to author a
 * SoHL block to be read.
 *
 * @param {object} fm     Parsed frontmatter.
 * @param {string} block  The system block being compiled.
 * @returns {{found: [object, string]|undefined, retiring: [object, string]|undefined,
 *   NEW: string, OLD: string}} The answering position, the retiring spelling's
 *   position if the note also carries it, and the two key names.
 */
function findTemplatePriority(fm, block) {
    const inBlock =
        fm != null && typeof fm[block] === "object" && fm[block] !== null ? fm[block] : null;
    const data = fm != null && typeof fm.data === "object" && fm.data !== null ? fm.data : null;

    const NEW = "templatePriority";
    const OLD = "archetype";
    const sources = /** @type {[object|null, string][]} */ ([
        [data, NEW],
        [inBlock, NEW],
        [fm, NEW],
        [inBlock, OLD],
        [fm, OLD],
    ]);
    const found = sources.find(([where, key]) => where != null && key in where);
    // A note part-way through the rename may carry both spellings, and they may
    // *disagree*: 145 of `sohl-thalorna`'s 941 dual-spelled notes say
    // `templatePriority: null` where `archetype: 0` says the opposite — "not a
    // template" against "a template at priority 0". Preferring the new key
    // silently would flip those documents, and preferring the old would ignore
    // what an author wrote most recently. Neither is a decision this function
    // gets to make quietly, so a contradiction is refused and named.
    const retiring = sources
        .slice(sources.findIndex(([, key]) => key === OLD))
        .find(([where, key]) => where != null && key in where);
    return {
        found: /** @type {[object, string]|undefined} */ (found),
        retiring: /** @type {[object, string]|undefined} */ (retiring),
        NEW,
        OLD,
    };
}

/**
 * The template priority a note states, for a system that treats an unstated one
 * as "not a template" rather than as an authoring error.
 *
 * Reads exactly the positions {@link resolveTemplatePriority} reads, including
 * the retiring `archetype` spelling, and refuses the same contradiction — so
 * the two systems cannot disagree about what a note said. It differs only in
 * what silence means: SoHL requires the statement, while HM3 keeps the value in
 * a flag it simply omits, so there is no tri-state for an absent value to
 * corrupt and nothing to demand.
 *
 * @param {object} fm      Parsed frontmatter.
 * @param {string} label   Human-readable context for error messages.
 * @param {object} [options] Options.
 * @param {string} [options.block="sohl"] The system block being compiled.
 * @returns {number|null}  The priority, or `null` when the note is not a
 *   template or states nothing.
 * @throws {Error} When both spellings are present and disagree.
 */
export function statedTemplatePriority(fm, label, { block = "sohl" } = {}) {
    const { found, retiring, NEW, OLD } = findTemplatePriority(fm, block);
    if (found && retiring && found[1] !== OLD && found[0][found[1]] !== retiring[0][OLD]) {
        throw new Error(
            `Conflicting ${NEW} for ${label}: ` +
                `${NEW} is ${JSON.stringify(found[0][found[1]])} and the retiring ` +
                `${OLD} is ${JSON.stringify(retiring[0][OLD])}. Both are read and ` +
                `${NEW} wins, so they must agree — delete ${OLD}, or correct it`,
        );
    }
    if (!found) return null;
    const raw = found[0][found[1]];
    return raw === null || raw === "" || raw === undefined ? null : raw;
}

/**
 * Resolve the required `templatePriority` frontmatter for an Item/Actor entry
 * (the archetype contract). The property is a nullable number that
 * authors must state explicitly:
 *   - a number → the document is a template of that priority.
 *   - `null`   → the document is not a template.
 *   - absent   → an authoring error (throws), so "not a template" is never
 *                silently assumed.
 *
 * Reads the positions {@link findTemplatePriority} lists: `data.templatePriority`
 * first — the specified home — then the system block and the top level, and
 * finally the retiring `archetype` spelling in the same two places.
 *
 * @param {object} fm      Parsed frontmatter.
 * @param {string} label   Human-readable context for error messages.
 * @param {object} [options] Options.
 * @param {string} [options.block="sohl"] The system block being compiled.
 * @returns {number|undefined}  The template priority, or `undefined` when null.
 * @throws {Error} When the property is absent, is not a number/null, or both
 *   spellings are present and disagree.
 */
export function resolveTemplatePriority(fm, label, { block = "sohl" } = {}) {
    const { found, retiring, NEW, OLD } = findTemplatePriority(fm, block);

    if (found && retiring && found[1] !== OLD && found[0][found[1]] !== retiring[0][OLD]) {
        throw new Error(
            `Conflicting ${NEW} for ${label}: ` +
                `${NEW} is ${JSON.stringify(found[0][found[1]])} and the retiring ` +
                `${OLD} is ${JSON.stringify(retiring[0][OLD])}. Both are read and ` +
                `${NEW} wins, so they must agree — delete ${OLD}, or correct it`,
        );
    }
    if (!found) {
        throw new Error(
            `Missing required ${NEW} for ${label} — set a number (this is a template, at that priority) or null (it is not)`,
        );
    }
    const raw = found[0][found[1]];
    if (raw === null) return undefined;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
        throw new Error(
            `Invalid ${found[1]} for ${label}: expected a number or null, got ${JSON.stringify(raw)}`,
        );
    }
    return raw;
}

/**
 * The value a document's `system.templatePriority` carries, from the required
 * `templatePriority` frontmatter (`archetype` is the legacy spelling).
 *
 * A **schema field**, so the tri-state is written out in full rather than
 * expressed by a key's presence: a number is a template at that priority, and
 * `null` is not a template. This is where {@link resolveTemplatePriority}'s
 * `undefined` becomes the field's `null` — an emitted `undefined` would be
 * dropped by `JSON.stringify`, leaving the compiled document with no
 * `templatePriority` at all and the tri-state readable as two.
 *
 * **`0` is a template.** It is the priority SoHL's own templates ship at, and
 * it is falsy, so this returns it unchanged and every caller must ask
 * `typeof v === "number"` rather than testing truthiness.
 *
 * @param {object} fm      Parsed frontmatter.
 * @param {string} label   Human-readable context for error messages.
 * @returns {number|null}  The template priority, or `null` for a document that
 *   is not a template.
 * @throws {Error} When the property is absent or invalid.
 */
export function systemTemplatePriority(fm, label) {
    const priority = resolveTemplatePriority(fm, label);
    return priority === undefined ? null : priority;
}

/**
 * Generates a compendium-source filename: `Name_id.json` with non-
 * alphanumeric runs replaced by underscores.
 */
export function makeFilename(name, id) {
    return `${unidecode(name)}_${id}`.replace(/[^0-9a-zA-Z]+/g, "_") + ".json";
}

/**
 * Translate an authored pathname into the address a Foundry install serves.
 *
 * The Foundry half of {@link module:engine/pathnames.resolvePathname}, which
 * states the rule and derives the other three surfaces from the same
 * statement. Kept as its own function because the compilers want one address
 * and nothing else, and because the default a caller applies to an unset one is
 * domain-specific — actors default differently from items, and gear differently
 * again — so each compiler owns its default and applies it with **nullish**
 * coalescing: `resolveImg(fm.img) ?? <default>`. Not `||`, which would collapse
 * a deliberate blank back into the default.
 *
 * **Two empties, and they mean opposite things.** `null` — or an absent key,
 * which reaches here as `undefined` — means _unset_: the note names no art and
 * the caller's default applies. `""` means _blank on purpose_: the note names
 * no art **and wants none**, so no default may replace it. Both come back
 * distinguishable, `null` and `""` respectively, and neither is invented from
 * the other.
 *
 * **`title` does not follow this rule**, and must not be made to. On a
 * `type: affiliation` note `title` is *also* a declared item field whose default
 * is `""` (`sohl/item-fields.mjs`), resolved from the very same shared top-level
 * key the site emitter reads as the page title — so `title: null` stringifies
 * into the compiled document as the literal `"null"`. One key, two destinations
 * that disagree about what empty means.
 *
 * **`banner:` does not follow it either, deliberately.** It is not a file
 * inside a Foundry install: it reaches no compiled document and no book, its
 * only consumer is the Hugo theme, and the theme resolves it against the site's
 * own asset root. See `docs/content-format.md`.
 *
 * For items, the default is the art paired with the type's builder, reached
 * through `itemArt()`, which runs the pathname back through this function so a
 * registry entry and a note's `img:` are spelled the same way.
 *
 * @param {string | null | undefined} raw - The pathname from frontmatter.
 * @param {{assetRoot: string|null}} [config] - The resolved build configuration.
 *   Defaults to this repository's.
 * @returns {string | null} the Foundry-relative path; `""` for a deliberate
 *   blank, and `null` when the note names no art at all.
 * @throws {Error} When no Foundry address can be derived — a `documentation`
 *   package, which Foundry installs nothing of, or a pathname naming a package
 *   this build declares no relationship with.
 */
export function resolveImg(raw, config = loadPackConfig()) {
    const forms = resolvePathname(raw, config);
    if (forms === null) return null;
    if (forms.foundry !== null) return forms.foundry;
    if (forms.own) {
        throw new Error(
            `package-build: \`${forms.authored}\` names a file this package serves, ` +
                `and a \`documentation\` package has no asset root to serve it from — ` +
                `Foundry installs no such package. Address a \`/\`-rooted path or a URL.`,
        );
    }
    throw new Error(
        `package-build: \`${forms.authored}\` names a file the \`${forms.package}\` ` +
            `package ships, and this build declares no relationship with a package of ` +
            `that name, so there is no Foundry address to derive. Declare it under ` +
            `\`relationships\`, or address the file by a \`/\`-rooted path.`,
    );
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
 * every v14 migration.
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
 * Every stamped identity is configuration: four compilers used to pass
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
 * The `_stats` block for one pack, stamped with the system that pack is for.
 *
 * **`systemId` travels with `systemVersion`.** They are one decision, so where
 * one is omitted both are. Stamping a per-pack version against a package-wide
 * id would emit `systemId: sohl, systemVersion: 1.6.3` on HM3 documents — a
 * *plausible lie*, which is worse than a missing value, because
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

// The one slug rule, re-exported so callers keep a single import path.
/**
 * Standardize a name into a slug: lowercase, apostrophes removed,
 * non-alphanumerics collapsed to single hyphens.
 */
export { slugify } from "./content-slug.mjs";

/**
 * Stable 16-char hex id derived from `${namespace}:${value}`.
 *
 * Defined in {@link sohl.utils.packs.ids} — a leaf module, so that the link
 * resolver this one imports can derive ids too — and re-exported here for the
 * passes that have always reached it through `helpers`.
 */
export { makeId } from "./ids.mjs";

// The content-type → document-type map, which decides *which* pack list a
// note's own document is routed against.
import { assertTypeNotRetired, packForType } from "./ids.mjs";
import { collectAnchors } from "./anchors.mjs";

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
 * would otherwise address every one of them as the first. A note whose
 * declaration is unroutable is indexed against the conventional name and left
 * for the compile pass to report — the index has no business failing a build,
 * and the pass fails it with a far better message. The one exception is a
 * **retired** content type: this walk is the first to see every
 * note together with its path, and unlike an unroutable declaration there is
 * no pass that would ever claim such a note and report it.
 *
 * @param {string} contentBase - Root of the content tree.
 * @param {object} [router] - The pack router. Supplied by the calling pass so
 *   the index and the compile agree about where each note landed; defaults to
 *   this repository's own.
 * @param {object} [opts]
 * @param {readonly string[]} [opts.skipDirectories] - Part of the options bag
 *   every corpus reader takes; the scope is already settled by `records`.
 * @param {object} [opts.config] - The resolved build configuration; loaded when
 *   omitted.
 * @param {readonly object[]} [opts.records] - The corpus, derived once per
 *   compile and handed in. Required: see {@link assertSuppliedCorpus}.
 * @param {object[]} [opts.problems] - Part of the same options bag; the notes
 *   the index cannot record are collected where the corpus is derived.
 * @returns {{byShortcode: Map, types: Set}} From `buildWikilinkIndex`.
 */
export function buildContentLinkIndex(
    contentBase,
    router = packRouter(),
    { skipDirectories, config, records, problems } = {},
) {
    const docs = [];
    /** The files this package ships, by canonical address. */
    const assets = new Map();
    const resolved = config ?? loadPackConfig();
    assertSuppliedCorpus(records, "buildContentLinkIndex");
    for (const record of records) {
        // An asset's record addresses a file rather than a note, so it becomes
        // no `doc` and takes no part in link resolution — it is keyed for the
        // art fields, which name a file and never a document.
        if (isAssetRecord(record)) {
            if (record.address?.canonical) assets.set(record.address.canonical, record);
            continue;
        }
        // A documentation journal is a document this tree emits, not a note in
        // it; the note it documents is indexed here and carries its address.
        if (!isNoteRecord(record)) continue;
        // The note as its author wrote it — the router, the draft tag and the
        // retired-type check all read authored fields, and none of them may be
        // handed the keys the index derived.
        const fm = authoredFrontmatter(record);
        const absPath = noteFile(contentBase, record);
        // The id a note's document is filed under: its authored pin, or the
        // one derived from its canonical address. Derived by the index
        // against the configuration this build resolved — never here through
        // `resolveNoteId(fm)` with no package, which falls back to the ambient
        // `contentPackage()` and so to whichever configuration the working
        // directory answers with.
        // What is left after that is a file with **no address** — no type, or
        // no shortcode — which is not an addressable note and has no document
        // to link to.
        if (!fm?.id) continue;
        // The first walk of every note in the tree, and the only one holding
        // both the declared type and the file that declares it — so a note
        // left on a retired type is reported here, by name, rather than
        // several frames deeper with nothing to go on.
        assertTypeNotRetired(fm.type, absPath);
        const base = String(record.file.name).replace(/_/g, " ");
        docs.push({
            type: fm.type,
            id: fm.id,
            // Where this note's own document lands, and where the JournalEntry
            // its prose compiles into lands — two documents, two packs.
            pack: router.resolveOrNull(fm, packForType(fm.type).docType),
            docPack: router.resolveOrNull(fm, "JournalEntry"),
            shortcode: fm.shortcode ?? null,
            // What the note *is*, carried so a caller resolving a reference
            // can group by the family its target declares rather than only by
            // where the target lives.
            subType: fm.subType ?? null,
            name: fm.name?.full ?? base,
            // Whether the note is tagged `draft`. Read from the tag
            // vocabulary that declares it, and used for one thing: a link
            // *into* this note renders marked. It takes no part in resolution,
            // so the note is indexed, compiled and published as any other.
            draft: isDraftNote(fm),
            // The anchors this note declares, carried so the *builds* can check
            // a `#section` link and not only the checker. A foreign
            // anchor has always been checked, because a fetched index
            // publishes the map; a local one was not, because the set was
            // discarded here — the walk yields the body and nothing read it.
            // Read from the record rather than from a second reading of the
            // note's headings — the one-anchor-reader rule.
            anchors: new Set((record.anchors ?? []).map((anchor) => anchor.slug)),
        });
    }
    // Packages this build links *into* but does not publish. Each publishes
    // its own content index and this build fetched the ones it depends on, so
    // a contributor without every repository checked out resolves the same
    // links CI does — from an artifact the producer shipped rather than a copy
    // this repository committed.
    const { index: foreign, stale } = loadForeignIndexes(
        resolved,
        [resolved.contentPackage],
        PACKAGE_BASE,
    );
    if (stale.length) {
        for (const st of stale) {
            log.error(`Unusable content index for "${st.package}": ${st.reason}`);
        }
        throw new Error(
            "Cross-package links cannot be resolved from an unusable index; " +
                "re-run `content-build deps fetch`.",
        );
    }
    log.debug(
        `Wikilink index: ${docs.length} local document(s), ` +
            `${foreign.size} foreign address(es)`,
    );
    return buildWikilinkIndex(docs, resolved.foundryPackage, foreign, resolved.contentPackage, {
        assets,
    });
}

/**
 * Converts the wikilinks in one note's markdown, reporting any that have no
 * target in the content tree. Every compiler funnels through this so the
 * diagnostic text and the leave-it-alone fallback are identical everywhere.
 *
 * Each report names the **file, line and column** the link sits on, so
 * it can be opened and fixed — and so two identical links on one note are
 * tellable apart. That needs `file` and the note's `bodyLine` / `bodyColumn`;
 * without them the diagnostic still reports, one field shorter, rather than
 * inventing a position.
 *
 * @param {string} body - The note's markdown body, tables already expanded.
 * @param {object} ctx
 * @param {string} ctx.type - The source note's content type.
 * @param {string} ctx.id - The source note's document id.
 * @param {string} ctx.pack - The pack the note's own document lands in, which
 *   addresses a `[[#slug]]` self-link: its target is the source note itself, so
 *   it has no index entry.
 * @param {string} ctx.docPack - The pack the note's documentation journal lands
 *   in, addressing a self-link the same way.
 * @param {object} ctx.index - The address index every link resolves through.
 * @param {string} ctx.name - The note, for the message.
 * @param {string} [ctx.file] - The note's file, so a report names it.
 * @param {number} [ctx.bodyLine] - 1-based file line of the body's first line.
 * @param {number} [ctx.bodyColumn] - 1-based file column of the same character.
 * @param {Array<{line: number, generated: boolean}>} [ctx.lineMap] - Which
 *   authored line each body line came from, from {@link expandNoteTables}.
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
        // Every class fails, and every class is worded by the shared table.
        // The three resolvers read one authored link, so an author who
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
 * @param {object} [opts]
 * @param {readonly string[]} [opts.skipDirectories] - Part of the options bag
 *   every corpus reader takes; the scope is already settled by `records`.
 * @param {object} [opts.config] - The resolved build configuration; loaded when
 *   omitted.
 * @param {readonly object[]} [opts.records] - The corpus, derived once per
 *   compile and handed in. Required: see {@link assertSuppliedCorpus}.
 * @param {object[]} [opts.problems] - Part of the same options bag; the notes
 *   the walk cannot read are collected where the corpus is derived.
 * @returns {Array<{fm: object, path: string, tld: string, folder: string,
 *   absPath: string}>}
 */
export function collectContentDocs(
    contentBase,
    { skipDirectories, config, records, problems } = {},
) {
    const docs = [];
    const resolved = config ?? loadPackConfig();
    assertSuppliedCorpus(records, "collectContentDocs");
    for (const record of records) {
        if (!isNoteRecord(record)) continue;
        const fm = authoredFrontmatter(record);
        const absPath = noteFile(contentBase, record);
        const segments = String(record.file.path).split("/");
        docs.push({
            // With its package supplied for a `WHERE … package = "…"` query —
            // synthesised from the configuration this build resolved, since no
            // note declares it and the ambient one is a different
            // configuration in a worktree or under `PACKAGE_BUILD_CONFIG`.
            fm: searchableFrontmatter(fm, resolved.contentPackage),
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
 * which; that field is retired and the filter with it.
 *
 * @param {string} body - The note's markdown body.
 * @param {object} ctx
 * @param {Array<object>} ctx.docs - From {@link collectContentDocs}.
 * @param {string} ctx.name - The note, for the error message.
 * @param {object} [ctx.fm] - The source note's frontmatter, which is what a
 *   query's `this` reads. Its entry in `docs` supplies the path as well.
 * @param {number} [ctx.bodyLine] - 1-based file line of the body's first line,
 *   so a failing directive can be reported at its position in the file.
 * @param {object[]} [ctx.sqlTables] - This note's prepared `sql` results, in
 *   document order, from
 *   {@link module:engine/sql-tables.prepareSqlTables}. An `sql` directive with
 *   no prepared result fails the note: nothing here runs a query.
 * @returns {{markdown: string, lineMap: Array<{line: number,
 *   generated: boolean}>}} The body with every table expanded, and where each
 *   emitted line came from — which is what lets a diagnostic about the
 *   expanded body name an authored position.
 * @throws {Error} When a query is malformed or unsupported — the note fails to
 *   compile rather than shipping a table-shaped hole. The error carries
 *   `position`, the directive's own line.
 */
export function expandNoteTables(body, { docs, name, fm, bodyLine, sqlTables }) {
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
        sqlTables,
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
/*  Folder document filenames                                               */
/* ------------------------------------------------------------------------ */

/**
 * Builds a compendium-source filename for a folder JSON document:
 * `folder_Name_id.json` with non-alphanumeric runs replaced by
 * underscores.
 */
export function folderFilename(name, id) {
    return `folder_${unidecode(name)}_${id}`.replace(/[^0-9a-zA-Z]+/g, "_") + ".json";
}
