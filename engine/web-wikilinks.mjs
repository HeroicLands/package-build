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
 * has to be rewritten to it before lookup. The target is read by the pack
 * build's own {@link readQualifier}, so recognising an address and resolving
 * one can never disagree: the two separators and the optional leading package
 * segment are stated once, there.
 *
 * It takes the **parsed** qualifier rather than the raw target because the
 * caller needs the parse for a second purpose: `unknown-type` and
 * `not-an-address` are different findings with different fixes, and only the
 * `reason` tells them apart (#184). Reading the target twice would let the two
 * readings drift.
 *
 * The build indexes an item note under both `skill/climb` and `docskill/climb`,
 * and `contentTypes` carries both qualifiers, so either form finds the page.
 *
 * @param {object|null} read - From {@link readQualifier}.
 * @returns {string | null} The index key, or `null` when not an address.
 */
function keyOfRead(read) {
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
 * **Every target that resolves nowhere fails the build** (#184), and is
 * classified into the vocabulary all three resolvers share — `unlabelled`,
 * `not-an-address`, `unknown-type`, `ambiguous`, `unresolved`. Failures are
 * collected in `ctx.errors`, each carrying the authored `link` and its
 * `occurrence` so a caller can report the line and column it sits on.
 *
 * There used to be one exception: a hyphen-form address was let through while
 * any linkable package had no vendored manifest, since a real cross-package
 * reference and a typo look identical from here. The pack compilers and the
 * link checker never made that allowance, so its only surviving effect was to
 * give one authored link two verdicts. The advice moved into the message
 * instead.
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
 *   foreign, type, errors, src, file }`.
 *   `packages` is every package an address may name, without which the leading
 *   package segment of a canonical address reads as an unknown type; `foreign`
 *   is the cross-package manifest index (#1446). `src` is the page's display
 *   path and `file` the source file a diagnostic should name — absent, `src`
 *   stands in.
 * @returns {string} The body with wikilinks rewritten.
 */
export function resolveWebWikilinks(body, ctx) {
    // How many times each authored link has been seen, so two identical links
    // on one page are located at their own positions in the source file — the
    // same counting the checker does, and what turns a finding into a
    // `file:line:column:` diagnostic rather than a note-wide one (#17, #184).
    const seen = new Map();
    /**
     * Records a finding, and returns the marked-up link it renders as.
     *
     * @param {string} all - The authored link, brackets and all.
     * @param {object} finding - `{ target, reason }`, plus any extras the class
     *   carries.
     * @param {string} text - What the link renders as.
     * @returns {string} The marked span.
     */
    const report = (all, finding, text) => {
        const occurrence = (seen.get(all) ?? 0) + 1;
        seen.set(all, occurrence);
        ctx.errors.push({
            // Absolute where the caller supplied one, so a diagnostic locates
            // the file an editor opens; the display path otherwise.
            file: ctx.file ?? ctx.src,
            src: ctx.src,
            link: all,
            occurrence,
            ...finding,
        });
        return unresolvedLink(text, finding.target);
    };

    // Code is verbatim: a `[[…]]` inside a code fence, an indented block or an
    // inline span is source text, not a link (#1505).
    return replaceOutsideCode(body, WIKILINK, (all, rawInner) => {
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
            return report(all, { target: parsed.inner, reason: "unlabelled" }, parsed.inner);
        }

        // `[[#section-slug|Text]]` — a section of this same page.
        if (isSamePage({ target, anchor })) {
            return `[${label ?? anchor}](#${slugify(anchor)})`;
        }

        // The canonical separator (#1398) has to be resolved, not merely
        // recognised. `null` here means the target is not an address at all,
        // which is a defect: there is no other namespace to try.
        const read = readQualifier(target, ctx.contentTypes ?? new Set(), ctx.packages);
        const hyphenKey = keyOfRead(read);
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
        // A slash-qualified target whose prefix is a real KB **section** is an
        // address in the site's own `section/slug` space, which the lookup
        // above already consulted. It parses as no `type/shortcode`, but it did
        // address something and nothing answered — so it is unresolved, not
        // unaddressable. (A prefix that is a content *type* never reaches here:
        // it yields a `hyphenKey`.)
        const siteAddress = prefix !== null && ctx.sections.has(prefix);

        // **An address resolving nowhere is a failure, unconditionally** (#184).
        //
        // It was gated on `manifestsComplete` — while any linkable package was
        // invisible here, `Rules/Bestiary.md` addressing `being-grkrahk` in the
        // `thalorna` package was indistinguishable from a typo, so the form
        // stayed unguarded rather than fail correct content. The gate has
        // outlived that: every linkable package publishes a manifest now, and
        // more to the point the *other two* resolvers never had it. The pack
        // compilers fail the note and the link checker reports an error, so the
        // gate's only remaining effect was to give one authored link two
        // verdicts depending on which build read it. The advice a missing
        // manifest calls for is in the message instead — {@link
        // unresolvedAddressMessage} names both corrections — which informs the
        // author without excusing the link.
        const reason =
            ctx.collide?.has(hyphenKey ?? rawKey) ? "ambiguous"
            : hyphenKey !== null || siteAddress ? "unresolved"
            : read?.reason === "unknown-type" ? "unknown-type"
                // Every link is an address, and this is not one. Distinct from
                // a dead address, because the fix is different: a name has to
                // become an address, not be corrected (#180).
            : "not-an-address";

        // Whether or not it failed the build, the link renders marked: the
        // author's text is kept so the sentence still reads, and a reader can
        // see that something was meant to be a link.
        return report(all, { target, reason }, label ?? target);
    });
}
