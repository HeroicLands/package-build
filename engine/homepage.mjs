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

import { matchAllOutsideCode } from "./code-fences.mjs";

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

/**
 * An inline markdown link — `[text](target)`, but not an image.
 *
 * Reference-style links are deliberately not matched: a landing's prose fields
 * are single YAML scalars with nowhere to put a link definition, so a `[x][y]`
 * in one could never resolve and is not an address anybody wrote.
 *
 * @type {RegExp}
 */
const MARKDOWN_LINK = /(?<!!)\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

/**
 * The two frontmatter keys that hold an address, and what each one means.
 *
 * They are **not** interchangeable, and a check that treated them as one would
 * be wrong about both. The theme resolves a `url` against the site with
 * `relURL`, so a package writes `kb/rules/` and is served `/sohl/kb/rules/`
 * without ever naming its own prefix. An `href` is an address that is *already*
 * resolved and is used verbatim — which is what `cards.source: sections` fills
 * in, since a section's permalink already carries the prefix.
 *
 * So a leading `/` is a defect in a `url` (it is prefixed a second time) and
 * correct in an `href`.
 *
 * @type {ReadonlySet<string>}
 */
export const HOMEPAGE_ADDRESS_KEYS = Object.freeze(new Set(["url", "href"]));

/**
 * Collect the markdown links in one prose value.
 *
 * @param {string} text - The value.
 * @param {string} field - Where it came from.
 * @param {string} kind - The address kind to record.
 * @param {object[]} out - Accumulator.
 * @param {boolean} [skipCode] - Whether to ignore links inside code.
 */
function collectProse(text, field, kind, out, skipCode = false) {
    const pattern = new RegExp(MARKDOWN_LINK.source, "g");
    const matches =
        skipCode ?
            matchAllOutsideCode(text, pattern)
        :   [...text.matchAll(pattern)];
    for (const m of matches) out.push({ field, url: m[1], kind });
}

/**
 * Every address a homepage carries, wherever it is written.
 *
 * **Both halves of the page are in scope, and that is the finding rather than
 * the assumption.** Of the six homepages authored today, four carry every link
 * in the body as ordinary markdown and two carry them in `landing:` — and the
 * one whose dead links prompted the check has an *empty body*, so a body-only
 * reading would have found nothing at all on it. A dead link in a card is
 * exactly as broken as one in a paragraph.
 *
 * Three shapes are gathered, and the caller needs to tell them apart because
 * the rules differ:
 *
 * - **`url`** — package-relative, resolved against the site by the theme.
 * - **`href`** — already resolved, used verbatim.
 * - **prose and body markdown links** — emitted as written and resolved by the
 *   browser against the landing's own address, which *is* the package root, so
 *   a relative one means the same thing a `url` does.
 *
 * `banner:` is not an address: it is an image path resolved through the CDN
 * base, and `banner: none` is a sentinel rather than a target. Top-level
 * `title` and `description` are not walked either — they are set as text, never
 * rendered as markdown.
 *
 * @param {object|null|undefined} fm - The note's frontmatter.
 * @param {string} [body] - The note's markdown body.
 * @returns {Array<{field: string, url: string, kind: string}>} Every address,
 *   frontmatter first and then the body, each with the dotted path it was
 *   written at.
 */
export function homepageAddresses(fm, body = "") {
    const out = [];

    const walk = (value, field) => {
        if (typeof value === "string") {
            collectProse(value, field, "prose", out);
            return;
        }
        if (Array.isArray(value)) {
            value.forEach((v, i) => walk(v, `${field}[${i}]`));
            return;
        }
        if (!value || typeof value !== "object") return;
        for (const [key, v] of Object.entries(value)) {
            const child = `${field}.${key}`;
            // An address field holds an address, not prose: reading it for
            // markdown links as well would report the same target twice
            // whenever one happened to look like a link.
            if (HOMEPAGE_ADDRESS_KEYS.has(key) && typeof v === "string") {
                out.push({ field: child, url: v, kind: key });
                continue;
            }
            walk(v, child);
        }
    };

    walk(fm?.landing, "landing");
    collectProse(String(body ?? ""), "body", "body", out, true);
    return out;
}
