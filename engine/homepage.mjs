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
 * The package homepage — a note that compiles to a **page** rather than to a
 * compendium document (#51).
 *
 * Every HeroicLands package is reachable at `https://www.heroiclands.org/<contentPackage>/`,
 * and what a reader finds there is one markdown file in the content tree,
 * written by a person: what the module is, which system it needs, how to install
 * it, where its source lives. Nothing about it is derived.
 *
 * **Authored, not assembled.** An earlier sketch generated the page in tiers —
 * identity and licence from the manifest, install URL from the release address,
 * "requires" links from `relationships`, a card per configured section. It would
 * have worked and needed almost no authoring, and it produces a page nobody
 * chose the contents of. The things that matter most on these pages cannot be
 * derived: that Kethira requires buying the book from Keléstia, what Thalorna's
 * setting *is*, which of twenty sections a reader should start with. So the only
 * thing defaulted here is the title, from `packageBuild.manifest.title`, so that
 * the package's name is not written twice.
 *
 * **Dispatched by `type`, not by filename.** A fixed `homepage.md` the walker
 * special-cased would be the anomaly: notes are routed by frontmatter, not by
 * location, and `NOTE_SCHEMAS` already routes `doc`, `macro`, `being` and the
 * map types. `homepage` is one more entry whose compile step emits a page. It is
 * deliberately not `README.md`: `landing: readme` already means "a `README.md`
 * is its section's landing page", and `sohl-thalorna/assets/content/README.md`
 * is a developer explainer about the source tree — adopting that name would make
 * Thalorna's public front page its build documentation.
 *
 * **Engine, not `sohl/`.** The `engine/` ÷ `sohl/` line separates *note-format*
 * knowledge from *game-system* knowledge, and a homepage is note format: it
 * carries no `system` block, mirrors no item builder, and would mean the same
 * thing for a game system that is not SoHL. Reachability is the symptom that
 * makes it obvious — `HarnMaster-3-FoundryVTT` declares no `itemBuilders`, so a
 * type living in the SoHL registry would be unavailable to HM3 and to every HM3
 * module, which is most of the packages that need a homepage and nothing else.
 *
 * **Its address is the package's, not the note's.** A homepage publishes at
 * `/<contentPackage>/` because that is where the package is, so `name.full`,
 * `shortcode` and `id` decide nothing on it (#53 refuses them outright; this
 * module simply never reads them). It compiles into no document, so it carries
 * no compendium UUID and appears in no pack and in no link-manifest entry.
 *
 * @module
 */

/**
 * The note type that compiles to the package homepage.
 *
 * @type {string}
 */
export const HOMEPAGE_TYPE = "homepage";

/**
 * What a homepage note may write under `sohl:` — nothing.
 *
 * Empty on purpose, and declared rather than omitted: a type with no vocabulary
 * and a type that is unknown are different findings, and only the second is an
 * authoring error. The whole envelope is the two top-level keys `type` and an
 * optional `title`; there is no game-system data on a page that compiles to no
 * document.
 *
 * @type {readonly import("./field-spec.mjs").FieldSpec[]}
 */
export const HOMEPAGE_FIELDS = Object.freeze([]);

/**
 * Where a homepage is written, relative to the package's site root.
 *
 * Hugo's section landing, because the page *is* the package's landing: the
 * package root is a section and this is its index.
 *
 * @type {string}
 */
export const HOMEPAGE_DESTINATION = "_index.md";

/**
 * Whether a note's frontmatter declares the homepage type.
 *
 * @param {object|null|undefined} fm - Parsed frontmatter.
 * @returns {boolean} Whether it is a homepage note.
 */
export function isHomepage(fm) {
    return Boolean(fm) && fm.type === HOMEPAGE_TYPE;
}

/**
 * The title a homepage publishes under.
 *
 * The one defaulted value on the page, and it defaults to the package's own
 * `packageBuild.manifest.title` — the name Foundry already shows for the
 * package — so a homepage that adds nothing to it need not restate it. An
 * authored `title` wins, because a front page is allowed to greet a reader
 * differently from a package browser.
 *
 * Falls back to `contentPackage` last, so a package that has no manifest of its
 * own still yields a titled page rather than a blank heading.
 *
 * @param {object|null|undefined} fm - The note's frontmatter.
 * @param {object} config - The resolved configuration.
 * @returns {string} The title.
 */
export function homepageTitle(fm, config) {
    const authored = fm?.title;
    if (typeof authored === "string" && authored.trim()) return authored;
    const manifest = /** @type {Record<string, unknown>|undefined} */ (
        config?.packageBuild?.manifest
    );
    const title = manifest?.title;
    return typeof title === "string" && title.trim() ?
            title
        :   config.contentPackage;
}

/**
 * The frontmatter a homepage publishes with.
 *
 * The note's own, plus the two derived values every emitted page carries: the
 * resolved `title`, and the package the build derived — no note declares one
 * (`package:` is retired, #56) and the theme's breadcrumb partial reads
 * `.Params.package`.
 *
 * An authored `aliases` is dropped for the same reason it is on every other
 * page: Obsidian reads it as names a reader might call the note, Hugo reads it
 * as URL redirects, and passing it through would publish a redirect stub at
 * each one.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {object} options - Options.
 * @param {string} options.contentPackage - The package this build publishes.
 * @param {string} options.title - The resolved title.
 * @returns {object} The frontmatter to write.
 */
export function homepageFrontmatter(fm, { contentPackage, title }) {
    const data = { ...fm, package: contentPackage, title };
    delete data.aliases;
    return data;
}
