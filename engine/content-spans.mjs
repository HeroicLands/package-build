/* SPDX-License-Identifier: GPL-3.0-or-later */
import MarkdownIt from "markdown-it";
import footnotePlugin from "markdown-it-footnote";
import { parseExtensionAttributes, refusedAttributes } from "./extension-attributes.mjs";

/** Add bracket spans after recognized Markdown links and footnotes.
 * @param {import("markdown-it")} md - Markdown parser to extend.
 */
export function spanMarkdownPlugin(md) {
    md.inline.ruler.after("link", "bracket_span", (state, silent) => {
        const start = state.pos;
        if (
            state.src[start] !== "[" ||
            state.src[start + 1] === "[" ||
            state.src[start + 1] === "^" ||
            ["!", "[", "]"].includes(state.src[start - 1])
        )
            return false;
        const end = state.md.helpers.parseLinkLabel(state, start, false);
        if (end < 0 || ["(", "["].includes(state.src[end + 1])) return false;
        let finish = end + 1;
        let parsed = { id: "", classes: [], values: {}, problems: [] };
        if (state.src[finish] === "{") {
            let quote = false,
                escape = false,
                close = finish + 1;
            for (; close < state.posMax; close++) {
                const char = state.src[close];
                if (escape) {
                    escape = false;
                    continue;
                }
                if (char === "\\") {
                    escape = true;
                    continue;
                }
                if (char === '"') quote = !quote;
                if (char === "}" && !quote) break;
            }
            if (close === state.posMax)
                parsed.problems.push("span attributes need closing {…} braces");
            else {
                parsed = parseExtensionAttributes(state.src.slice(finish + 1, close));
                finish = close + 1;
            }
        }
        const problems = [...parsed.problems, ...refusedAttributes(parsed.values)];
        if (silent) {
            state.pos = finish;
            return true;
        }
        const token = state.push("span_open", "span", 1);
        token.meta = {
            span: true,
            start,
            end: finish,
            text: state.src.slice(start + 1, end),
            problems,
        };
        if (parsed.id) token.attrSet("id", parsed.id);
        if (parsed.classes.length) token.attrSet("class", parsed.classes.join(" "));
        for (const [key, value] of Object.entries(parsed.values))
            if (!refusedAttributes({ [key]: value }).length) token.attrSet(key, value);
        const nested = [];
        state.md.inline.parse(state.src.slice(start + 1, end), state.md, state.env, nested);
        for (const child of nested)
            if (child.meta?.span) {
                child.meta.start += start + 1;
                child.meta.end += start + 1;
            }
        state.tokens.push(...nested);
        state.push("span_close", "span", -1);
        state.pos = finish;
        return true;
    });
}

const parser = new MarkdownIt({ html: true }).use(footnotePlugin).use(spanMarkdownPlugin);
/** Read span anchors and located attribute diagnostics outside literal code.
 * @param {string} source - Authored Markdown.
 */
export function scanSpans(source) {
    const text = String(source ?? ""),
        tokens = parser.parse(text, {}),
        spans = [],
        errors = [];
    let cursor = 0;
    for (const token of tokens) {
        if (token.type !== "inline") continue;
        const at = text.indexOf(token.content, cursor);
        if (at < 0) continue;
        cursor = at + token.content.length;
        for (const child of token.children ?? []) {
            if (!child.meta?.span) continue;
            const start = at + child.meta.start,
                end = at + child.meta.end;
            const prefix = text.slice(0, start);
            const line = prefix.split("\n").length,
                column = start - prefix.lastIndexOf("\n");
            spans.push({
                id: child.attrGet("id") ?? "",
                line,
                column,
                start,
                end,
                text: child.meta.text,
                attrs: child.attrs ?? [],
            });
            for (const message of child.meta.problems) errors.push({ line, column, message });
        }
    }
    return { spans, errors };
}

/** Emit span tags while leaving their inline content as Markdown for Hugo.
 * @param {string} source - Authored Markdown.
 */
export function renderSpans(source) {
    const { spans, errors } = scanSpans(source);
    let markdown = String(source ?? "");
    const escape = (value) =>
        String(value)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    for (const span of spans
        .filter(
            (span) => !spans.some((parent) => parent.start < span.start && parent.end >= span.end),
        )
        .sort((a, b) => b.start - a.start)) {
        const attrs = span.attrs.map(([key, value]) => ` ${key}="${escape(value)}"`).join("");
        markdown =
            markdown.slice(0, span.start) +
            `<span${attrs}>${renderSpans(span.text).markdown}</span>` +
            markdown.slice(span.end);
    }
    return { markdown, errors };
}
