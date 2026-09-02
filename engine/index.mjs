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
 * The package-agnostic half of the toolchain: everything that knows how a
 * HeroicLands content tree is shaped, but nothing about any particular game
 * system's data model.
 *
 * The content walk, frontmatter parsing, table generation, wikilink
 * resolution, id and folder derivation, the link manifest and the web-address
 * rule, `BasePackCompiler`, and the generic Foundry document compilers
 * (journals, macros, scenes) all live here (#1512).
 *
 * **Each module is re-exported as its own namespace, not flattened.** Several
 * of them deliberately re-export a neighbour's symbol so a caller keeps one
 * import path (`helpers` re-exports the frontmatter readers and `makeId`;
 * `wikilinks` re-exports the pack router). Flattened, every such name would
 * become an ambiguous star export and vanish from this barrel silently. Each
 * module is also reachable as its own entry point —
 * `@heroiclands/package-build/engine/<module>` — which is how a build that
 * needs one thing avoids loading the whole pipeline.
 *
 * @module
 */

/** Deterministic document ids, the conventional pack map, and compendium UUIDs. */
export * as ids from "./ids.mjs";

/** Fenced-code detection, so a rewrite never edits a code block. */
export * as codeFences from "./code-fences.mjs";

/** The `sohl:` frontmatter readers, shared by every content package. */
export * as frontmatter from "./frontmatter.mjs";

/** The content walk's note census — the empty-tree guard's evidence. */
export * as contentTree from "./content-tree.mjs";

/** The consuming repository's resolved `package-build.config.yaml`. */
export * as packConfig from "./pack-config.mjs";

/** Which pack of a document type a note's document lands in (#1566). */
export * as packRouter from "./pack-router.mjs";

/** The content package a build compiles, and the Foundry package it ships in. */
export * as contentPackage from "./content-package.mjs";

/** Which content package a note belongs to, and refusing one that says so. */
export * as notePackage from "./note-package.mjs";

/** Frontmatter fields a note may no longer declare, and the refusal of them. */
export * as retiredFields from "./retired-fields.mjs";

/** The package homepage: the note type that compiles to a page, not a document. */
export * as homepage from "./homepage.mjs";

/** The note types the engine itself declares, whatever a consumer registers. */
export * as noteSchemas from "./note-schemas.mjs";

/** The shipped Foundry manifest: locating it, reading it, guarding its id. */

/** The URL a content note is published at — the one web-address rule. */
export * as contentSlug from "./content-slug.mjs";

/** Section and address derivation on top of {@link contentSlug}. */
export * as contentAddress from "./content-address.mjs";

/** Whether a vendored manifest can still be addressed, not merely read. */
export * as foreignManifests from "./foreign-manifests.mjs";

/** The cross-package link manifest: reader, writer, and canonical keys. */
export * as kbManifest from "./kb-manifest.mjs";

/** Deriving this package's own link manifest from its content tree. */
export * as manifestEmit from "./manifest-emit.mjs";

/** Publishing a content tree as a website: the pass, and its integrity gates. */
export * as siteBuild from "./site-build.mjs";

/** Address rules every content tree is linted against: shape, uniqueness, alias. */
export * as contentLint from "./content-lint.mjs";

/** Resolving every link in a tree, and the ones that land nowhere. */
export * as contentLinks from "./content-links.mjs";

/** Wikilinks resolved to a **web URL** — the site half of the pair below. */
export * as webWikilinks from "./web-wikilinks.mjs";

/** Dataview-style content tables, expanded into markdown at compile time. */
export * as contentTables from "./content-tables.mjs";

/** Markdown parsing, stats, folders, images, and the wikilink index. */
export * as helpers from "./helpers.mjs";

/** The consumer's resolved item-type registry: the whitelist and its builders. */
export * as itemRegistry from "./item-registry.mjs";

/** The per-system note-type → document-subtype map, and looking a note up in it. */
export * as documentSubtypes from "./document-subtypes.mjs";

/** Which types carry documentation of their own, and where it is addressed. */
export * as itemDocs from "./item-docs.mjs";

/** Wikilinks resolved to a **Foundry UUID**: qualifiers, the index, rewriting. */
export * as wikilinks from "./wikilinks.mjs";

/** What a `[[…]]` is, before either resolver decides where it points. */
export * as wikilinkSyntax from "./wikilink-syntax.mjs";

/** The address index a site build resolves its wikilinks against. */
export * as siteIndex from "./site-index.mjs";

/** The shape every pack compiler shares. */
export * as baseCompiler from "./base-compiler.mjs";

/** The JournalEntry compiler, and the page/anchor derivation it shares. */
export * as journals from "./journals.mjs";

/** The Macro compiler. */
export * as macros from "./macros.mjs";

/** The map-note schema a Scene is authored in. */
export * as mapNotes from "./map-notes.mjs";

/** The Scene and Adventure compiler. */
export * as scenes from "./scenes.mjs";

/** The compiled-pack Scene/Level integrity guard. */
export * as sceneLevels from "./scene-levels.mjs";

/** Pack JSON generation — the pass that turns a content tree into documents. */
export * as generate from "./generate.mjs";

/** Compile, unpack, and clean the LevelDB packs. */
export * as compendiums from "./compendiums.mjs";

// The region-event vocabulary stays flat as well as namespaced: the Foundry
// runtime imports these three by name through
// `@heroiclands/package-build/engine/region-events`, and they were part of this
// barrel's surface before the pipeline arrived (#1510).
export {
    CURATED_REGION_EVENTS,
    EXCLUDED_REGION_EVENTS,
    REGION_EVENT_TO_TRIGGER,
} from "./region-events.mjs";

/** The curated region-event vocabulary, shared with the Foundry runtime. */
export * as regionEvents from "./region-events.mjs";
