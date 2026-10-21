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
 * The glyph and cartouche spans of a note, read in one place for the stages
 * that need their pictures: the renderer that draws them and the book that
 * stages their files.
 *
 * @module
 */

import {
    glyphHtml,
    glyphPathname,
    cartoucheHtml,
    cartouchePathname,
    cartoucheProblems,
    glyphProblems,
} from "./content-glyphs.mjs";
import { scanSpans } from "./content-spans.mjs";

/**
 * A span's attributes as the construct's checker reads them.
 * @param {Array<[string, string]>} attrs - The span's attribute pairs.
 * @returns {{id: string, classes: string[], values: Record<string, string>}} Parsed form.
 */
function parsedAttributes(attrs) {
    const find = (name) => attrs.find(([key]) => key === name)?.[1] ?? "";
    return {
        id: find("id"),
        classes: find("class").split(/\s+/).filter(Boolean),
        values: Object.fromEntries(attrs.filter(([key]) => !["id", "class"].includes(key))),
    };
}

/**
 * The well-formed glyph and cartouche spans of a note, outermost only, outside
 * code.
 * @param {string} source - Authored Markdown.
 * @returns {Array<{kind: "glyph"|"cartouche", start: number, end: number, slug: string, alt: string, frame?: string, size?: string, align?: string, height?: string, caption?: string}>}
 *   One entry per sign, in source order. A sign with a finding is left out: it
 *   is reported and draws as an ordinary span.
 */
function symbolSpans(source) {
    if (!/\.(glyph|cartouche)\b/.test(source)) return [];
    const { spans } = scanSpans(source);
    const signs = spans
        .map((span) => ({ span, parsed: parsedAttributes(span.attrs) }))
        .flatMap(({ span, parsed }) => {
            const kind = ["glyph", "cartouche"].find((name) => parsed.classes.includes(name));
            const problems = { glyph: glyphProblems, cartouche: cartoucheProblems }[kind];
            if (!problems || problems(parsed).length) return [];
            const { slug, frame, size, align, height, caption } = parsed.values;
            return [
                {
                    kind,
                    start: span.start,
                    end: span.end,
                    slug,
                    alt: span.visible.trim(),
                    ...(frame ? { frame } : {}),
                    ...(size ? { size } : {}),
                    ...(align ? { align } : {}),
                    ...(height ? { height } : {}),
                    ...(caption ? { caption } : {}),
                },
            ];
        });
    return signs.filter(
        (sign) => !signs.some((outer) => outer.start < sign.start && outer.end >= sign.end),
    );
}

const OPEN = "\uE000",
    CLOSE = "\uE001";
const PLACEHOLDER = new RegExp(`${OPEN}([0-9a-f]+)${CLOSE}`, "g");

/**
 * A cartouche as the inert text a Markdown parser passes through untouched.
 * A figure written as HTML at the start of a line would open a CommonMark HTML
 * block and leave the rest of its paragraph unparsed, so the figure is written
 * as inline HTML by {@link cartoucheFigures} after the paragraph is parsed.
 * @param {object} cartouche - The figure's attributes, with `src` the address of its picture.
 * @returns {string} Private-use delimiters around the hex of the attributes' JSON.
 */
function cartouchePlaceholder(cartouche) {
    const hex = [...new TextEncoder().encode(JSON.stringify(cartouche))]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    return `${OPEN}${hex}${CLOSE}`;
}

/**
 * Markdown-it plugin: write each cartouche placeholder as the inline HTML of
 * its figure, in whatever paragraph, cell or title it stands.
 * @param {import("markdown-it")} md - Parser to extend.
 */
export function cartoucheFigures(md) {
    md.core.ruler.after("inline", "cartouche_figures", (state) => {
        for (const token of state.tokens) {
            if (token.type !== "inline" || !token.children) continue;
            token.children = token.children.flatMap((child) => {
                if (child.type !== "text" || !child.content.includes(OPEN)) return [child];
                const pieces = [];
                let last = 0;
                const piece = (type, content) => {
                    const made = new state.Token(type, "", 0);
                    made.content = content;
                    made.level = child.level;
                    pieces.push(made);
                };
                for (const match of child.content.matchAll(PLACEHOLDER)) {
                    if (match.index > last) piece("text", child.content.slice(last, match.index));
                    const { src, ...cartouche } = JSON.parse(
                        new TextDecoder().decode(
                            Uint8Array.from(match[1].match(/../g), (pair) => parseInt(pair, 16)),
                        ),
                    );
                    piece("html_inline", cartoucheHtml(cartouche, src));
                    last = match.index + match[0].length;
                }
                if (last < child.content.length) piece("text", child.content.slice(last));
                return pieces;
            });
        }
    });
}

/**
 * Write each glyph and cartouche span as the HTML that draws its picture. A
 * cartouche is written as a placeholder that {@link cartoucheFigures} turns
 * into its figure.
 *
 * @param {string} source - Markdown that may contain glyph and cartouche spans.
 * @param {(src: string) => string} [resolveSrc] - From a sign's authored
 *   pathname to the address the target serves; omitted, the pathname.
 * @param {object} [options]
 * @param {boolean} [options.glyphs] - Write glyph spans; `false` leaves them
 *   as the source they were written in. Default `true`.
 * @returns {string} The Markdown with each well-formed sign written as HTML or a placeholder.
 */
export function renderSymbolSpans(source, resolveSrc, { glyphs = true } = {}) {
    let markdown = String(source ?? "");
    for (const sign of symbolSpans(markdown).sort((a, b) => b.start - a.start)) {
        if (sign.kind === "glyph" && !glyphs) continue;
        const picture = (sign.kind === "glyph" ? glyphPathname : cartouchePathname)(sign.slug);
        const src = resolveSrc?.(picture) ?? picture;
        const html =
            sign.kind === "glyph" ?
                glyphHtml(sign, src)
            :   cartouchePlaceholder({ ...sign, alt: sign.alt || undefined, src });
        markdown = markdown.slice(0, sign.start) + html + markdown.slice(sign.end);
    }
    return markdown;
}

/**
 * Every picture the glyphs and cartouches of a body name, for a stage that has
 * to place the files before a compiler reads them.
 *
 * @param {string} body - The note's Markdown.
 * @returns {Array<{src: string, locate: string}>} The authored pathname of each
 *   picture and the slug that locates it in the note's text, in document order
 *   within glyphs and then cartouches.
 */
export function symbolImagesIn(body) {
    const signs = symbolSpans(String(body ?? ""));
    return ["glyph", "cartouche"].flatMap((kind) =>
        signs
            .filter((sign) => sign.kind === kind)
            .map(({ slug }) => ({
                src: (kind === "glyph" ? glyphPathname : cartouchePathname)(slug),
                locate: slug,
            })),
    );
}
