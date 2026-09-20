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
 * compendium document.
 *
 * Every HeroicLands package is reachable at `https://www.heroiclands.org/<contentPackage>/`,
 * and what a reader finds there is one markdown file in the content tree,
 * written by a person: what the module is, which system it needs, how to install
 * it, where its source lives. Nothing about it is derived.
 *
 * **Authored, not assembled.** The things that matter most on a front page
 * cannot be derived: that Kethira requires buying the book from Keléstia, what
 * Thalorna's setting *is*, which of twenty pages a reader should start with. So
 * the only thing defaulted here is the title, from `packageBuild.manifest.title`,
 * so that the package's name is not written twice. Everything else is the body,
 * which is why a `landing:` card block is refused: the homepage is a page with a
 * body, rendered as one, and an index of what the package publishes is a `doc`
 * note carrying a content table.
 *
 * **Dispatched by `type`, not by filename.** A fixed `homepage.md` the walker
 * special-cased would be the anomaly: notes are routed by frontmatter, not by
 * location, and `NOTE_SCHEMAS` already routes `doc`, `macro`, `being` and the
 * map types. `homepage` is one more entry whose compile step emits a page.
 *
 * **Engine, not `sohl/`.** The `engine/` ÷ `sohl/` line separates *note-format*
 * knowledge from *game-system* knowledge, and a homepage is note format: it
 * carries no `system` block, mirrors no item builder, and would mean the same
 * thing for a game system that is not SoHL. Reachability is the symptom that
 * makes it obvious — `HarnMaster-3-FoundryVTT` declares no `itemBuilders`, so a
 * type living in the SoHL registry would be unavailable to HM3 and to every HM3
 * module, which is most of the packages that need a homepage and nothing else.
 *
 * **Published at the package root, addressed like every other note.** A
 * homepage is written as the mount's `_index.md`, so Hugo's `home` kind renders
 * it at `/<package>/` — the address a reader expects a package's front page at,
 * and the one `package.json`'s `homepage` states. It still declares a
 * `shortcode` — conventionally {@link HOMEPAGE_SHORTCODE} — because that is what
 * a link is written with: `[[homepage-root|Text]]` is an ordinary wikilink, and
 * it resolves to `/<package>/`. The shortcode names the page in links; the
 * address is the package root.
 *
 * `id` is refused, on its own ground: a homepage compiles into no document, so
 * it carries no compendium UUID and appears in no pack and in no link-manifest
 * entry.
 *
 * @module
 */

import fs from "node:fs";

import { matchAllOutsideCode } from "./code-fences.mjs";
import { formatLocator, positionInFrontmatter } from "./diagnostics.mjs";

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
 * authoring error. The whole envelope is the top-level keys `type` and
 * `shortcode`, plus an optional `title` or `name`; there is no game-system data
 * on a page that compiles to no document.
 *
 * @type {readonly import("./field-spec.mjs").FieldSpec[]}
 */
export const HOMEPAGE_FIELDS = Object.freeze([]);

/**
 * The shortcode a package landing conventionally takes.
 *
 * A **convention, not a rule.** The address only has to be unique within the
 * package, which `(type, shortcode)` already guarantees, and nothing here knows
 * better than an author what their landing is called. What the constant buys is
 * one spelling shared by the diagnostic, the documentation and the six trees —
 * so `[[homepage-root|…]]` is the same link in every package.
 *
 * @type {string}
 */
export const HOMEPAGE_SHORTCODE = "root";

/**
 * The file a homepage is written to, relative to the package's site root.
 *
 * The mount's own `_index.md`: Hugo renders it as the `home` kind, at
 * `baseURL` — which is `/<package>/`, the package's own address. One fixed
 * destination rather than one derived from the note's address, because the
 * homepage's address *is* the package root; the note's `shortcode` names the
 * page in links and decides no file.
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
 * The top-level fields a homepage refuses, and what each would decide.
 *
 * `id` is the Foundry document id a compendium UUID is built from, and a
 * homepage compiles into no document. `landing` is a card block; the homepage
 * is a page with a body, rendered as one, so nothing reads it — and an index
 * of what the package publishes is a `doc` note carrying a content table,
 * authored where every other page is.
 *
 * `name` and `shortcode` are permitted: the shortcode is what a link is
 * written with, and `name` titles the page like every other note's.
 *
 * **A named class, not an allow-list, and that boundary is the decision.** A
 * homepage's frontmatter is *emitted into the published page*
 * ({@link homepageFrontmatter}), so an unrecognised key is a Hugo or theme
 * parameter this build has never heard of and has no standing to refuse.
 * Rejecting unknown keys would make every new theme parameter wait on a
 * package-build release.
 *
 * `aliases` is deliberately not in the class: it is a **retired** field, refused
 * on every note whatever its type, so it is answered there rather than
 * here.
 *
 * @type {ReadonlyMap<string, string>}
 */
