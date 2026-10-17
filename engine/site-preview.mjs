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

/** Buffer-only HTML preview shared by editors and external renderers. @module */

import MarkdownIt from "markdown-it";
import footnotePlugin from "markdown-it-footnote";
import deflistPlugin from "markdown-it-deflist";
import { dictionaryListPlugin } from "./definition-list.mjs";
import Handlebars from "handlebars";
import matter from "gray-matter";
import { ALERT_TYPES, alertMarkdownPlugin, scanAlerts } from "./content-alerts.mjs";
import { spanMarkdownPlugin } from "./content-spans.mjs";
import { scanPoetry, poetryStanzas } from "./content-poetry.mjs";
import { scanFigures } from "./content-figures.mjs";
import { scanBlocks } from "./content-blocks.mjs";
import { splitHeadingAttributes } from "./heading-attributes.mjs";
import { EXPRESSION, renderMarkdownExpressions } from "./markdown-expressions.mjs";
import { WIKILINK, parseWikilink } from "./wikilink-syntax.mjs";
import { dataFields } from "./note-vocabulary.mjs";
import { applyComputedBeingAge } from "./being-age.mjs";
import { DEFAULT_CURRENT_DATE, normalizeCurrentDate } from "./current-date.mjs";

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

const escapeHtml = new MarkdownIt().utils.escapeHtml;
const escape = (value) => escapeHtml(String(value ?? ""));
const colored = (role, source) => `<span class="hl-preview-${role}">${escape(source)}</span>`;

