/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Finding the empty shells in a page.
 *
 * A layout draws a section only when it has something to show. A section drawn
 * around nothing is an empty shell: its element holds whitespace, or holds only
 * its own heading. {@link emptyShells} reads a finished page and names each one.
 *
 * | Counts as content | Does not |
 * | ----------------- | -------- |
 * | text a reader sees | whitespace, and text in `script`, `style` or a `hidden` element |
 * | a picture, an icon, a button, a form control, a rule | a heading from `h2` to `h6`, and a `summary` |
 * | a first-level heading with text | an `h1` with none |
 * | an element with an `id`, which a script fills | |
 * | an element drawn with a background image | |
 *
 * An element is content when any child is. A section holding a heading and a
 * list with items is not a shell; a section holding a heading alone is.
 */

/** An element that was drawn around nothing. */
export interface Shell {
    tag: string;
    classes: string;
    line: number;
}

interface Node {
    tag: string;
    attrs: Record<string, string>;
    children: Array<Node | string>;
    offset: number;
}

/** The elements that have no closing tag. */
const VOID = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
]);

/** The elements whose content is not text a reader reads. */
const SILENT = new Set(["script", "style", "template", "noscript", "head", "title"]);

/** The elements that are content by being there. */
const FURNISHING = new Set([
    "img",
    "svg",
    "picture",
    "video",
    "audio",
    "iframe",
    "canvas",
    "object",
    "embed",
    "input",
    "select",
    "textarea",
    "button",
    "hr",
]);

/** The elements whose emptiness is reported. */
const CHECKED = new Set([
    "section",
    "aside",
    "nav",
    "article",
    "header",
    "footer",
    "main",
    "ul",
    "ol",
    "dl",
    "dt",
    "dd",
    "li",
    "p",
    "details",
    "div",
    "figure",
    "table",
    "blockquote",
]);

const TAG =
    /<!--[^]*?-->|<\/([A-Za-z][A-Za-z0-9-]*)\s*>|<([A-Za-z][A-Za-z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR = /([A-Za-z_:][-A-Za-z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function attributes(source: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const match of source.matchAll(ATTR))
        attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
    return attrs;
}

function parse(html: string): Node {
    const root: Node = { tag: "#root", attrs: {}, children: [], offset: 0 };
    const stack = [root];
    let last = 0;
    const text = (end: number) => {
        const value = html.slice(last, end);
        if (value) stack.at(-1)!.children.push(value);
    };
    for (const match of html.matchAll(TAG)) {
        // Raw text, such as a script, was skipped over.
        if (match.index! < last) continue;
        text(match.index!);
        last = match.index! + match[0].length;
        if (match[0].startsWith("<!--")) continue;
        if (match[1]) {
            const name = match[1].toLowerCase();
            const at = stack.map((node) => node.tag).lastIndexOf(name);
            if (at > 0) stack.length = at;
            continue;
        }
        const tag = match[2].toLowerCase();
        const node: Node = {
            tag,
            attrs: attributes(match[3]),
            children: [],
            offset: match.index!,
        };
        stack.at(-1)!.children.push(node);
        if (VOID.has(tag) || match[3].trimEnd().endsWith("/")) continue;
        if (SILENT.has(tag) && tag !== "head") {
            // The element's text is raw: skip to its closing tag.
            const close = html.toLowerCase().indexOf(`</${tag}`, last);
            last = close < 0 ? html.length : close;
            stack.push(node);
            continue;
        }
        stack.push(node);
    }
    text(html.length);
    return root;
}

/** Whether an element, or something in it, is there for a reader. */
function isContent(node: Node | string): boolean {
    if (typeof node === "string") return node.replace(/&nbsp;/g, " ").trim() !== "";
    if (SILENT.has(node.tag) || "hidden" in node.attrs) return false;
    if (/^h[2-6]$/.test(node.tag) || node.tag === "summary") return false;
    if (FURNISHING.has(node.tag) || node.attrs.id !== undefined) return true;
    if (node.tag === "i" && node.attrs.class) return true;
    if (/url\(/.test(node.attrs.style ?? "")) return true;
    return node.children.some(isContent);
}

/**
 * The empty shells in a page.
 *
 * @param html - A page's HTML.
 * @returns Each section drawn around nothing, in document order.
 */
export function emptyShells(html: string): Shell[] {
    const shells: Shell[] = [];
    const lineOf = (offset: number) => html.slice(0, offset).split("\n").length;
    const visit = (node: Node) => {
        if (SILENT.has(node.tag) || "hidden" in node.attrs) return;
        if (CHECKED.has(node.tag) && node.attrs.id === undefined && !isContent(node)) {
            shells.push({
                tag: node.tag,
                classes: node.attrs.class ?? "",
                line: lineOf(node.offset),
            });
            return;
        }
        for (const child of node.children) if (typeof child !== "string") visit(child);
    };
    visit(parse(html));
    return shells;
}

/** A shell as a line a reader can follow. */
export function describeShell(shell: Shell): string {
    return `line ${shell.line}: <${shell.tag}${shell.classes ? ` class="${shell.classes}"` : ""}>`;
}