export const HOMEPAGE_REFUSED_FIELDS = Object.freeze(
    new Map([
        [
            "id",
            "`id` decides nothing on a `type: homepage` note: it is the " +
                "Foundry document id a compendium UUID is built from, and a " +
                "homepage compiles into no document — it appears in no pack " +
                "and in no link manifest. Delete it",
        ],
        [
            "landing",
            "`landing` decides nothing on a `type: homepage` note: the homepage " +
                "is a page with a body, rendered as one, and no card block is " +
                "read off it. Write the page's links in its body, and author an " +
                "index of what the package publishes as a `doc` note carrying a " +
                "content table. Delete it",
        ],
    ]),
);

/**
 * What the address rule says about one note's top-level fields.
 *
 * Two statements about the same thing, so they are made together: the field a
 * homepage **owes** and the fields it may **not** write.
 *
 * The missing `shortcode` comes first, and is located at `type:` rather than at
 * a key that is not there — the `homepage` value is what makes the field
 * required, it is a real position in the file, and inventing a `1:1` for an
 * absent key would put the author on the opening fence. The refused fields
 * follow in the order the note authored them, so a caller emitting one
 * diagnostic per finding walks down the file.
 *
 * Presence is the whole test for a refused field, and absence-or-blank for the
 * required one: `shortcode:` authored empty is no address, and no value can
 * make `id` or `landing` mean something on a page that compiles to no document
 * and renders as its body.
 *
 * Each finding carries the `locator` key to position it at, because the two
 * things that would resolve one — the raw note text and the position helper —
 * belong to the caller. This mirrors {@link module:engine/retired-fields},
 * whose retired-field messages are likewise positioned by whoever reports them.
 *
 * **A refused field must be one the note *wrote*.** `resolveNoteId` fills
 * `fm.id` **in place** so every downstream reader sees one derived value —
 * deliberately, and documented as such — and this ran over the same object, so
 * a homepage that authors no `id` was told to delete one that is not there.
 * Since the caller already owns the raw note text, it also answers
 * which keys the note actually declared; without an answer every key in `fm`
 * counts, which is the old behaviour and right for a caller holding authored
 * frontmatter only.
 *
 * @param {object|null|undefined} fm - Parsed frontmatter.
 * @param {object} [options] - Options.
 * @param {(key: string) => boolean} [options.isAuthored] - Whether the note
 *   declares this key at its own top level. Defaults to "every key in `fm`".
 * @returns {Array<{field: string, locator: {key: string, literal?: string},
 *   message: string}>} One entry per finding, empty for any note that is not a
 *   homepage and declares nothing wrong.
 */
export function checkHomepageAddressFields(fm, { isAuthored } = {}) {
    if (!isHomepage(fm)) return [];
    const out = [];

    const shortcode = typeof fm.shortcode === "string" ? fm.shortcode.trim() : "";
    if (!shortcode) {
        out.push({
            field: "shortcode",
            locator: { key: "type", literal: HOMEPAGE_TYPE },
            message:
                "a `type: homepage` note declares a `shortcode`, like every " +
                "other note: it is addressed as `homepage-<shortcode>`, which " +
                "is what `[[homepage-<shortcode>|Text]]` is written with to " +
                "reach the package's front page at `/<package>/`. Write " +
                `\`shortcode: ${HOMEPAGE_SHORTCODE}\` — the front page is ` +
                `\`homepage-${HOMEPAGE_SHORTCODE}\` in every package`,
        });
    }

    for (const key of Object.keys(fm)) {
        const message = HOMEPAGE_REFUSED_FIELDS.get(key);
        if (!message) continue;
        if (isAuthored && !isAuthored(key)) continue;
        out.push({ field: key, locator: { key }, message });
    }
    return out;
}

/**
 * Require exactly one homepage note in a content tree.
 *
 * "Exactly one" is two rules, and they are **one severity** because they are
 * one defect: a package whose front page is not the page a person chose.
 *
 * - _None_ and the package serves nothing at `/<package>/`. That is the failure
 *   this exists to prevent, and it is silent — the site build reports `wrote 0
 *   homepage(s)` and exits 0.
 * - _Two_ and it serves a page nobody chose. **This is a cardinality rule, and
 *   only that.** Both are written to the mount's `_index.md`, so the second
 *   silently overwrites the first; the duplicate-address check catches only
 *   the pair that happen to share a shortcode, and says nothing at all about
 *   a `homepage-root` beside a `homepage-front`. Which of the two should be
 *   the front page is a question nothing here can answer.
 *
 * Neither has a safe default, so neither is a warning. A warning is the right
 * severity for something a build can proceed past correctly, and a build that
 * proceeds past either of these publishes the wrong front page while reporting
 * success — which is the exact outcome a warning would be tolerating.
 *
 * **Two is reported once per note, not once for the tree.** Each note is a
 * place an author has to open and edit, and a single finding saying "there are
 * two" sends them hunting for the second.
 *
 * **None is located at the tree, honestly.** There is no file to name, so the
 * locator is the content root — the directory the note is missing from, which
 * is a real path and the one the author adds it to. No line and no column are
 * invented for it, per the diagnostic rules in
 * {@link module:engine/diagnostics}. {@link lintContentTree} already reports an
 * empty walk against the same locator.
 *
 * The rule reads no `site:` configuration and does not vary by
 * `publish.site`: that setting chooses whether the *content* surfaces are
 * published, and the homepage is the floor underneath both modes.
 *
 * @param {ReadonlyArray<{file: string}>} found - The homepage notes, in walk
 *   order. Paths may be absolute or relative to the working directory.
 * @param {object} options - Options.
 * @param {string} options.contentBase - Root of the content tree, for the
 *   locator when there is no file to name.
 * @param {string} [options.contentPackage] - The package this tree builds.
 *   Dropped from the message when unknown rather than guessed.
 * @returns {Array<{file: string, line?: number, column?: number,
 *   severity: "error", message: string}>} The findings, one per offending note.
 */
