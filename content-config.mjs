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
 * The per-repository configuration contract for `@heroiclands/package-build`.
 *
 * Every consuming repository declares one `package-build.config.yaml` at its
 * root:
 *
 * ```yaml
 * contentPackage: sohl
 * packageKind: systems
 * compatibility: { minimum: "14.359", verified: "14.364" }
 * stats:
 *     lastModifiedBy: sohlbuilder00000
 * itemBuilders: sohl
 * skipDirectories: [Templates]
 * packs:
 *     - { name: items, type: Item }
 *     - { name: journals, type: JournalEntry, label: Journals }
 * packageBuild:
 *     assets:
 *         - { from: assets/icons, to: assets/icons }
 * publish:
 *     site: content
 * ```
 *
 * `defineConfig` is the whole of the contract: it validates the object, fills
 * the optional halves with their defaults, and returns a deeply frozen copy.
 * It performs no I/O and knows nothing about any particular package's content —
 * a consumer's config is data, and the compilers read it.
 *
 * **This module validates; it does not load.** `engine/pack-config.mjs` is what
 * finds a repository's configuration and reads it, and it is where the four
 * fields absent from the YAML above are derived: `rootDir` (the directory the
 * file sits in), `foundryPackage` and `stats.systemVersion` (the adjacent
 * `package.json`), and the `itemBuilders` table the name `sohl` stands for. All
 * four are I/O or code, and this module is deliberately neither — which is also
 * why a consumer whose item-builder registry is its own writes
 * `package-build.config.mjs`, calling `defineConfig` below directly with a
 * `rootDir` of `import.meta.dirname`. Both forms end here, so both are
 * validated and frozen identically.
 *
 * **`rootDir` anchors every path**, so the build reads the same files whatever
 * directory it was launched from.
 *
 * The Foundry floor is declared here as top-level `compatibility`, and the
 * shipped manifest is generated *from* this file. That reverses an older rule —
 * configuration named where the manifest was and read the floor back out of it —
 * which was right while the manifest was hand-authored and became a round trip
 * through a generated artifact once it was not.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

// Leaves with no local imports of their own, so naming them here cannot close
// a cycle around a consumer's config file (see `engine/pack-config.mjs`).
import { ADDRESS_SEGMENT_PATTERN, isAddressSegment } from "./engine/address-charset.mjs";
import { ASSET_TYPE_NAMES } from "./engine/asset-types.mjs";
import { isReservedPackage } from "./engine/packages.mjs";
import { EMPTY_ICON_REGISTRY, checkIconRegistry } from "./engine/content-icons.mjs";
import { MAP_TYPES, PACK_BY_TYPE } from "./engine/ids.mjs";
import { ACTOR_TYPES } from "./engine/subtype-registry.mjs";
import { NOTE_VOCABULARY } from "./engine/note-vocabulary.mjs";

/**
 * What kind of package this is.
 *
 * `systems` and `modules` are the two Foundry answers, and the value is also
 * the directory Foundry installs the package under, which is why they are
 * plural. `documentation` is the answer "not a Foundry package at all": it
 * publishes a site and a book from its notes, installs into no Foundry data
 * directory and compiles no compendium.
 *
 * @satisfies {readonly PackageKind[]}
 */
export const PACKAGE_KINDS = /** @type {const} */ (["systems", "modules", "documentation"]);

/**
 * The kind that compiles no Foundry documents.
 *
 * Spelled once and read wherever a pass asks whether it applies, so the
 * validator, the CLI and the compile passes cannot come to disagree about what
 * the value means.
 *
 * @type {string}
 */
export const DOCUMENTATION_KIND = "documentation";

/**
 * Whether this package compiles Foundry documents at all.
 *
 * The one question every Foundry-side reader asks — the manifest writer, to
 * decide whether there is a package for Foundry to install, and the pack
 * compilers, to decide whether there is anything to compile.
 *
 * @param {{packageKind: string}} config - A resolved configuration.
 * @returns {boolean} Whether the package compiles Foundry documents.
 */
export function compilesFoundryDocuments(config) {
    return config.packageKind !== DOCUMENTATION_KIND;
}

/**
 * Every key a documentation package may not declare, and why.
 *
 * The value of the kind is as much in what it refuses as in what it accepts. A
 * key here cannot mean anything in a package that compiles nothing and installs
 * nowhere, so it fails at load naming the key — the loader resolves that name
 * to a line and a column — rather than being read and ignored, which is the
 * failure this contract exists to prevent.
 *
 * `foundryPackage` is on the list for the same reason as the rest, and is the
 * one the YAML loader would otherwise supply: it derives the id from the
 * adjacent `package.json`, and there is no Foundry package here to carry one.
 *
 * @type {Readonly<Record<string, string>>}
 */
const DOCUMENTATION_REFUSES = Object.freeze({
    packs: "compiles no compendium, so there are no packs to declare",
    itemBuilders: "compiles no items, so there is no item-type registry to name",
    docs: "compiles no items, so there are no item-field reference pages to frame",
    compatibility:
        "installs into no Foundry data directory, so there is no Foundry core range to support",
    relationships: "is not a Foundry package, so it stands in no relationship to one",
    systems: "compiles no documents, so it ships content for no game system",
    requiresSystem: "compiles no documents, so there is no game system to gate its packs on",
    stats: "compiles no documents, so there is no `_stats` block to stamp",
    foundryPackage: "is not a Foundry package, so it has no Foundry package id",
});

/**
 * The directories the build reads from and writes to, relative to `rootDir`,
 * with the layout a HeroicLands content repository conventionally uses. A
 * consumer overrides only the ones it moves.
 *
 */
export const DEFAULT_PATHS = /** @type {const} */ ({
    content: "assets/content",
    // The asset roots' parent — `icons/`, `images/` and `audio/` sit directly
    // under it, and the content tree beside them. Named separately from
    // `content` rather than derived from its parent, because the two are free to
    // move independently and deriving one from the other would make relocating
    // either a surprise for the other.
    assets: "assets",
    // Where `content-index` writes this package's note index. Under `build/`
    // because it is derived and disposable — regenerating it costs a
    // frontmatter parse — and emphatically not under `stage`, which is mirrored
    // into a Foundry data root.
    contentIndex: "build/content-index",
    packJson: "build/packs-json",
    stage: "build/stage/packs",
    unpack: "build/tmp/packs",
    // Where a dependency declaring `itemCatalog: true` is unpacked. Under
    // `build/` because it is derived, disposable, and version-keyed.
    foreignCache: "build/cache/foreign",
    // Where a dependency's published content index is fetched to. A
    // sibling of the item catalogue rather than a subdirectory of it: the two
    // are fetched for different dependency sets — a catalogue only where
    // `itemCatalog: true` is declared, an index for *every* declared
    // dependency — so nesting one under the other would imply a containment
    // that does not hold.
    metadataCache: "build/cache/metadata",
    // Where the site navigation heroiclands.org publishes is fetched to.
    // Beside the other two: it is fetched by the same command and read under
    // the same complete-marker rule.
    navigationCache: "build/cache/navigation",
});

/**
 * The Foundry document types a compendium pack may hold. This is the set the
 * toolchain is able to compile a pack of; a document type Foundry supports but
 * this toolchain does not compile is deliberately absent (playlists
 * and roll tables are out of scope).
 *
 * @satisfies {readonly PackDocumentType[]}
 */
export const PACK_DOCUMENT_TYPES = /** @type {const} */ ([
    "Actor",
    "Adventure",
    "Item",
    "JournalEntry",
    "Macro",
    "Scene",
]);

/**
 * Address-scheme keys a configuration may no longer declare.
 *
 * A retired key has exactly two possible fates, and only one of them is honest
 * — the same reasoning `engine/retired-fields.mjs` applies to a retired
 * frontmatter field. Left honoured, it keeps doing whatever it did, which is
 * why it was retired. Left *ignored*, it reads to its author as though it still
 * works: the configuration says one thing and the build does another, and
 * nothing says so. This module has no third option, because it has no warning
 * channel — every finding goes through `fail()`, which throws. So a retired
 * key is **refused**, at the line it was written on, with a message that says
 * the mechanism is gone rather than naming a value to correct.
 *
 * **`landing` is one such key.** It named which note addressed a whole section
 * rather than a page within one — a *landing page*, which therefore had no slug
 * of its own. There are no sections to address: a section is a Hugo content
 * directory the note format does not carry, a page's address names no
 * directory, and so no note lands anything.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const RETIRED_ADDRESS_KEYS = Object.freeze({
    landing:
        "is a retired option — delete it. It named which note addressed a " +
        "whole section rather than a page within one, and there are no " +
        "sections to address: a section is a Hugo content directory the note " +
        "format does not carry, so no note lands one and every page is " +
        "addressed `<type>-<shortcode>`. Nothing replaces it",
});

/**
 * A repository's address scheme, with the defaults an unconfigured one gets.
 *
 * `prefix` is where the content tree mounts *inside the package* — `"kb/"` for
 * `sohl`, whose knowledgebase is one surface among several, and empty for
 * `thalorna`, whose site is nothing but its content. It is not the package's
 * own mount point: where the package itself is served is the consuming build's
 * knowledge, held in `PACKAGE_BASE` (`engine/content-address.mjs`) and prefixed at
 * resolve time, so it is never recorded here.
 *
 * It is the whole scheme: `landing`, the key that named which note addressed a
 * whole section, is retired with the sections themselves — see
 * {@link RETIRED_ADDRESS_KEYS}.
 */
export const DEFAULT_ADDRESS_SCHEME = Object.freeze({
    prefix: "",
});

/**
 * How much of a package reaches the web.
 *
 * Every HeroicLands package publishes something: a top-level, human-authored
 * homepage at `https://www.heroiclands.org/<contentPackage>/` saying what the
 * module is, which system it needs and how to install it. So there is no
 * value here meaning *no web presence at all* — homepage-only is the **floor**,
 * and the default.
 *
 * - `homepage` — the authored homepage, and **no other page**. The content tree
 *   is not walked for pages, `site.sections` / `site.trees` / `site.landing`
 *   emit nothing, and nothing serves a page for its addresses.
 * - `content` — the homepage *plus* every page the content tree publishes: the
 *   knowledgebase, the extra trees, the section landings.
 *
 * **Homepage-only is a first-class mode, not an accommodation.**
 * `sohl-kethira-basic` (unofficial Hârn fan material under Keléstia Productions'
 * Fan Material Guidelines) and `harn-adventures` (HârnFanon under Lythia's
 * terms) must each publish a homepage and nothing beneath it — two packages
 * under two different fan-content licences. The boundary is **published
 * content**: journal text, artwork, item descriptions, compiled notes. A
 * human-authored page announcing the module discloses none of it. Because the
 * failure mode is silent — a `site:` block added later ships licensed content
 * with nobody noticing — the mode fences the content surfaces off rather than
 * trusting a configuration to stay empty.
 *
 * This was a boolean until 5.0.0, and `false` read as "no web presence", which
 * no longer describes any package. Both spellings are refused rather than
 * mapped: a value silently reinterpreted reads to its author as though it still
 * means what it said.
 *
 * @typedef {"homepage" | "content"} SiteMode
 */

/**
 * The publishing modes {@link PublishSwitches.site} may name, floor first.
 *
 * @satisfies {readonly SiteMode[]}
 */
export const SITE_MODES = /** @type {const} */ (["homepage", "content"]);

/**
 * Whether this package publishes the pages its content tree compiles to.
 *
 * The one question every reader of the mode actually asks — the site build, to
 * decide whether to walk the tree at all, and the content index, to
 * decide whether an entry carries a web `path`. Written once here so the two
 * cannot come to disagree about what a mode means.
 *
 * @param {{publish: {site: SiteMode}}} config - A resolved configuration.
 * @returns {boolean} Whether content pages are published.
 */
export function publishesContentPages(config) {
    return config.publish.site === "content";
}

/**
 * @typedef {"systems" | "modules" | "documentation"} PackageKind
 */

/**
 * @typedef {"Actor" | "Adventure" | "Item" | "JournalEntry" | "Macro" | "Scene"} PackDocumentType
 */

/**
 * One compendium pack the build compiles, named exactly as it is declared in
 * the package manifest's `packs` array.
 *
 * Several packs may share a `type`. The `type` selects the **compiler** that
 * fills the pack; a note's `pack:` frontmatter selects **which pack of that
 * type** receives its document. The two are orthogonal, and both are needed
 * once a repository groups same-type documents editorially — which it may have
 * to, since a compendium UUID carries its pack name and collapsing such a
 * layout breaks every stored reference.
 *
 * @typedef {object} PackSpec
 * @property {string} name              Pack name — the manifest `name`, and the
 *                                      directory under `packs/`.
 * @property {PackDocumentType} type    Foundry document type the pack holds.
 * @property {string} [label]           Human-readable label. Defaults to `name`.
 * @property {boolean} [private]        Whether the pack is GM-only. Default `false`.
 * @property {string} [prebuilt]        Directory holding this pack's per-document
 *                                     JSON, already built. Declaring it skips
 *                                     generation for the pack and compiles from
 *                                     there instead.
 * @property {string} [system]          The system this pack depends on, written
 *                                     to the manifest. Defaults to
 *                                     `stats.systemId`; omitted when neither is
 *                                     set.
 * @property {PackSpec[]} [companions]  Packs written by this pack's own compiler
 *                                      pass rather than a pass of their own (the
 *                                      scenes pass also emits the adventures
 *                                      bundling them). Default `[]`.
 * @property {boolean} [mayBeEmpty]     Whether a pass compiling zero entries is
 *                                      legitimate rather than a build failure.
 *                                      Default `false`.
 * @property {boolean} [default]        Whether this is the pack of its `type`
 *                                      that receives notes declaring no `pack:`
 *                                      of their own. Default `false`. A type
 *                                      with exactly one pack is its default
 *                                      implicitly; a type with several and no
 *                                      `default: true` requires every note of
 *                                      that type to declare one. Not permitted
 *                                      on a companion — no note is routed into
 *                                      one. See `engine/pack-router.mjs`.
 */

