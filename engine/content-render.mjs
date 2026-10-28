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
 * **The renderer.** {@link createRenderer} builds the one markdown-it
 * configuration every target reads, so a rule such as "an alert is a labelled
 * callout" is written once and holds everywhere.
 *
 * ## One configuration, four targets
 *
 * | | `foundry` | `web` | `preview` | `book` |
 * | --- | --- | --- | --- | --- |
 * | the shared plugins | all | all | all | all that read tokens |
 * | an inline `[text]{.secret}` | a focusable spoiler | a toggle button | a focusable spoiler, or its highlighted source | read as a span |
 * | a `.secret` block | a section the GM reads | a closed disclosure | a closed disclosure | a labelled box |
 * | a `.secret` heading | a page withheld by ownership | a closed disclosure | a closed disclosure | a labelled box |
 * | a heading's id | as authored | as authored, or its text's | as authored | as authored |
 * | quotes, dashes and ellipses | as written | typographic | as written | as written, set by Typst |
 * | raw HTML in a note | passed through | passed through | shown as text | shown as text |
 * | a name's first use | bold | bold | bold, with an index | bold |
 * | the output | HTML | HTML | HTML | the token stream, for the Typst stage |
 *
 * A target differs from the others only in that table. The shared plugins are
 * footnotes, definition lists, dictionary rows, bracket spans, dictionary
 * entries, heading attributes, icons, body images and first uses; each
 * renderer's `plugins` lists what its target installs.
 *
 * ## The stages of a render
 *
 * A note reaches {@link Renderer#render} with its index-dependent constructs
 * already resolved by {@link module:engine/content-expand.expandContent}.
 * {@link Renderer#prepare} then writes the constructs markdown-it has no
 * syntax for as HTML between blank lines, in this order:
 *
 * 1. **Marked text** — a run's language, face and mapping, from the
 *    configuration's script notes.
 * 2. **Captioned items** — each figure's wrapper and label. Its number, kind
 *    and role come from the figure scan expansion made, so a figure is
 *    numbered once; see {@link module:engine/content-figures.renderFigureBlocks}.
 * 3. **Named blocks, verse and scrolls** — `:::` blocks, verse divs and
 *    `scroll` fences.
 * 4. **Alerts.**
 * 5. **Spans and withheld sections** — written here on the `web` target; the
 *    other targets read spans and headings as tokens.
 *
 * The book skips these stages. It reads the parser's tokens and writes Typst,
 * so its own output stage replaces them.
 *
 * ## Code
 *
 * A fenced block that names a language highlight.js knows is highlighted at
 * build time, with class-based markup that `content-base.css` themes.
 *
 * @module
 */

import MarkdownIt from "markdown-it";
import footnotePlugin from "markdown-it-footnote";
import deflistPlugin from "markdown-it-deflist";
import hljs from "highlight.js/lib/common";

import { dictionaryListPlugin } from "./definition-list.mjs";
import { alertMarkdownPlugin, renderAlerts, scanAlerts } from "./content-alerts.mjs";
import { renderBlocks, renderWithheldSections } from "./content-blocks.mjs";
import { renderFigureBlocks } from "./content-figures.mjs";
import { firstUsePlugin } from "./first-use.mjs";
import { iconPlugin } from "./content-icons.mjs";
import { imagePlugin } from "./content-images.mjs";
import { renderRuns } from "./content-scripts.mjs";
import { renderSpans, spanMarkdownPlugin } from "./content-spans.mjs";
import { cartoucheFigures, renderSymbolSpans } from "./content-symbols.mjs";
import { inlineVerse, parseVerse, renderVerseQuotes } from "./content-verse.mjs";
import { verseDivPlugin } from "./verse-regions.mjs";
import { replaceOutsideCode } from "./code-fences.mjs";
import { dictionaryEntryPlugin } from "./dictionary-layout.mjs";
import { headingAttributesPlugin, headingIdsPlugin } from "./heading-attributes.mjs";
import { INERT_BRACKET, previewSourcePlugin } from "./preview-source.mjs";
import { typographerPlugin } from "./typographer.mjs";

/** The targets a renderer is built for. */
export const RENDER_TARGETS = Object.freeze(["foundry", "web", "preview", "book"]);

/**
 * What each target writes into {@link renderRuns} as its target: only the
 * site's pages carry the search marker.
 */
const RUN_TARGET = Object.freeze({
    foundry: "foundry",
    web: "site",
    preview: "foundry",
    book: "book",
});

/**
 * Highlight a fenced block's code for the language it names.
 *
 * @param {string} code - The block's text.
 * @param {string} language - The fence's first word.
 * @returns {string} The code as highlight.js's class-based markup, or `""` when
 *   no language is named or highlight.js does not know it, which markdown-it
 *   reads as "escape it as plain text".
 */
export function highlightCode(code, language) {
    const name = String(language ?? "").toLowerCase();
    if (!name || !hljs.getLanguage(name)) return "";
    return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
}

/** Parse logical verse lines in the note's shared inline environment. */
function parseVerseContent(token, md, env, region) {
    const body = token.type === "verse_inline" ? token.meta.text : token.content;
    const inline = token.type === "verse_inline";
    const paired = inline ? undefined : env.verses?.get(body);
    const footnotes = new Set(Object.keys(env.footnotes?.refs ?? {}).map((key) => key.slice(1)));
    const model = paired?.model ?? region.model ?? parseVerse(body, { inline, footnotes });
    token.meta ??= {};
    token.meta.verse = region;
    token.meta.versePaired = paired;
    const parse = (text) => {
        const children = [];
        md.inline.parse(inlineVerse(text), md, env, children);
        return children;
    };
    token.meta.verseNotes = (model.notes ?? []).map((line) => ({
        children: parse(line.romanText ?? line.text),
    }));
    token.meta.verseGroups = model.groups.map((group) =>
        group.cantoBreak ?
            {
                ...group,
                children: group.text ? parse(group.text) : [],
                titleChildren: group.title ? parse(group.title) : [],
            }
        :   {
                ...group,
                lines: group.lines.map((line) => ({
                    ...line,
                    children: parse(line.text),
                    ...(paired ? { romanChildren: parse(line.romanText ?? line.text) } : {}),
                })),
            },
    );
}

/** An opaque quoted verse is parsed once, before footnote collection. */
function quotedVerse(token, state) {
    const classes = (token.attrGet("class") ?? "")
        .split(/\s+/)
        .filter((name) => name && name !== "verse");
    const attributes = Object.fromEntries(
        (token.attrs ?? []).filter(([key]) => !["id", "class"].includes(key)),
    );
    parseVerseContent(token, state.md, state.env, { id: token.attrGet("id"), classes, attributes });
}

/** A verse div's raw body receives inline parsing without block interpretation. */
function verseInlinePlugin(md) {
    md.core.ruler.after("inline", "verse_inline", (state) => {
        for (const token of state.tokens) {
            if (token.type !== "verse_div") continue;
            parseVerseContent(token, state.md, state.env, token.meta.verseRegion);
        }
    });
}

/** The tag {@link renderRuns} writes for emphasis in a script. */
const SCRIPT_EMPHASIS_OPEN = /^<(em|strong) class="emph-(rubric|overline)">/;

/**
 * Read the emphasis a script run's convention sets: an `<em>` or a `<strong>`
 * carrying `emph-rubric` or `emph-overline`, which {@link renderRuns} writes,
 * and the closing tag that matches one. Nothing else that looks like HTML is
 * read. The book parses with HTML off, and this is the one tag it reads.
 *
 * @param {import("markdown-it")} md - The parser.
 */
function scriptEmphasisPlugin(md) {
    md.inline.ruler.before("text", "script_emphasis", (state, silent) => {
        if (state.src.charCodeAt(state.pos) !== 0x3c) return false;
        const rest = state.src.slice(state.pos);
        const open = SCRIPT_EMPHASIS_OPEN.exec(rest);
        if (open) {
            if (!silent) {
                const token = state.push("script_emphasis_open", open[1], 1);
                token.meta = { convention: open[2] };
            }
            state.pos += open[0].length;
            return true;
        }
        const close = /^<\/(em|strong)>/.exec(rest);
        if (!close) return false;
        let depth = 0;
        for (const token of state.tokens) {
            if (token.type === "script_emphasis_open" && token.tag === close[1]) depth++;
            else if (token.type === "script_emphasis_close" && token.tag === close[1]) depth--;
        }
        if (depth <= 0) return false;
        if (!silent) state.push("script_emphasis_close", close[1], -1);
        state.pos += close[0].length;
        return true;
    });
}

/**
 * The footnote section's markup, shared by every HTML target: a heading, a
 * list, and anchors and numbers that follow the note-wide numbering `env`
 * carries.
 *
 * @param {import("markdown-it")} md - Markdown parser to extend.
 */
function footnoteMarkup(md) {
    const rules = md.renderer.rules;
    rules.footnote_block_open = () =>
        '<section class="footnotes"><h2>Footnotes</h2><ol class="footnotes-list">\n';
    rules.footnote_caption = (tokens, idx, _options, env) => {
        const meta = tokens[idx].meta;
        const number = env.footnoteNumbers?.get(meta.label) ?? meta.id + 1;
        return `[${number}${meta.subId > 0 ? `:${meta.subId}` : ""}]`;
    };
    rules.footnote_anchor_name = (tokens, idx, _options, env) => {
        const meta = tokens[idx].meta;
        const number = env.footnoteNumbers?.get(meta.label) ?? meta.id + 1;
        return `${env.docId ? `-${env.docId}-` : ""}${number}`;
    };
    rules.footnote_open = (tokens, idx, options, env, renderer) => {
        const meta = tokens[idx].meta;
        const number = env.footnoteNumbers?.get(meta.label) ?? meta.id + 1;
        const id = renderer.rules.footnote_anchor_name(tokens, idx, options, env, renderer);
        return `<li id="fn${id}" class="footnote-item" value="${number}">`;
    };
}

/**
 * An autolink's opening: `<scheme:…>` or `<name@host>`, which markdown reads
 * as a link and never as a tag.
 */
const AUTOLINK = /<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[^\s<>@]+@[^\s<>]+)>/y;

/**
 * Make the raw HTML an author wrote inert, leaving what markdown reads as a
 * link and anything inside code as written.
 *
 * The `preview` target parses with HTML on, because the stages of
 * {@link Renderer#prepare} write HTML between blank lines. A tag the author
 * wrote must still read as text, so its opening bracket becomes
 * {@link INERT_BRACKET} first, before the stages run and before expansion
 * writes its own markup; the preview renderer writes it back as `&lt;`, and
 * its source view as `<`.
 *
 * @param {string} markdown - Authored markdown.
 * @returns {string} The same markdown with each authored `<` that opens a tag,
 *   comment, declaration or processing instruction replaced.
 */
export function inertHtml(markdown) {
    return replaceOutsideCode(markdown, /<(?=[A-Za-z/!?])/g, (match, ...rest) => {
        const offset = rest.at(-2);
        const source = rest.at(-1);
        // `](<destination>)` is a link destination, never a tag.
        if (source.slice(offset - 2, offset) === "](") return match;
        AUTOLINK.lastIndex = offset;
        return AUTOLINK.test(source) ? match : INERT_BRACKET;
    });
}

/**
 * The preview's alerts that have a finding, written back as their authored
 * source in a block, so an editor shows an unfinished alert instead of a
 * guess at one.
 *
 * @param {string} markdown - The buffer's markdown.
 * @returns {string} The markdown with each alert holding a finding as a
 *   `<pre>` of its lines.
 */
function sourceMalformedAlerts(markdown) {
    const { errors, blocks } = scanAlerts(markdown);
    if (!errors.length) return markdown;
    const lines = markdown.split("\n");
    const faulted = blocks
        .filter((block) =>
            errors.some((error) => error.line >= block.start + 1 && error.line <= block.end + 1),
        )
        .sort((a, b) => b.start - a.start);
    const escape = (value) =>
        value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    for (const block of faulted) {
        const raw = lines.slice(block.start, block.end + 1).join("\n");
        lines.splice(
            block.start,
            block.end - block.start + 1,
            "",
            `<pre>${escape(raw).replaceAll(INERT_BRACKET, "&lt;")}</pre>`,
            "",
        );
    }
    return lines.join("\n");
}

/**
 * How a target's pictures resolve.
 *
 * @typedef {object} ImageSources
 * @property {(src: string) => string} [resolveSrc] - From a body image's address
 *   to the `src` the target draws.
 * @property {(src: string) => ({role?: string, width?: number|"", height?: number|""}|undefined)} [lookupAsset] -
 *   From an address to the asset it names.
 */

/**
 * What a renderer is built with.
 *
 * @typedef {object} RendererOptions
 * @property {() => (object|undefined)|object} [icons] - The icon registry, or a
 *   function that returns it, called at each render so a configuration read
 *   late is honoured. `foundry`, `web`, `preview` and `book`.
 * @property {ImageSources} [images] - How body images resolve. `foundry`, `web`
 *   and `preview`.
 * @property {boolean} [source] - `preview`: show wikilinks, spans, expressions
 *   and queries as highlighted authored source, for a buffer with no index.
 * @property {object} [sourceContext] - `preview` with `source`: the buffer's
 *   `fm`, `file` and `findings`, which the source view reads.
 */

/**
 * @typedef {object} RenderEnv
 * @property {import("./content-scripts.mjs").RunContext} [runs] - The package's
 *   languages, faces and maps.
 * @property {Array<object>} [figures] - The note's numbered figures, from the
 *   figure scan expansion made: matched in order when they are as many as the
 *   text holds, by id otherwise.
 * @property {(address: string) => string|undefined} [resolveRole] - From a
 *   picture's address to the role its asset declares, used when `figures` is
 *   not given.
 * @property {Map<string, number>} [footnoteNumbers] - Footnote numbers shared
 *   across the pages of one note.
 * @property {string} [docId] - Threaded into footnote anchors.
 * @property {(src: string) => string} [resolveSrc] - From a glyph's or
 *   cartouche's authored pathname to the address this render serves, taking
 *   the place of the renderer's own image resolver.
 */

/**
 * @typedef {object} Renderer
 * @property {RendererTarget} target - The target it renders for.
 * @property {import("markdown-it")} md - The configured parser.
 * @property {readonly string[]} plugins - The names of the plugins installed, in
 *   order. Targets that share a configuration share its names.
 * @property {(markdown: string, env?: RenderEnv) => string} prepare - Write the
 *   constructs markdown-it has no syntax for as HTML between blank lines.
 * @property {(markdown: string, env?: RenderEnv) => string} render - Prepare,
 *   then render to HTML.
 * @property {(markdown: string) => string} renderInline - Render one inline run.
 */

/** @typedef {"foundry"|"web"|"preview"|"book"} RendererTarget */

/**
 * Build the renderer for one target.
 *
 * @param {RendererTarget} target - What the markdown is rendered for.
 * @param {RendererOptions} [options] - Per-target inputs.
 * @returns {Renderer} The configured parser and its stages.
 * @throws {Error} When `target` is not one of {@link RENDER_TARGETS}.
 */
export function createRenderer(target, options = {}) {
    if (!RENDER_TARGETS.includes(target))
        throw new Error(
            `\`${target}\` is not a render target; expected ` +
                RENDER_TARGETS.slice(0, -1)
                    .map((name) => `\`${name}\``)
                    .join(", ") +
                ` or \`${RENDER_TARGETS.at(-1)}\``,
        );
    const book = target === "book";
    const preview = target === "preview";
    const source = preview && Boolean(options.source);
    const md =
        book ?
            new MarkdownIt({ html: false, linkify: false, typographer: false })
        :   new MarkdownIt({ html: true, highlight: highlightCode });
    const plugins = [];
    const use = (name, plugin, ...args) => {
        md.use(plugin, ...args);
        plugins.push(name);
    };

    use("footnotes", footnotePlugin);
    if (book) {
        use("alerts", alertMarkdownPlugin);
        use("spans", spanMarkdownPlugin, { verseInline: quotedVerse });
        use("verse-div", verseDivPlugin);
        use("verse-inline", verseInlinePlugin);
        use("script-emphasis", scriptEmphasisPlugin);
        use("definition-lists", deflistPlugin);
        use("icons", iconPlugin(options.icons));
        use("images", imagePlugin());
        use("first-use", firstUsePlugin);
    } else {
        use("cartouche-figures", cartoucheFigures);
        use("definition-lists", deflistPlugin);
        use("dictionary-rows", dictionaryListPlugin);
        // A `web` page's spans are written as HTML by `prepare`, which this
        // parser reads as inline HTML; the other HTML targets read them as tokens.
        if (!(target === "web"))
            use("spans", spanMarkdownPlugin, source ? { source: true } : { spoilers: true });
        use("dictionary-entries", dictionaryEntryPlugin);
        use("heading-attributes", headingAttributesPlugin);
        // A web page links its contents list to every heading, and sets its
        // punctuation as a printed page does.
        if (target === "web") {
            use("heading-ids", headingIdsPlugin);
            use("typographer", typographerPlugin);
        }
        // A buffer with no index has no registry to draw an icon from.
        if (!source) use("icons", iconPlugin(options.icons));
        use("images", imagePlugin(options.images?.resolveSrc, options.images?.lookupAsset));
        use("first-use", firstUsePlugin);
        footnoteMarkup(md);
        if (preview)
            use("preview-source", previewSourcePlugin, { ...options.sourceContext, source });
    }

    const unsupported = () => {
        throw new Error(
            "the `book` target is parsed, not rendered: markdownToTypst reads its tokens",
        );
    };

    // The preview sets titles and captions with its own parser, so an address
    // in one reads as source like any other.
    const renderInline = preview ? (text) => md.renderInline(text, {}) : undefined;
    const restore = (html) => (preview ? html.replaceAll(INERT_BRACKET, "&lt;") : html);

    /** Write the constructs markdown-it has no syntax for as HTML. */
    const prepare = (markdown, env = {}) => {
        let text = String(markdown ?? "");
        if (preview) text = sourceMalformedAlerts(text);
        let verses = env.verses;
        if (env.runs) {
            const marked = renderRuns(text, env.runs, undefined, { target: RUN_TARGET[target] });
            text = marked.markdown;
            verses = marked.verses;
        }
        // A glyph and a cartouche are pictures on every target that draws
        // HTML, so they are written before any stage renders a fragment. The
        // buffer-only preview shows a glyph as the source it was written in
        // and draws a cartouche.
        const resolveSrc = env.resolveSrc ?? options.images?.resolveSrc;
        text = renderSymbolSpans(text, resolveSrc, { glyphs: !source });
        const figured = renderFigureBlocks(
            text,
            target === "web" ? undefined : (block) => md.render(block),
            env.figures,
            { resolveRole: env.resolveRole, renderInline },
        );
        text = renderAlerts(
            renderBlocks(figured.markdown, target, { renderInline, verses }).markdown,
            target,
            {
                renderInline,
            },
        ).markdown;
        text = renderVerseQuotes(text);
        if (target === "web") text = renderSpans(text).markdown;
        return target === "web" ? renderWithheldSections(text) : text;
    };

    return {
        target,
        md,
        plugins: Object.freeze(plugins),
        prepare: book ? unsupported : prepare,
        render:
            book ? unsupported : (
                (markdown, env = {}) =>
                    restore(
                        md.render(prepare(markdown, env), {
                            footnoteNumbers: env.footnoteNumbers,
                            docId: env.docId,
                        }),
                    )
            ),
        renderInline:
            book ? unsupported : (
                (markdown) => restore(md.renderInline(renderVerseQuotes(String(markdown ?? ""))))
            ),
    };
}
