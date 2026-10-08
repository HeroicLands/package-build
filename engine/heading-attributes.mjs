/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * The braced attribute block a heading may end with, read once.
 *
 * ```
 * # The Harbor {#harbor .wide}
 * ```
 *
 * The index, the link checker, the journal compiler, the figure pass and the
 * book all ask what a heading declares, and they have to give the same answer:
 * an id a surface publishes as an anchor, classes a surface may honour, and
 * attributes an HTML surface writes onto the element. This is where that
 * reading lives, so there is one grammar — the same one a `:::` block and a
 * captions and divs are written in.
 *
 * **A leaf, deliberately.** `anchors.mjs` is shared by the compilers, the index
 * and the link checker and cannot import any of them; the figure pass is
 * imported by `anchors.mjs` and so cannot import it back. A module that imports
 * only the attribute grammar can be asked by all of them.
 *
 * @module
 */

import { parseExtensionAttributes, refusedAttributes } from "./extension-attributes.mjs";

/**
 * A heading line: its hashes and the text after them.
 *
 * Shared with every pass that has to find a heading before reading what it
 * declares, so the passes cannot disagree about which lines are headings.
 */
export const HEADING_LINE = /^\s*(#{1,6})\s+(.+?)\s*#*\s*$/;

/** The braces a heading's text may end with, and what is inside them. */
const SUFFIX = /^(.*?)\s*\{([^}\n]*)\}\s*$/;

/**
 * A heading's id.
 *
 * Looser than a figure's or a block's, which must begin with a letter: a
 * heading's id is published as an HTML `id` and as a Foundry page anchor, both
 * of which admit a digit first, and the corpus carries ids that are Foundry
 * document ids and ids derived from a numbered heading.
 */
const HEADING_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Read a heading's text and the attribute block it may end with.
 *
 * A suffix that is not an attribute block — a set written in braces, a die
 * expression — is left in the text and reported, so no surface silently prints
 * a heading with words missing and no author is told to fix nothing.
 *
 * **One mistake draws one finding.** Braces holding nothing the grammar
 * recognises are reported once, naming the braces: an author who wrote
 * `{a, b}` meant no attribute block at all, and a complaint per fragment inside
 * it says the same thing twice in words that name neither the heading nor the
 * fix. Braces that *are* an attribute block, carrying one bad attribute beside
 * good ones, relay the grammar's own complaint about that attribute.
 *
 * @param {string} heading - A heading's text, hashes already removed.
 * @returns {{text: string, id: string, classes: string[],
 *   values: Record<string, string>, problems: string[], braces: boolean}}
 *   `text` is what a surface sets, `braces` whether a suffix was there at all.
 */
export function splitHeadingAttributes(heading) {
    const raw = String(heading ?? "").trim();
    const blank = { text: raw, id: "", classes: [], values: {}, problems: [], braces: false };
    const match = SUFFIX.exec(raw);
    if (!match) return blank;
    const parsed = parseExtensionAttributes(match[2], { idPattern: HEADING_ID });
    const recognised =
        Boolean(parsed.id) || parsed.classes.length > 0 || Object.keys(parsed.values).length > 0;
    let problems;
    if (recognised) {
        // An id, a class or an attribute the markup owns: refused here as it is
        // on a named block, because a heading writes its attributes onto the
        // element on both HTML surfaces.
        problems = [...parsed.problems, ...refusedAttributes(parsed.values)];
    } else if (match[2].trim()) {
        problems = [`{${match[2]}} is not an attribute block`];
    } else {
        problems = ["an attribute block states nothing"];
    }
    if (problems.length) return { ...blank, braces: true, problems };
    return {
        text: match[1].trim(),
        id: parsed.id,
        classes: parsed.classes,
        values: parsed.values,
        problems: [],
        braces: true,
    };
}

/**
 * The class that withholds a section from players.
 *
 * Written on the heading that opens the section, so the section stays linkable:
 * secrecy is a property of the section, not of the name a link resolves to.
 */
export const WITHHELD_CLASS = "secret";