/**
 * The normalized form of a {@link PackSpec}: every optional half filled in.
 *
 * @typedef {object} ResolvedPackSpec
 * @property {string} name
 * @property {PackDocumentType} type
 * @property {string} label
 * @property {boolean} private
 * @property {string|null} prebuilt
 * @property {string|null} system
 * @property {readonly Readonly<ResolvedPackSpec>[]} companions
 * @property {boolean} mayBeEmpty
 * @property {boolean} default
 */

/**
 * The directories a consumer may relocate, each relative to `rootDir`.
 *
 * @typedef {object} PathsInput
 * @property {string} [content]          Content tree root.
 * @property {string} [assets]           The asset roots' parent — the directory
 *                                       holding `icons/`, `images/` and
 *                                       `audio/`.
 * @property {string} [contentIndex]     Where `content-index` writes this
 *                                       package's note index. Outbound, and a
 *                                       derived artifact — never a source, and
 *                                       never inside `stage`.
 * @property {string} [packJson]         Build-only per-entry JSON intermediate.
 * @property {string} [stage]            Compiled LevelDB packs.
 * @property {string} [unpack]           Where `unpack` extracts JSON back to.
 * @property {string} [foreignCache]     Where a dependency declaring
 *                                       `itemCatalog: true` is unpacked.
 *                                       Inbound, and fetched rather than
 *                                       committed.
 * @property {string} [metadataCache]    Where a dependency's published content
 *                                       index is fetched to. Inbound,
 *                                       for *every* declared dependency, not
 *                                       only those supplying a catalogue.
 * @property {string} [navigationCache]  Where the site navigation is fetched
 *                                       to, for the generated Hugo menu.
 */

/**
 * {@link PathsInput}, resolved to absolute paths against `rootDir`.
 *
 * @typedef {object} ResolvedPaths
 * @property {string} content
 * @property {string} assets
 * @property {string} contentIndex
 * @property {string} packJson
 * @property {string} stage
 * @property {string} unpack
 * @property {string} foreignCache
 * @property {string} metadataCache
 * @property {string} navigationCache
 */

/**
 * The identity every compiled document's `_stats` block carries.
 *
 * `coreVersion` is **not** here: it is the top-level `compatibility.minimum`,
 * so the floor is declared in one place and stamped from it.
 *
 * @typedef {object} StatsSpec
 * @property {string} systemId          The game system the documents are for —
 *                                      `"sohl"` even for a module, which ships
 *                                      content *for* the system rather than being it.
 * @property {string} systemVersion     The system version the packs were built against.
 * @property {string} lastModifiedBy    The 16-character id stamped as the author.
 */

/**
 * The section of the configuration belonging to `@heroiclands/package-build`.
 *
 * **Opaque here, on purpose.** One repository describes itself in one file, so
 * the two shared build packages share it — but they split by *input*, and
 * neither should learn the other's schema. This validator checks only that the
 * section is a mapping and hands it back frozen; package-build validates what
 * is inside it, exactly as this module validates the keys around it.
 *
 * That is also why it is a section rather than a scatter of top-level keys: one
 * reserved name keeps {@link ContentBuildConfig}'s unknown-key guard intact for
 * everything else, which is the guard that catches a typo'd `packs` before it
 * becomes an empty compendium.
 *
 * The values package-build needs that are *not* in here — `packageKind`,
 * `foundryPackage` — it reads from the top level, where they already are. They
 * were duplicated in each consumer's deploy script until this existed, which is
 * two places for one fact.
 *
 * @typedef {Record<string, unknown>} PackageBuildSection
 */

/**
 * @typedef {object} PublishSwitches
 * @property {SiteMode} site          How much of this package reaches the web.
 *                                    See {@link SITE_MODES}.
 */

/**
 * The **Foundry core** version range this package supports.
 *
 * `minimum` is stamped into every compiled document as `_stats.coreVersion`, so
 * a document never claims to predate the migrations that would rewrite it.
 *
 * `verified` names the newest build the full suite has **actually passed** —
 * never an aspiration. Moving this out of the hand-authored manifest and into a
 * configuration file does not soften that; if anything it makes the claim
 * easier to edit casually, so it is written down here beside the key rather
 * than left behind in the template.
 *
 * Not to be confused with `relationships.systems[].compatibility`, which is the
 * **game system's** version range. Same key, different subject.
 *
 * @typedef {object} CompatibilitySpec
 * @property {string} minimum   Oldest Foundry core this package supports.
 * @property {string} [verified]  Newest Foundry core the suite has passed on.
 */

/**
 * What this package declares about other packages, in Foundry's own shape.
 *
 * Passed through to the shipped manifest, and read here for one derivation: a
 * module's `_stats.systemVersion` comes from the `verified` field of the system
 * it declares a relationship with, because a module's own `package.json`
 * version is the *module's* and stamping it would claim a system version that
 * never existed.
 *
 * @typedef {object} Relationships
 * @property {RelationshipSpec[]} [systems]  Game systems this package targets.
 * @property {RelationshipSpec[]} [requires]  Packages this one needs.
 * @property {RelationshipSpec[]} [recommends]  Packages it works well with.
 * @property {RelationshipSpec[]} [conflicts]  Packages it cannot run beside.
 */

/**
 * One declared relationship.
 *
 * @typedef {object} RelationshipSpec
 * @property {string} id             The other package's id.
 * @property {string} [contentPackage]  What the other package's content is
 *                                   called, where that differs from its Foundry
 *                                   id. It is the name a note writes when it
 *                                   addresses a file that package ships.
 * @property {string} [type]         `system`, `module`, or `world`.
 * @property {string} [manifest]     Where its manifest is published.
 * @property {CompatibilitySpec} [compatibility]  The version range of *that*
 *                                   package this one targets — for a system
 *                                   relationship, `verified` is what
 *                                   `_stats.systemVersion` is stamped from.
 * @property {boolean} [contentIndex]  Whether `deps fetch` fetches this
 *                                   dependency's content index. Default
 *                                   `true`. `false` declares the dependency
 *                                   for the Foundry manifest only — nothing
 *                                   this tree cites by wikilink — and refuses
 *                                   `itemCatalog: true` on the same entry,
 *                                   since a catalogue is fetched from the same
 *                                   index.
 */

/**
 * How a generated documentation page is framed in the repository publishing it.
 *
 * The tables come from the `itemBuilders` registry and are the same wherever
 * they are rendered. Everything around them is the consumer's: the heading, the
 * "See also" line its section's pages carry, the orientation a reader needs
 * before the tables start, and where the page is filed. Those were the reason
 * every consumer wrapped the renderer in a script of its own.
 *
 * @typedef {object} DocPageSpec
 * @property {string} [title]      The page's H1.
 * @property {string} [out]        Where to write it, relative to `rootDir`.
 *                                 Without it the page goes to stdout.
 * @property {string[]} [preamble] Lines between the generated banner and the
 *                                 first table. Markdown, emitted verbatim.
 */

/**
 * The documentation pages this repository generates.
 *
 * @typedef {object} DocsSpec
 * @property {DocPageSpec} [itemFields]  The item-frontmatter reference,
 *                                       rendered by `content-build docs
 *                                       item-fields`.
 */

/**
 * @typedef {object} PublishSwitchesInput
 * @property {SiteMode} [site]
 * @property {AddressSchemeInput} [address]
 */

/**
 * @typedef {object} AddressSchemeInput
 * @property {string} [prefix]  Where the content tree mounts inside the package.
 */

/**
 * One entry of a consumer's `itemBuilders` registry.
 *
 * Either a bare builder function, or that builder paired with the type's
 * default art and the frontmatter fields it declares. See
 * {@link normalizeItemBuilders} for why the paired form exists.
 *
 * `fields` is what makes the type documentable: a builder function says
 * nothing about the vocabulary it consumes, so a consumer that declares its
 * fields can generate its own authoring reference and check its own notes,
 * while one that does not is simply undocumented rather than broken.
 *
 * @typedef {((fm: object) => object)|{system: (fm: object) => object, img?: string, fields?: readonly object[]}} ItemBuilderEntry
 */

/**
 * One **registry** of a declared set, and the system it belongs to.
 *
 * A repository shipping content for two systems declares one of these per
 * system: the accepted type vocabulary is their union, and a type both declare
 * keeps a builder on each side rather than one of them winning in silence.
 *
 * @typedef {object} ItemRegistrySpec
 * @property {string} system  The system id whose vocabulary this registry is.
 * @property {Record<string, ItemBuilderEntry>} builders  The registry itself.
 */

/**
 * The configuration a consumer writes.
 *
 * @typedef {object} ContentBuildConfigInput
 * @property {string} rootDir               Absolute path of the consuming
 *                                          repository — every configured path is
 *                                          resolved against it, so the build never
 *                                          depends on the working directory.
 * @property {string} contentPackage        Content package name — the address
 *                                          namespace every note in this
 *                                          repository is published under.
 * @property {string} [foundryPackage]      Foundry package id, as it appears in
 *                                          `system.json` / `module.json`.
 *                                          Refused by a `documentation`
 *                                          package, which ships no Foundry
 *                                          package.
 * @property {string} [homepage]            `package.json`'s own `homepage` —
 *                                          the site build's `baseURL`. Checked
 *                                          by `checkHomepage` in
 *                                          `config.mjs`.
 * @property {string|{name: string, email?: string, url?: string}} [author]
 *                                          `package.json`'s own `author`, in
 *                                          either of npm's forms.
 * @property {PackageKind} packageKind      Whether the package is a system, a
 *                                          module, or documentation — the kind
 *                                          that publishes a site and a book
 *                                          while compiling nothing.
 * @property {StatsSpec} [stats]            Identity stamped into every
 *                                          document's `_stats`. Required of a
 *                                          package that compiles documents, and
 *                                          refused by a `documentation` one,
 *                                          which compiles none.
 * @property {Record<string, ItemBuilderEntry>|readonly ItemRegistrySpec[]} [itemBuilders]
 *                                          The consumer's
 *                                          item-type registry: each content `type`
 *                                          that compiles into an Item, paired with
 *                                          the builder producing its `system` block
 *                                          — and, optionally, the default art a
 *                                          note of that type gets when it sets no
 *                                          `img:` of its own. Default `{}` — a
 *                                          content module that ships no items
 *                                          declares none. A repository feeding
 *                                          two systems declares a **list** of
 *                                          `{ system, builders }` registries
 *                                          instead, and the accepted type
 *                                          vocabulary is their union.
 * @property {PackSpec[]} packs             Packs to compile. More than one entry
 *                                          may share a `type`: a note then names
 *                                          the pack it belongs in with its
 *                                          `pack:` frontmatter, and one pack of
 *                                          the type is marked `default: true` to
 *                                          receive the notes that name none.
 * @property {PathsInput} [paths]           Layout overrides. See {@link DEFAULT_PATHS}.
 * @property {string[]} [skipDirectories]   Directory names the content walk ignores
 *                                          wherever they appear (e.g. Obsidian's
 *                                          `Templates`). Default `[]`.
 * @property {PackageBuildSection} [packageBuild]  Reserved for
 *                                          `@heroiclands/package-build`, which
 *                                          validates it. Not read here.
 * @property {DocsSpec} [docs]             How this repository frames the
 *                                          documentation pages it generates.
 * @property {CompatibilitySpec} [compatibility]  The Foundry core range this
 *                                          package supports. Required for any
 *                                          repository that ships one — reading
 *                                          the floor throws without it — and
 *                                          absent for a content-only consumer,
 *                                          which has none to invent.
 * @property {Relationships} [relationships]  What this package declares about
 *                                          others, in Foundry's own shape.
 * @property {PublishSwitchesInput} [publish]  Publishing switches. The manifest
 *                                          switches default to off; `site`
 *                                          defaults to `homepage`, the floor.
 */

/**
 * The normalized, frozen configuration the toolchain reads.
 *
 * @typedef {object} ContentBuildConfig
 * @property {string} rootDir
 * @property {string} contentPackage
 * @property {string|null} foundryPackage  `null` for a `documentation`
 *                                     package, which ships no Foundry package.
 * @property {string|null} homepage    `package.json`'s own `homepage`,
 *                                     checked by `checkHomepage` in
 *                                     `config.mjs`.
 * @property {Readonly<{name: string, email?: string, url?: string}>|null} author
 *                                     `package.json`'s own `author`, normalised
 *                                     from either of npm's forms; `null` when
 *                                     the package declares none.
 * @property {PackageKind} packageKind
 * @property {string|null} assetRoot   Derived, and **conditional**: the served
 *                                     Foundry asset root,
 *                                     `<packageKind>/<foundryPackage>/assets`,
 *                                     for a package Foundry installs — and
 *                                     `null` for a `documentation` package,
 *                                     which Foundry serves no files for. See
 *                                     {@link module:engine/helpers.resolveImg},
 *                                     the one reader of it.
 * @property {Readonly<ResolvedPaths>} paths
 * @property {Readonly<StatsSpec>|null} stats  `null` for a `documentation`
 *                                     package, which stamps no `_stats`.
 * @property {Readonly<Record<string, Function>>} itemBuilders  Derived: the
 *                                     `system` builder of each entry, whichever
 *                                     of the two spellings declared it.
 * @property {Readonly<Record<string, string>>} itemArt  Derived: the default art
 *                                     of each entry that paired one. Sparse — a
 *                                     type absent here has no default, and a note
 *                                     of it must carry `img:` (#7).
 * @property {Readonly<Record<string, readonly object[]>>} itemFields  Derived:
 *                                     the frontmatter fields each entry
 *                                     declared. Sparse, like `itemArt` — a type
 *                                     absent here compiles normally and is
 *                                     simply undocumented.
 * @property {Readonly<Record<string, Readonly<Record<string, Function>>>>} itemBuildersBySystem
 *                                     Derived: the same builders, kept per
 *                                     declaring system. `{}` for the single
 *                                     registry form, which names no system.
 * @property {Readonly<Record<string, Readonly<Record<string, string>>>>} itemArtBySystem
 *                                     Derived: the default art, per system.
 * @property {Readonly<Record<string, Readonly<Record<string, readonly object[]>>>>} itemFieldsBySystem
 *                                     Derived: the declared fields, per system.
 * @property {ReadonlySet<string>} itemTypesBySeveralSystems  Derived: the types
 *                                     more than one registry declares — the
 *                                     ones the flat tables cannot answer for
 *                                     without choosing a system for the caller.
 * @property {ReadonlySet<string>} itemTypes       Derived: the keys of
 *                                     {@link ContentBuildConfigInput.itemBuilders},
 *                                     unioned across every declared registry, so
 *                                     the accepted item types and the builder
 *                                     tables are one list.
 * @property {ReadonlySet<string>} docEntryTypes   Derived: every type whose prose
 *                                     compiles into a JournalEntry of its own —
 *                                     the item types, plus `macro`, plus the map
 *                                     types. The one set the compilers and the
 *                                     link-manifest emitter both read.
 * @property {readonly string[]} skipDirectories
 * @property {import("./engine/content-icons.mjs").IconRegistry} icons  The
 *                                     fonts this package ships and the names it
 *                                     draws from them; empty when it declares
 *                                     none.
 * @property {readonly Readonly<ResolvedPackSpec>[]} packs
 * @property {readonly string[]} packDirectories  Derived: every pack directory
 *                                     the build produces, in compile order —
 *                                     each pack followed by its companions.
 * @property {Readonly<PackageBuildSection>} packageBuild  Passed through
 *                                     frozen, uninterpreted. `{}` when absent.
 * @property {Readonly<DocsSpec>} docs   Frozen; `{}` when absent.
 * @property {Readonly<CompatibilitySpec>|null} compatibility  The Foundry core
 *                                     range, or `null` when none is declared.
 * @property {Readonly<Relationships>} relationships  Frozen; `{}` when absent.
 * @property {Readonly<PublishSwitches>} publish
 */

