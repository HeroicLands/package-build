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
 *     systemId: sohl
 *     lastModifiedBy: sohlbuilder00000
 * itemBuilders: sohl
 * skipDirectories: [Templates]
 * packs:
 *     - { name: items, type: Item, folders: item-folders.yaml }
 *     - { name: journals, type: JournalEntry, label: Journals }
 * packageBuild:
 *     assets:
 *         - { from: assets/icons, to: assets/icons }
 * publish:
 *     site: content
 *     manifests: { publish: true, consume: true }
 * ```
 *
 * `defineConfig` is the whole of the contract: it validates the object, fills
 * the optional halves with their defaults, and returns a deeply frozen copy.
 * It performs no I/O and knows nothing about any particular package's content —
 * a consumer's config is data, and the compilers read it.
 *
 * **This module validates; it does not load.** `engine/pack-config.mjs` is what
 * finds a repository's configuration and reads it, and it is where the three
 * fields absent from the YAML above are derived: `rootDir` (the directory the
 * file sits in), `stats.systemVersion` (the adjacent `package.json`), and the
 * `itemBuilders` table the name `sohl` stands for. All three are I/O or code,
 * and this module is deliberately neither — which is also why a consumer whose
 * item-builder registry is its own writes `package-build.config.mjs`, calling
 * `defineConfig` below directly with a `rootDir` of `import.meta.dirname`.
 * Both forms end here, so both are validated and frozen identically.
 *
 * **`rootDir` anchors every path**, so the build reads the same files whatever
 * directory it was launched from (#1508).
 *
 * The Foundry floor is declared here as top-level `compatibility`, and the
 * shipped manifest is generated *from* this file. That reverses an older rule —
 * configuration named where the manifest was and read the floor back out of it —
 * which was right while the manifest was hand-authored and became a round trip
 * through a generated artifact once it was not (#50, package-build#9).
 *
 * @module
 */

import path from "node:path";

// Leaves with no local imports of their own, so naming them here cannot close
// a cycle around a consumer's config file (see `engine/pack-config.mjs`).
import { isAddressSegment } from "./engine/address-charset.mjs";
import { MAP_TYPES, PACK_BY_TYPE } from "./engine/ids.mjs";

/**
 * The two kinds of Foundry package a content module can be built into. The
 * value is also the directory Foundry installs the package under, which is why
 * it is plural.
 *
 * @satisfies {readonly PackageKind[]}
 */
export const PACKAGE_KINDS = /** @type {const} */ (["systems", "modules"]);

/**
 * The directories the build reads from and writes to, relative to `rootDir`,
 * with the layout a HeroicLands content repository conventionally uses. A
 * consumer overrides only the ones it moves.
 *
 */
export const DEFAULT_PATHS = /** @type {const} */ ({
    content: "assets/content",
    manifests: "assets/manifests",
    manifestOut: "build/manifests",
    packJson: "build/packs-json",
    stage: "build/stage/packs",
    unpack: "build/tmp/packs",
    // Where a dependency declaring `itemCatalog: true` is unpacked. Under
    // `build/` because it is derived, disposable, and version-keyed.
    foreignCache: "build/cache/foreign",
});

/**
 * The Foundry document types a compendium pack may hold. This is the set the
 * toolchain is able to compile a pack of; a document type Foundry supports but
 * this toolchain does not compile is deliberately absent (see #1501 — playlists
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
 * The landing-page rules a repository may route by.
 *
 * A *landing page* is a note that addresses a whole section rather than a page
 * within one, so it has no slug of its own. Which note that is differs between
 * repositories, and both live rules are represented here because switching
 * either one on for the other repository moves addresses that are already
 * published:
 *
 * - `readme` — a `README.md` **is** its section's landing page. This is `sohl`'s
 *   rule, and a `doc` note routes by its `category` like any other, so `sohl`'s
 *   eleven `category: collection` notes publish under a literal `collection/`
 *   section (`kb/collection/skills/`).
 * - `collection` — a `doc` note whose `category` is `collection` addresses the
 *   section it introduces, named by its authored `section`. This is `thalorna`'s
 *   rule, under which the same note publishes at `creature/`.
 *
 * The two are not disjoint and cannot simply both apply: each tree holds notes
 * the other rule would move.
 *
 * @type {readonly string[]}
 */
export const LANDING_RULES = Object.freeze(["readme", "collection"]);

/**
 * A repository's address scheme, with the defaults an unconfigured one gets.
 *
 * `prefix` is where the content tree mounts *inside the package* — `"kb/"` for
 * `sohl`, whose knowledgebase is one surface among several, and empty for
 * `thalorna`, whose site is nothing but its content. It is not the package's
 * own mount point: where the package itself is served is the consuming build's
 * knowledge, held in `PACKAGE_BASE` (`engine/kb-manifest.mjs`) and prefixed at
 * resolve time, so it is never recorded here (#1465).
 */
export const DEFAULT_ADDRESS_SCHEME = Object.freeze({
    prefix: "",
    landing: "readme",
});

/**
 * How much of a package reaches the web.
 *
 * Every HeroicLands package publishes something: a top-level, human-authored
 * homepage at `https://www.heroiclands.org/<contentPackage>/` saying what the
 * module is, which system it needs and how to install it (#50). So there is no
 * value here meaning *no web presence at all* — homepage-only is the **floor**,
 * and the default.
 *
 * - `homepage` — the authored homepage, and **no other page**. The content tree
 *   is not walked for pages, `site.sections` / `site.trees` / `site.landing`
 *   emit nothing, and link-manifest entries carry no web `path`.
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
 * decide whether to walk the tree at all, and the link-manifest emitter, to
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
 * @typedef {"systems" | "modules"} PackageKind
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
 * layout breaks every stored reference (#1566).
 *
 * @typedef {object} PackSpec
 * @property {string} name              Pack name — the manifest `name`, and the
 *                                      directory under `packs/`.
 * @property {PackDocumentType} type    Foundry document type the pack holds.
 * @property {string} [label]           Human-readable label. Defaults to `name`.
 * @property {boolean} [private]        Whether the pack is GM-only. Default `false`.
 * @property {string|null} [folders]    The pack's folder-hierarchy file, relative
 *                                      to `paths.content`. Default `null` — no
 *                                      folder documents are emitted.
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
 * @property {string|null} folders
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
 * @property {string} [manifests]        Vendored cross-package link manifests,
 *                                       read by `links`. Inbound.
 * @property {string} [manifestOut]      Where `manifest` writes this package's
 *                                       own link manifest. Outbound, and a
 *                                       build artifact — the published copy is
 *                                       the one a consumer vendors into its
 *                                       `manifests` directory.
 * @property {string} [packJson]         Build-only per-entry JSON intermediate.
 * @property {string} [stage]            Compiled LevelDB packs.
 * @property {string} [unpack]           Where `unpack` extracts JSON back to.
 */

/**
 * {@link PathsInput}, resolved to absolute paths against `rootDir`.
 *
 * @typedef {object} ResolvedPaths
 * @property {string} content
 * @property {string} manifests
 * @property {string} manifestOut
 * @property {string} packJson
 * @property {string} stage
 * @property {string} unpack
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
 * The two manifest switches. A package may publish a link manifest, consume
 * other packages' manifests, both, or neither — the four combinations are all
 * real (see #1385/#1446: `kethira` consumes but never publishes).
 *
 * @typedef {object} ManifestSwitches
 * @property {boolean} publish  Emit this package's link manifest.
 * @property {boolean} consume  Resolve cross-package links through vendored manifests.
 */

/**
 * @typedef {object} PublishSwitches
 * @property {SiteMode} site          How much of this package reaches the web.
 *                                    See {@link SITE_MODES}.
 * @property {ManifestSwitches} manifests
 */

/**
 * @typedef {object} ManifestSwitchesInput
 * @property {boolean} [publish]
 * @property {boolean} [consume]
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
 * @property {string} [type]         `system`, `module`, or `world`.
 * @property {string} [manifest]     Where its manifest is published.
 * @property {CompatibilitySpec} [compatibility]  The version range of *that*
 *                                   package this one targets — for a system
 *                                   relationship, `verified` is what
 *                                   `_stats.systemVersion` is stamped from.
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
 * @property {ManifestSwitchesInput} [manifests]
 * @property {AddressSchemeInput} [address]
 */

/**
 * @typedef {object} AddressSchemeInput
 * @property {string} [prefix]   Where the content tree mounts inside the package.
 * @property {string} [landing]  Which note addresses a whole section.
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
 * while one that does not is simply undocumented rather than broken (#22).
 *
 * @typedef {((fm: object) => object)|{system: (fm: object) => object, img?: string, fields?: readonly object[]}} ItemBuilderEntry
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
 * @property {string} foundryPackage        Foundry package id, as it appears in
 *                                          `system.json` / `module.json`.
 * @property {PackageKind} packageKind      Whether the package is a system or a module.
 * @property {StatsSpec} stats              Identity stamped into every document's `_stats`.
 * @property {Record<string, ItemBuilderEntry>} [itemBuilders]  The consumer's
 *                                          item-type registry: each content `type`
 *                                          that compiles into an Item, paired with
 *                                          the builder producing its `system` block
 *                                          — and, optionally, the default art a
 *                                          note of that type gets when it sets no
 *                                          `img:` of its own. Default `{}` — a
 *                                          content module that ships no items
 *                                          declares none.
 * @property {PackSpec[]} packs             Packs to compile. More than one entry
 *                                          may share a `type`: a note then names
 *                                          the pack it belongs in with its
 *                                          `pack:` frontmatter, and one pack of
 *                                          the type is marked `default: true` to
 *                                          receive the notes that name none
 *                                          (#1566).
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
 * @property {string} foundryPackage
 * @property {PackageKind} packageKind
 * @property {string} assetRoot        Derived: the served Foundry asset root,
 *                                     `<packageKind>/<foundryPackage>/assets`.
 * @property {Readonly<ResolvedPaths>} paths
 * @property {Readonly<StatsSpec>} stats
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
 *                                     simply undocumented (#22).
 * @property {ReadonlySet<string>} itemTypes       Derived: the keys of
 *                                     {@link ContentBuildConfigInput.itemBuilders},
 *                                     so the accepted item types and the builder
 *                                     table are one list (#1504).
 * @property {ReadonlySet<string>} docEntryTypes   Derived: every type whose prose
 *                                     compiles into a JournalEntry of its own —
 *                                     the item types, plus `macro`, plus the map
 *                                     types. The one set the compilers and the
 *                                     link-manifest emitter both read.
 * @property {readonly string[]} skipDirectories
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
    "packageKind",
    "stats",
    "itemBuilders",
    "paths",
    "skipDirectories",
    "packs",
    "docs",
    "site",
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
    "out",
    "base",
    "packages",
    "sections",
    "readmeSections",
    "landing",
    "trees",
    "pass",
    "passOptions",
    "backfillSections",
];
const SITE_TREE_KEYS = ["from", "section"];
const SECTION_META_KEYS = ["title", "banner", "description"];
const DOC_PAGE_KEYS = ["title", "out", "preamble"];
const RELATIONSHIP_KINDS = ["systems", "requires", "recommends", "conflicts"];
const RELATIONSHIP_KEYS = ["id", "type", "manifest", "compatibility", "itemCatalog"];
const ITEM_BUILDER_KEYS = ["system", "img", "fields"];
const PACK_KEYS = [
    "name",
    "type",
    "label",
    "private",
    "folders",
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
 * configuration (#48), but the value still has to reach here from the loader —
 * which is the half that may do I/O, and which reads a system package's version
 * out of the adjacent `package.json`. A string key would be a second spelling of
 * the refused one, forgeable from YAML and reachable by `rejectUnknownKeys`; a
 * symbol key cannot be written in YAML at all and does not appear in
 * `Object.keys`, so the refusal has no back door.
 *
 * @type {symbol}
 */
export const DERIVED_SYSTEM_VERSION = Symbol.for("package-build.derivedSystemVersion");
const PUBLISH_KEYS = ["site", "manifests", "address"];
const MANIFEST_KEYS = ["publish", "consume"];
const ADDRESS_KEYS = ["prefix", "landing"];

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
 * column, and does (`locateConfigError` in `engine/pack-config.mjs`, #95).
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
 * The `contentPackage`, checked against the two rules an address puts on it.
 *
 * It is the first segment of every canonical address this repository publishes
 * (`sohl-skill-clmb`), and an address is read by counting hyphen-separated
 * segments. So the value carries two obligations that the rest of the
 * configuration does not, and #59 asks for both to be **enforced rather than
 * assumed** — the alternative is a package whose addresses are simply
 * unreadable, reported nowhere and discovered as links that resolve to nothing.
 *
 * 1. _Alphanumeric_, so the hyphen stays purely a separator. `harn-adventures`
 *    was the one violator, and its keys read as four segments and failed as a
 *    `null` return from `readCanonicalKey` — a silence, not an error.
 * 2. _Not a note type_, because the package and the type are adjacent segments
 *    drawn from two vocabularies. Keeping them disjoint is what lets a reader
 *    take a name at face value instead of deciding which slot it is filling.
 *    One such collision is structural and cannot be fixed — `sohl` is both a
 *    content package and a system id, because Foundry requires a system
 *    package's id to *be* its system id — which is the reason to prevent the
 *    ones that are avoidable.
 *
 * @param {unknown} value - The configured `contentPackage`.
 * @param {ReadonlySet<string>} docEntryTypes - Every type whose prose compiles
 *   to a documentation entry: the item types plus `macro` and the map types.
 *   With {@link PACK_BY_TYPE} and the `doc`-prefixed forms, this is the whole
 *   type vocabulary an address may write.
 * @returns {string} The value, unchanged.
 */
function requireContentPackage(value, docEntryTypes) {
    const pkg = requireNonEmptyString(value, "contentPackage");
    if (!isAddressSegment(pkg)) {
        fail(
            "contentPackage",
            `is \`${pkg}\`, which is not alphanumeric. It is the first ` +
                `segment of every address this package publishes ` +
                `(\`${pkg}-<type>-<shortcode>\`), and an address is read by ` +
                `counting hyphen-separated segments — so anything outside ` +
                "`[A-Za-z0-9]` here makes those addresses unreadable rather " +
                "than merely ugly. `harn-adventures` became `harnadventures`",
        );
    }
    const typeNames = new Set([
        ...Object.keys(PACK_BY_TYPE),
        ...docEntryTypes,
        ...[...docEntryTypes].map((type) => `doc${type}`),
    ]);
    if (typeNames.has(pkg)) {
        fail(
            "contentPackage",
            `is \`${pkg}\`, which is also a note type — \`${pkg}-<shortcode>\` ` +
                "already addresses one. The package and the type are adjacent " +
                "segments of an address, and the two vocabularies are kept " +
                "disjoint so a reader never has to decide which slot a name " +
                "is filling. Rename the package",
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
 * @param {unknown} value
 * @param {string} where       Field path used in error messages.
 * @param {boolean} [nested]   Whether this is a companion, which may not nest
 *                             companions of its own.
 * @returns {Readonly<ResolvedPackSpec>}
 */
function normalizePack(value, where, nested = false) {
    if (!isPlainObject(value)) fail(where, "must be an object");
    const pack = /** @type {Record<string, unknown>} */ (value);
    rejectUnknownKeys(pack, PACK_KEYS, `${where}.`);

    const name = requireNonEmptyString(pack.name, `${where}.name`);
    const type = pack.type;
    if (
        typeof type !== "string" ||
        !(/** @type {readonly string[]} */ (PACK_DOCUMENT_TYPES).includes(type))
    ) {
        fail(`${where}.type`, `must be one of: ${PACK_DOCUMENT_TYPES.join(", ")}`);
    }

    if (pack.folders !== undefined && pack.folders !== null) {
        requireNonEmptyString(pack.folders, `${where}.folders`);
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
    // may accompany it: silently ignoring a `folders` file that can never be
    // read is worse than refusing the configuration that declares it.
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
        if (pack.folders !== undefined && pack.folders !== null) {
            fail(
                `${where}.folders`,
                "may not accompany `prebuilt`: the folder hierarchy is built " +
                    "during generation, which a prebuilt pack skips",
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
        folders:
            pack.folders === undefined || pack.folders === null ?
                null
            :   /** @type {string} */ (pack.folders),
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
 * @param {unknown} value
 * @returns {Readonly<StatsSpec>}
 */
function normalizeStats(value, derived) {
    if (!isPlainObject(value)) fail("stats", "must be an object");
    const input = /** @type {Record<string, unknown>} */ (value);

    // **`systemId` and `systemVersion` are derived, and authoring a derived
    // value is an error rather than an override (#48).** `systems:` is the
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
 * A generated landing is the *only* place a section can speak: a content
 * package has no authored `_index.md` for `weapongear` or `affliction`, so the
 * file the theme reads is the one the site build writes. This is therefore the
 * whole vocabulary, and it is deliberately a **closed** one.
 *
 * The alternative — passing whatever a section declared straight through, as
 * `site.landing` does — was weighed and refused. `landing` is written once, for
 * the mount, and its keys are one landing template's own; a section entry is
 * written fourteen to twenty times per build against a contract every package
 * and every section shares. Unbounded there, a mistyped `descrption:` publishes
 * into front matter, is read by nobody, and says nothing to anyone — which is
 * the failure #91 was filed about, moved one step downstream where no build can
 * see it. So the keys are named here, and the writers emit what this produced
 * rather than transcribing a second list of their own (#91).
 *
 * `banner` and `description` are optional — the hero images are external assets
 * and not every section has one, and a section may reasonably have nothing to
 * add to its title. Each is left off entirely rather than written as
 * `undefined`, which is not a value YAML can carry.
 *
 * @param {unknown} value - The declared entry.
 * @param {string} where - Dotted path, for the error.
 * @returns {Readonly<{title: string, banner?: string, description?: string}>}
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
    return Object.freeze(out);
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
 * The `site` section — how this repository frames the website it publishes.
 *
 * Everything here is *framing*: where the Hugo tree is written, what a section
 * is called, which extra trees are published beside the content, and which
 * named pass bundle supplies the repository's own body rewrites. How a page gets
 * its **address** is deliberately not here — that is `publish.address`, shared
 * with the link manifest so the two cannot disagree about where a page is.
 *
 * @param {unknown} value - The `site` block, or `undefined`.
 * @returns {Readonly<object>} It, frozen, with every default filled.
 */
function normalizeSite(value) {
    const empty = Object.freeze({
        out: "",
        base: "",
        packages: Object.freeze([]),
        sections: Object.freeze({}),
        readmeSections: Object.freeze({}),
        landing: null,
        trees: Object.freeze([]),
        pass: "",
        passOptions: Object.freeze({}),
        backfillSections: false,
    });
    if (value === undefined) return empty;
    if (!isPlainObject(value)) fail("site", "must be a mapping");
    const input = /** @type {Record<string, unknown>} */ (value);
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
        out: input.out === undefined ? "" : requireNonEmptyString(input.out, "site.out"),
        base: input.base === undefined ? "" : requireNonEmptyString(input.base, "site.base"),
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
 * Validate the declared relationships.
 *
 * Only as far as this package needs to read them: enough that a system
 * relationship can be found and its `verified` version trusted. The rest is
 * passed through for the manifest generator to emit.
 *
 * @param {unknown} value - The `relationships` block, or `undefined`.
 * @returns {Readonly<Relationships>} It, frozen; `{}` when absent.
 */
/**
 * The systems this package can stamp content against — declaration only (#48).
 *
 * **Declaring is not requiring, and that separation is the whole point.** The
 * only place to state a system version used to be `relationships.systems`, and
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
 * The one system this package refuses to load without, or `null` (#48).
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
 * builder behind it (#1504).
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
 * @param {unknown} value
 * @returns {{itemBuilders: Readonly<Record<string, Function>>,
 *            itemArt: Readonly<Record<string, string>>}}
 *   The `system` builder for each type, and the default art for those types
 *   that paired one. The art table is deliberately *sparse*: a bare-function
 *   entry contributes no key, which is what distinguishes "no default art" from
 *   an empty one.
 */
function normalizeItemBuilders(value) {
    if (value === undefined) {
        return { itemBuilders: Object.freeze({}), itemArt: Object.freeze({}) };
    }
    if (!isPlainObject(value)) fail("itemBuilders", "must be an object");
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
                `itemBuilders.${type}`,
                "must be a builder function, or an object with a `system` builder",
            );
        }
        const paired = /** @type {Record<string, unknown>} */ (entry);
        rejectUnknownKeys(paired, ITEM_BUILDER_KEYS, `itemBuilders.${type}.`);
        if (typeof paired.system !== "function") {
            fail(`itemBuilders.${type}.system`, "must be a function");
        }
        itemBuilders[type] = /** @type {Function} */ (paired.system);
        if (paired.img !== undefined) {
            itemArt[type] = requireNonEmptyString(paired.img, `itemBuilders.${type}.img`);
        }
        if (paired.fields !== undefined) {
            if (!Array.isArray(paired.fields)) {
                fail(`itemBuilders.${type}.fields`, "must be an array");
            }
            for (const [index, field] of paired.fields.entries()) {
                if (!isPlainObject(field)) {
                    fail(
                        `itemBuilders.${type}.fields[${index}]`,
                        "must be a field declaration object",
                    );
                }
                requireNonEmptyString(
                    /** @type {Record<string, unknown>} */ (field).to,
                    `itemBuilders.${type}.fields[${index}].to`,
                );
            }
            itemFields[type] = Object.freeze([...paired.fields]);
        }
    }

    return {
        itemBuilders: Object.freeze(itemBuilders),
        itemArt: Object.freeze(itemArt),
        itemFields: Object.freeze(itemFields),
    };
}

/**
 * The publishing mode, refusing the boolean this setting used to be.
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
            manifests: Object.freeze({ publish: false, consume: false }),
            address: Object.freeze({ ...DEFAULT_ADDRESS_SCHEME }),
        });
    }
    if (!isPlainObject(value)) fail("publish", "must be an object");
    const publish = /** @type {Record<string, unknown>} */ (value);
    rejectUnknownKeys(publish, PUBLISH_KEYS, "publish.");

    const manifestsInput = publish.manifests;
    if (manifestsInput !== undefined && !isPlainObject(manifestsInput)) {
        fail("publish.manifests", "must be an object");
    }
    const manifests = /** @type {Record<string, unknown>} */ (manifestsInput ?? {});
    rejectUnknownKeys(manifests, MANIFEST_KEYS, "publish.manifests.");

    const addressInput = publish.address;
    if (addressInput !== undefined && !isPlainObject(addressInput)) {
        fail("publish.address", "must be an object");
    }
    const address = /** @type {Record<string, unknown>} */ (addressInput ?? {});
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
        // which is exactly the site-absolute shape #1465 removed.
        fail("publish.address.prefix", "must not begin with a slash");
    }

    const landing =
        address.landing === undefined ?
            DEFAULT_ADDRESS_SCHEME.landing
        :   optionalString(address.landing, "publish.address.landing");
    if (!LANDING_RULES.includes(landing)) {
        fail("publish.address.landing", `must be one of ${LANDING_RULES.join(", ")}`);
    }

    return Object.freeze({
        site: normalizeSiteMode(publish.site),
        address: Object.freeze({ prefix, landing }),
        manifests: Object.freeze({
            publish: optionalBoolean(manifests.publish, "publish.manifests.publish", false),
            consume: optionalBoolean(manifests.consume, "publish.manifests.consume", false),
        }),
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

    if (!Array.isArray(input.packs)) fail("packs", "must be an array");
    if (input.packs.length === 0) fail("packs", "must declare at least one pack");
    const packs = input.packs.map((pack, index) => normalizePack(pack, `packs[${index}]`));

    // One list, so the compile order and the directory list cannot disagree —
    // they used to be `PACK_CONFIGS` and `SOURCE_PACKS`, maintained apart (#1508).
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

    // ── systems: declaring, and requiring, are separate decisions (#48) ──────
    const systems = normalizeSystems(input.systems);
    const requiresSystem = normalizeRequiresSystem(input.requiresSystem);
    const declaredSystems = new Set(Object.keys(systems));
    /** `relationships.systems`, for the derivations that still consult it. */
    const relationshipSystems = /** @type {{id?: string}[]} */ (
        (isPlainObject(input.relationships) ? input.relationships.systems : null) ?? []
    );

    // A name that resolves to nothing is a build error rather than a
    // fall-through, in the spirit the rest of this file already follows: a pack
    // stamping a system nobody declared would stamp `undefined`, which is the
    // plausible lie #43 was about.
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
        if (declaredSystems.size && !declaredSystems.has(pack.system)) {
            fail(
                `packs.${pack.name}.system`,
                `names \`${pack.system}\`, which \`systems:\` does not ` +
                    `declare. Declared: ${[...declaredSystems].join(", ")}`,
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
    // layout breaks every stored compendium UUID (#1566). What is not allowed
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

    const foundryPackage = requireNonEmptyString(input.foundryPackage, "foundryPackage");

    const { itemBuilders, itemArt, itemFields } = normalizeItemBuilders(input.itemBuilders);
    const itemTypes = Object.freeze(new Set(Object.keys(itemBuilders)));
    const docEntryTypes = Object.freeze(new Set([...itemTypes, "macro", ...MAP_TYPES]));

    return Object.freeze({
        rootDir,
        contentPackage: requireContentPackage(input.contentPackage, docEntryTypes),
        foundryPackage,
        packageKind: /** @type {PackageKind} */ (packageKind),
        // Foundry serves a package's files from `<kind>/<id>/`, so this is the
        // one place `systems/sohl` (or `modules/sohl-thalorna`) is spelled.
        assetRoot: `${packageKind}/${foundryPackage}/assets`,
        paths: normalizePaths(input.paths, rootDir),
        // The package-wide system, derived (#48). A **system** package is its
        // own system, which is true by construction and needs no declaration. A
        // **module** takes the one it requires, or the one system it declares
        // when there is exactly one; with several and no gate there is no
        // package-wide answer, and each pack carries its own.
        stats: normalizeStats(input.stats, {
            systemId:
                packageKind === "systems" ? foundryPackage
                : requiresSystem ? requiresSystem
                : Object.keys(systems).length === 1 ? Object.keys(systems)[0]
                    // A lone `relationships.systems` entry is a declaration of
                    // the system as much as a gate, so it still answers. That
                    // matters because the relationship carries `itemCatalog`
                    // too — a separate concern the split does not replace — so
                    // a repository using it would otherwise have to restate its
                    // compatibility under `systems:` purely to keep stamping,
                    // which is the duplication this whole change exists to
                    // remove. Several entries have no single answer and get
                    // none.
                : relationshipSystems.length === 1 ? (relationshipSystems[0]?.id ?? null)
                : null,
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
                        (Object.keys(systems).length === 1 ? Object.keys(systems)[0] : null);
                    return id ? (systems[id]?.compatibility?.verified ?? null) : null;
                })() ??
                (isPlainObject(input.stats) ? input.stats[DERIVED_SYSTEM_VERSION] : null) ??
                null,
        }),
        itemBuilders,
        itemArt,
        itemFields,
        // Resolved once, here, and read everywhere through
        // `loadPackConfig()`. The doc-entry *concept* is the engine's —
        // a note that carries documentation is not a SoHL idea — but the
        // membership is the consumer's, and there is exactly one resolved set at
        // runtime. Two would drift, which is the whole reason the composition
        // was written down in one place to begin with.
        itemTypes,
        docEntryTypes,
        skipDirectories: Object.freeze(skipDirectories),
        packs: Object.freeze(packs),
        packDirectories: Object.freeze(packDirectories),
        docs: normalizeDocs(input.docs),
        site: normalizeSite(input.site),
        compatibility: normalizeCompatibility(input.compatibility, "compatibility"),
        relationships: normalizeRelationships(input.relationships),
        systems,
        requiresSystem,
        packageBuild: normalizePackageBuild(input.packageBuild),
        publish: normalizePublish(input.publish),
    });
}
