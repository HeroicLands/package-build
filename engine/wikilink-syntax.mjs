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

import { parseExtensionAttributes, refusedAttributes } from "./extension-attributes.mjs";
import { isGmNote } from "./note-vocabulary.mjs";

import { parseAddress, isAddressTuple, splitAnchor } from "./address.mjs";

/**
 * What a `[[…]]` **is**, before anything decides where it points.
 *
 * One authored link is written three ways — a Foundry `@UUID` content link for
 * the packs, a URL for the web, a cross-reference for the book — and those
 * forms are the *only* thing that legitimately differs. The syntax is the
 * author's, and it is the same syntax whichever build is reading it.
 *
 * So the parse lives here, once, and two readers take it: the link checker
 * (`content-links.mjs`) and the resolver (`wikilinks.mjs`). Each receives the
 * parts and decides only what it is for: which document the address names.
 *
 * The one rule about a link's *shape* also lives here — **a link carries a
 * label** ({@link unlabelledLinkMessage}) — because every build states it
 * through one message and the author reads the same words whichever ran
 * first.
 *
 * For the same reason, so does the **vocabulary of link findings**
 * ({@link LINK_FINDING_REASONS}) and the message each one reports through
 * ({@link linkFindingMessage}). Every build reads one authored link; an author
 * meets whichever ran first, and a consumer switching on a `reason` should not
 * be switching on which build produced it.
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
 *
 * **A leading `!` makes it an embed, not a link**, and the lookbehind is what
 * keeps every reader from seeing one as the other. Stated here rather than in
 * each reader for the reason the rest of this module exists: the checker, the
 * resolver and the embed reader all match on this pattern, and a copy of the
 * exclusion in each is a place for it to be forgotten. An embed's
 * own grammar is {@link module:engine/content-embeds}.
 */