const CONFIG_KEYS = [
    "rootDir",
    "contentPackage",
    "foundryPackage",
    "homepage",
    "author",
    "packageKind",
    "stats",
    "itemBuilders",
    "paths",
    "skipDirectories",
    "icons",
    "packs",
    "docs",
    "site",
    "pdf",
    "compatibility",
    "relationships",
    "systems",
    "requiresSystem",
    "packageBuild",
    "publish",
];
const SYSTEM_KEYS = ["manifest", "compatibility"];
const COMPATIBILITY_KEYS = ["minimum", "verified"];
const DOCS_KEYS = ["itemFields"];
const SITE_KEYS = [
    "base",
    "assets",
    "packages",
    "sections",
    "readmeSections",
    "landing",
    "trees",
    "pass",
    "passOptions",
    "backfillSections",
    "list",
    "notfound",
    "hugo",
];
const SITE_TREE_KEYS = ["from", "section"];
const SITE_LIST_KEYS = ["shortcodes"];
const SITE_NOTFOUND_KEYS = ["tagline", "sitenoun", "heroimage", "links"];
const SITE_NOTFOUND_LINK_KEYS = ["title", "url", "text"];
const PDF_KEYS = ["title", "subtitle", "document", "out", "front", "fonts", "iconFonts", "binary"];
const PDF_FONT_KEYS = ["serif", "sans", "mono", "path"];
const EMPTY_PDF_FONTS = Object.freeze({ serif: "", sans: "", mono: "", path: "" });
const SECTION_META_KEYS = ["title", "banner", "description", "listType", "listSubType"];
const DOC_PAGE_KEYS = ["title", "out", "preamble"];
const RELATIONSHIP_KINDS = ["systems", "requires", "recommends", "conflicts"];
const RELATIONSHIP_KEYS = [
    "id",
    "contentPackage",
    "type",
    "manifest",
    "compatibility",
    "itemCatalog",
    "contentIndex",
];
const AUTHOR_KEYS = ["name", "email", "url"];
const ITEM_BUILDER_KEYS = ["system", "img", "fields"];
const ITEM_REGISTRY_KEYS = ["system", "builders"];
const PACK_KEYS = [
    "name",
    "type",
    "label",
    "private",
    "companions",
    "mayBeEmpty",
    "default",
    "prebuilt",
    "system",
];
const PATH_KEYS = Object.keys(DEFAULT_PATHS);
const STATS_KEYS = ["lastModifiedBy"];

/**
 * How the loader hands {@link defineConfig} the system version it resolved.
 *
 * A **Symbol**, deliberately. `stats.systemVersion` is refused from an authored
 * configuration, but the value still has to reach here from the loader —
 * which is the half that may do I/O, and which reads a system package's version
 * out of the adjacent `package.json`. A string key would be a second spelling of
 * the refused one, forgeable from YAML and reachable by `rejectUnknownKeys`; a
 * symbol key cannot be written in YAML at all and does not appear in
 * `Object.keys`, so the refusal has no back door.
 *
 * @type {symbol}
 */
export const DERIVED_SYSTEM_VERSION = Symbol.for("package-build.derivedSystemVersion");
const PUBLISH_KEYS = ["site", "address"];
const ADDRESS_KEYS = ["prefix"];

/** @param {unknown} value */
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reject a configured value, naming the key it was written under.
 *
 * The dotted path is carried on the error as `field` as well as spelled into
 * the message, because the message alone is a good description and a bad
 * locator: the loader that read the file can resolve that path to a line and
 * column, and does (`locateConfigError` in `engine/pack-config.mjs`).
 * Attaching it here rather than formatting here is what keeps this module
 * free of I/O — it is the leaf an `.mjs` configuration imports, so it may not
 * reach for the file it is validating.
 *
 * @param {string} field - Dotted path of the offending key.
 * @param {string} problem - What is wrong with it.
 * @returns {never}
 */
function fail(field, problem) {
    throw Object.assign(new TypeError(`package-build config: \`${field}\` ${problem}.`), { field });
}

/**
 * @param {object} object
 * @param {readonly string[]} allowed
 * @param {string} where
 */