/**
 * Whether a heading opens a journal page.
 *
 * A Foundry UUID addresses a page and nothing smaller, so a section a link can
 * reach has to be one: a top-level heading starts a page, and so does any
 * heading that names an anchor. {@link module:engine/journals.splitPages}
 * decides *where* a page begins — a heading inside a fence or a named block is
 * its business — and asks this which headings are eligible, so no caller
 * re-decides it.
 *
 * @param {{level: number, id: string}} heading - From
 *   {@link scanHeadingAttributes}, or any `{level, id}` pair.
 * @returns {boolean} Whether the heading opens a page.
 */
export function opensPage({ level, id }) {
    return level === 1 || Boolean(id);
}

/**
 * Every heading in a body, with what its attribute block declares.
 *
 * Fenced code is skipped: `#` opens a comment in most of what gets fenced, and
 * an example heading in a document is not a heading of it.
 *
 * @param {string} source - A note's markdown body.
 * @param {number} [bodyLine=1] - The 1-based file line the body starts on, so a
 *   finding lands where an editor can open it.
 * @returns {{headings: Array<{level: number, line: number, text: string,
 *   id: string, classes: string[], values: Record<string, string>}>,
 *   errors: Array<{line: number, column: number, message: string}>}}
 */
export function scanHeadingAttributes(source, bodyLine = 1) {
    const lines = String(source ?? "").split("\n");
    const headings = [];
    const errors = [];
    let codeFence = null;
    for (let i = 0; i < lines.length; i++) {
        const fence = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
        if (codeFence) {
            if (fence && fence[1][0] === codeFence[0] && fence[1].length >= codeFence.length)
                codeFence = null;
            continue;
        }
        if (fence) {
            codeFence = fence[1];
            continue;
        }
        const heading = HEADING_LINE.exec(lines[i]);
        if (!heading) continue;
        const parsed = splitHeadingAttributes(heading[2]);
        const line = bodyLine + i;
        if (parsed.problems.length) {
            const column = lines[i].indexOf("{") + 1;
            for (const message of parsed.problems) errors.push({ line, column, message });
            continue;
        }
        headings.push({
            level: heading[1].length,
            line,
            text: parsed.text,
            id: parsed.id,
            classes: parsed.classes,
            values: parsed.values,
        });
    }
    return { headings, errors };
}

/**
 * A markdown-it plugin writing a heading's attribute block onto its element.
 *
 * The website's renderer reads the block itself, so the surfaces that use
 * markdown-it read it here and publish the same `id`, the same classes and the
 * same attributes — rather than typesetting the braces an author wrote.
 *
 * @param {object} md - A markdown-it instance.
 * @returns {void}
 */
export function headingAttributesPlugin(md) {
    md.core.ruler.push("heading_attributes", (state) => {
        const tokens = state.tokens;
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].type !== "heading_open") continue;
            const inline = tokens[i + 1];
            const children = inline?.children ?? [];
            const last = children[children.length - 1];
            if (last?.type !== "text") continue;
            const parsed = splitHeadingAttributes(String(last.content ?? ""));
            if (!parsed.braces || parsed.problems.length) continue;
            last.content = parsed.text;
            inline.content = splitHeadingAttributes(String(inline.content ?? "")).text;
            if (parsed.id) tokens[i].attrSet("id", parsed.id);
            if (parsed.classes.length) tokens[i].attrJoin("class", parsed.classes.join(" "));
            for (const [key, value] of Object.entries(parsed.values)) tokens[i].attrSet(key, value);
        }
    });
}

/**
 * Parse one line as a heading, and say whether it starts a journal page.
 *
 * The single reading of that rule. {@link module:engine/journals.splitPages}
 * builds its pages from it; `scanBlocks` and `scanFigures` refuse a heading
 * that starts a page written where it cannot become one. All three ask this, so
 * none of them can disagree about what a heading line means or about what starts
 * a page — and the attribute block comes off here, so a class beside an anchor
 * is not read as part of the anchor by any of them.
 *
 * @param {string} line - One line of a note's body.
 * @returns {{level: number, text: string, id: string, classes: string[],
 *   values: Record<string, string>, problems: string[], startsPage: boolean}|null}
 *   `null` when the line is not a heading.
 */