export function checkHomepageCount(found, { contentBase, contentPackage }) {
    const pages = found ?? [];
    const named = contentPackage ? ` "${contentPackage}"` : "";
    const address = contentPackage ? ` /${contentPackage}/` : "";

    if (pages.length === 0) {
        return [
            {
                file: contentBase,
                severity: "error",
                message:
                    `holds no \`type: homepage\` note, so ` +
                    `${contentPackage ? `package${named}` : "this package"} ` +
                    `publishes nothing at its own address${address} — a ` +
                    `package's front page is one authored note in this tree, ` +
                    `routed by \`type:\` rather than by filename`,
            },
        ];
    }
    if (pages.length === 1) return [];

    return pages.map((page) => {
        const others = pages.filter((p) => p !== page).map((p) => formatLocator({ file: p.file }));
        return {
            file: page.file,
            ...positionOfType(page.file),
            severity: "error",
            message:
                `duplicate \`type: homepage\` note, also declared by ` +
                `${others.join(", ")}; a package has one front page` +
                `${contentPackage ? `, at${address}` : ""}, and nothing here ` +
                `can say which of these it should be. Keep one, and make the ` +
                `rest ordinary notes`,
        };
    });
}

/**
 * Where a note declares `type: homepage`, when the file can still be read.
 *
 * A separate read rather than a raw text threaded through every caller: the
 * two call sites hold different shapes (a lint note, a collected page) and this
 * runs only on a tree that is already failing.
 *
 * @param {string} file - Path to the note.
 * @returns {{line?: number, column?: number}} Spreadable position fields, empty
 *   when the file cannot be read — dropped rather than guessed.
 */
function positionOfType(file) {
    try {
        return positionInFrontmatter(fs.readFileSync(file, "utf8"), "type", HOMEPAGE_TYPE);
    } catch {
        return {};
    }
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
    return typeof title === "string" && title.trim() ? title : config.contentPackage;
}

/**
 * The frontmatter a homepage publishes with.
 *
 * The note's own, plus the two derived values every emitted page carries: the
 * resolved `title`, and the package the build derived — no note declares one
 * (`package:` is retired) and the theme's breadcrumb partial reads
 * `.Params.package`.
 *
 * **No `url` and no `slug`.** Hugo publishes the `home` kind at `baseURL`,
 * whose path is already where the package is served, so the page has no
 * address to state; a content page states one because its file sits under the
 * mount and its address does not.
 *
 * An authored `aliases` is dropped for the same reason it is on every other
 * page: Hugo reads it as URL redirects, so passing it through would publish a
 * redirect stub at each one. The field is retired and refused before a
 * build reaches here, which makes this a guard rather than a working path.
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
 * Reference-style links are deliberately not matched: a homepage is published
 * verbatim, so a `[x][y]` whose definition sits in the body reaches the reader
 * as Hugo renders it, and one whose definition is missing is a defect the
 * rendered page shows for itself.
 *
 * @type {RegExp}
 */
const MARKDOWN_LINK = /(?<!!)\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

/**
 * Every address a homepage carries: the markdown links in its body.
 *
 * Nowhere else: the frontmatter holds no address, because a homepage is a
 * page with a body and the card block that once carried links is refused.
 * Top-level `title` and `description` are not walked — they are set as text,
 * never rendered as markdown — and `banner:` is not an address: it is an image
 * path resolved through the CDN base, and `banner: none` is a sentinel rather
 * than a target.
 *
 * A body link is emitted as written and resolved by the browser against the
 * homepage's own address, which *is* the package root, so a package-relative
 * one (`kb/rules/`) lands where a reader expects.
 *
 * Links inside code are ignored, so an example in a fenced block is not
 * reported as a dead address.
 *
 * @param {string} [body] - The note's markdown body.
 * @returns {Array<{field: string, url: string, kind: string}>} Every address,
 *   in body order, each recorded at `field: "body"` with `kind: "body"`.
 */
export function homepageAddresses(body = "") {
    const out = [];
    const pattern = new RegExp(MARKDOWN_LINK.source, "g");
    for (const m of matchAllOutsideCode(String(body ?? ""), pattern)) {
        out.push({ field: "body", url: m[1], kind: "body" });
    }
    return out;
}