export const WIKILINK = /(?<!!)\[\[([^\]\n]+)\]\](?:\{(?:[^{}"\n]|"(?:\\.|[^"\\\n])*")*\})?/g;

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
 * @property {ReturnType<typeof parseExtensionAttributes>} [attributes] - Trailing extension attributes.
 * @property {boolean} labelled - Whether a `|` was present at all. A link
 *   without one addresses nothing and is a finding — see
 *   {@link unlabelledLinkMessage} — so every reader has to be able to ask.
 */

/**
 * Split a wikilink's interior into its parts.
 *
 * Takes the **inside** of the brackets — the capture group of {@link WIKILINK} —
 * not the whole link, so a caller that has already matched does not re-match.
 *
 * @param {string} rawInner - The text between `[[` and `]]`.
 * @param {string} [literal] - Whole matched link, including trailing attributes.
 * @returns {ParsedWikilink} The parts, each trimmed.
 */
export function parseWikilink(rawInner, literal = "") {
    // A pipe inside a markdown table cell is escaped as `\|`; undo that before
    // looking for the label separator, or the cell's own escape reads as one.
    const inner = String(rawInner ?? "").replace(/\\\|/g, "|");

    const bar = inner.indexOf("|");
    const labelled = bar !== -1;
    const linkPart = (labelled ? inner.slice(0, bar) : inner).trim();
    const display = labelled ? inner.slice(bar + 1).trim() : null;

    // The anchor is read by the one reader a frontmatter Address uses, so a
    // link and a field cannot disagree about where the anchor starts.
    const { address: target, anchor = "" } = splitAnchor(linkPart);

    const suffix = literal.slice(literal.indexOf("]]") + 2);
    const attributes =
        suffix.startsWith("{") ? parseExtensionAttributes(suffix.slice(1, -1)) : null;
    if (attributes) attributes.problems.push(...refusedAttributes(attributes.values));
    if (attributes && Object.hasOwn(attributes.values, "ref"))
        attributes.problems.push("a wikilink never takes ref; its address is its ref");
    return {
        inner: inner.trim(),
        target,
        anchor,
        display,
        labelled,
        ...(attributes ? { attributes } : {}),
    };
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
 * anything.
 *
 * Read with `??`, which falls through on `null` only, an empty label would
 * emit `[](/url/)`: a link with no clickable text. One reading, one place.
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
 * Shared by the link checker and the resolver, on every target, because
 * an author meets whichever runs first and they should read the same. It names
 * the form to write rather than a value to correct: there is no value that
 * makes an unlabelled link resolve.
 *
 * **A bare link has nothing to mean.** Every link is an address, and an
 * address needs the pipe that says so.
 *
 * The **link part may be an anchor**: `[[#slug|Text]]` addresses a
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
        `[[Name]] form addresses nothing`
    );
}

/**
 * Every way a link can fail, named once for every reader of a link.
 *
 * A link is read by the checker (`content-links.mjs`) and by the resolver
 * (`wikilinks.mjs`) for every target, and each names a failure by one of these
 * reasons, so a consumer switching on a `reason` never switches on which build
 * produced it. The set is closed and lives here, beside the syntax they share.
 *
 * - `unlabelled` — no `|`, so the link addresses nothing.
 * - `not-an-address` — labelled, but the target does not parse as an address.
 * - `not-lowercase` — a package, system or type segment carries a capital.
 * - `shortcode-not-lowercase` — the shortcode segment carries a capital. A
 *   shortcode is lowercase, and the link is refused rather than lowercased.
 * - `unknown-type` — definitely qualified, but names no type this build knows.
 * - `not-an-asset` — a real address, embedded where only a file can be drawn.
 * - `unresolved` — parses as an address, and nothing publishes it.
 * - `stub` — the address names a note this tree holds whose body is empty, so
 *   it publishes no page for the link to reach.
 * - `ambiguous` — more than one package publishes the short address.
 * - `unknown-anchor` — the address resolved, the `#section` it names did not.
 * - `no-content-index` — the address names a package declared
 *   `contentIndex: false`, a Foundry dependency only, so no index was fetched
 *   for it to resolve against.
 *
 * @type {ReadonlySet<string>}
 */
export const LINK_FINDING_REASONS = Object.freeze(
    new Set([
        "invalid-attributes",
        "unlabelled",
        "not-an-address",
        "not-lowercase",
        "shortcode-not-lowercase",
        "unknown-type",
        "not-an-asset",
        "unresolved",
        "stub",
        "ambiguous",
        "unknown-anchor",
        "event-anchor",
        "no-content-index",
    ]),
);

/**
 * Whether an anchor a link names is one of its target's events.
 *
 * A wikilink names a `prose` anchor; an `event` anchor is named only by the
 * frontmatter keys that accept one. A local target carries its event ids as
 * `eventAnchors`, a target another package publishes carries its kinded
 * anchors as `noteAnchors`.
 *
 * @param {{eventAnchors?: Set<string>, noteAnchors?: Array<{slug: string,
 *   kind?: string}>}|undefined} hit - The link's resolved target.
 * @param {string} anchor - The anchor the link names.
 * @returns {boolean} Whether it is an event.
 */
export function isEventAnchor(hit, anchor) {
    if (!hit || !anchor) return false;
    if (hit.eventAnchors?.has?.(anchor)) return true;
    return Array.isArray(hit.noteAnchors) ?
            hit.noteAnchors.some((one) => one?.slug === anchor && one.kind === "event")
        :   false;
}

/**
 * What an author writing an address that resolves to nothing is told.
 *
 * **Both corrections, because the author cannot tell which applies.** An
 * address lands nowhere either because the shortcode is wrong or because the
 * package publishing it is not a declared dependency — or is one whose index
 * has not been fetched — and the link itself looks identical in every case.
 *
 * An address naming no note is a typo or an omission: the intent of a
 * placeholder for a note nobody has written yet is spelled as a `draft`-tagged
 * note that exists, resolves and renders marked. Both want fixing, and every build says so.
 *
 * @param {string} target - The address as authored, named in the message.
 * @returns {string} The message, unpunctuated at the end as a finding is.
 */
export function unresolvedAddressMessage(target) {
    return (
        `address [[${target}]] resolves to no note — no package publishes ` +
        `it. Fix the shortcode, or declare the package that does as a ` +
        `dependency and run \`package-build deps fetch\``
    );
}

/**
 * What an author linking to a **stub** is told.
 *
 * Strictly better than "resolves to no note", and available only because a stub
 * is in the index: the note exists, its file can be named, and the reason the
 * link cannot land is a fact about that file rather than a guess about a
 * shortcode. So the message names the file to open and offers both corrections
 * — the link was either premature or the note is owed a body.
 *
 * @param {string} target - The address as authored.
 * @param {string} [file] - Where the stub is, relative to the content root.
 * @returns {string} The message, unpunctuated at the end as a finding is.
 */
export function stubAddressMessage(target, file) {
    return (
        `address [[${target}]] names a stub${file ? ` at ${file}` : ""}, which has ` +
        `no body and therefore no page — name it in prose, or write the note`
    );
}

/**
 * What an author writing a short address more than one package publishes is
 * told.
 *
 * There is no defensible way to pick one, and the correction is mechanical:
 * write the package-qualified form. So it fails rather than warning, and the
 * message names the claimants so the author can choose between them without
 * going looking.
 *
 * **The correction is the canonical form**, all four segments. Omission
 * runs strictly left to right, so there is no `package-type-shortcode` to offer
 * — naming a package means naming the system before the type. That would be
 * the correction here, back when a written target could state three segments at
 * most; the grammar is positional now, and a three-segment target names a
 * *system*, not a package.
 *
 * @param {string} target - The address as authored.
 * @param {Iterable<string>} [packages] - The packages that publish it.
 * @returns {string} The message.
 */
export function ambiguousAddressMessage(target, packages = []) {
    const named = [...packages].filter(Boolean).sort();
    return (
        `address [[${target}]] is published by ` +
        (named.length ? `${named.join(" and ")}` : `more than one package`) +
        `, so it names neither — write the fully qualified ` +
        `[[package-system-type-shortcode|Text]]`
    );
}

/**
 * The message for one link finding, whichever resolver found it.
 *
 * The single table the checker and the resolver report through, on every
 * target, so one authored link cannot get different explanations of the same
 * mistake depending on which build the author ran first. Callers
 * add their own context around it — the note's name, the file it sits in — and
 * never their own wording for the defect.
 *
 * @param {object} finding
 * @param {string} finding.reason - One of {@link LINK_FINDING_REASONS}.
 * @param {string} finding.target - The link target as authored.
 * @param {Iterable<string>} [finding.packages] - For `ambiguous`, the
 *   claimants.
 * @param {string} [finding.anchor] - For `unknown-anchor`, the section named.
 * @param {string} [finding.type] - For `not-an-asset`, the type the address
 *   named.
 * @param {string} [finding.stub] - For `stub`, where the stub is.
 * @param {string} [finding.shortcode] - For `shortcode-not-lowercase`, the
 *   shortcode as written.
 * @param {string[]} [finding.problems] - Invalid attribute diagnostics.
 * @param {string} [finding.declared] - For `shortcode-not-lowercase`, the
 *   lowercase spelling, when it is a declared shortcode.
 * @returns {string} The message.
 * @throws {Error} On a reason outside the closed set — a resolver inventing one
 *   would otherwise report a link with no explanation at all.
 */
export function linkFindingMessage({
    reason,
    target,
    packages,
    anchor,
    type,
    stub,
    shortcode,
    declared,
    problems,
}) {
    switch (reason) {
        case "invalid-attributes":
            return `wikilink [[${target}]] has invalid attributes: ${(problems ?? []).join("; ")}`;
        case "unlabelled":
            return unlabelledLinkMessage(target);
        case "not-an-address":
            return (
                `"${target}" is not an address — the "|" says one was meant, ` +
                `so write [[type-shortcode|Text]], or ` +
                `[[package-system-type-shortcode|Text]] for a note in another ` +
                `package`
            );
        case "not-lowercase":
            return (
                `address [[${target}]] capitalises a package, system or type ` +
                `segment — every segment of an address is lowercase`
            );
        case "shortcode-not-lowercase":
            return (
                `address [[${target}]] shortcode \`${shortcode ?? target}\` must be ` +
                `lowercase${declared ? `; the declared shortcode is \`${declared}\`` : ""}`
            );
        case "unknown-type":
            return `address [[${target}]] names no known content type`;
        case "not-an-asset":
            return (
                `![[${target}]] embeds a \`${type ?? "note"}\`, and an embed draws a ` +
                `file — only an \`icon\`, an \`image\` or an \`audio\` address can be ` +
                `embedded. Write [[${target}|Text]] to link to it instead`
            );
        case "ambiguous":
            return ambiguousAddressMessage(target, packages ?? []);
        case "unknown-anchor":
            return (
                `address [[${target}]] resolves, but no section "#${anchor ?? ""}" ` +
                `is published for it`
            );
        case "event-anchor":
            // A link on the event's own note has no note to link to instead,
            // so it names nothing to write in its place.
            return target ?
                    `address [[${target}#${anchor ?? ""}]] names an event, and prose links to ` +
                        `the note, not to an event — write [[${target}|…]]`
                :   `address [[#${anchor ?? ""}]] names an event of this note, and prose ` +
                        "links to sections, not to events — write the words without a link";
        case "unresolved":
            return unresolvedAddressMessage(target);
        case "stub":
            return stubAddressMessage(target, stub);
        case "no-content-index":
            return (
                `address [[${target}]] names a package declared \`contentIndex: false\` — ` +
                `it is a Foundry dependency only, and no content index was fetched for it, ` +
                `so nothing it publishes can be cited`
            );
        default:
            throw new Error(
                `linkFindingMessage: "${reason}" is not one of ` +
                    `${[...LINK_FINDING_REASONS].join(", ")}`,
            );
    }
}

/**
 * Whether a parsed link addresses a section of the page it is written on.
 *
 * `[[#some-heading]]` — no target, only an anchor. The resolver and the checker
 * special-case it before consulting any index, because there is nothing to look
 * up.
 *
 * @param {ParsedWikilink} parsed - A parsed wikilink.
 * @returns {boolean} True when the link is same-page.
 */
export function isSamePage({ target, anchor }) {
    return !target && Boolean(anchor);
}

/**
 * Read an operational link target in its enclosing Address context.
 * @param {string} inner - Lexical link contents.
 * @param {object} context - Builder defaults and type vocabulary.
 * @param {string} [literal] - Whole matched link, including trailing attributes.
 * @returns {object} Typed target and diagnostic source spelling.
 */
export function readWikilink(inner, context, literal = "") {
    const parsed = parseWikilink(inner, literal);
    const rawTarget = parsed.target;
    if (!rawTarget) return { ...parsed, rawTarget, target: { kind: "same-page" } };
    const target = parseAddress(rawTarget, context);
    if (target.reason === "no-type") target.reason = "not-an-address";
    if (!target.reason && !isAddressTuple(target))
        throw new Error("Wikilink read requires complete builder Address context");
    return target.reason ?
            { ...parsed, rawTarget, target: { kind: "literal", text: rawTarget }, problem: target }
        :   { ...parsed, rawTarget, target };
}

/** Whether the actual referenced destination needs spoiler presentation.
 * @param {object} destination - Resolved note metadata.
 * @param {string} [anchor] - Referenced prose anchor.
 * @returns {boolean} Whole-note or section audience.
 */
export function secretDestination(destination, anchor = "") {
    return Boolean(
        destination?.gm ||
        isGmNote(destination?.fm ?? destination) ||
        (anchor && destination?.noteAnchors?.some((one) => one.slug === anchor && one.secret)),
    );
}

/** Apply destination-derived presentation without changing its address.
 * @param {string} reference - Rendered reference Markdown.
 * @param {object} parsed - Shared parsed wikilink.
 * @param {object} destination - Resolved target metadata.
 * @returns {string} Inline spoiler or visible reference.
 */
export function presentWikilink(reference, parsed, destination) {
    const attrs = parsed.attributes;
    const classes = (attrs?.classes ?? []).filter((value) => value !== "show");
    if (
        !attrs?.classes.includes("show") &&
        secretDestination(destination, parsed.anchor) &&
        !classes.includes("secret")
    )
        classes.push("secret");
    const fields = [
        attrs?.id ? `#${attrs.id}` : "",
        ...classes.map((value) => `.${value}`),
        ...Object.entries(attrs?.values ?? {}).map(
            ([key, value]) => `${key}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
        ),
    ].filter(Boolean);
    return fields.length ? `[${reference}]{${fields.join(" ")}}` : reference;
}
