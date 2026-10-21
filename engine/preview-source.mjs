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
 * **What the preview target adds to the shared renderer.** The editor preview
 * renders a buffer that may have no content index. Where it has none, a
 * wikilink, a span, an expression and a query cannot be resolved, so the
 * preview shows each as highlighted authored source. Where it has one, links
 * and spans render as every target renders them, and only what a buffer cannot
 * answer — a query, a date that needs a calendar — stays highlighted source.
 *
 * {@link previewSourcePlugin} installs:
 *
 * - **Source highlighting** of wikilinks, embeds, bracket spans and
 *   expressions, when the buffer has no index; of expressions alone otherwise.
 * - **Table cells that keep their pipes**, so an extension's `|` stays inside
 *   its cell, with alignment written as a class a sanitizing host keeps.
 * - **Query fences as source**, since a buffer runs no query.
 * - **No generated sections**: a `See also` or `Related pages` heading and
 *   what it holds are absent, since a buffer has no related pages.
 * - **Secret headings as disclosures**: a `.secret` heading opens a closed
 *   disclosure that runs to the next heading at its level or above, wherever
 *   the heading sits. An editor shows the passage a reader will not see, and
 *   the build refuses a withheld heading that opens no page.
 *
 * @module
 */

import MarkdownIt from "markdown-it";
import Handlebars from "handlebars";
import { EXPRESSION, renderMarkdownExpressions } from "./markdown-expressions.mjs";
import { WIKILINK, parseWikilink } from "./wikilink-syntax.mjs";
import { splitHeadingAttributes } from "./heading-attributes.mjs";

/** Explicit dependency policy: a new registered helper requires a preview decision. */
export const PREVIEW_HELPERS = Object.freeze({
    eq: "local",
    gt: "local",
    gte: "local",
    lt: "local",
    lte: "local",
    not: "local",
    and: "local",
    or: "local",
    words: "local",
    digits: "local",
    sql: "dependent",
    dateformat: "dependent",
    ref: "reference",
});

/**
 * What stands for an authored `<` in the preview between
 * {@link module:engine/content-render.inertHtml} and the rendered HTML, where
 * it is written `&lt;`. A private-use character, so it can neither be read as
 * markup nor collide with prose.
 */
export const INERT_BRACKET = "\uE000";

const escapeHtml = new MarkdownIt().utils.escapeHtml;
// An authored `<` stands as a private-use character until the HTML is written;
// source is shown as it was authored.
const escape = (value) => escapeHtml(String(value ?? "").replaceAll(INERT_BRACKET, "<"));

/**
 * A span of authored source, coloured by what it is.
 *
 * @param {string} role - `bracket`, `address`, `label`, `attribute`, `dependent` or `fence`.
 * @param {string} source - The authored text.
 * @returns {string} The span, with the text escaped.
 */
export const colored = (role, source) =>
    `<span class="hl-preview-${role}">${escape(source)}</span>`;

/**
 * Highlight a wikilink or an embed without interpreting any Markdown or HTML
 * inside the source.
 *
 * @param {string} raw - The link as written, from `[[` or `![[` to its end.
 * @returns {string} The highlighted source.
 */
export function wikiSource(raw) {
    const open = raw.startsWith("!") ? "![[" : "[[";
    const close = raw.indexOf("]]", open.length);
    const end = close < 0 ? raw.length : close;
    const inner = raw.slice(open.length, end);
    const pipe = inner.indexOf("|");
    const secret = close >= 0 && parseWikilink(inner, raw).attributes?.classes.includes("secret");
    const label =
        colored("address", pipe < 0 ? inner : inner.slice(0, pipe)) +
        (pipe < 0 ? "" : colored("bracket", "|") + colored("label", inner.slice(pipe + 1)));
    const html =
        colored("bracket", open) +
        (secret ? `<span class="hl-preview-secret-content">${label}</span>` : label) +
        (close < 0 ? "" : colored("bracket", "]]") + colored("attribute", raw.slice(close + 2)));
    return secret ? `<span class="hl-preview-secret" tabindex="0">${html}</span>` : html;
}