export function parseHeadingLine(line) {
    const heading = HEADING_LINE.exec(line);
    if (!heading) return null;
    const level = heading[1].length;
    const parsed = splitHeadingAttributes(heading[2]);
    return {
        level,
        text: parsed.text,
        id: parsed.id,
        classes: parsed.classes,
        values: parsed.values,
        problems: parsed.problems,
        startsPage: opensPage({ level, id: parsed.id }),
    };
}

/**
 * Every heading that opens a journal page, by the line it sits on.
 *
 * The walk that decides it: fenced code holds no headings, a named block holds
 * no page — the block is one passage of the page it is written in — and what is
 * left is read by {@link opensPage}. {@link module:engine/journals.splitPages}
 * builds the pages from this, and the passes that honour a class on a
 * page-opening heading ask the same question of the same answer.
 *
 * A figure fence also opens a page, which is `splitPages`' business: a fence is
 * found by the figure pass, and the page it opens is named for its label.
 *
 * @param {string} source - A note's markdown body.
 * @param {ReadonlySet<number>} [blockLines] - The 0-based lines sitting inside
 *   a named block, supplied by the caller. A named block is read by
 *   {@link module:engine/content-blocks.scanBlocks}, which knows every name in
 *   the registry, reads an opener's attribute block, and tracks nesting by
 *   depth — so the caller that already holds that answer passes it rather than
 *   a second reading of the same lines being kept here.
 * @returns {Map<number, {level: number, line: number, text: string, id: string,
 *   classes: string[], values: Record<string, string>}>} Keyed by 0-based line.
 */
export function pageOpenings(source, blockLines = new Set()) {
    const lines = String(source ?? "").split("\n");
    const openings = new Map();
    let codeFence = null;
    for (const [index, line] of lines.entries()) {
        // A fence's closer must carry the same character as its opener and
        // be at least as long, same as {@link scanHeadingAttributes} tracks
        // it below — a longer fence is what lets a fenced example carry a
        // shorter fence of its own as literal content.
        const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
        if (codeFence) {
            if (fence && fence[1][0] === codeFence[0] && fence[1].length >= codeFence.length) {
                codeFence = null;
            }
        } else if (fence) {
            codeFence = fence[1];
        }
        if (codeFence !== null || blockLines.has(index)) continue;
        const heading = parseHeadingLine(line);
        if (!heading?.startsPage) continue;
        openings.set(index, { ...heading, line: index + 1 });
    }
    return openings;
}

/**
 * The spans a `.secret` heading withholds, and the classes written where no
 * surface can honour them.
 *
 * A span runs from its heading to the line before the next heading that opens a
 * page, which is the stretch Foundry makes one page of. A `.secret` on a heading
 * that opens no page covers no page, so no surface can withhold it: that is a
 * finding at the heading's own line rather than a class quietly ignored.
 *
 * @param {string} source - A note's markdown body.
 * @param {number} [bodyLine=1] - The 1-based file line the body starts on.
 * @returns {{sections: Array<{start: number, end: number, heading: object}>,
 *   errors: Array<{line: number, column: number, message: string}>}} `start` and
 *   `end` are 0-based line indexes, `end` exclusive.
 */
export function withheldSections(source, bodyLine = 1) {
    const lines = String(source ?? "").split("\n");
    const openings = pageOpenings(source);
    const starts = [...openings.keys()];
    const sections = [];
    const errors = [];
    for (const [at, index] of starts.entries()) {
        const heading = openings.get(index);
        if (!heading.classes.includes(WITHHELD_CLASS)) continue;
        sections.push({ start: index, end: starts[at + 1] ?? lines.length, heading });
    }
    // A heading that opens no page is not among the openings at all, so the
    // class is looked for again across every heading the body states. The
    // openings are keyed by body line index and a heading carries its file
    // line, so the body's first line is subtracted to compare the two.
    for (const heading of scanHeadingAttributes(source, bodyLine).headings) {
        if (openings.has(heading.line - bodyLine)) continue;
        if (!heading.classes.includes(WITHHELD_CLASS)) continue;
        errors.push({
            line: heading.line,
            column: (lines[heading.line - bodyLine]?.indexOf("{") ?? 0) + 1,
            message:
                `.${WITHHELD_CLASS} withholds the page a heading opens, and this heading ` +
                "opens none — give it an anchor, or raise it to the top level",
        });
    }
    return { sections, errors };
}
