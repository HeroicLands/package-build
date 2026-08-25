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
 * The prose conventions every content repository writes to — one Prettier
 * configuration and one markdownlint rule set, declared here so a note
 * formatted in one repository is formatted the same way in the next (#69).
 *
 * These used to exist in exactly one consumer. The SoHL repository carried
 * both; `sohl-thalorna` had Prettier but never ran it from `lint`; and
 * `sohl-kethira-basic` had neither, so the package least likely to have been
 * proofread was checked for addresses and nothing else. A rule set copied into
 * three repositories is one rule with three implementations, which is the drift
 * #20 exists to remove — so it is declared once, here, and every consumer
 * invokes it.
 *
 * **Neither of these is an override.** A consumer that declares its own
 * Prettier config or its own `.markdownlint-cli2.jsonc` wins; what ships here
 * is the default a repository gets for declaring nothing. Repository *layout*
 * knowledge — which paths to skip — stays with the repository that has the
 * layout, in its own ignore files.
 *
 * @module
 */

/**
 * The Prettier options every content repository shares, before any per-language
 * adjustment.
 *
 * The values are not arbitrary: they are the ones the SoHL repository has
 * always used, kept identical here so a module or a note moving between
 * repositories does not reformat on arrival. Changing one of these reformats
 * every consumer, so treat it as a breaking change to the shared tree rather
 * than a preference.
 *
 * @type {Readonly<object>}
 */
export const PRETTIER_BASE = Object.freeze({
    printWidth: 80,
    tabWidth: 4,
    useTabs: false,
    semi: true,
    singleQuote: false,
    quoteProps: "as-needed",
    trailingComma: "all",
    bracketSpacing: true,
    bracketSameLine: true,
    arrowParens: "always",
    endOfLine: "lf",
    experimentalTernaries: true,
});

/**
 * What markdown gets on top of {@link PRETTIER_BASE}.
 *
 * Markdown indents at 2, not the global 4. Notes are the thing several
 * repositories exchange, so their indentation is the one value that most needs
 * to be the same everywhere — a note's YAML frontmatter is nested lists, and at
 * 4 every note reindents away from the form it was written in.
 *
 * **Declared apart from the `overrides` block, not derived from it.** Prettier
 * applies `overrides` only while resolving a config *file*; options handed to
 * it directly keep the global values, so a consumer with no config of its own
 * silently got markdown at 4 (#76). The runner needs the adjustment as data it
 * can apply itself, and {@link PRETTIER_CONFIG} composes the same values into
 * the shape a config file wants — one source, two presentations.
 *
 * @type {Readonly<object>}
 */
export const PRETTIER_MARKDOWN = Object.freeze({ tabWidth: 2 });

/**
 * The shared configuration in the shape a Prettier **config file** takes.
 *
 * This is what a consumer's `prettier.config.mjs` re-exports, and it is the
 * form in which the markdown adjustment works: resolved from the consumer's own
 * root, `**\/*.md` matches that repository's markdown. Shipped from inside
 * `node_modules` it would match nothing, because Prettier resolves an
 * override's glob relative to the config file's own directory — which is why
 * the runner applies {@link PRETTIER_MARKDOWN} itself rather than pointing
 * Prettier at this file.
 *
 * @type {Readonly<object>}
 */
export const PRETTIER_CONFIG = Object.freeze({
    ...PRETTIER_BASE,
    overrides: Object.freeze([
        Object.freeze({
            files: "**/*.md",
            options: PRETTIER_MARKDOWN,
        }),
    ]),
});

/**
 * The shared options for one file, with the per-language adjustment applied.
 *
 * What a consumer's own Prettier config would have produced, for a repository
 * that declares none.
 *
 * @param {string} file - Path of the file about to be formatted.
 * @returns {object} Options to hand Prettier directly. Never carries
 *   `overrides`: passing that inline is what silently did nothing (#76).
 */
export function sharedPrettierOptionsFor(file) {
    return /\.md$/i.test(file) ?
            { ...PRETTIER_BASE, ...PRETTIER_MARKDOWN }
        :   { ...PRETTIER_BASE };
}

/**
 * The markdownlint rules — the structural checks Prettier cannot make.
 *
 * Prettier already formats every hand-written `.md` file, and it is indifferent
 * to structure: it will happily reformat a document whose heading levels skip
 * from h3 to h5, whose two sibling sections claim the same anchor, or whose
 * link is `(text)[url]`. Those are the defects this set is for.
 *
 * **THE RULE SET IS DELIBERATELY NARROW, and stays that way on purpose.**
 * Turning on markdownlint's defaults over a content tree produces tens of
 * thousands of findings, almost all of them line length, list indentation and
 * blank-line placement — Prettier's territory, or a second formatter's taste
 * imposed on prose it already owns. So `default` is off and each rule below is
 * enabled by name, with the reason it earns its place. Add a rule only if it
 * can report that a page is *wrong*.
 *
 * @type {Readonly<object>}
 */
export const MARKDOWNLINT_CONFIG = Object.freeze({
    default: false,

    /* ── Document structure ─────────────────────────────────────────────── */

    // MD001 — heading levels increment by one. A skipped level (h3 → h5) breaks
    // the outline every consumer derives from it: a knowledgebase's on-page
    // table of contents, a section nav, and the reading order of a page nobody
    // re-reads top to bottom.
    MD001: true,

    // MD024 — no duplicate sibling headings. Two identical headings under one
    // parent generate two identical anchors and the second is unreachable, so a
    // `#fragment` link silently lands on the wrong section. Content notes link
    // by anchor everywhere and this package validates those links, which cannot
    // help when the anchor exists but points at the wrong one of two.
    //
    // `siblings_only` is what makes the rule usable: repeating "## Notes" under
    // each of several parents is a normal shape for a reference page, and only
    // a repeat within one parent is ambiguous.
    MD024: Object.freeze({ siblings_only: true }),

    // MD056 — every table row has the column count its header declares. A row
    // with too few or too many cells renders as a broken table, and the failure
    // is invisible in the source.
    MD056: true,

    /* ── Links that do not link ─────────────────────────────────────────── */

    // MD011 — reversed link syntax: `(text)[url]` renders as literal text with
    // no link at all. A pure typo class, and easy to miss in review.
    MD011: true,

    // MD034 — no bare URLs. Whether a bare URL becomes a link depends on the
    // renderer, and this content is rendered by three of them (Hugo/goldmark
    // for a knowledgebase, Foundry's own markdown for compendium journals, and
    // GitHub for the repository pages). Writing the link explicitly is the only
    // form that renders the same everywhere.
    MD034: true,

    // MD039 — no spaces inside link text. `[ Skills ](url)` carries the spaces
    // into the rendered anchor, which shows up as a stray underline and as a
    // mismatched link title in any index built from it.
    MD039: true,

    // MD042 — no empty links. `[Skills]()` renders as a dead anchor that looks
    // exactly like a working one.
    MD042: true,

    // MD052 / MD053 — reference links resolve, and definitions are used. An
    // undefined reference renders as literal `[text][ref]` brackets; an orphaned
    // definition is a link someone meant to make and did not.
    MD052: true,
    MD053: true,

    /* ── Emphasis markers ───────────────────────────────────────────────── */

    // MD049 / MD050 — one marker for each kind of emphasis: `_emphasis_` and
    // `**strong**`. Both are style rules rather than correctness ones, and both
    // are already satisfied wherever Prettier runs, because Prettier normalises
    // to exactly this pair. That is the point of enabling them: the convention
    // otherwise holds as a *side effect* of the formatter's default, so it would
    // lapse silently if that default changed or a path were added to an ignore
    // file. Stated here, it is a decision rather than an accident — and it is
    // the one rule a repository with no Prettier in its lint chain was missing
    // entirely.
    //
    // Note for anyone reading rendered output: neither marker is an underline.
    // Markdown has no underline; `_x_` and `*x*` both mean emphasis, and the
    // choice between them is purely which one these repositories write.
    MD049: Object.freeze({ style: "underscore" }),
    MD050: Object.freeze({ style: "asterisk" }),
});

/**
 * The globs `content-build markdown` checks when a consumer names no paths.
 *
 * Every markdown file the repository tracks, which is what a consumer means by
 * "lint my markdown". What to *skip* is the repository's own business and comes
 * from its `.gitignore` (honoured by default) and its own configuration.
 *
 * @type {readonly string[]}
 */
export const MARKDOWN_GLOBS = Object.freeze(["**/*.md"]);

/**
 * Markdown every consumer has and nobody hand-writes.
 *
 * `CHANGELOG.md` is assembled by `changeset version` from the `.changeset/*.md`
 * bodies on every release. It is not in anyone's `.gitignore` — it is
 * committed — so nothing else excludes it, and linting it reports on the
 * generator: the findings are real (a heading level changesets chose, an
 * asterisk it emitted) and unfixable, because the next release rewrites the
 * file. Every repository here releases through changesets, so this is a fact
 * about the shared toolchain rather than any one repository's layout, and it
 * belongs in the default instead of being rediscovered three times.
 *
 * @type {readonly string[]}
 */
export const MARKDOWN_IGNORES = Object.freeze(["CHANGELOG.md"]);