/** Read a dependent call anywhere in the Handlebars AST, including hash values. */
function dependentExpression(source, fm) {
    const authoredValue = (node) => {
        if (node?.type === "StringLiteral") return node.value;
        if (node?.type !== "PathExpression" || node.depth || node.data || !node.parts?.length)
            return undefined;
        let value = fm;
        for (const part of node.parts) {
            if (!value || typeof value !== "object" || !Object.hasOwn(value, part))
                return undefined;
            value = value[part];
        }
        return value;
    };
    const visit = (node) => {
        if (!node || typeof node !== "object") return false;
        if (["MustacheStatement", "SubExpression"].includes(node.type)) {
            const name = node.path?.original;
            const policy = PREVIEW_HELPERS[name];
            if (policy === "dependent") return true;
            if (policy === "reference") {
                const target = authoredValue(node.params?.[0]);
                if (typeof target !== "string" || !target.startsWith("#")) return true;
                // Date-valued event fields need calendar context even on this note.
                if (
                    node.hash?.pairs?.some(
                        (pair) =>
                            pair.key === "field" &&
                            !["kind", "summary", "name"].includes(pair.value?.value),
                    )
                )
                    return true;
            }
            if ((node.params?.length || node.hash?.pairs?.length) && !policy) return true;
        }
        return Object.values(node).some((value) =>
            Array.isArray(value) ? value.some(visit) : visit(value),
        );
    };
    try {
        return visit(Handlebars.parse(source));
    } catch {
        return true;
    }
}

/**
 * The end of a wikilink's partially entered trailing attribute block, so an
 * unfinished `{…` stays with the link it follows.
 *
 * @param {string} rest - The source from the link's start.
 * @param {string} raw - The link itself.
 * @returns {string} The link with its attribute block, as far as it goes on the line.
 */
function withTrailingAttributes(rest, raw) {
    if (rest[raw.length] !== "{") return raw;
    let quoted = false,
        escaped = false,
        end = raw.length + 1;
    for (; end < rest.length && rest[end] !== "\n"; end++) {
        const char = rest[end];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === "\\") {
            escaped = true;
            continue;
        }
        if (char === '"') quoted = !quoted;
        if (char === "}" && !quoted) {
            end++;
            break;
        }
    }
    return rest.slice(0, end);
}

/**
 * The cells of one table row, keeping a pipe inside a wikilink, a code span or
 * an extension's braces in its cell.
 *
 * @param {string} line - One table line.
 * @returns {string[]} The trimmed cells, without the empty edges.
 */
