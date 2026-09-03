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
 * Wikilink resolution for the knowledgebase build.
 *
 * The same authored links the pack compilers turn into Foundry `@UUID` enrichers
 * (see `./wikilinks.mjs`) become site-local hrefs here:
 *
 *   `[[type-shortcode|Text]]`       → `[Text](/section/slug/)`
 *   `[[type-shortcode|]]`           → the same, showing the target's own name
 *   `[[type-shortcode#slug|Text]]`  → `[Text](/section/slug/#slug)`
 *   `[[#slug|Text]]`                → `[Text](#slug)`
 *
 * **Every link is an address and carries a label** (#180). One written without
 * a label addresses nothing and is reported — see
 * {@link unlabelledLinkMessage}, which states the rule for this build and the
 * pack build together.
 *
 * The KB *section* is not always the type: prose pages (`type: doc`) route by
 * their `category`, so `doc/quickstart` lands on `/user-guide/sohl-quickstart/`.
 * The caller supplies that mapping already resolved, in the index it builds.
 *
 * Lives here rather than in a consumer so every package resolves a link the
 * same way. `sohl-thalorna` carried a forked copy of this as
 * `utils/site-wikilinks.mjs`, already 3 KB adrift from the original, which is
 * exactly the drift one rule with two implementations produces (#20).
 */

// How an address *parses* is the pack build's own rule, so the two builds
// cannot drift apart on it: they disagreed once over the unlabelled hyphen
// form, which the packs showed as a raw shortcode and the knowledgebase as a
// name (#1409).
import { readQualifier } from "./wikilinks.mjs";
import { replaceOutsideCode } from "./code-fences.mjs";
// The canonical `package-type-shortcode` key, so a package-qualified address
// is looked up the way a vendored manifest publishes it.
import { canonicalKey } from "./kb-manifest.mjs";
// The one rule about a link's shape both builds share: it carries a label, and
// {@link unlabelledLinkMessage} is the one place that says so (#180).
import { unlabelledLinkMessage } from "./wikilink-syntax.mjs";
// One slug rule for the whole build — see `./content-slug.mjs`. This module
// carried a copy that dropped non-ASCII letters rather than transliterating
// them, so a link to a heading named `Kûrbúl Helm` pointed at `#k-rb-l-helm`.
import { slugify } from "./content-slug.mjs";

// Re-exported so a site build keeps one import path for the whole of link
// resolution: the same rule that names a page also names an anchor within it.
export { slugify };
import { authoredLabel, WIKILINK, isSamePage, parseWikilink } from "./wikilink-syntax.mjs";

/** KB heading/anchor slug: lowercase, non-alphanumerics to single hyphens. */

/**
 * The index key a **piped** target resolves to, or `null` when it does not
 * parse as an address at all.
 *
 * The KB index is keyed by the canonical `type/shortcode`, so a target written
 * in the hyphen separator — which is what the content tree authors (#1398) —
 * has to be rewritten to it before lookup. Uses the pack build's own
 * {@link readQualifier}, so recognising an address and resolving one can never
 * disagree: the two separators and the optional leading package segment are
 * stated once, there.
 *
 * The build indexes an item note under both `skill/climb` and `docskill/climb`,
 * and `contentTypes` carries both qualifiers, so either form finds the page.
 *
 * @param {string} target - The link target, anchor already removed.
 * @param {Set<string>} [contentTypes] - Every content type the KB build saw.
 * @param {Set<string>} [packages] - Every package an address may name.
 * @returns {string | null} The index key, or `null` when not an address.
 */
function qualifiedKey(target, contentTypes, packages) {
    const read = readQualifier(target, contentTypes ?? new Set(), packages);
    if (!read || read.reason) return null;
    // A package-qualified address keeps its package: the canonical key is what
    // a vendored manifest publishes, and dropping the segment would resolve
    // another package's address against this one's short key.
    return read.package ?
            canonicalKey(read.package, read.type, read.shortcode)
        :   `${read.type}/${read.shortcode}`.toLowerCase();
}

/**
 * How an **unresolved** link renders.
 *
 * The author's text is kept, so the sentence still reads — dropping it would
 * silently rewrite the prose. It is marked so a reader can tell that something
 * was meant to be a link, and an author can find it: the appearance lives in
 * `scss/components/_unresolved-link.scss` for Foundry and in the Hugo theme for
 * the website, not here.
 *
 * This is deliberately identical to the pack compiler's own `unresolvedLink`,
 * down to the class name and the `title` wording. One authored link renders on
 * two surfaces, and the two builds have drifted before over exactly this kind
 * of detail (#1409) — matching markup is what keeps a reader's cue the same in
 * a journal and on the page. Duplicated rather than imported only because the
 * function is not exported from `@heroiclands/package-build`; hoisting it there
 * is HeroicLands/content-build#13.
 *
 * The knowledgebase renders with `unsafe = true` (`kb/hugo.toml`), so raw HTML
 * in generated markdown reaches the page. That makes escaping obligatory: this
 * is the one path where *authored* text becomes markup rather than content.
 *
 * @param {string} text - The text to show, from the link's label or target.
 * @param {string} target - The address that resolved nowhere, for the tooltip.
 * @returns {string} An inline HTML span, safe to sit in a markdown table cell.
 */
function unresolvedLink(text, target) {
    const esc = (v) =>
        String(v)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    return (
        `<span class="sohl-unresolved-link" title="Unresolved link: ` +
        `${esc(target)}">${esc(text)}</span>`
    );
}

/**
 * A wikilink, as it is written, anywhere in a value that is not markdown.
 *
 * Deliberately its own pattern rather than the body resolver's: nothing here is
 * markdown, so there is no fence or code span to step around, and a frontmatter
 * value is a single line by construction (`[^\]\n]` keeps a runaway match from
 * swallowing the rest of a folded scalar).
 */
// The same syntax the body scan reads — see `./wikilink-syntax.mjs`.
const FRONTMATTER_WIKILINK = new RegExp(WIKILINK.source, "g");

/**
 * Every wikilink authored inside a frontmatter value (#1428).
 *
 * Wikilinks are resolved in a note's **body** — by {@link resolveWebWikilinks}
 * here, and by the pack compilers' `convertWikilinks` for Foundry. Frontmatter
 * is not markdown and is never walked by either, so a link written in one is
 * copied through verbatim and reaches the reader as literal `[[…]]` text, in
 * whatever the theme renders that field as (an infobox row, a description, a
 * card subtitle). Nothing downstream notices: the value is a valid string, the
 * page builds, and the defect is visible only to someone who looks at it.
 *
 * So the form is refused rather than resolved. Resolving it would mean choosing
 * an output syntax for a field whose renderer is unknown to this build — a
 * markdown link is inert in a Hugo template that prints the value as text, and
 * an `<a>` is unusable in one that escapes it — and would quietly bless an
 * authoring habit that the pack build has no way to honour at all. Frontmatter
 * carries data; a link belongs in prose.
 *
 * Values are read from the *parsed* frontmatter, so a `[[` inside a YAML comment
 * is not a hit, and every hit can be named by the path a reader would look at.
 *
 * @param {unknown} fm - Parsed frontmatter, as `gray-matter` returns it.
 * @returns {Array<{path: string, link: string}>} In reading order; `path` is the
 *   dotted key path of the offending value (`government.summary`, `aliases.1`).
 */
export function frontmatterWikilinks(fm) {
    const hits = [];
    const visit = (value, trail) => {
        if (typeof value === "string") {
            for (const m of value.matchAll(FRONTMATTER_WIKILINK)) {
                hits.push({ path: trail, link: m[0] });
            }
        } else if (Array.isArray(value)) {
            value.forEach((v, i) => visit(v, `${trail}.${i}`));
        } else if (isPlainMap(value)) {
            for (const [k, v] of Object.entries(value)) {
                visit(v, trail ? `${trail}.${k}` : k);
            }
        }
    };
    if (!isPlainMap(fm)) return hits;
    visit(fm, "");
    return hits;
}

/**
 * Whether a value is a YAML mapping rather than a scalar the parser built into
 * an object of its own (a `Date`, which is what an unquoted date becomes).
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainMap(value) {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        !(value instanceof Date)
    );
}

/**
 * Rewrites the wikilinks in a markdown body as KB-local markdown links.
 *
 * **Every target is an address**, parsed by {@link readQualifier} and looked up
 * case-insensitively in the KB-wide `ctx.index` (the canonical
 * `package-type-shortcode`, `type/shortcode`, and the site's own
 * `section/slug`), then in the vendored `ctx.foreign` manifests. A link written
 * without a label addresses nothing at all and is reported as such (#180) —
 * there is no second namespace left for it to name.
 *
 * Only a slash-qualified target reaches the raw key, which is what keeps
 * `section/slug` addressable without a page's own slug answering for it.
 *
 * An unresolved target fails the build when it is a genuine intra-KB problem —
 * an unlabelled link, an ambiguous address, a qualified `prefix/key` whose
 * prefix is a real KB section or content directory, or a target that is not an
 * address at all. Anything else is treated as an external reference — until
 * every package's manifest is present, after which any address resolving
 * nowhere fails too. Failures are collected in `ctx.errors`.
 *
 * Whether or not it fails the build, a target that resolves nowhere renders
 * through {@link unresolvedLink} rather than as bare prose (#1665): the author's
 * text is kept, marked so a reader can see a link was intended. Not failing the
 * build is a statement that the link *may* be legitimate prose — it was never a
 * reason to make a dead link indistinguishable from the sentence around it.
 *
 * A target that **resolved** to an entry with no page is not this case and is
 * not marked: a pack-only package (#1516) publishes Foundry addresses and no
 * web pages, so the author wrote a real address and there is simply nothing to
 * link to.
 *
 * @param {string} body - The markdown body.
 * @param {object} ctx - `{ index, collide, sections, contentTypes, packages,
 *   foreign, manifestsComplete, type, errors, src }`.
 *   `packages` is every package an address may name, without which the leading
 *   package segment of a canonical address reads as an unknown type; `foreign`
 *   is the cross-package manifest index (#1446); `manifestsComplete` says
 *   whether every linkable package is accounted for. Together they decide
 *   whether an unresolved address is a typo or a package merely absent.
 * @returns {string} The body with wikilinks rewritten.
 */
export function resolveWebWikilinks(body, ctx) {
    // Code is verbatim: a `[[…]]` inside a code fence, an indented block or an
    // inline span is source text, not a link (#1505).
    return replaceOutsideCode(body, WIKILINK, (_m, rawInner) => {
        const parsed = parseWikilink(rawInner);
        const { target, anchor, display } = parsed;
        // An empty label is not a label: `[[x|]]` addresses the target and
        // shows its name, so `""` falls through to the same place `null` does
        // (#113). One reading, from {@link authoredLabel}.
        const label = authoredLabel({ display });

        // **Every link carries a label** (#180). Without one there is nothing
        // to resolve against — the alias namespace a bare `[[Text]]` named is
        // retired — and nothing to show either, a shortcode being an address
        // rather than prose. Reported before the same-page form, because the
        // rule is about how the link is *written*: `[[#slug]]` needs the pipe
        // exactly as `[[skill-clmb]]` does.
        if (!parsed.labelled) {
            ctx.errors.push({ file: ctx.src, target: parsed.inner, reason: "unlabelled" });
            return unresolvedLink(parsed.inner, parsed.inner);
        }

        // `[[#section-slug|Text]]` — a section of this same page.
        if (isSamePage({ target, anchor })) {
            return `[${label ?? anchor}](#${slugify(anchor)})`;
        }

        // The canonical separator (#1398) has to be resolved, not merely
        // recognised. `null` here means the target is not an address at all,
        // which is a defect: there is no other namespace to try.
        const hyphenKey = qualifiedKey(target, ctx.contentTypes, ctx.packages);
        const rawKey = target.toLowerCase();
        const hit =
            (hyphenKey ? ctx.index.get(hyphenKey) : undefined) ??
            // `section/slug` is the site's own address for a page, and it is in
            // the same map. Admitted only when the target carries a slash, so
            // a page's bare slug cannot answer for an address.
            (rawKey.includes("/") ? ctx.index.get(rawKey) : undefined) ??
            // A manifest entry carries the same `{ url, name }` shape as a
            // local one (#1446), so a cross-package hit needs no special case
            // below. Local wins: a live build is authoritative and a vendored
            // manifest can only be staler.
            (hyphenKey ? ctx.foreign?.get(hyphenKey) : undefined);
        if (hit) {
            // An address with an *empty* label has no prose to show (a
            // shortcode is not display text), so the document's **current**
            // name stands in and a rename shows at every citation.
            const text = label ?? hit.name;
            // A pack-only package publishes Foundry addresses and no pages
            // (#1516), so its entries carry no `path` and resolve to no URL.
            // The address is real — this is not a typo and must not fail the
            // build — but there is nothing on the web to point at, so the
            // reader gets the text and no href. Emitting the href anyway is
            // what the manifest exists to prevent: `[Name](undefined)` renders
            // as a link and goes nowhere.
            if (!hit.url) return text;
            return `[${text}](${anchor ? `${hit.url}#${slugify(anchor)}` : hit.url})`;
        }

        const slash = target.indexOf("/");
        const prefix = slash === -1 ? null : target.slice(0, slash).toLowerCase();
        // A slash-qualified target whose prefix is a real section or content
        // type is definitely local, so it is a typo whatever the manifest
        // situation.
        const badQualified =
            prefix !== null && (ctx.sections.has(prefix) || ctx.contentTypes.has(prefix));
        // The hyphen form is the canonical address (#1398) and is what the
        // authored content writes. It could not be guarded while some packages
        // were invisible here: `Rules/Bestiary.md` addresses `being-grkrahk`,
        // a real note in the `thalorna` package, and nothing in the syntax
        // separated that legitimate cross-package reference from a typo — so
        // treating the form as definitely-local would have failed the build on
        // correct content.
        //
        // The link manifest settles it (#1446). Once every linkable package is
        // accounted for — built here or vendored as a manifest — an address
        // resolving in none of them is a typo and nothing else. Until then
        // `manifestsComplete` is false and the form stays unguarded, so the
        // check returns exactly when it becomes decidable rather than on a date
        // someone has to remember.
        const badAddress = ctx.manifestsComplete === true && hyphenKey !== null;

        if (hyphenKey === null && !badQualified) {
            // Every link is an address, and this is not one. Distinct from a
            // dead address, because the fix is different: a name has to become
            // an address, not be corrected (#180).
            ctx.errors.push({ file: ctx.src, target, reason: "not-an-address" });
        } else if (ctx.collide?.has(hyphenKey ?? rawKey)) {
            // Two packages publish the short address, so it names neither; the
            // author writes the package-qualified form.
            ctx.errors.push({ file: ctx.src, target, reason: "ambiguous" });
        } else if (badQualified || badAddress) {
            ctx.errors.push({
                file: ctx.src,
                target,
                reason: "broken type/shortcode",
            });
        }
        // Whether or not it failed the build, the link renders marked: the
        // author's text is kept so the sentence still reads, and a reader can
        // see that something was meant to be a link.
        return unresolvedLink(label ?? target, target);
    });
}