/** Highlight without interpreting any Markdown or HTML inside the source. */
function wikiSource(raw) {
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

function parserFor(fm, findings, file) {
    const md = new MarkdownIt({ html: false, linkify: false })
        .use(footnotePlugin)
        .use(deflistPlugin)
        .use(dictionaryListPlugin)
        .use(alertMarkdownPlugin)
        .use(spanMarkdownPlugin, { source: true });
    const figures = new Map();
    const inline = (text, env = {}) => {
        const tokens = [];
        md.inline.parse(text, md, env, tokens);
        return md.renderer.renderInline(tokens, md.options, env);
    };
    md.renderer.rules.hl_preview_source = (tokens, idx) => tokens[idx].meta.html;
    // Run before ordinary links and text so protected source becomes one opaque token.
    md.inline.ruler.before("link", "hl_preview_source", (state, silent) => {
        const rest = state.src.slice(state.pos);
        let raw, html;
        if (rest.startsWith("[[") || rest.startsWith("![[")) {
            const match = new RegExp(`^(?:!)?${WIKILINK.source.replace("(?<!!)", "")}`).exec(rest);
            raw = match?.[0] ?? rest.split("\n")[0];
            // Preserve a partially entered trailing attribute too.
            if (rest[raw.length] === "{") {
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
                raw = rest.slice(0, end);
            }
            html = wikiSource(raw);
        } else if (rest.startsWith("{{")) {
            const match = new RegExp(`^${EXPRESSION.source.replace("(?<![\\\\{])", "")}`).exec(
                rest,
            );
            raw = match?.[0] ?? rest.split("\n")[0];
            if (!dependentExpression(raw, fm) && match) {
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
    md.renderer.rules.span_source = (tokens, idx) => {
        const token = tokens[idx];
        const end = token.meta.labelEnd;
        const secret = Boolean(token.meta.secret);
        const classes = `hl-preview-span${secret ? " hl-preview-secret" : ""}`;
        const focus = secret ? ' tabindex="0"' : "";
        const label = colored("label", token.content.slice(1, end));
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
            const cells = (line) => {
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
            };
            if (start + 1 >= end || state.sCount[start] - state.blkIndent >= 4) return false;
            const header = cells(lineAt(start)),
                separators = cells(lineAt(start + 1));
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
                row(cells(lineAt(line)), "td");
            state.push("tbody_close", "tbody", -1);
            state.push("table_close", "table", -1);
            open.map[1] = line;
            state.line = line;
            return true;
        },
        { alt: ["paragraph", "reference"] },
    );
    const quoteOpen = md.renderer.rules.blockquote_open;
    md.renderer.rules.blockquote_open = (tokens, idx, options, env, self) => {
        const block = tokens[idx].meta?.alert;
        if (!block)
            return quoteOpen ? quoteOpen(tokens, idx, options, env, self) : "<blockquote>\n";
        const id = block.id ? ` id="${escape(block.id)}"` : "";
        return `<blockquote class="alert alert-${block.type}"${id}>\n`;
    };
    md.renderer.rules.hl_preview_alert_title_open = (tokens, idx) =>
        `<p class="alert-title">${ALERT_TYPES[tokens[idx].meta.type].svg}`;
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
        const alertErrors = scanAlerts(state.src).errors;
        for (let i = state.tokens.length - 1; i >= 0; i--) {
            const token = state.tokens[i],
                alert = token.meta?.alert;
            if (
                !alert ||
                !alertErrors.some(
                    (error) => error.line >= alert.start + 1 && error.line <= alert.end + 1,
                )
            )
                continue;
            let depth = 1,
                end = i + 1;
            for (; end < state.tokens.length; end++) {
                if (state.tokens[end].type === "blockquote_open") depth++;
                if (state.tokens[end].type === "blockquote_close" && --depth === 0) break;
            }
            token.type = "hl_preview_source";
            token.nesting = 0;
            token.meta = {
                html: `<pre>${escape(lines.slice(alert.start, alert.end + 1).join("\n"))}</pre>`,
            };
            state.tokens.splice(i + 1, end - i);
        }
        for (let i = state.tokens.length - 1; i >= 0; i--) {
            const block = state.tokens[i].meta?.alert;
            if (!block) continue;
            const open = new state.Token("hl_preview_alert_title_open", "p", 1);
            open.meta = block;
            const title = new state.Token("inline", "", 0);
            title.content = block.title;
            title.children = [];
            const close = new state.Token("paragraph_close", "p", -1);
            state.tokens.splice(i + 1, 0, open, title, close);
        }
        const poetry = scanPoetry(state.src).blocks;
        const localFigures = scanFigures(state.src).figures;
        for (const fig of localFigures) if (fig.id) figures.set(fig.id, fig);
        for (const token of state.tokens) {
            if (token.type === "fence")
                token.meta = {
                    ...token.meta,
                    source: lines.slice(token.map[0], token.map[1]).join("\n"),
                    poem: poetry.find((poem) => poem.start === token.map[0]),
                };
        }
        // Poetry must become inline tokens before footnote collection, so a
        // definition outside the fence remains visible to a verse reference.
        for (let i = state.tokens.length - 1; i >= 0; i--) {
            const token = state.tokens[i];
            const poem = token.meta?.poem;
            if (!poem) continue;
            const replacement = [];
            const push = (type, tag, nesting, attrs) => {
                const part = new state.Token(type, tag, nesting);
                if (attrs) part.attrs = attrs;
                replacement.push(part);
                return part;
            };
            push("hl_preview_poetry_open", "div", 1, [["class", "poetry"]]).map = token.map;
            for (const stanza of poetryStanzas(poem.body)) {
                push("paragraph_open", "p", 1);
                stanza.forEach(({ text, level }, row) => {
                    if (row) push("hardbreak", "br", 0);
                    push("hl_preview_poetry_line_open", "span", 1, [
                        ["class", `poetry-line i${level}`],
                    ]);
                    const line = push("inline", "", 0);
                    line.content = text;
                    line.children = [];
                    push("hl_preview_poetry_line_close", "span", -1);
                });
                push("paragraph_close", "p", -1);
            }
            push("hl_preview_poetry_close", "div", -1);
            state.tokens.splice(i, 1, ...replacement);
        }
        // Work backwards so figure ranges and heading removals retain source maps.
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
            } else if (!parsed.problems.length) {
                content.content = parsed.text;
                if (parsed.id) token.attrSet("id", parsed.id);
                token.meta = { ...token.meta, secret: parsed.classes.includes("secret") };
            }
        }
        for (const fig of localFigures.reverse()) {
            const first = state.tokens.findIndex(
                (token) => token.type === "paragraph_open" && token.map?.[0] === fig.captionStart,
            );
            if (first < 0) continue;
            let after = first + 3;
            while (
                after < state.tokens.length &&
                (state.tokens[after].map?.[0] ?? -1) < fig.bodyEnd
            )
                after++;
            // Match closing tokens of the last block as well.
            while (
                after < state.tokens.length &&
                !state.tokens[after].map &&
                state.tokens[after].nesting < 0
            )
                after++;
            const open = new state.Token("hl_preview_figure_open", "div", 1);
            open.meta = fig;
            const caption = new state.Token("inline", "", 0);
            caption.content = `${fig.label}${fig.label && fig.hasCaption ? ": " : ""}${fig.caption}`;
            caption.children = [];
            const titleOpen = new state.Token("paragraph_open", "p", 1);
            titleOpen.attrSet("class", "content-figure-label");
            const titleClose = new state.Token("paragraph_close", "p", -1);
            const close = new state.Token("hl_preview_figure_close", "div", -1);
            state.tokens.splice(after, 0, titleOpen, caption, titleClose, close);
            state.tokens.splice(first, 3, open);
        }
        // Use parsed heading tokens so fenced examples are never section boundaries.
        // Keep all inline tokens in this document for shared footnote collection.
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
    md.renderer.rules.hl_preview_figure_open = (tokens, idx) => {
        const fig = tokens[idx].meta;
        return `<div class="content-figure content-figure-${escape(fig.kind)}"${fig.slug ? ` id="${escape(fig.slug)}"` : ""}>\n`;
    };
    md.renderer.rules.hl_preview_figure_close = () => "</div>\n";
    // Shared container parser determines complete nested ranges; tokenizing each
    // body within the same state keeps document footnotes in scope.
    md.block.ruler.before(
        "fence",
        "hl_preview_container",
        (state, start, end, silent) => {
            if (!state.src.slice(state.bMarks[start] + state.tShift[start]).startsWith(":::"))
                return false;
            const block = scanBlocks(state.src).blocks.find((block) => block.start === start);
            if (!block || block.end >= end) return false;
            if (silent) return true;
            const open = state.push(
                "hl_preview_container_open",
                block.name === "secret" ? "details" : "div",
                1,
            );
            open.meta = block;
            if (block.name === "secret") {
                state.push("summary_open", "summary", 1);
                const title = state.push("inline", "", 0);
                title.content = block.title;
                title.children = [];
                state.push("summary_close", "summary", -1);
            }
            const oldMax = state.lineMax;
            state.lineMax = block.end;
            state.md.block.tokenize(state, start + 1, block.end);
            state.lineMax = oldMax;
            const close = state.push("hl_preview_container_close", open.tag, -1);
            close.meta = block;
            state.line = block.end + 1;
            return true;
        },
        { alt: ["paragraph", "reference", "blockquote", "list"] },
    );
    md.renderer.rules.hl_preview_container_open = (tokens, idx, _options, env) => {
        const block = tokens[idx].meta;
        const attrs = `${block.id ? ` id="${escape(block.id)}"` : ""} class="${escape([block.name, ...block.classes].join(" "))}"`;
        return block.name === "secret" ? `<details${attrs}>` : `<div${attrs}>\n`;
    };
    md.renderer.rules.hl_preview_container_close = (tokens, idx) => `</${tokens[idx].tag}>\n`;
    return md;
}

/** A small profile from authored fields; references never acquire resolved data. */
function localInfobox(fm, md) {
    const fields = dataFields(fm.type) ?? [];
    const rows = [];
    const present = (value) => (typeof value === "string" ? value : JSON.stringify(value));
    for (const [name, value] of Object.entries(fm.data ?? {})) {
        if (["seeAlso", "related", "pack", "packFolder"].includes(name)) continue;
        if (name === "age" && (value === null || value === undefined || value === "")) continue;
        const field = fields.find((field) => field.name === name);
        const source = present(value);
        let html;
        if (
            typeof value === "string" &&
            /^!?\[\[/.test(value) &&
            (/^!/.test(value) || ["portrait", "banner", "icon", "token", "image"].includes(name))
        )
            html = wikiSource(value);
        else if (
            field?.kind === "address" ||
            field?.entryKind === "address" ||
            field?.ref ||
            field?.accepts ||
            ["born", "died", "calendar", "map", "events"].includes(name)
        )
            html = colored("dependent", source);
        else html = md.renderInline(source ?? "");
        rows.push(`<dt>${escape(name)}</dt><dd>${html}</dd>`);
    }
    if (!rows.length) return "";
    return `<aside class="hl-preview-infobox"><dl>${rows.join("")}</dl></aside>`;
}

/**
 * Render one complete buffer with no configuration, index, filesystem or database.
 * @param {string} text - Markdown, optionally beginning with YAML frontmatter.
 * @param {{dark?: boolean, infobox?: boolean, file?: string, currentDate?: string}} [options] - Explicit palette, profile visibility, diagnostic filename and neutral current date (default "720.1").
 * @returns {{ok: boolean, html: string, frontmatter: object, findings: object[]}} HTML and metadata with locally calculable ages; unavailable ages remain absent or null.
 */
export function renderPreview(
    text,
    { dark = false, infobox = true, file = "", currentDate = DEFAULT_CURRENT_DATE } = {},
) {
    const date = normalizeCurrentDate(currentDate);
    const findings = [];
    let frontmatter = {},
        body = String(text ?? "");
    try {
        const parsed = matter(body);
        frontmatter =
            parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data) ?
                structuredClone(parsed.data)
            :   {};
        body = parsed.content;
    } catch (error) {
        findings.push({ file, severity: "warning", message: String(error.message) });
    }
    applyComputedBeingAge(frontmatter, date);
    if (String(frontmatter.type ?? "").toLowerCase() === "being") {
        frontmatter.data ??= {};
        if (
            typeof frontmatter.data === "object" &&
            !Array.isArray(frontmatter.data) &&
            !Object.hasOwn(frontmatter.data, "age")
        )
            frontmatter.data.age = null;
    }
    const md = parserFor(frontmatter, findings, file);
    const content = md.render(body);
    const profile = infobox ? localInfobox(frontmatter, md) : "";
    return {
        ok: true,
        html: `<div class="hl-preview hl-preview-${dark ? "dark" : "light"}">${profile}<main class="hl-preview-main">${content}</main></div>`,
        frontmatter,
        findings,
    };
}

/**
 * Opt in to reading only the project's currentDate setting; never called by renderPreview.
 * @param {string} root - Directory from which to find the nearest package configuration.
 * @returns {Promise<string>} Validated neutral date, or the shared default when no setting is present.
 */
export async function readPreviewCurrentDate(root) {
    const reader = await import("./preview-current-date.mjs");
    return reader.readPreviewCurrentDate(root);
}

/** Both explicit palettes, scoped to the preview container. */
export function previewStyles() {
    return `
.hl-preview.hl-preview-light { --hl-bg:#ffffff; --hl-panel:#f6f8fa; --hl-fg:#24292f; --hl-blue:#0969da; --hl-purple:#6c3fd1; --hl-green:#1a7f37; --hl-grey:#57606a; --hl-note:#0969da; --hl-note-bg:#f6faff; --hl-tip:#1a7f37; --hl-tip-bg:#f4fbf5; --hl-important:#6c3fd1; --hl-important-bg:#faf7ff; --hl-warning:#9a6700; --hl-warning-bg:#fffaf0; color-scheme:light; }
.hl-preview.hl-preview-dark { --hl-bg:#0d1117; --hl-panel:#161b22; --hl-fg:#e6edf3; --hl-blue:#58a6ff; --hl-purple:#c4b0ff; --hl-green:#7ee787; --hl-grey:#8b949e; --hl-note:#58a6ff; --hl-note-bg:#101a28; --hl-tip:#7ee787; --hl-tip-bg:#102018; --hl-important:#c4b0ff; --hl-important-bg:#1c172a; --hl-warning:#d29922; --hl-warning-bg:#241d10; color-scheme:dark; }
.hl-preview { background:var(--hl-bg); color:var(--hl-fg); padding:1rem; overflow-wrap:anywhere; }
.hl-preview .hl-preview-main { color:var(--hl-fg); background:var(--hl-bg); }
.hl-preview a, .hl-preview .hl-preview-bracket { color:var(--hl-blue)!important; opacity:1!important; }
.hl-preview .hl-preview-address { color:var(--hl-purple)!important; opacity:1!important; }
.hl-preview .hl-preview-label { color:var(--hl-fg)!important; font-weight:700!important; opacity:1!important; }
.hl-preview .hl-preview-dependent { color:var(--hl-green)!important; opacity:1!important; }
.hl-preview .hl-preview-attribute, .hl-preview .hl-preview-fence, .hl-preview .hl-preview-fence code { color:var(--hl-grey)!important; font-weight:400!important; opacity:1!important; }
.hl-preview pre, .hl-preview code, .hl-preview .hl-preview-infobox { background:var(--hl-panel); }
.hl-preview pre { padding:1rem; white-space:pre-wrap; }
.hl-preview .hl-preview-infobox { padding:1rem; color:var(--hl-fg); }
@media (min-width:48rem) { .hl-preview:has(> .hl-preview-infobox) { display:grid; grid-template-columns:minmax(0,1fr) minmax(14rem,20rem); gap:1.5rem; align-items:start; } .hl-preview > .hl-preview-infobox { grid-column:2; grid-row:1; } .hl-preview > .hl-preview-main { grid-column:1; grid-row:1; } }
.hl-preview dt { font-weight:700; }
.hl-preview dd { font-weight:400; }
.hl-preview .dictionary { --indent:150px; --gap:.75em; margin:0; display:block; }
.hl-preview .dictionary > div { padding-left:var(--indent); text-indent:calc(-1 * var(--indent)); margin-bottom:.5em; }
.hl-preview .dictionary > div > dt { display:inline-block; min-width:calc(var(--indent) - var(--gap)); margin-right:var(--gap); font-weight:bold; white-space:nowrap; text-indent:0; text-align:left; }
.hl-preview .dictionary > div > dd { display:inline; margin:0; font-weight:normal; }
.hl-preview .dictionary > div > dd > :is(p, ul, ol, dl, blockquote, pre, table, div) { text-indent:0; }
.hl-preview .dictionary > div > dd > p:first-child { display:inline; }
@media (max-width:600px) { .hl-preview .dictionary { --indent:100px; } }
.hl-preview .hl-preview-span, .hl-preview .hl-preview-span .hl-preview-attribute, .hl-preview .hl-preview-span .hl-preview-bracket { font-weight:700!important; }
.hl-preview .hl-preview-secret { cursor:help; }
.hl-preview .hl-preview-secret:not(:hover):not(:focus):not(:focus-within) .hl-preview-secret-content { color:transparent!important; background-color:var(--hl-fg)!important; text-shadow:none!important; }
.hl-preview .hl-preview-secret:not(:hover):not(:focus):not(:focus-within) .hl-preview-secret-content * { color:transparent!important; -webkit-text-fill-color:transparent!important; visibility:hidden!important; text-shadow:none!important; text-decoration-color:transparent!important; }
.hl-preview .hl-preview-secret:focus { outline:2px solid var(--hl-blue); outline-offset:2px; }
.hl-preview .hl-preview-infobox dd { margin:0 0 .5rem; white-space:pre-wrap; }
.hl-preview .hl-preview-align-center { text-align:center; }
.hl-preview .hl-preview-align-right { text-align:right; }
.hl-preview .hl-preview-align-left { text-align:left; }
.hl-preview th, .hl-preview td { background:var(--hl-bg); color:var(--hl-fg); padding:.3rem .6rem; border:1px solid var(--hl-grey); }
.hl-preview .alert { border:0; border-left:4px solid var(--hl-accent); background:var(--hl-alert-bg); color:var(--hl-fg); padding:1rem; border-radius:.375rem; margin:1rem 0; }
.hl-preview .alert-note { --hl-accent:var(--hl-note); --hl-alert-bg:var(--hl-note-bg); }
.hl-preview .alert-tip { --hl-accent:var(--hl-tip); --hl-alert-bg:var(--hl-tip-bg); }
.hl-preview .alert-important { --hl-accent:var(--hl-important); --hl-alert-bg:var(--hl-important-bg); }
.hl-preview .alert-warning { --hl-accent:var(--hl-warning); --hl-alert-bg:var(--hl-warning-bg); }
.hl-preview .alert .alert-title { color:var(--hl-accent); font-weight:700; opacity:1; }
.hl-preview .alert .alert-icon { width:1em; height:1em; margin-right:.5em; vertical-align:-.1em; color:var(--hl-accent); fill:currentColor; }
.hl-preview .poetry-line { white-space:pre-wrap; }
${Array.from({ length: 9 }, (_, n) => `.hl-preview .poetry-line.i${n} { padding-left:${n * 2}em; }`).join("\n")}
`;
}