function tableCells(line) {
    const result = [];
    let cell = "",
        wiki = false,
        code = "",
        quote = false,
        braces = 0;
    for (let at = 0; at < line.length; at++) {
        const char = line[at];
        if (char === "\\" && at + 1 < line.length) {
            cell += char + line[++at];
            continue;
        }
        if (char === "`" && !wiki) {
            const marks = /^`+/.exec(line.slice(at))[0];
            if (!code) code = marks;
            else if (code === marks) code = "";
            cell += marks;
            at += marks.length - 1;
            continue;
        }
        if (!code) {
            if (line.slice(at, at + 2) === "[[") wiki = true;
            if (line.slice(at - 1, at + 1) === "]]") wiki = false;
            if (char === '"' && braces) quote = !quote;
            if (!quote && char === "{") braces++;
            if (!quote && char === "}" && braces) braces--;
        }
        if (char === "|" && !wiki && !code && !braces) {
            result.push(cell.trim());
            cell = "";
        } else cell += char;
    }
    result.push(cell.trim());
    if (!result[0]) result.shift();
    if (!result.at(-1)) result.pop();
    return result;
}

/**
 * Install the preview target's rules.
 *
 * @param {import("markdown-it")} md - The shared parser.
 * @param {object} [options]
 * @param {boolean} [options.source] - The buffer has no index: show wikilinks,
 *   embeds, spans and local expressions as authored source.
 * @param {object} [options.fm] - The buffer's frontmatter, which a local
 *   expression reads.
 * @param {string} [options.file] - The buffer's name, for a finding.
 * @param {Map<string, object>} [options.figures] - The buffer's captioned items
 *   by id, which a local `ref` reads.
 */
export function previewSourcePlugin(md, { source = false, fm = {}, file = "", figures } = {}) {
    const inline = (text) => {
        const tokens = [];
        md.inline.parse(text, md, {}, tokens);
        return md.renderer.renderInline(tokens, md.options, {});
    };
    md.renderer.rules.hl_preview_source = (tokens, idx) => tokens[idx].meta.html;
    // Run before ordinary links and text so protected source becomes one opaque token.
    md.inline.ruler.before("link", "hl_preview_source", (state, silent) => {
        const rest = state.src.slice(state.pos);
        let raw, html;
        if (source && (rest.startsWith("[[") || rest.startsWith("![["))) {
            const match = new RegExp(`^(?:!)?${WIKILINK.source.replace("(?<!!)", "")}`).exec(rest);
            raw = withTrailingAttributes(rest, match?.[0] ?? rest.split("\n")[0]);
            html = wikiSource(raw);
        } else if (rest.startsWith("{{")) {
            const match = new RegExp(`^${EXPRESSION.source.replace("(?<![\\\\{])", "")}`).exec(
                rest,
            );
            raw = match?.[0] ?? rest.split("\n")[0];
            if (source && match && !dependentExpression(raw, fm)) {
                const entries =
                    Array.isArray(fm.data?.events) ?
                        fm.data.events.filter((entry) => entry && typeof entry === "object")
                    :   [];
                const own = {
                    events: entries.map((entry) => ({ id: entry.id, entry })),
                    anchors: entries
                        .filter((entry) => entry.id)
                        .map((entry) => ({ slug: entry.id, kind: "event" })),
                };
                const events = { note: () => undefined, own: () => own };
                const result = renderMarkdownExpressions(raw, { fm, figures, events, file });
                if (!result.findings.length)
                    html = /^{{\s*ref\b/.test(raw) ? inline(result.markdown) : result.markdown;
            }
            html ??= colored("dependent", raw);
        } else return false;
        if (!silent) {
            const token = state.push("hl_preview_source", "", 0);
            token.meta = { html };
        }
        state.pos += raw.length;
        return true;
    });
    if (source)
        md.renderer.rules.span_source = (tokens, idx) => {
            const token = tokens[idx];
            const end = token.meta.labelEnd;
            const secret = Boolean(token.meta.secret);
            const classes = `hl-preview-span${secret ? " hl-preview-secret" : ""}`;
            const focus = secret ? ' tabindex="0"' : "";
            // A secret's label sits behind a cover, so it is set as the reader
            // will read it; any other label is the authored text.
            const text = token.content.slice(1, end);
            const label =
                secret ?
                    `<span class="hl-preview-label">${inline(text)}</span>`
                :   colored("label", text);
            return `<span class="${classes}"${focus}>${
                colored("bracket", "[") +
                (secret ? `<span class="hl-preview-secret-content">${label}</span>` : label) +
                colored("bracket", "]") +
                colored("attribute", token.content.slice(end + 1))
            }</span>`;
        };

    // Keep extension pipes inside their cell. Markdown's table splitter only
    // understands escaped pipes, before inline rules have a chance to see them.
    md.block.ruler.before(
        "table",
        "hl_preview_table",
        (state, start, end, silent) => {
            const lineAt = (line) =>
                state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
            if (start + 1 >= end || state.sCount[start] - state.blkIndent >= 4) return false;
            const header = tableCells(lineAt(start)),
                separators = tableCells(lineAt(start + 1));
            if (
                !lineAt(start).includes("|") ||
                !header.length ||
                separators.length !== header.length ||
                !separators.every((cell) => /^:?-+:?$/.test(cell))
            )
                return false;
            if (silent) return true;
            const row = (values, tag) => {
                state.push("tr_open", "tr", 1);
                for (let col = 0; col < header.length; col++) {
                    const cell = state.push(`${tag}_open`, tag, 1);
                    const alignment =
                        separators[col].startsWith(":") ?
                            separators[col].endsWith(":") ?
                                "center"
                            :   "left"
                        : separators[col].endsWith(":") ? "right"
                        : "";
                    if (alignment) cell.attrSet("class", `hl-preview-align-${alignment}`);
                    const token = state.push("inline", "", 0);
                    token.content = values[col] ?? "";
                    token.children = [];
                    state.push(`${tag}_close`, tag, -1);
                }
                state.push("tr_close", "tr", -1);
            };
            const open = state.push("table_open", "table", 1);
            open.map = [start, start + 2];
            state.push("thead_open", "thead", 1);
            row(header, "th");
            state.push("thead_close", "thead", -1);
            state.push("tbody_open", "tbody", 1);
            let line = start + 2;
            for (; line < end && lineAt(line).trim() && lineAt(line).includes("|"); line++)
                row(tableCells(lineAt(line)), "td");
            state.push("tbody_close", "tbody", -1);
            state.push("table_close", "table", -1);
            open.map[1] = line;
            state.line = line;
            return true;
        },
        { alt: ["paragraph", "reference"] },
    );

    // A buffer runs no query: the fence is the authored source.
    const fence = md.renderer.rules.fence;
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        const name = token.info.trim().split(/\s/)[0];
        if (["sql", "pagelist", "map"].includes(name)) {
            const raw =
                token.meta?.source ??
                `${token.markup}${token.info}\n${token.content}${token.markup}`;
            return `<pre class="hl-preview-${name === "map" ? "dependent" : "fence"}"><code>${escape(raw)}</code></pre>\n`;
        }
        return fence(tokens, idx, options, env, self);
    };
    // Capture fences from their original source lines, retaining all delimiters.
    md.core.ruler.before("inline", "hl_preview_structure", (state) => {
        const lines = state.src.split("\n");
        for (const token of state.tokens)
            if (token.type === "fence")
                token.meta = {
                    ...token.meta,
                    source: lines.slice(token.map[0], token.map[1]).join("\n"),
                };
        // Use parsed heading tokens so a fenced example is never a section boundary.
        for (let i = state.tokens.length - 1; i >= 0; i--) {
            const token = state.tokens[i];
            if (token.type !== "heading_open") continue;
            const content = state.tokens[i + 1];
            const parsed = splitHeadingAttributes(content.content);
            if (/^(?:see also|related pages)$/i.test(parsed.text)) {
                const level = Number(token.tag.slice(1));
                let end = i + 3;
                while (
                    end < state.tokens.length &&
                    !(
                        state.tokens[end].type === "heading_open" &&
                        Number(state.tokens[end].tag.slice(1)) <= level
                    )
                )
                    end++;
                state.tokens.splice(i, end - i);
            } else if (!parsed.problems.length && parsed.classes.includes("secret")) {
                // A withheld heading names only its anchor; the disclosure
                // below carries the withholding.
                content.content = parsed.text;
                if (parsed.id) token.attrSet("id", parsed.id);
                token.meta = { ...token.meta, secret: true };
            }
        }
        // A `.secret` heading hides its section through the next heading at the
        // same or a higher level, wherever the heading sits.
        const output = [],
            sections = [];
        const closeSection = () => {
            output.push(new state.Token("details_close", "details", -1));
            sections.pop();
        };
        for (const token of state.tokens) {
            const level = token.type === "heading_open" ? Number(token.tag.slice(1)) : null;
            while (
                sections.length &&
                ((token.nesting === -1 && token.level < sections.at(-1).scope) ||
                    (level !== null &&
                        token.level <= sections.at(-1).scope &&
                        level <= sections.at(-1).level))
            )
                closeSection();
            if (token.type === "heading_open" && token.meta?.secret) {
                const open = new state.Token("details_open", "details", 1);
                open.attrSet("class", "secret");
                output.push(open, new state.Token("summary_open", "summary", 1));
                const title = new state.Token("inline", "", 0);
                title.content = "Secret";
                title.children = [];
                output.push(title, new state.Token("summary_close", "summary", -1));
                sections.push({ level, scope: token.level });
            }
            output.push(token);
        }
        while (sections.length) closeSection();
        state.tokens = output;
    });
}
