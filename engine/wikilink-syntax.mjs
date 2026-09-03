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
 * What a `[[…]]` **is**, before anything decides where it points.
 *
 * One authored link compiles to two different addresses — a Foundry `@UUID`
 * enricher for the packs, a URL for the web — and those two destinations are the
 * *only* thing that legitimately differs. The syntax is the author's, and it is
 * the same syntax whichever build is reading it.
 *
 * It was written twice, and the two copies had already drifted:
 *
 * | Body | `foundry` side | `web` side |
 * | --- | --- | --- |
 * | `[[weapongear-bsw` ⏎ `]]` in a table cell | not a link | a link whose target ends in a newline |
 * | a stray `[[`, a real link two paragraphs later | finds the real link | swallows both paragraphs as one target |
 *
 * The web side's pattern omitted `\n` from the excluded set, so an unclosed
 * bracket consumed everything up to the next `]]` anywhere in the document —
 * the same shape of corruption a hand-rolled code-fence regex caused on the one
 * page whose subject is link syntax (SoHL#1665). It was also internally
 * inconsistent: its *frontmatter* scan excluded newlines while its body scan did
 * not.
 *
 * So the parse lives here, once. A resolver receives the parts and decides only
 * what it is actually for: which document the address names.
 *
 * The one rule about a link's *shape* that both resolvers share also lives here
 * — **a link carries a label** ({@link unlabelledLinkMessage}) — because the
 * two used to state it in their own words and the author met whichever ran
 * first.
 *
 * @module
 */

/**
 * A wikilink, as authored.
 *
 * **Newlines are excluded deliberately.** A link is written on one line; an
 * unclosed `[[` is a typo, and the alternative is letting it swallow arbitrary
 * prose in search of a closer. Erring towards "not a link" leaves the author's
 * text as written, which is the safe direction for a rewriter.
 */
export const WIKILINK = /\[\[([^\]\n]+)\]\]/g;

/**
 * The parts of a wikilink's interior.
 *
 * @typedef {object} ParsedWikilink
 * @property {string} inner - The whole interior, unescaped and trimmed. What an
 *   unlabelled link displays, anchor and all.
 * @property {string} target - What is linked to: an address, or `""` for a
 *   link to a section of the same page.
 * @property {string} anchor - The `#section` slug, `""` when there is none.
 * @property {string|null} display - The text after `|`, or `null` when the link
 *   is unlabelled. `null` and `""` differ: an author may write `[[x|]]`.
 * @property {boolean} labelled - Whether a `|` was present at all. A link
 *   without one addresses nothing and is a finding (#180) — see
 *   {@link unlabelledLinkMessage} — so every reader has to be able to ask.
 */

/**
 * Split a wikilink's interior into its parts.
 *
 * Takes the **inside** of the brackets — the capture group of {@link WIKILINK} —
 * not the whole link, so a caller that has already matched does not re-match.
 *
 * @param {string} rawInner - The text between `[[` and `]]`.
 * @returns {ParsedWikilink} The parts, each trimmed.
 */
export function parseWikilink(rawInner) {
    // A pipe inside a markdown table cell is escaped as `\|`; undo that before
    // looking for the label separator, or the cell's own escape reads as one.
    const inner = String(rawInner ?? "").replace(/\\\|/g, "|");

    const bar = inner.indexOf("|");
    const labelled = bar !== -1;
    const linkPart = (labelled ? inner.slice(0, bar) : inner).trim();
    const display = labelled ? inner.slice(bar + 1).trim() : null;

    const hash = linkPart.indexOf("#");
    const target = (hash === -1 ? linkPart : linkPart.slice(0, hash)).trim();
    const anchor = hash === -1 ? "" : linkPart.slice(hash + 1).trim();

    return { inner: inner.trim(), target, anchor, display, labelled };
}

/**
 * The label an author actually supplied, or `null` when they supplied none.
 *
 * **An empty label is not a label.** `[[x|]]` is deliberately writable — it
 * means "address this target, and show the target's own name" — so `display:
 * ""` has to read as *absent* everywhere a fallback is chosen, exactly as
 * `display: null` does. The two are still distinguishable through
 * {@link ParsedWikilink.labelled}, which is the thing that genuinely differs:
 * `[[x|]]` is labelled and `[[x]]` is not, and only the first addresses
 * anything (#180).
 *
 * Stated here because the two resolvers had already drawn the line in two
 * places and drawn it differently: the packs tested falsiness and were right,
 * the web tested `??` — which falls through on `null` only — and emitted
 * `[](/url/)`, a link with no clickable text, through every build (#113). That
 * is the same drift this module exists to prevent, in the case its own
 * {@link ParsedWikilink} docstring calls out. One reading, one place.
 *
 * @param {{display: string|null}} parsed - A parsed wikilink, or anything
 *   carrying its `display`.
 * @returns {string|null} The label, or `null` when there is none to show.
 */
export function authoredLabel({ display }) {
    return display ? display : null;
}

/**
 * What an author writing an unlabelled link is told, in one place.
 *
 * Shared by the link checker, the pack compilers and the web resolver, because
 * an author meets whichever runs first and they should read the same. It names
 * the form to write rather than a value to correct: there is no value that
 * makes an unlabelled link resolve.
 *
 * **Why there is nothing left for a bare link to mean** (#180). The pipe used
 * to select between two namespaces — address and alias — and the alias one was
 * empty in practice: across 8,305 wikilinks in three content trees, not one
 * bare `[[Alias]]` resolved to a note. What the index it looked up in *did* do
 * was fold every note's `name.full` into itself, which forbade two notes of a
 * type from sharing a display name (#179). So the namespace is gone, every
 * link is an address, and an address needs the pipe that says so.
 *
 * The **link part may still be an anchor**: `[[#slug|Text]]` addresses a
 * section of the page it is written on. It is the label that is required, not
 * a target.
 *
 * @param {string} target - The target as authored, named in the message.
 * @returns {string} The message, unpunctuated at the end as a finding is.
 */
export function unlabelledLinkMessage(target) {
    return (
        `wikilink [[${target}]] carries no label, so it addresses nothing — ` +
        `write [[type-shortcode|Text]]. Every link is an address; the bare ` +
        `[[Name]] form named an alias, and the alias namespace is retired`
    );
}

/**
 * Whether a parsed link addresses a section of the page it is written on.
 *
 * `[[#some-heading]]` — no target, only an anchor. Both resolvers special-case
 * it before consulting any index, because there is nothing to look up.
 *
 * @param {ParsedWikilink} parsed - A parsed wikilink.
 * @returns {boolean} True when the link is same-page.
 */
export function isSamePage({ target, anchor }) {
    return !target && Boolean(anchor);
}
