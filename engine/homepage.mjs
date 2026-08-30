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
 * `shortcode` and `id` decide nothing on it — nothing here reads them, and
 * {@link HOMEPAGE_REFUSED_FIELDS} refuses them outright rather than leaving an
 * author to believe they worked (#53). It compiles into no document, so it carries
 * no compendium UUID and appears in no pack and in no link-manifest entry.
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
 * The top-level fields a homepage refuses, and what each one would decide (#53).
 *
 * A note's URL derives from `name.full` and its identity from
 * `(type, shortcode)`. The homepage is the one page for which neither holds: it
 * publishes at `/<package>/`, fixed by the package id. An author fluent in the
 * conventions writes them here expecting exactly what they do everywhere else,
 * and gets none of it.
 *
 * **They were never inert, which is why ignoring them was the wrong answer.** A
 * `shortcode` puts the note in the address index and in the `dataview` link
 * universe, so `[[homepage-<shortcode>]]` resolves *green* — to
 * `homepage/<slug>/`, an address derived from `name.full` and published by
 * nothing, because a homepage is written to {@link HOMEPAGE_DESTINATION} at the
 * package root. A build that reports a live link to a 404 is worse than one
 * that says nothing. It also inflates `content-build lint`'s address tally, so
 * the lint and the link manifest disagree about what the package publishes.
 *
 * **A named class, not an allow-list, and that boundary is the decision.** The
 * documented envelope is `type` plus an optional `title`, and `landing`,
 * `description` and `banner` are legitimate beside them — but a homepage's
 * frontmatter is *emitted into the published page*
 * ({@link homepageFrontmatter}), so an unrecognised key is a Hugo or theme
 * parameter this build has never heard of and has no standing to refuse.
 * Rejecting unknown keys would make every new theme parameter wait on a
 * package-build release. What is refused is the specific class that makes a
 * false claim about *where this page is*.
 *
 * `aliases` is deliberately not in the class: {@link homepageFrontmatter}
 * already drops it from every emitted page, with a reason of its own, so
 * authoring one is the same no-op it is on any other page rather than a wrong
 * belief about this one's address.
 *
 * @type {ReadonlyMap<string, string>}
 */
export const HOMEPAGE_REFUSED_FIELDS = Object.freeze(
    new Map([
        [
            "name",
            "`name` decides nothing on a `type: homepage` note: a page's slug " +
                "derives from `name.full`, and a homepage's destination is " +
                `fixed — it is written to \`${HOMEPAGE_DESTINATION}\` at the ` +
                "package's own address, `/<package>/`. Write `title:` for what " +
                "the page is called, and delete `name`",
        ],
        [
            "shortcode",
            "`shortcode` decides nothing on a `type: homepage` note: this " +
                "page's address is the package's own, `/<package>/`, fixed by " +
                "the package id. It is not ignored either — it puts the note " +
                "in the address index, so `[[homepage-<shortcode>]]` resolves " +
                "to a page the site build never writes. Delete it",
        ],
        [
            "id",
            "`id` decides nothing on a `type: homepage` note: it is the " +
                "Foundry document id a compendium UUID is built from, and a " +
                "homepage compiles into no document — it appears in no pack " +
                "and in no link manifest. Delete it",
        ],
    ]),
);

/**
 * The address-bearing fields one note authors, in the order it authored them.
 *
 * Authoring order rather than declaration order, so a caller emitting one
 * diagnostic per finding emits them top to bottom down the file — the order a
 * reader and a compiler-output parser both expect.
 *
 * Presence is the whole test: `shortcode:` authored empty still says "this page
 * has an address of its own", and a value cannot make the claim true.
 *
 * Returned without a locator, because the two things that would supply one —
 * the raw note text and the position helper — belong to the caller. This
 * mirrors {@link module:engine/retired-fields}, whose retired-field messages
 * are likewise positioned by whoever reports them.
 *
 * @param {object|null|undefined} fm - Parsed frontmatter.
 * @returns {Array<{key: string, message: string}>} One entry per field the note
 *   authored, empty for any note that is not a homepage.
 */
export function checkHomepageAddressFields(fm) {
    if (!isHomepage(fm)) return [];
    const out = [];
    for (const key of Object.keys(fm)) {
        const message = HOMEPAGE_REFUSED_FIELDS.get(key);
        if (message) out.push({ key, message });
    }
    return out;
}

/**
 * Require exactly one homepage note in a content tree (#52).
 *
 * "Exactly one" is two rules, and they are **one severity** because they are
 * one defect: a package whose front page is not the page a person chose.
 *
 * - _None_ and the package serves nothing at `/<package>/`. That is the failure
 *   #50 exists to prevent, and it is silent — the site build reports `wrote 0
 *   homepage(s)` and exits 0.
 * - _Two_ and it serves a page nobody chose. Every homepage is written to the
 *   same {@link HOMEPAGE_DESTINATION}, so the second overwrites the first and
 *   the package's front page is decided by the order the walk happened to reach
 *   the files in — by *filename*, on a type whose whole point is that it is
 *   routed by frontmatter. There is no "first wins" convention to fall back on,
 *   so nothing here can pick the right one.
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
        const others = pages
            .filter((p) => p !== page)
            .map((p) => formatLocator({ file: p.file }));
        return {
            file: page.file,
            ...positionOfType(page.file),
            severity: "error",
            message:
                `duplicate \`type: homepage\` note, also declared by ` +
                `${others.join(", ")}; a package has one front page` +
                `${contentPackage ? `, at${address},` : ""} and every ` +
                `homepage is written to the same \`${HOMEPAGE_DESTINATION}\` — ` +
                `so the one the walk reaches last silently overwrites the rest`,
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
        return positionInFrontmatter(
            fs.readFileSync(file, "utf8"),
            "type",
            HOMEPAGE_TYPE,
        );
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