function rejectUnknownKeys(object, allowed, where) {
    for (const key of Object.keys(object)) {
        if (!allowed.includes(key)) {
            fail(
                `${where}${key}`,
                `is not a recognized option (expected one of: ${allowed.join(", ")})`,
            );
        }
    }
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requireNonEmptyString(value, field) {
    if (typeof value !== "string" || value.trim() === "") {
        fail(field, "must be a non-empty string");
    }
    return /** @type {string} */ (value);
}

/**
 * The `contentPackage`, checked against the three rules an address puts on it.
 *
 * It is the first segment of every canonical address this repository publishes
 * (`package-system-type-shortcode`, so `sohl-none-doc-gear`), and an address is
 * read by counting hyphen-separated segments. So the value carries two
 * obligations that the rest of the configuration does not, and asks for
 * both to be **enforced rather than assumed** — the alternative is a package
 * whose addresses are simply unreadable, reported nowhere and discovered as
 * links that resolve to nothing.
 *
 * 1. _Lowercase alphanumeric_ (`ADDRESS_SEGMENT_PATTERN`), so the hyphen stays
 *    purely a separator. `harn-adventures` was the one violator, and its keys
 *    read as one segment too many and failed as a `null` return from
 *    `readCanonicalKey` — a silence, not an error.
 * 2. _Not a note type_, because a written address is a **partial** one: the
 *    shorter forms drop segments from the left, so `skill-clmb` and
 *    `sohl-skill-clmb` are both addresses and position alone no longer says
 *    which vocabulary a leading segment is drawn from. The reader decides that
 *    by asking whether the name is a known package, and a name in both
 *    vocabularies makes one target readable two ways with no defensible pick.
 *    Keeping the two disjoint is what lets a name be taken at face value; that
 *    the package and the type are not *adjacent* segments, the system sitting
 *    between them, changes nothing: the hazard is not adjacency, it is that a
 *    short form omits the slots in between.
 *    One such collision is structural and cannot be fixed — `sohl` is both a
 *    content package and a system id, because Foundry requires a system
 *    package's id to *be* its system id, and `sohl-sohl-skill-clmb` is the
 *    honest address that results — which is the reason to prevent the ones that
 *    are avoidable.
 * 3. _Not reserved_. `packagebuild` addresses the files this toolchain ships
 *    itself, so a repository claiming the name would publish addresses that
 *    collide with them — see {@link module:engine/packages}.
 *
 * The type vocabulary rule reaches the **asset** types too: `icon`, `image` and
 * `audio` are types an address names exactly as it names a being, so a package
 * called `image` would make `image-thorn` readable two ways.
 *
 * @param {unknown} value - The configured `contentPackage`.
 * @param {ReadonlySet<string>} docEntryTypes - Every type whose prose compiles
 *   to a documentation entry: the item types plus `macro` and the map types.
 *   With {@link PACK_BY_TYPE}, {@link NOTE_VOCABULARY} and the `doc`-prefixed
 *   forms, this is the whole type vocabulary an address may write.
 * @returns {string} The value, unchanged.
 */
function requireContentPackage(value, docEntryTypes) {
    const pkg = requireNonEmptyString(value, "contentPackage");
    if (!isAddressSegment(pkg)) {
        fail(
            "contentPackage",
            `is \`${pkg}\`, which is not lowercase alphanumeric ` +
                `(${ADDRESS_SEGMENT_PATTERN.source}). It is the first ` +
                `segment of every address this package publishes ` +
                `(\`${pkg}-<system>-<type>-<shortcode>\`), and an address is read by ` +
                `counting hyphen-separated segments — so anything outside ` +
                "that here makes those addresses unreadable rather " +
                "than merely ugly. `harn-adventures` became `harnadventures`",
        );
    }
    if (isReservedPackage(pkg)) {
        fail(
            "contentPackage",
            `is \`${pkg}\`, which is a reserved package name. ` +
                `\`${pkg}-none-image-<shortcode>\` already addresses a file the ` +
                "toolchain itself ships, so a package claiming the name would " +
                "publish addresses that collide with it. Rename the package",
        );
    }
    // The closed vocabulary is read alongside the configured registries, not
    // instead of them, because neither is a superset of the other. The format's
    // vocabulary holds every type a note may declare *however this repository
    // is configured* — the reasoning `KNOWN_DOCUMENT_SUBTYPE_MAPS` already
    // states — so `skill` and `bundle` are type names in a repository that
    // declares no `itemBuilders`, where `docEntryTypes` alone would have let
    // either through. The registries hold whatever a consumer declares beyond
    // it. The `doc`-prefixed forms follow the registry, since a type that
    // compiles no documentation entry has no `doc`-prefixed address to collide
    // with.
    const typeNames = new Set([
        ...Object.keys(PACK_BY_TYPE),
        ...Object.keys(NOTE_VOCABULARY),
        ...ASSET_TYPE_NAMES,
        ...docEntryTypes,
        ...[...docEntryTypes].map((type) => `doc${type}`),
    ]);
    if (typeNames.has(pkg)) {
        fail(
            "contentPackage",
            `is \`${pkg}\`, which is also a note type — \`${pkg}-<shortcode>\` ` +
                "already addresses one. A written address may omit its leading " +
                `segments, so \`${pkg}-<shortcode>\` reads as a type and a ` +
                "shortcode and nothing but the two vocabularies being disjoint " +
                "says which slot the name is filling. Rename the package",
        );
    }
    return pkg;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {boolean} fallback
 * @returns {boolean}
 */
function optionalBoolean(value, field, fallback) {
    if (value === undefined) return fallback;
    if (typeof value !== "boolean") fail(field, "must be a boolean");
    return /** @type {boolean} */ (value);
}

/**
 * A string-valued field with a fallback, rejecting any other type.
 *
 * Separate from {@link requireNonEmptyString} because an empty string is a
 * meaningful value here: an address prefix of `""` is the statement "the
 * content tree mounts at the package root", which is `thalorna`'s layout.
 *
 * @param {unknown} value - The supplied value.
 * @param {string} field - The field's dotted path, for the error message.
 * @returns {string} The value.
 */
function optionalString(value, field) {
    if (typeof value !== "string") fail(field, "must be a string");
    return value;
}

/**
 * npm's `author` field, in either of its two forms.
 *
 * `package.json` accepts a single string — `"Name <email> (url)"`, with the
 * email and the URL both optional — or an object carrying the same three
 * parts. Both normalise to one shape, so the site build reads one field
 * instead of branching on which form a repository happened to write.
 *
 * @type {RegExp}
 */
const AUTHOR_STRING = /^([^<(]*?)\s*(?:<([^>]*)>)?\s*(?:\(([^)]*)\))?\s*$/;

/**
 * @param {unknown} value - The declared `author`, or `undefined`.
 * @returns {Readonly<{name: string, email?: string, url?: string}>|null}
 *   `null` when the package declares none.
 */
function normalizeAuthor(value) {
    if (value === undefined) return null;
    if (typeof value === "string") {
        const match = AUTHOR_STRING.exec(value.trim());
        const name = match?.[1]?.trim();
        if (!match || !name) {
            fail(
                "author",
                'must be `"Name"`, `"Name <email>"`, `"Name (url)"` or ' +
                    '`"Name <email> (url)"` — npm\'s own `author` forms',
            );
        }
        return Object.freeze({
            name: /** @type {string} */ (name),
            ...(match[2] ? { email: match[2] } : {}),
            ...(match[3] ? { url: match[3] } : {}),
        });
    }
    if (!isPlainObject(value)) {
        fail("author", "must be a string or an object with `name`, `email` and `url`");
    }
    const author = /** @type {Record<string, unknown>} */ (value);
    rejectUnknownKeys(author, AUTHOR_KEYS, "author.");
    const name = requireNonEmptyString(author.name, "author.name");
    return Object.freeze({
        name,
        ...(author.email !== undefined ?
            { email: optionalString(author.email, "author.email") }
        :   {}),
        ...(author.url !== undefined ? { url: optionalString(author.url, "author.url") } : {}),
    });
}

/**
 * @param {unknown} value
 * @param {string} where       Field path used in error messages.
 * @param {boolean} [nested]   Whether this is a companion, which may not nest
 *                             companions of its own.
 * @returns {Readonly<ResolvedPackSpec>}
 */
function normalizePack(value, where, nested = false) {
    if (!isPlainObject(value)) fail(where, "must be an object");
    const pack = /** @type {Record<string, unknown>} */ (value);
    // Retired with the YAML it named. Refused explicitly rather than
    // left to the unknown-key check, because the useful thing to say is not
    // "no such key" but where the folders went: they are notes, and a pack
    // materialises the ones its documents reference.
    if (pack.folders !== undefined) {
        fail(
            `${where}.folders`,
            "is retired — delete it. A folder is a note (`type: folder`) now, " +
                "and a pack materialises the folders its documents reference " +
                "through `packFolder`, so there is no per-pack hierarchy file " +
                "to name",
        );
    }
    rejectUnknownKeys(pack, PACK_KEYS, `${where}.`);

    const name = requireNonEmptyString(pack.name, `${where}.name`);
    const type = pack.type;
    if (
        typeof type !== "string" ||
        !(/** @type {readonly string[]} */ (PACK_DOCUMENT_TYPES).includes(type))
    ) {
        fail(`${where}.type`, `must be one of: ${PACK_DOCUMENT_TYPES.join(", ")}`);
    }

    const companionsInput = pack.companions;
    if (companionsInput !== undefined && !Array.isArray(companionsInput)) {
        fail(`${where}.companions`, "must be an array");
    }
    if (nested && pack.default !== undefined) {
        fail(
            `${where}.default`,
            "may not be declared on a companion: a companion is written by " +
                "another pack's pass, so no note is ever routed into one",
        );
    }
    if (nested && Array.isArray(companionsInput) && companionsInput.length) {
        fail(
            `${where}.companions`,
            "may not nest: a companion is written by another pack's pass, and " +
                "that pass is the only level of indirection the build has",
        );
    }
    const companions = (companionsInput ?? []).map((companion, index) =>
        normalizePack(companion, `${where}.companions[${index}]`, true),
    );

    // A prebuilt pack's per-document JSON already exists, so it has no
    // generation pass. Every key below describes one, which is why none of them
    // may accompany it: silently ignoring a key that can never be read is
    // worse than refusing the configuration that declares it.
    const prebuilt =
        pack.prebuilt === undefined || pack.prebuilt === null ?
            null
        :   requireNonEmptyString(pack.prebuilt, `${where}.prebuilt`);
    if (prebuilt !== null) {
        if (nested) {
            fail(
                `${where}.prebuilt`,
                "may not be declared on a companion: a companion is written by " +
                    "another pack's pass, and a prebuilt pack has no pass",
            );
        }
        if (Array.isArray(companionsInput) && companionsInput.length) {
            fail(
                `${where}.companions`,
                "may not accompany `prebuilt`: a companion is written by this " +
                    "pack's pass, and a prebuilt pack has none",
            );
        }
        if (pack.default === true) {
            fail(
                `${where}.default`,
                "may not accompany `prebuilt`: the default pack receives notes " +
                    "declaring no `pack:`, and no note is routed into a prebuilt one",
            );
        }
    }

    // Foundry requires `system` on ActiveEffect, Actor and Item packs and on no
    // others (CONST.SYSTEM_SPECIFIC_COMPENDIUM_TYPES), so a package may need a
    // different answer per pack. Unset here falls back to `stats.systemId`, and
    // unset in both omits the key from the manifest.
    const system =
        pack.system === undefined || pack.system === null ?
            null
        :   requireNonEmptyString(pack.system, `${where}.system`);

    /** @type {ResolvedPackSpec} */
    const normalized = {
        name,
        type: /** @type {PackDocumentType} */ (type),
        label:
            pack.label === undefined ? name : requireNonEmptyString(pack.label, `${where}.label`),
        private: optionalBoolean(pack.private, `${where}.private`, false),
        companions: Object.freeze(companions),
        mayBeEmpty: optionalBoolean(pack.mayBeEmpty, `${where}.mayBeEmpty`, false),
        // Which pack of a type receives a note that declares none. Validated
        // across the whole list in `defineConfig` — at most one per type.
        default: optionalBoolean(pack.default, `${where}.default`, false),
        prebuilt,
        system,
    };
    return Object.freeze(normalized);
}

/**
 * A package's icon registry — the fonts it ships and the names it draws from
 * them.
 *
 * **Nothing is supplied by default.** A registry entry is a promise that a
 * glyph will render, and only the package shipping the font can keep it: the
 * Game-Icons webfont is built by a consumer from its own templates, and Font
 * Awesome reaches neither the knowledgebase nor a printed page unless somebody
 * puts it there. A toolchain that shipped a starter table would be promising on
 * a consumer's behalf, and a name like `victory-star-tester` is one game
 * system's vocabulary besides.
 *
 * So a package declares both halves, and a package that declares neither names
 * no icons at all.
 *
 * **Two spellings, one shape.** The value is either the registry itself:
 *
 * ```yaml
 * icons:
 *     families:
 *         fontawesome: { class: fa, styles: [solid, regular, brands], describe: Font Awesome Free }
 *     icons:
 *         being: { style: solid, icon: user, label: being }
 * ```
 *
 * or a **path to a file holding it**, relative to this configuration:
 *
 * ```yaml
 * icons: assets/icon-registry.yaml
 * ```
 *
 * The file form is the one a real package wants. A registry is derived from
 * what the interface actually draws, so it is generated rather than hand-kept —
 * and a generated document inlined into a hand-edited configuration is a merge
 * conflict on every regeneration. Kept beside it, the generator owns one file
 * and the configuration owns the other.
 *
 * Validated with {@link module:engine/content-icons.checkIconRegistry}, whose
 * findings are warnings everywhere else and a **refusal** here: elsewhere the
 * question is whether one note is wrong, and here it is whether the table every
 * note is read against is.
 *
 * @param {unknown} value - The authored `icons:` value.
 * @param {string} rootDir - The configuration's own directory, which a relative
 *   path is resolved against.
 * @returns {import("./engine/content-icons.mjs").IconRegistry} The frozen
 *   registry.
 */
function normalizeIcons(value, rootDir) {
    if (value === undefined) return EMPTY_ICON_REGISTRY;

    let declared = value;
    let where = "icons";
    if (typeof value === "string") {
        if (!value.trim()) fail("icons", "is empty — name a file, or write the registry inline");
        const file = path.resolve(rootDir, value);
        let text;
        try {
            text = fs.readFileSync(file, "utf8");
        } catch {
            fail("icons", `names ${value}, which cannot be read from ${rootDir}`);
        }
        try {
            declared = YAML.parse(text);
        } catch (err) {
            fail("icons", `names ${value}, which is not readable YAML: ${err.message}`);
        }
        // A finding says which *file* is wrong, not which key of this one.
        where = value;
        if (declared === null || declared === undefined) {
            fail("icons", `names ${value}, which is empty`);
        }
    }

    if (!isPlainObject(declared)) {
        fail(
            "icons",
            "must be a registry — `families` and `icons` — or a path to a file holding one",
        );
    }

    const families = declared.families ?? {};
    const icons = declared.icons ?? {};
    if (!isPlainObject(families)) fail(`${where}.families`, "must be a mapping of name to family");
    if (!isPlainObject(icons)) fail(`${where}.icons`, "must be a mapping of name to icon entry");

    for (const name of Object.keys(icons)) {
        // The name a note writes between the colons. Checked here rather than
        // left to the note, because an entry nothing can name is a silent
        // no-op: every use of it reports "no such icon" and the table says
        // otherwise.
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
            fail(
                `${where}.icons.${name}`,
                "is not a name a note can write — `:icon-…:` takes lowercase " +
                    "letters, digits and hyphens, the charset an address segment uses",
            );
        }
    }

    const defaultFamily = declared.defaultFamily;
    if (defaultFamily !== undefined) {
        if (typeof defaultFamily !== "string" || !(defaultFamily in families)) {
            fail(
                `${where}.defaultFamily`,
                `names \`${defaultFamily}\`, which is not one of the declared families`,
            );
        }
    }

    const findings = checkIconRegistry({ families, icons, defaultFamily }, where);
    if (findings.length) {
        fail("icons", findings.map((finding) => finding.message).join("; "));
    }

    return Object.freeze({
        families: Object.freeze(families),
        defaultFamily,
        icons: Object.freeze(icons),
    });
}

/**
 * Resolve the layout a consumer supplies against its `rootDir`, filling every
 * unnamed directory from {@link DEFAULT_PATHS}.
 *
 * Configured paths are **relative by contract**: an absolute one would escape
 * the repository the config anchors, which is never what a consumer means and
 * is what made these paths working-directory-dependent in the first place.
 *
 * @param {unknown} value
 * @param {string} rootDir
 * @returns {Readonly<ResolvedPaths>}
 */
function normalizePaths(value, rootDir) {
    if (value !== undefined && !isPlainObject(value)) {
        fail("paths", "must be an object");
    }
    const input = /** @type {Record<string, unknown>} */ (value ?? {});
    rejectUnknownKeys(input, PATH_KEYS, "paths.");

    /** @type {Record<string, string>} */
    const resolved = {};
    for (const key of PATH_KEYS) {
        const raw =
            input[key] === undefined ?
                /** @type {Record<string, string>} */ (DEFAULT_PATHS)[key]
            :   requireNonEmptyString(input[key], `paths.${key}`);
        if (path.isAbsolute(raw)) {
            fail(
                `paths.${key}`,
                "must be relative to rootDir, so a consumer's layout travels " +
                    "with its repository",
            );
        }
        resolved[key] = path.resolve(rootDir, raw);
    }
    return Object.freeze(/** @type {ResolvedPaths} */ (resolved));
}

/**
 * @param {unknown} value - The authored `stats:` block.
 * @param {{systemId: string, systemVersion: string}} derived - The package-wide
 *   system and the version it stamps against, both derived by the caller.
 * @returns {Readonly<StatsSpec>}
 */
function normalizeStats(value, derived) {
    if (!isPlainObject(value)) fail("stats", "must be an object");
    const input = /** @type {Record<string, unknown>} */ (value);

    // **`systemId` and `systemVersion` are derived, and authoring a derived
    // value is an error rather than an override.** `systems:` is the
    // single source: it says which systems this package stamps against, and
    // `requiresSystem` — or a lone declared system — says which one the
    // package-wide block takes. A system package answers for itself.
    //
    // Refused rather than ignored, because the two would silently disagree.
    // That is exactly how `stats.systemVersion` came to sit at `0.6.0` for four
    // releases: a transcribed copy is free to drift from what it copied, and
    // nothing reads a stamped `_stats` until something migrates on it.
    for (const key of ["systemId", "systemVersion"]) {
        if (input[key] === undefined) continue;
        fail(
            `stats.${key}`,
            `is derived and may not be authored. ` +
                (key === "systemId" ?
                    `A system package is its own system; a module takes it ` +
                    `from \`requiresSystem\`, or from \`systems:\` when it ` +
                    `declares exactly one. `
                :   `It is the \`compatibility.verified\` of the system in ` +
                    `\`systems:\`, or a system package's own \`package.json\` ` +
                    `version. `) +
                `Remove the key`,
        );
    }
    rejectUnknownKeys(input, STATS_KEYS, "stats.");

    return Object.freeze({
        // Per pack where the packs differ — see `statsForPack` — and this is
        // the package-wide answer for everything that has no pack in hand.
        systemId: derived.systemId,
        systemVersion: derived.systemVersion,
        lastModifiedBy: requireNonEmptyString(input.lastModifiedBy, "stats.lastModifiedBy"),
    });
}

/**
 * Freeze a value and everything reachable from it.
 *
 * The reserved section is handed back frozen like every other part of the
 * configuration, so package-build reads the same immutable object the rest of
 * the toolchain does — but its *shape* is package-build's business, so this
 * walks whatever is there rather than checking it against a key list.
 *
 * @param {unknown} value - Any value.
 * @returns {unknown} The same value, deeply frozen.
 */
function deepFreeze(value) {
    if (value === null || typeof value !== "object") return value;
    for (const inner of Object.values(value)) deepFreeze(inner);
    return Object.freeze(value);
}

/**
 * Validate one generated page's framing.
 *
 * @param {unknown} value - The page spec, or `undefined`.
 * @param {string} where - Dotted path, for the error.
 * @returns {Readonly<DocPageSpec>} It, frozen; `{}` when absent.
 */
function normalizeDocPage(value, where) {
    if (value === undefined) return Object.freeze({});
    if (!isPlainObject(value)) fail(where, "must be a mapping");
    const input = /** @type {Record<string, unknown>} */ (value);
    rejectUnknownKeys(input, DOC_PAGE_KEYS, `${where}.`);

    const out = {};
    for (const key of ["title", "out"]) {
        if (input[key] !== undefined) {
            out[key] = requireNonEmptyString(input[key], `${where}.${key}`);
        }
    }
    if (input.preamble !== undefined) {
        if (!Array.isArray(input.preamble)) {
            fail(
                `${where}.preamble`,
                "must be a list of lines — a blank entry is a blank line, " +
                    "which is how paragraphs are separated in markdown",
            );
        }
        // A blank line is meaningful here, so this checks the type without
        // requiring content.
        out.preamble = Object.freeze(
            input.preamble.map((line, index) => {
                if (typeof line !== "string") {
                    fail(`${where}.preamble[${index}]`, "must be a string");
                }
                return line;
            }),
        );
    }
    return Object.freeze(out);
}

/**
 * Validate the `docs` section.
 *
 * @param {unknown} value - The section, or `undefined`.
 * @returns {Readonly<DocsSpec>} It, frozen; `{}` when absent.
 */
function normalizeDocs(value) {
    if (value === undefined) return Object.freeze({});
    if (!isPlainObject(value)) fail("docs", "must be a mapping");
    const input = /** @type {Record<string, unknown>} */ (value);
    rejectUnknownKeys(input, DOCS_KEYS, "docs.");
    return Object.freeze({
        itemFields: normalizeDocPage(input.itemFields, "docs.itemFields"),
    });
}

/**
 * One section's landing metadata — what a section says about itself on the
 * `_index.md` this build generates for it.
 *
 * A generated landing is the *only* place a section can speak, and it
 * is the only place a section **exists**: a content page is addressed
 * `(type, shortcode)` and written flat under the mount, so no page creates a
 * directory and nothing else makes `<prefix><section>/` answer. This is
 * therefore the whole vocabulary, and it is deliberately a **closed** one.
 *
 * The alternative — passing whatever a section declared straight through, as
 * `site.landing` does — was weighed and refused. `landing` is written once, for
 * the mount, and its keys are one landing template's own; a section entry is
 * written fourteen to twenty times per build against a contract every package
 * and every section shares. Unbounded there, a mistyped `descrption:` publishes
 * into front matter, is read by nobody, and says nothing to anyone — which is
 * the same failure, moved one step downstream where no build can
 * see it. So the keys are named here, and the writers emit what this produced
 * rather than transcribing a second list of their own.
 *
 * `banner` and `description` are optional — the hero images are external assets
 * and not every section has one, and a section may reasonably have nothing to
 * add to its title. Each is left off entirely rather than written as
 * `undefined`, which is not a value YAML can carry.
 *
 * **`listType` / `listSubType` say what the section lists.** A section's
 * directory holds nothing but the `_index.md` written here, so a layout
 * reading Hugo's `.Pages` finds
 * no members and renders an empty landing. The membership survives in this map
 * and nowhere a theme can reach it, so the landing states it and a layout
 * substitutes the equivalent `site.RegularPages` query — the same one `sohl`'s
 * catalog layouts already run, which is why `sohl`'s landings never broke.
 *
 * They are two keys of their own rather than `type` / `subType` because `type`
 * on an `_index.md` is **Hugo's own layout selector**: verified against Hugo
 * 0.165, a section landing carrying `type: doc` renders through
 * `layouts/doc/list.html` rather than the default list template, so spelling
 * the content type there would silently change which template serves the
 * landing. (This build already uses that behaviour deliberately, for the
 * mount's own landing.)
 *
 * Both are checked as **address segments**, which is the trap this came from:
 * a section is named for the URL a consumer chose and a subType is an address
 * segment, and the two need not agree — `/sohl/kb/user-guide/` is the section,
 * `userguide` the subType. Copying the section's name into the
 * declaration would select no page at all, and an empty landing reported by
 * nobody is the failure being fixed. A `listSubType` with no `listType` is
 * refused for the same reason: a subType is only distinguishing *within* a
 * type — `rules`, `userguide` and `reference` are all `doc` — so alone it names
 * no query.
 *
 * @param {unknown} value - The declared entry.
 * @param {string} where - Dotted path, for the error.
 * @returns {Readonly<{title: string, banner?: string, description?: string,
 *   listType?: string, listSubType?: string}>}
 */
function normalizeSectionMeta(value, where) {
    if (!isPlainObject(value)) fail(where, "must be a mapping");
    const input = /** @type {Record<string, unknown>} */ (value);
    rejectUnknownKeys(input, SECTION_META_KEYS, `${where}.`);
    const out = { title: requireNonEmptyString(input.title, `${where}.title`) };
    if (input.banner !== undefined) {
        out.banner = requireNonEmptyString(input.banner, `${where}.banner`);
    }
    if (input.description !== undefined) {
        out.description = requireNonEmptyString(input.description, `${where}.description`);
    }
    for (const key of ["listType", "listSubType"]) {
        if (input[key] === undefined) continue;
        const segment = requireNonEmptyString(input[key], `${where}.${key}`);
        if (!isAddressSegment(segment)) {
            fail(
                `${where}.${key}`,
                `is \`${segment}\`, which is not lowercase alphanumeric. It names a ` +
                    "content type or subType, and those are address segments " +
                    `(${ADDRESS_SEGMENT_PATTERN.source}) — not the section's ` +
                    "own name, which is a URL this site chose and need not " +
                    "match (`user-guide` is the section, `userguide` the " +
                    "subType). A value no page carries selects nothing and " +
                    "leaves the landing empty",
            );
        }
        out[key] = segment;
    }
    if (out.listSubType !== undefined && out.listType === undefined) {
        fail(
            `${where}.listSubType`,
            "is declared without a `listType`. A subType tells pages apart " +
                "only within a type — `rules`, `userguide` and `reference` " +
                "are all `doc` — so on its own it names no query for a layout " +
                "to run",
        );
    }
    return Object.freeze(out);
}

/**
 * The asset host the website resolves a pathname against.
 *
 * The one address in this configuration that is not this repository's own. A
 * note names a file by the package that owns it and the path inside that
 * package's `assets/`, and the website serves every package's files from one
 * host — so the host is the missing half of a web address, and it is written
 * here because a build has no way to find it out.
 *
 * **Absolute, and with no trailing slash.** The forms are joined with a single
 * `/`, so a trailing one would double it; it is trimmed rather than refused,
 * because a doubled slash is the sort of thing a reader's eye slides past. A
 * relative value is refused outright: it would resolve against each page's own
 * URL, which is the failure the key exists to remove.
 *
 * @param {unknown} value - The configured value, or `undefined`.
 * @returns {string} The host, without its trailing slash; `""` when unset.
 */
function normalizeSiteAssets(value) {
    if (value === undefined) return "";
    const assets = requireNonEmptyString(value, "site.assets");
    if (!/^https?:\/\/[^/]+/.test(assets)) {
        fail(
            "site.assets",
            "must be an absolute `http://` or `https://` address — it is the host " +
                "every package's imagery is served from, and a relative value " +
                "resolves against whichever page happens to carry the image",
        );
    }
    return assets.replace(/\/+$/, "");
}

/**
 * A map of section name → landing metadata.
 *
 * @param {unknown} value - The declared mapping.
 * @param {string} where - Dotted path, for the error.
 * @returns {Readonly<Record<string, object>>}
 */
function normalizeSectionMap(value, where) {
    if (value === undefined) return Object.freeze({});
    if (!isPlainObject(value)) fail(where, "must be a mapping");
    const out = {};
    for (const [name, meta] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
        out[name] = normalizeSectionMeta(meta, `${where}.${name}`);
    }
    return Object.freeze(out);
}

/**
 * Hugo keys a repository may **not** declare under `site.hugo`, because the
 * site build generates them and would only overwrite what was written.
 *
 * The same rule `DERIVED_MANIFEST_KEYS` states for the manifest, for the same
 * reason: an authored `baseURL` would look authoritative, sit there unread,
 * and disagree with the site forever. Each key names where its value comes
 * from. A dotted key names a nested one, and covers everything beneath it —
 * `params.brand` refuses `params.brand.logo` too — so `site.hugo` reaches only
 * what the generator does not write.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const DERIVED_HUGO_KEYS = Object.freeze({
    baseURL: "package.json `homepage`",
    title: "`packageBuild.manifest.title`",
    locale: "the organisation's locale, in `engine/site-config.mjs`",
    publishDir: "`contentPackage`, under the deployment root `build/site`",
    contentDir: "the fixed content mount, `build/hugo/content`",
    themesDir: "where `@heroiclands/hugo-theme` is installed",
    theme: "the installed `@heroiclands/hugo-theme`",
    disableKinds: "whether any note in the tree carries `tags:`, which the site walk discovers",
    taxonomies: "whether any note in the tree carries `tags:`, which the site walk discovers",
    outputs: "whether any note in the tree carries `tags:`, which the site walk discovers",
    "params.description": "package.json `description`",
    "params.author": "package.json `author`",
    "params.cdnBaseURL": "`site.assets`",
    "params.brand": "the organisation's brand links, in `engine/site-config.mjs`",
    "params.list": "`site.list`",
    "params.notfound": "`site.notfound`",
    "markup.goldmark.renderer.unsafe": "the toolchain, whose pages carry raw HTML",
    menu: "the navigation `content-build deps fetch` caches from heroiclands.org",
});

/**
 * The `site.list` block — how a listing page renders.
 *
 * @param {unknown} value - The block, or `undefined`.
 * @returns {Readonly<{shortcodes: boolean}>} It, frozen, with every default filled.
 */
function normalizeSiteList(value) {
    if (value === undefined) return Object.freeze({ shortcodes: false });
    if (!isPlainObject(value)) fail("site.list", "must be a mapping");
    const input = /** @type {Record<string, unknown>} */ (value);
    rejectUnknownKeys(input, SITE_LIST_KEYS, "site.list.");
    return Object.freeze({
        shortcodes: optionalBoolean(input.shortcodes, "site.list.shortcodes", false),
    });
}

/**
 * The `site.notfound` block — the wording of the "page not found" page.
 *
 * The theme renders the page for every site; what a repository supplies is
 * the tagline, the noun the body prose calls the site, and the routes back.
 * `tagline` and `sitenoun` are required once the block is present: a block
 * declaring only links would render the theme's generic wording above a list
 * of this site's routes, which reads as two sites.
 *
 * @param {unknown} value - The block, or `undefined`.
 * @returns {Readonly<object>|null} It, frozen; `null` when absent.
 */
function normalizeSiteNotfound(value) {
    if (value === undefined) return null;
    if (!isPlainObject(value)) fail("site.notfound", "must be a mapping");
    const input = /** @type {Record<string, unknown>} */ (value);
    rejectUnknownKeys(input, SITE_NOTFOUND_KEYS, "site.notfound.");
    const out = {
        tagline: requireNonEmptyString(input.tagline, "site.notfound.tagline"),
        sitenoun: requireNonEmptyString(input.sitenoun, "site.notfound.sitenoun"),
    };
    if (input.heroimage !== undefined) {
        out.heroimage = requireNonEmptyString(input.heroimage, "site.notfound.heroimage");
    }
    if (input.links !== undefined) {
        if (!Array.isArray(input.links)) fail("site.notfound.links", "must be a list");
        out.links = Object.freeze(
            input.links.map((link, i) => {
                const where = `site.notfound.links[${i}]`;
                if (!isPlainObject(link)) fail(where, "must be a mapping");
                const entry = /** @type {Record<string, unknown>} */ (link);
                rejectUnknownKeys(entry, SITE_NOTFOUND_LINK_KEYS, `${where}.`);
                return Object.freeze({
                    title: requireNonEmptyString(entry.title, `${where}.title`),
                    url: requireNonEmptyString(entry.url, `${where}.url`),
                    text: requireNonEmptyString(entry.text, `${where}.text`),
                });
            }),
        );
    }
    return Object.freeze(out);
}

/**
 * The `site.hugo` block — a mapping deep-merged over the generated Hugo
 * configuration, last.
 *
 * The escape hatch for the key nobody anticipated. Every key the generator
 * writes is refused here by {@link DERIVED_HUGO_KEYS}, naming its source, so
 * the block cannot grow into a second configuration file.
 *
 * @param {unknown} value - The block, or `undefined`.
 * @returns {Readonly<Record<string, unknown>>} It, frozen; `{}` when absent.
 */
function normalizeSiteHugo(value) {
    if (value === undefined) return Object.freeze({});
    if (!isPlainObject(value)) fail("site.hugo", "must be a mapping");
    const input = /** @type {Record<string, unknown>} */ (value);
    for (const [dotted, source] of Object.entries(DERIVED_HUGO_KEYS)) {
        /** @type {unknown} */
        let at = input;
        for (const part of dotted.split(".")) {
            at = isPlainObject(at) ? /** @type {Record<string, unknown>} */ (at)[part] : undefined;
            if (at === undefined) break;
        }
        if (at !== undefined) {
            fail(
                `site.hugo.${dotted}`,
                `is derived from ${source} and must not be declared — it ` +
                    `would be overwritten, and the two would disagree with ` +
                    `nothing to say so`,
            );
        }
    }
    return Object.freeze(structuredClone(input));
}

/**
 * The `site` section — how this repository frames the website it publishes.
 *
 * Everything here is *framing*: what a section is called, which extra trees
 * are published beside the content, which named pass bundle supplies the
 * repository's own body rewrites, and the residue of the generated Hugo
 * configuration that is genuinely this repository's own. Where the Hugo tree
 * is written is not a choice: `content-build site` writes it under
 * `build/hugo/`, and a `site.out` is refused by name. How a page gets its
 * **address** is deliberately not here either — that is `publish.address`,
 * shared with the link manifest so the two cannot disagree about where a
 * page is.
 *
 * @param {unknown} value - The `site` block, or `undefined`.
 * @returns {Readonly<object>} It, frozen, with every default filled.
 */
function normalizeSite(value) {
    const empty = Object.freeze({
        base: "",
        assets: "",
        packages: Object.freeze([]),
        sections: Object.freeze({}),
        readmeSections: Object.freeze({}),
        landing: null,
        trees: Object.freeze([]),
        pass: "",
        passOptions: Object.freeze({}),
        backfillSections: false,
        list: Object.freeze({ shortcodes: false }),
        notfound: null,
        hugo: Object.freeze({}),
    });
    if (value === undefined) return empty;
    if (!isPlainObject(value)) fail("site", "must be a mapping");
    const input = /** @type {Record<string, unknown>} */ (value);
    // Refused by name, ahead of the vocabulary check: the useful thing to say
    // is not "no such key" but that the location is fixed.
    if (input.out !== undefined) {
        fail(
            "site.out",
            "is retired — the site build writes its content mount at " +
                "`build/hugo/content`, beside the generated `hugo.toml`, and " +
                "the location is not configurable. Remove the key",
        );
    }
    rejectUnknownKeys(input, SITE_KEYS, "site.");

    const trees = [];
    if (input.trees !== undefined) {
        if (!Array.isArray(input.trees)) fail("site.trees", "must be a list");
        input.trees.forEach((entry, i) => {
            const where = `site.trees[${i}]`;
            if (!isPlainObject(entry)) fail(where, "must be a mapping");
            const tree = /** @type {Record<string, unknown>} */ (entry);
            rejectUnknownKeys(tree, SITE_TREE_KEYS, `${where}.`);
            trees.push(
                Object.freeze({
                    from: requireNonEmptyString(tree.from, `${where}.from`),
                    section: requireNonEmptyString(tree.section, `${where}.section`),
                    // The tree's own path, POSIX-separated — what a
                    // repository-relative link inside it is resolved against.
                    rel: String(tree.from).split(path.sep).join("/"),
                }),
            );
        });
    }

    let packages = [];
    if (input.packages !== undefined) {
        if (!Array.isArray(input.packages)) {
            fail("site.packages", "must be a list");
        }
        packages = input.packages.map((p, i) => requireNonEmptyString(p, `site.packages[${i}]`));
    }

    let landing = null;
    if (input.landing !== undefined) {
        if (!isPlainObject(input.landing)) {
            fail("site.landing", "must be a mapping");
        }
        // Passed through rather than validated field by field: it is Hugo
        // frontmatter, whose vocabulary is the theme's and not this package's.
        landing = Object.freeze({ ...input.landing });
    }

    return Object.freeze({
        base: input.base === undefined ? "" : requireNonEmptyString(input.base, "site.base"),
        assets: normalizeSiteAssets(input.assets),
        packages: Object.freeze(packages),
        sections: normalizeSectionMap(input.sections, "site.sections"),
        readmeSections: normalizeSectionMap(input.readmeSections, "site.readmeSections"),
        landing,
        trees: Object.freeze(trees),
        pass: input.pass === undefined ? "" : requireNonEmptyString(input.pass, "site.pass"),
        passOptions:
            input.passOptions === undefined ?
                Object.freeze({})
            :   Object.freeze({ ...input.passOptions }),
        backfillSections: optionalBoolean(input.backfillSections, "site.backfillSections", false),
        list: normalizeSiteList(input.list),
        notfound: normalizeSiteNotfound(input.notfound),
        hugo: normalizeSiteHugo(input.hugo),
    });
}

/**
 * The `pdf` section — the book the content tree is published as.
 *
 * A third surface beside the packs and the website, and the one that is a
 * **selection** rather than a rendering of everything: `document:` names the
 * tree that says which notes the volume carries and in what order, because a
 * book is an editorial act where a site is an index. That file is the
 * consumer's, parsed by {@link module:engine/pdf-toc.parseDocumentTree}, and
 * nothing about its shape is validated here — this block says only where it is.
 *
 * **Nothing here is an address or a brand.** The title, the subtitle, the front
 * matter and the faces are every one of them the publishing repository's to
 * choose, which is the whole reason they are configuration: the engine that
 * sets the book must be able to set somebody else's book.
 *
 * **Declaring the block is not the switch.** Whether a PDF is built at all is
 * `publish.site` — `content` builds one, `homepage` does not — so a package
 * cannot end up with two switches that disagree about whether it publishes its
 * content tree. See {@link publishesContentPages}.
 *
 * @param {unknown} value - The `pdf` block, or `undefined`.
 * @param {string} rootDir - The repository root configured paths resolve against.
 * @returns {Readonly<object>|null} It, frozen; `null` when the block is absent.
 */
function normalizePdf(value, rootDir) {
    if (value === undefined) return null;
    if (!isPlainObject(value)) fail("pdf", "must be a mapping");
    const input = /** @type {Record<string, unknown>} */ (value);
    rejectUnknownKeys(input, PDF_KEYS, "pdf.");

    // Both required, and required together: a document with no tree has nothing
    // to print, and a tree with no title produces a file whose name and cover
    // say nothing about what a reader downloaded.
    const title = requireNonEmptyString(input.title, "pdf.title");
    const document = requireNonEmptyString(input.document, "pdf.document");

    const front = [];
    if (input.front !== undefined) {
        if (!Array.isArray(input.front)) fail("pdf.front", "must be a list of markdown files");
        input.front.forEach((entry, i) => {
            front.push(requireNonEmptyString(entry, `pdf.front[${i}]`));
        });
    }

    let fonts = EMPTY_PDF_FONTS;
    if (input.fonts !== undefined) {
        if (!isPlainObject(input.fonts)) fail("pdf.fonts", "must be a mapping");
        const declared = /** @type {Record<string, unknown>} */ (input.fonts);
        rejectUnknownKeys(declared, PDF_FONT_KEYS, "pdf.fonts.");
        fonts = Object.freeze({
            // Family *names*, not files: the renderer asks the font stack for a
            // family, and `path` is where it may look beyond the system's own.
            serif:
                declared.serif === undefined ?
                    ""
                :   requireNonEmptyString(declared.serif, "pdf.fonts.serif"),
            sans:
                declared.sans === undefined ?
                    ""
                :   requireNonEmptyString(declared.sans, "pdf.fonts.sans"),
            mono:
                declared.mono === undefined ?
                    ""
                :   requireNonEmptyString(declared.mono, "pdf.fonts.mono"),
            path:
                declared.path === undefined ?
                    ""
                :   path.resolve(rootDir, requireNonEmptyString(declared.path, "pdf.fonts.path")),
        });
    }

    // Family name to the font file carrying its glyphs, for `:icon-…:`. A file
    // rather than a codepoint, because the font's own tables are the only
    // trustworthy source of which glyph a name resolves to — see
    // {@link module:engine/content-icons}, which states the style and the name
    // and deliberately holds no codepoints.
    const iconFonts = {};
    if (input.iconFonts !== undefined) {
        if (!isPlainObject(input.iconFonts)) {
            fail("pdf.iconFonts", "must be a mapping of icon family to font file");
        }
        for (const [family, file] of Object.entries(input.iconFonts)) {
            iconFonts[family] = path.resolve(
                rootDir,
                requireNonEmptyString(file, `pdf.iconFonts.${family}`),
            );
        }
    }

    return Object.freeze({
        title,
        subtitle:
            input.subtitle === undefined ?
                ""
            :   requireNonEmptyString(input.subtitle, "pdf.subtitle"),
        document: path.resolve(rootDir, document),
        out: input.out === undefined ? "" : requireNonEmptyString(input.out, "pdf.out"),
        front: Object.freeze(front.map((f) => path.resolve(rootDir, f))),
        fonts,
        iconFonts: Object.freeze(iconFonts),
        // Where the Typst binary is, when it is not simply `typst` on PATH.
        // Named rather than bundled: a native compiler would put a
        // platform-specific binary in the dependency tree of three repositories
        // that mostly do not build books.
        binary: input.binary === undefined ? "" : requireNonEmptyString(input.binary, "pdf.binary"),
    });
}

/**
 * Validate a Foundry version range.
 *
 * `minimum` is required of the package's own range, because it is stamped into
 * every compiled document and a guessed floor is invisible until something
 * migrates on it. Inside a *relationship* neither field is required: what is
 * load-bearing there is `verified`, and a relationship may reasonably name a
 * package without pinning a floor at all.
 *
 * @param {unknown} value - The declared range, or `undefined`.
 * @param {string} where - Dotted path, for the error.
 * @param {boolean} [requireMinimum] - Whether `minimum` must be present.
 * @returns {Readonly<CompatibilitySpec>|null} It, frozen; `null` when absent.
 */
function normalizeCompatibility(value, where, requireMinimum = true) {
    if (value === undefined) return null;
    if (!isPlainObject(value)) fail(where, "must be a mapping");
    const input = /** @type {Record<string, unknown>} */ (value);
    rejectUnknownKeys(input, COMPATIBILITY_KEYS, `${where}.`);
    const out = {};
    if (requireMinimum || input.minimum !== undefined) {
        out.minimum = requireNonEmptyString(input.minimum, `${where}.minimum`);
    }
    if (input.verified !== undefined) {
        out.verified = requireNonEmptyString(input.verified, `${where}.verified`);
    }
    return Object.freeze(out);
}

/**
 * The **package-wide** system, or `null` where the configuration names none.
 *
 * A *system* package is its own system, which is true by construction and needs
 * no declaration. A *module* takes the one it requires, or the one system it
 * declares when there is exactly one; with several and no gate there is no
 * package-wide answer, and each pack carries its own.
 *
 * A lone `relationships.systems` entry is a declaration of the system as much as
 * a gate, so it still answers. That matters because the relationship carries
 * `itemCatalog` too — a separate concern the `systems:` split does not replace —
 * so a repository using it would otherwise have to restate its compatibility
 * under `systems:` purely to keep stamping, which is the duplication that split
 * exists to remove. Several entries have no single answer and get none.
 *
 * **Written once and read twice**, which is why it is a function rather than the
 * expression: the value stamped into `stats.systemId` and the
 * value a pack's `system:` is validated against are the same fact, and two
 * spellings of it would be free to disagree about exactly the case that has no
 * answer.
 *
 * @param {object} parts - The resolved pieces of the configuration.
 * @param {string} parts.packageKind - One of {@link PACKAGE_KINDS}.
 * @param {unknown} parts.foundryPackage - The package id.
 * @param {string|null} parts.requiresSystem - The declared gate, if any.
 * @param {Readonly<Record<string, object>>} parts.systems - The `systems:` block.
 * @param {readonly {id?: string}[]} parts.relationshipSystems - System
 *   relationships.
 * @returns {string|null} The system id, or `null` where there is no single one.
 */
function packageWideSystemId({
    packageKind,
    foundryPackage,
    requiresSystem,
    systems,
    relationshipSystems,
}) {
    if (packageKind === "systems") return /** @type {string} */ (foundryPackage);
    if (requiresSystem) return requiresSystem;
    const declared = Object.keys(systems);
    if (declared.length === 1) return declared[0];
    if (relationshipSystems.length === 1) return relationshipSystems[0]?.id ?? null;
    return null;
}

/**
 * The systems this package can stamp content against — declaration only.
 *
 * **Declaring is not requiring, and that separation is the whole point.** The
 * only other place to state a system version is `relationships.systems`, and
 * that list is a *restriction*: Foundry's `supportsSystem` drops a module from
 * any world whose system it does not name. So a module shipping content for two
 * systems — `harn-ensemble` ships an HM3 pack, a SoHL pack and a system-neutral
 * journals pack — had to choose between naming its systems and remaining
 * loadable, and choosing the second meant stamping no system version at all on
 * content that certainly has one.
 *
 * Naming a system here restricts nothing. {@link normalizeRequiresSystem} is
 * what restricts, and it is separate and optional.
 *
 * Each entry carries the same `compatibility` shape a relationship does, and
 * `verified` is what a pack stamps: `_stats.systemVersion` records what the
 * content was *built against*, not the floor it tolerates.
 *
 * @param {unknown} value - The declared `systems:` mapping.
 * @returns {Readonly<Record<string, Readonly<object>>>} Frozen; `{}` when absent.
 */
function normalizeSystems(value) {
    if (value === undefined || value === null) return Object.freeze({});
    if (!isPlainObject(value)) fail("systems", "must be a mapping of id to spec");
    const input = /** @type {Record<string, unknown>} */ (value);

    const out = {};
    for (const [id, entry] of Object.entries(input)) {
        const at = `systems.${id}`;
        if (!id) fail("systems", "declares an empty system id");
        if (!isPlainObject(entry)) fail(at, "must be a mapping");
        const spec = /** @type {Record<string, unknown>} */ (entry);
        rejectUnknownKeys(spec, SYSTEM_KEYS, `${at}.`);

        const compatibility = spec.compatibility;
        if (!isPlainObject(compatibility)) {
            fail(`${at}.compatibility`, "must be a mapping");
        }
        const compat = /** @type {Record<string, unknown>} */ (compatibility);
        rejectUnknownKeys(compat, COMPATIBILITY_KEYS, `${at}.compatibility.`);
        // `verified` is required because it is the value a pack stamps. A
        // declaration that cannot answer "which version was this built
        // against" is the gap this block exists to close.
        const verified = requireNonEmptyString(compat.verified, `${at}.compatibility.verified`);

        out[id] = Object.freeze({
            manifest:
                spec.manifest === undefined || spec.manifest === null ?
                    null
                :   requireNonEmptyString(spec.manifest, `${at}.manifest`),
            compatibility: Object.freeze({
                minimum:
                    compat.minimum === undefined || compat.minimum === null ?
                        null
                    :   requireNonEmptyString(compat.minimum, `${at}.compatibility.minimum`),
                verified,
            }),
        });
    }
    return Object.freeze(out);
}

/**
 * The one system this package refuses to load without, or `null`.
 *
 * The gate half of the split. Naming a system here emits
 * `relationships.systems` for it, which is what Foundry's `supportsSystem`
 * reads — so the package becomes unavailable under any other system. Omitted,
 * no relationship is emitted and the package loads anywhere, each pack stamping
 * whatever its own `system:` names.
 *
 * It reuses the {@link normalizeSystems} entry rather than restating the
 * compatibility: `stats.systemVersion` froze at `0.6.0` for four releases
 * because a transcription was free to disagree with what it copied, and a
 * second transcription invites the same.
 *
 * @param {unknown} value - The declared `requiresSystem:`.
 * @returns {string|null} The system id, or `null`.
 */
function normalizeRequiresSystem(value) {
    if (value === undefined || value === null) return null;
    return requireNonEmptyString(value, "requiresSystem");
}

/**
 * Validate the declared relationships.
 *
 * Only as far as this package needs to read them: enough that a system
 * relationship can be found and its `verified` version trusted. The rest is
 * passed through for the manifest generator to emit.
 *
 * @param {unknown} value - The `relationships` block, or `undefined`.
 * @returns {Readonly<Relationships>} It, frozen; `{}` when absent.
 */
function normalizeRelationships(value) {
    if (value === undefined) return Object.freeze({});
    if (!isPlainObject(value)) fail("relationships", "must be a mapping");
    const input = /** @type {Record<string, unknown>} */ (value);
    rejectUnknownKeys(input, RELATIONSHIP_KINDS, "relationships.");

    const out = {};
    for (const kind of RELATIONSHIP_KINDS) {
        if (input[kind] === undefined) continue;
        if (!Array.isArray(input[kind])) {
            fail(`relationships.${kind}`, "must be a list");
        }
        out[kind] = Object.freeze(
            input[kind].map((entry, index) => {
                const at = `relationships.${kind}[${index}]`;
                if (!isPlainObject(entry)) fail(at, "must be a mapping");
                const rel = /** @type {Record<string, unknown>} */ (entry);
                rejectUnknownKeys(rel, RELATIONSHIP_KEYS, `${at}.`);
                const spec = {
                    id: requireNonEmptyString(rel.id, `${at}.id`),
                };
                // What the other package's *content* is called, where that
                // differs from its Foundry id. A note addresses a file by the
                // content package that owns it — `thalorna/assets/…` — and the
                // Foundry id (`sohl-thalorna`) appears only in the install
                // path this derives. Omitted where the two are the same word,
                // which they are for every system.
                if (rel.contentPackage !== undefined) {
                    spec.contentPackage = requireNonEmptyString(
                        rel.contentPackage,
                        `${at}.contentPackage`,
                    );
                }
                for (const key of ["type", "manifest"]) {
                    if (rel[key] !== undefined) {
                        spec[key] = requireNonEmptyString(rel[key], `${at}.${key}`);
                    }
                }
                const compat = normalizeCompatibility(
                    rel.compatibility,
                    `${at}.compatibility`,
                    false,
                );
                if (compat) spec.compatibility = compat;
                // Opt-in: extract this package's Item packs so the actors pass
                // can resolve embedded items this repository does not hold.
                // Off by default, because depending on a package is not the
                // same as needing its item catalogue at build time.
                if (rel.itemCatalog !== undefined) {
                    if (typeof rel.itemCatalog !== "boolean") {
                        fail(`${at}.itemCatalog`, "must be true or false");
                    }
                    if (rel.itemCatalog && spec.manifest === undefined) {
                        fail(`${at}.itemCatalog`, "needs a `manifest` naming the package to fetch");
                    }
                    spec.itemCatalog = rel.itemCatalog;
                }
                // Opt-out: declares the dependency for the Foundry manifest
                // only, so `deps fetch` fetches no content index for it and a
                // wikilink into it is refused rather than silently dead. A
                // catalogue is fetched from the same index, so it cannot be
                // declared alongside `itemCatalog: true`.
                if (rel.contentIndex !== undefined) {
                    if (typeof rel.contentIndex !== "boolean") {
                        fail(`${at}.contentIndex`, "must be true or false");
                    }
                    if (rel.contentIndex === false && spec.itemCatalog) {
                        fail(
                            `${at}.contentIndex`,
                            "cannot be false together with `itemCatalog: true` — a catalogue is " +
                                "fetched from the same index",
                        );
                    }
                    spec.contentIndex = rel.contentIndex;
                }
                return Object.freeze(spec);
            }),
        );
    }
    return Object.freeze(out);
}

/**
 * Validate the reserved `packageBuild` section — that it is a mapping, and no
 * more than that.
 *
 * @param {unknown} value - The section, or `undefined`.
 * @returns {Readonly<PackageBuildSection>} It, frozen; `{}` when absent.
 */
function normalizePackageBuild(value) {
    if (value === undefined) return Object.freeze({});
    if (!isPlainObject(value)) {
        fail(
            "packageBuild",
            "must be a mapping — it is the section @heroiclands/package-build " +
                "reads, and that package validates what is inside it",
        );
    }
    return /** @type {Readonly<PackageBuildSection>} */ (deepFreeze(structuredClone(value)));
}

/**
 * Validate a consumer's item-type registry, splitting it into the two tables
 * the rest of the toolchain reads.
 *
 * The registry is *code* a consumer supplies — the only place the configuration
 * carries any — because the type list and the builder table have to be the same
 * list. They were two, and `trait` sat in the whitelist for a release with no
 * builder behind it.
 *
 * **An entry may be written two ways**, and the difference is only whether the
 * type brings default art:
 *
 * - `type: fn` — a bare builder. Every note of the type must carry its own
 *   `img:`.
 * - `type: { system: fn, img }` — the same builder, paired with the image a
 *   note of the type gets when it sets no `img:` of its own.
 *
 * The paired form exists because the type whitelist and the default art used to
 * travel by different routes: `itemTypes` was derived from these keys, while
 * art was looked up in `sohl/default-item-art.mjs` — a table a consumer cannot
 * add to. A consumer's own item type was therefore configurable while its
 * default art was not, so its notes all had to carry an explicit `img:` (#7).
 * Art now travels with the builder it belongs to, which is the one place a type
 * is already declared.
 *
 * @param {unknown} value - One registry: type → entry.
 * @param {string} at - The configuration path to report against.
 * @returns {{itemBuilders: Record<string, Function>,
 *            itemArt: Record<string, string>,
 *            itemFields: Record<string, readonly object[]>}}
 *   The `system` builder for each type, and the default art for those types
 *   that paired one. The art table is deliberately *sparse*: a bare-function
 *   entry contributes no key, which is what distinguishes "no default art" from
 *   an empty one.
 */
function normalizeOneRegistry(value, at) {
    if (!isPlainObject(value)) fail(at, "must be an object");
    const input = /** @type {Record<string, unknown>} */ (value);

    /** @type {Record<string, Function>} */
    const itemBuilders = {};
    /** @type {Record<string, string>} */
    const itemArt = {};
    /** @type {Record<string, readonly object[]>} */
    const itemFields = {};

    for (const [type, entry] of Object.entries(input)) {
        if (typeof entry === "function") {
            itemBuilders[type] = entry;
            continue;
        }
        if (!isPlainObject(entry)) {
            fail(
                `${at}.${type}`,
                "must be a builder function, or an object with a `system` builder",
            );
        }
        const paired = /** @type {Record<string, unknown>} */ (entry);
        rejectUnknownKeys(paired, ITEM_BUILDER_KEYS, `${at}.${type}.`);
        if (typeof paired.system !== "function") {
            fail(`${at}.${type}.system`, "must be a function");
        }
        itemBuilders[type] = /** @type {Function} */ (paired.system);
        if (paired.img !== undefined) {
            itemArt[type] = requireNonEmptyString(paired.img, `${at}.${type}.img`);
        }
        if (paired.fields !== undefined) {
            if (!Array.isArray(paired.fields)) {
                fail(`${at}.${type}.fields`, "must be an array");
            }
            for (const [index, field] of paired.fields.entries()) {
                if (!isPlainObject(field)) {
                    fail(`${at}.${type}.fields[${index}]`, "must be a field declaration object");
                }
                requireNonEmptyString(
                    /** @type {Record<string, unknown>} */ (field).to,
                    `${at}.${type}.fields[${index}].to`,
                );
            }
            itemFields[type] = Object.freeze([...paired.fields]);
        }
    }

    return { itemBuilders, itemArt, itemFields };
}

/**
 * The declared item-builder registries, and the vocabulary their union gives.
 *
 * **One registry is a ceiling, not a default.** The accepted type list is the
 * registry's keys, which is what makes a type impossible to accept without a
 * builder behind it — and, with one registry, impossible to accept a
 * type a *second* system declares. A tree feeding two systems has both:
 * `spell`, `invocation` and `psionic` are HM3's, `mysticalability` and
 * `projectile` are SoHL's, and `skill` is both systems' under one name and
 * two data models.
 *
 * So `itemBuilders` accepts either form:
 *
 * - **A registry** — `{ skill: fn, … }`. Unchanged, and what every existing
 *   configuration declares. It names no system, because there is only one.
 * - **A list of registries** — `[{ system: "sohl", builders: {…} }, …]`. The
 *   vocabulary is the **union** of their keys; a type more than one declares
 *   keeps a builder per system, so nothing is chosen for the build silently.
 *
 * The **flat** tables — `itemBuilders`, `itemArt`, `itemFields` — are the union
 * with the first declaring registry winning a collision. They answer a
 * single-system build, where a collision cannot arise; a build with two systems
 * asks by system, and `itemTypesBySeveralSystems` names the types where asking
 * flatly would be answering the wrong question. See `engine/item-registry.mjs`,
 * which refuses exactly those without a system.
 *
 * @param {unknown} value - The declared `itemBuilders`.
 * @returns {{itemBuilders: Readonly<Record<string, Function>>,
 *            itemArt: Readonly<Record<string, string>>,
 *            itemFields: Readonly<Record<string, readonly object[]>>,
 *            itemBuildersBySystem: Readonly<Record<string, Readonly<Record<string, Function>>>>,
 *            itemArtBySystem: Readonly<Record<string, Readonly<Record<string, string>>>>,
 *            itemFieldsBySystem: Readonly<Record<string, Readonly<Record<string, readonly object[]>>>>,
 *            itemTypesBySeveralSystems: ReadonlySet<string>}}
 *   The flat tables, the per-system ones, and the contested types.
 */
function normalizeItemBuilders(value) {
    const empty = Object.freeze({});
    if (value === undefined) {
        return {
            itemBuilders: empty,
            itemArt: empty,
            itemFields: empty,
            itemBuildersBySystem: empty,
            itemArtBySystem: empty,
            itemFieldsBySystem: empty,
            itemTypesBySeveralSystems: Object.freeze(new Set()),
        };
    }

    /** @type {{system: string|null, tables: ReturnType<typeof normalizeOneRegistry>}[]} */
    const registries = [];

    if (Array.isArray(value)) {
        const seen = new Set();
        for (const [index, entry] of value.entries()) {
            const at = `itemBuilders[${index}]`;
            if (!isPlainObject(entry)) {
                fail(
                    at,
                    "must be `{ system, builders }` — a registry and the system it belongs to",
                );
            }
            const declared = /** @type {Record<string, unknown>} */ (entry);
            rejectUnknownKeys(declared, ITEM_REGISTRY_KEYS, `${at}.`);
            const system = requireNonEmptyString(declared.system, `${at}.system`);
            if (seen.has(system)) {
                fail(
                    at,
                    `declares a second registry for \`${system}\` — a system has one ` +
                        `item vocabulary, so merge them at their source`,
                );
            }
            seen.add(system);
            registries.push({
                system,
                tables: normalizeOneRegistry(declared.builders, `${at}.builders`),
            });
        }
    } else {
        registries.push({ system: null, tables: normalizeOneRegistry(value, "itemBuilders") });
    }

    /** @type {Record<string, Function>} */
    const itemBuilders = {};
    /** @type {Record<string, string>} */
    const itemArt = {};
    /** @type {Record<string, readonly object[]>} */
    const itemFields = {};
    /** @type {Record<string, Readonly<Record<string, Function>>>} */
    const itemBuildersBySystem = {};
    /** @type {Record<string, Readonly<Record<string, string>>>} */
    const itemArtBySystem = {};
    /** @type {Record<string, Readonly<Record<string, readonly object[]>>>} */
    const itemFieldsBySystem = {};
    /** @type {Map<string, number>} */
    const declaringSystems = new Map();

    for (const { system, tables } of registries) {
        for (const [type, builder] of Object.entries(tables.itemBuilders)) {
            declaringSystems.set(type, (declaringSystems.get(type) ?? 0) + 1);
            if (!(type in itemBuilders)) itemBuilders[type] = builder;
        }
        for (const [type, art] of Object.entries(tables.itemArt)) {
            if (!(type in itemArt)) itemArt[type] = art;
        }
        for (const [type, fields] of Object.entries(tables.itemFields)) {
            if (!(type in itemFields)) itemFields[type] = fields;
        }
        if (system === null) continue;
        itemBuildersBySystem[system] = Object.freeze(tables.itemBuilders);
        itemArtBySystem[system] = Object.freeze(tables.itemArt);
        itemFieldsBySystem[system] = Object.freeze(tables.itemFields);
    }

    return {
        itemBuilders: Object.freeze(itemBuilders),
        itemArt: Object.freeze(itemArt),
        itemFields: Object.freeze(itemFields),
        itemBuildersBySystem: Object.freeze(itemBuildersBySystem),
        itemArtBySystem: Object.freeze(itemArtBySystem),
        itemFieldsBySystem: Object.freeze(itemFieldsBySystem),
        itemTypesBySeveralSystems: Object.freeze(
            new Set(
                [...declaringSystems.entries()].filter(([, count]) => count > 1).map(([t]) => t),
            ),
        ),
    };
}

/**
 * The publishing mode, refusing a boolean.
 *
 * A boolean is refused rather than mapped onto the nearest mode, because the
 * reading `false` invited — *this package has no web presence* — is exactly the
 * belief the change exists to correct, and a value quietly reinterpreted reads
 * to its author as though it still means what it said. So the message names the
 * mode to write instead of the value to fix.
 *
 * @param {unknown} value - The authored `publish.site`.
 * @returns {SiteMode} The mode.
 */
function normalizeSiteMode(value) {
    if (value === undefined) return "homepage";
    if (typeof value === "boolean") {
        fail(
            "publish.site",
            `is no longer a boolean — write \`site: ${value ? "content" : "homepage"}\`. ` +
                `Every package publishes an authored homepage at ` +
                `/<contentPackage>/, so no value means "no web presence": ` +
                `\`homepage\` publishes that page and nothing else, and ` +
                `\`content\` publishes it plus every page the content tree ` +
                `compiles to`,
        );
    }
    if (
        typeof value !== "string" ||
        !(/** @type {readonly string[]} */ (SITE_MODES).includes(value))
    ) {
        fail(
            "publish.site",
            `must be one of ${SITE_MODES.join(", ")} (got ${JSON.stringify(value)})`,
        );
    }
    return /** @type {SiteMode} */ (value);
}

/**
 * @param {unknown} value
 * @returns {Readonly<PublishSwitches>}
 */
function normalizePublish(value) {
    if (value === undefined) {
        return Object.freeze({
            site: "homepage",
            address: Object.freeze({ ...DEFAULT_ADDRESS_SCHEME }),
        });
    }
    if (!isPlainObject(value)) fail("publish", "must be an object");
    const publish = /** @type {Record<string, unknown>} */ (value);
    rejectUnknownKeys(publish, PUBLISH_KEYS, "publish.");

    const addressInput = publish.address;
    if (addressInput !== undefined && !isPlainObject(addressInput)) {
        fail("publish.address", "must be an object");
    }
    const address = /** @type {Record<string, unknown>} */ (addressInput ?? {});
    // A retired key is refused by name, ahead of the vocabulary check: reported
    // as merely unrecognized it would read as a misspelling of the one key that
    // survives, and the author would correct the spelling rather than learn
    // that the mechanism is gone.
    for (const key of Object.keys(address)) {
        if (Object.hasOwn(RETIRED_ADDRESS_KEYS, key)) {
            fail(`publish.address.${key}`, RETIRED_ADDRESS_KEYS[key]);
        }
    }
    rejectUnknownKeys(address, ADDRESS_KEYS, "publish.address.");

    const prefix =
        address.prefix === undefined ?
            DEFAULT_ADDRESS_SCHEME.prefix
        :   optionalString(address.prefix, "publish.address.prefix");
    // A prefix is concatenated, not joined, so a missing slash would silently
    // fuse it to the first section (`kbaffliction/`) — an address that builds,
    // resolves nowhere, and reads as a content error rather than a config one.
    if (prefix && !prefix.endsWith("/")) {
        fail("publish.address.prefix", "must end in a slash when it is set");
    }
    if (prefix.startsWith("/")) {
        // A leading slash would make the recorded address package-absolute,
        // which is exactly the site-absolute shape this avoids.
        fail("publish.address.prefix", "must not begin with a slash");
    }

    return Object.freeze({
        site: normalizeSiteMode(publish.site),
        address: Object.freeze({ prefix }),
    });
}

/**
 * Validate and normalize a content configuration.
 *
 * Every configuration reaches this function — a YAML one through the loader in
 * `engine/pack-config.mjs`, an `.mjs` one by calling it itself — so that a
 * malformed configuration fails at load with a message naming the offending
 * field, rather than surfacing much later as an empty pack or a missing asset.
 * The returned object is a deeply frozen **copy**: mutating the input
 * afterwards cannot reach the configuration the build reads.
 *
 * @param {ContentBuildConfigInput} config  The configuration to validate.
 * @returns {ContentBuildConfig}            The frozen, defaulted configuration.
 * @throws {TypeError} If any field is missing, mistyped, or unrecognized.
 */
export function defineConfig(config) {
    if (!isPlainObject(config)) {
        throw new TypeError("package-build config: expected a configuration object.");
    }
    const input = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (config));
    rejectUnknownKeys(input, CONFIG_KEYS, "");

    const rootDir = requireNonEmptyString(input.rootDir, "rootDir");
    if (!path.isAbsolute(rootDir)) {
        fail(
            "rootDir",
            "must be an absolute path — it is what makes the build independent " +
                "of the directory it was launched from (pass `import.meta.dirname`)",
        );
    }

    const packageKind = input.packageKind;
    if (
        typeof packageKind !== "string" ||
        !(/** @type {readonly string[]} */ (PACKAGE_KINDS).includes(packageKind))
    ) {
        fail("packageKind", `must be one of: ${PACKAGE_KINDS.join(", ")}`);
    }

    // A documentation package compiles nothing and installs nowhere, so every
    // key that describes a Foundry package is refused by name — ahead of the
    // checks below, which each assume a Foundry package is being described.
    const documentation = packageKind === DOCUMENTATION_KIND;
    if (documentation) {
        for (const [key, why] of Object.entries(DOCUMENTATION_REFUSES)) {
            if (input[key] === undefined) continue;
            fail(key, `is refused in a \`${DOCUMENTATION_KIND}\` package, which ${why}`);
        }
        // Publishing is what a documentation package is *for*, so the floor
        // every other package may sit at is not available to it: `homepage`
        // would leave a package that publishes one authored page, builds no
        // book, and compiles nothing at all.
        if (!isPlainObject(input.publish)) {
            fail(
                "publish",
                `is required in a \`${DOCUMENTATION_KIND}\` package: publishing ` +
                    "the content tree is the whole of what it does. Write " +
                    "`publish: {site: content}`",
            );
        }
        const mode = /** @type {Record<string, unknown>} */ (input.publish).site;
        if (mode !== "content") {
            fail(
                "publish.site",
                `must be \`content\` in a \`${DOCUMENTATION_KIND}\` package — ` +
                    "`homepage` fences the content surfaces off, and a package " +
                    "that compiles nothing and publishes nothing from its tree " +
                    "would produce a single authored page and no book",
            );
        }
    }

    // A Foundry package need not compile anything. A module may ship assets and
    // nothing else — alternative art for another package is the case, and it is
    // an ordinary module that installs, is enabled, and supplies files. So
    // `packs: []` is a package saying it compiles no documents, not a package
    // that forgot to say which.
    //
    // What that leaves uncovered is a tree of notes with no pack to compile them
    // into, which would be silently ignored. `packs` cannot see the tree, so the
    // walk reports it: a declared pack that compiles nothing from a non-empty
    // tree already fails, and so does a note whose `pack:` names none.
    if (!documentation && !Array.isArray(input.packs)) fail("packs", "must be an array");
    const declaredPacks = Array.isArray(input.packs) ? input.packs : [];
    const packs = declaredPacks.map((pack, index) => normalizePack(pack, `packs[${index}]`));

    // One list, so the compile order and the directory list cannot disagree —
    // as `PACK_CONFIGS` and `SOURCE_PACKS` they would be maintained apart.
    const packDirectories = packs.flatMap((pack) => [
        pack.name,
        ...pack.companions.map((companion) => companion.name),
    ]);
    const seen = new Set();
    for (const name of packDirectories) {
        if (seen.has(name)) {
            fail("packs", `declares the pack \`${name}\` more than once`);
        }
        seen.add(name);
    }

    // ── systems: declaring, and requiring, are separate decisions ──────
    const systems = normalizeSystems(input.systems);
    const requiresSystem = normalizeRequiresSystem(input.requiresSystem);
    const declaredSystems = new Set(Object.keys(systems));
    /** `relationships.systems`, for the derivations that still consult it. */
    const relationshipSystems = /** @type {{id?: string}[]} */ (
        (isPlainObject(input.relationships) ? input.relationships.systems : null) ?? []
    );
    // Read here as well as stamped below, so the check that a pack's `system:`
    // resolves to something and the value it resolves to are one statement.
    const packageWide = packageWideSystemId({
        packageKind,
        foundryPackage: input.foundryPackage,
        requiresSystem,
        systems,
        relationshipSystems,
    });

    // A name that resolves to nothing is a build error rather than a
    // fall-through, in the spirit the rest of this file already follows: a pack
    // stamping a system nobody declared would stamp `undefined`, which is the
    // plausible lie.
    if (requiresSystem !== null && !declaredSystems.has(requiresSystem)) {
        fail(
            "requiresSystem",
            `names \`${requiresSystem}\`, which \`systems:\` does not declare` +
                (declaredSystems.size ?
                    `. Declared: ${[...declaredSystems].join(", ")}`
                :   ` — the \`systems:\` block is empty or absent`),
        );
    }
    for (const pack of packs.flatMap((p) => [p, ...p.companions])) {
        if (!pack.system) continue;
        // **A pack's `system:` must resolve to a stamp**, and there are exactly
        // two things it can resolve to: a `systems:` entry, which carries the
        // verified version `statsForPack` reads, or this package's own
        // package-wide system, whose stats answer for every pack of it.
        //
        // Skipping this entirely when `systems:` is empty or absent
        // — `declaredSystems.size &&` guarded it — which left the case the
        // comment above was written about wide open. `harn-ensemble` declares
        // `system: sohl` and `system: hm3` on its packs, no `systems:` block,
        // and no package-wide system, so every pack fell through to a
        // package-wide stat that is null: 2,513 compiled actors stamped
        // `_stats.systemId: null` in a pack that says `system: sohl` on the
        // line above. That is the plausible lie, reached by the
        // one path this check did not cover, and the `requiresSystem` check ten
        // lines up already refuses its own version of it in as many words.
        if (!declaredSystems.has(pack.system) && pack.system !== packageWide) {
            fail(
                `packs.${pack.name}.system`,
                `names \`${pack.system}\`, which \`systems:\` does not declare` +
                    (declaredSystems.size ?
                        ` (declared: ${[...declaredSystems].join(", ")})`
                    :   ` — the \`systems:\` block is empty or absent`) +
                    (packageWide ?
                        `, and which is not this package's own system \`${packageWide}\``
                    :   `, and this package has no package-wide system either`) +
                    `. Every document in the pack is stamped \`_stats.systemId\` ` +
                    `and \`systemVersion\` from one of those two, so with ` +
                    `neither it would be stamped null. Add \`systems:\` naming ` +
                    `\`${pack.system}\` with a \`compatibility.verified\` version`,
            );
        }
        // With a gate set, a pack for any other system could never be seen:
        // Foundry drops the whole package under a system `requiresSystem` does
        // not name, so the pack would ship and be unreachable.
        if (requiresSystem !== null && pack.system !== requiresSystem) {
            fail(
                `packs.${pack.name}.system`,
                `names \`${pack.system}\` while \`requiresSystem\` is ` +
                    `\`${requiresSystem}\`, so this pack could never be seen — ` +
                    `Foundry hides the whole package from any world whose ` +
                    `system \`requiresSystem\` does not name. Drop ` +
                    `\`requiresSystem\`, or correct the pack`,
            );
        }
    }

    // Several packs of one document type are allowed — editorial grouping of
    // same-type documents is ordinary Foundry practice, and collapsing such a
    // layout breaks every stored compendium UUID. What is not allowed
    // is two candidates for the same undeclared note.
    const defaultsByType = new Map();
    for (const pack of packs) {
        if (!pack.default) continue;
        const already = defaultsByType.get(pack.type);
        if (already) {
            fail(
                "packs",
                `marks both \`${already}\` and \`${pack.name}\` as the ` +
                    `default ${pack.type} pack; a note declaring no \`pack:\` ` +
                    `must have one destination`,
            );
        }
        defaultsByType.set(pack.type, pack.name);
    }

    if (input.skipDirectories !== undefined && !Array.isArray(input.skipDirectories)) {
        fail("skipDirectories", "must be an array");
    }
    const skipDirectories = (input.skipDirectories ?? []).map((name, index) =>
        requireNonEmptyString(name, `skipDirectories[${index}]`),
    );

    // Refused above for a documentation package, so there is nothing to read
    // and nothing to derive an asset root or a package-wide system from.
    const foundryPackage =
        documentation ? null : requireNonEmptyString(input.foundryPackage, "foundryPackage");

    const {
        itemBuilders,
        itemArt,
        itemFields,
        itemBuildersBySystem,
        itemArtBySystem,
        itemFieldsBySystem,
        itemTypesBySeveralSystems,
    } = normalizeItemBuilders(input.itemBuilders);
    // The union across every declared registry — the flat table already
    // holds every key any of them declares, so this stays "the registry's keys"
    // rather than becoming a second list to keep in step.
    const itemTypes = Object.freeze(new Set(Object.keys(itemBuilders)));
    // Every note that compiles into a *system-bearing* document publishes its
    // prose as a documentation JournalEntry, and that includes actors.
    // A being was the one such note with no `none` address — its only address
    // named the Actor — so nothing a prose link wrote could land on its page.
    // `doc` stays out for the reason that actually applies to it: its single
    // document *is* the prose.
    const docEntryTypes = Object.freeze(
        new Set([...itemTypes, ...ACTOR_TYPES, "macro", ...MAP_TYPES]),
    );

    return Object.freeze({
        rootDir,
        contentPackage: requireContentPackage(input.contentPackage, docEntryTypes),
        foundryPackage,
        // `package.json`'s own address and byline. `homepage` is checked by
        // `checkHomepage` in `config.mjs`.
        homepage:
            input.homepage === undefined ? null : requireNonEmptyString(input.homepage, "homepage"),
        author: normalizeAuthor(input.author),
        packageKind: /** @type {PackageKind} */ (packageKind),
        // Foundry serves a package's files from `<kind>/<id>/`, so this is the
        // one place `systems/sohl` (or `modules/sohl-thalorna`) is spelled.
        //
        // **Conditional on the kind.** `documentation` names no directory
        // Foundry serves, and there is no package id to put under one either, so
        // the derivation would read `documentation/null/assets` — an address
        // that resolves nowhere and would be written into every compiled `img`.
        // `null` says the package has no asset root instead, and
        // {@link module:engine/helpers.resolveImg} — the only reader — refuses
        // rather than rooting a path against nothing.
        assetRoot: documentation ? null : `${packageKind}/${foundryPackage}/assets`,
        paths: normalizePaths(input.paths, rootDir),
        // The package-wide system, derived. A **system** package is its
        // own system, which is true by construction and needs no declaration. A
        // **module** takes the one it requires, or the one system it declares
        // when there is exactly one; with several and no gate there is no
        // package-wide answer, and each pack carries its own.
        stats:
            documentation ? null : (
                normalizeStats(input.stats, {
                    systemId: packageWideSystemId({
                        packageKind,
                        foundryPackage,
                        requiresSystem,
                        systems,
                        relationshipSystems,
                    }),
                    // Derived here where the answer is pure data — the `verified` of
                    // whichever system the package-wide block takes — and supplied by
                    // the loader otherwise. The loader is the half that may do I/O, and
                    // the two cases needing it are a *system* package (its own
                    // `package.json` version) and a module still deriving from
                    // `relationships.systems`.
                    systemVersion:
                        (() => {
                            const id =
                                requiresSystem ??
                                (Object.keys(systems).length === 1 ?
                                    Object.keys(systems)[0]
                                :   null);
                            return id ? (systems[id]?.compatibility?.verified ?? null) : null;
                        })() ??
                        (isPlainObject(input.stats) ? input.stats[DERIVED_SYSTEM_VERSION] : null) ??
                        null,
                })
            ),
        itemBuilders,
        itemArt,
        itemFields,
        itemBuildersBySystem,
        itemArtBySystem,
        itemFieldsBySystem,
        itemTypesBySeveralSystems,
        // Resolved once, here, and read everywhere through
        // `loadPackConfig()`. The doc-entry *concept* is the engine's —
        // a note that carries documentation is not a SoHL idea — but the
        // membership is the consumer's, and there is exactly one resolved set at
        // runtime. Two would drift, which is the whole reason the composition
        // was written down in one place to begin with.
        itemTypes,
        docEntryTypes,
        skipDirectories: Object.freeze(skipDirectories),
        icons: normalizeIcons(input.icons, rootDir),
        packs: Object.freeze(packs),
        packDirectories: Object.freeze(packDirectories),
        docs: normalizeDocs(input.docs),
        site: normalizeSite(input.site),
        pdf: normalizePdf(input.pdf, rootDir),
        compatibility: normalizeCompatibility(input.compatibility, "compatibility"),
        relationships: normalizeRelationships(input.relationships),
        systems,
        requiresSystem,
        packageBuild: normalizePackageBuild(input.packageBuild),
        publish: normalizePublish(input.publish),
    });
}
