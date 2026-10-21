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
 * Content snapshots: what a reader sees, as text, and where a page links.
 *
 * A snapshot records **text, not markup**. A change to the markup a page is
 * written in leaves it unchanged; a dropped sentence, a heading that no longer
 * renders or a link that stops pointing where it did changes it.
 *
 * | Snapshot | Records | From |
 * | -------- | ------- | ---- |
 * | site | each page's title, the visible text of its `<main>`, and its outgoing link targets | the HTML a site build emits |
 * | book | each entry's text | the Typst source of each book, never a compiled PDF |
 *
 * Both are deterministic: pages and entries are ordered, links are sorted and
 * unique, and nothing records a date, a hash or a search-index id.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import MarkdownIt from "markdown-it";

/** The decoder for HTML character references. */
const { unescapeAll } = new MarkdownIt().utils;

/** Elements whose tags separate words; every other tag is inline. */
const INLINE = new Set([
    "a",
    "abbr",
    "b",
    "bdi",
    "bdo",
    "cite",
    "code",
    "data",
    "del",
    "dfn",
    "em",
    "i",
    "ins",
    "kbd",
    "mark",
    "q",
    "s",
    "samp",
    "small",
    "span",
    "strong",
    "sub",
    "sup",
    "time",
    "u",
    "var",
]);

/** Elements whose content is not text a reader reads. */
const SILENT = ["script", "style", "template", "noscript", "svg"];

/** Decode character references without treating a backslash as an escape. */
function decode(text) {
    return unescapeAll(text.replace(/\\/g, "\\\\"));
}

/** Collapse every run of whitespace to one space. */
function collapse(text) {
    return text.replace(/\s+/g, " ").trim();
}

/** The element's content between its opening and closing tag, or `""`. */
function inner(html, tag) {
    const open = new RegExp(`<${tag}(?:\\s[^>]*)?>`, "i").exec(html);
    if (!open) return "";
    const start = open.index + open[0].length;
    const end = html.toLowerCase().lastIndexOf(`</${tag}>`);
    return end < start ? html.slice(start) : html.slice(start, end);
}

/**
 * Where a link points, in a form that does not depend on how it was written.
 *
 * A relative link is resolved against the page; a link to the same origin is a
 * path with its query and fragment; any other link is the absolute address.
 *
 * @param {string} href - The `href` as written.
 * @param {string} page - The page's own path, with a leading slash.
 * @param {string} [origin] - The origin the site is deployed at, such as
 *   `https://www.heroiclands.org`; a link to it is a path.
 * @returns {string|null} The target, or `null` for a link with none.
 */
export function linkTarget(href, page, origin = "") {
    const value = decode(href).trim();
    if (!value || /^(?:javascript|data):/i.test(value)) return null;
    const base = new URL(page, "https://snapshot.invalid");
    const target = new URL(value, base);
    if (target.origin === base.origin || (origin && target.origin === origin))
        return `${target.pathname}${target.search}${target.hash}`;
    return target.href;
}

/**
 * The title, visible text and outgoing links of one rendered page.
 *
 * @param {string} html - The page's HTML.
 * @param {string} url - The page's path, with a leading slash.
 * @param {string} [origin] - The origin the site is deployed at.
 * @returns {{title: string, text: string, links: string[]}} The page, as text.
 */
export function pageText(html, url, origin = "") {
    const title = collapse(decode(inner(html, "title").replace(/<[^>]*>/g, "")));
    let body = inner(html, "main") || inner(html, "body");
    body = body.replace(/<!--[\s\S]*?-->/g, "");
    // Search metadata is markup a reader never sees.
    body = body.replace(
        /<span\s[^>]*data-pagefind-(?:filter|meta|sort|weight)=[^>]*>[\s\S]*?<\/span>/gi,
        " ",
    );
    for (const tag of SILENT)
        body = body.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "gi"), " ");
    const links = new Set();
    for (const match of body.matchAll(/<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
        const target = linkTarget(match[1] ?? match[2], url, origin);
        if (target !== null) links.add(target);
    }
    const text = body.replace(/<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s[^>]*)?>/g, (_, name) =>
        INLINE.has(name.toLowerCase()) ? "" : " ",
    );
    return {
        title,
        text: collapse(decode(text)),
        links: [...links].sort(),
    };
}

/** Every file under a directory, as paths relative to it, in a fixed order. */
function walk(root, dir = "") {
    const entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
    return entries
        .map((entry) => entry.name)
        .sort()
        .flatMap((name) => {
            const entry = entries.find((e) => e.name === name);
            const rel = dir ? `${dir}/${name}` : name;
            return entry.isDirectory() ? walk(root, rel) : [rel];
        });
}

/**
 * The page path a built HTML file is served at.
 *
 * @param {string} file - The file, relative to the output directory.
 * @returns {string} The path with a leading slash; `/dir/index.html` is `/dir/`.
 */
export function pageUrl(file) {
    if (file === "index.html") return "/";
    return `/${file.replace(/index\.html$/, "")}`;
}

/**
 * Snapshot every HTML page under a built site.
 *
 * @param {string} dir - The site's output directory.
 * @param {string} [origin] - The origin the site is deployed at.
 * @returns {{kind: "site", pages: Array<{url: string, title: string, text: string, links: string[]}>}}
 *   The pages, ordered by path.
 */
export function snapshotSite(dir, origin = "") {
    const pages = walk(dir)
        .filter((file) => file.endsWith(".html"))
        .map((file) => {
            const url = pageUrl(file);
            return { url, ...pageText(fs.readFileSync(path.join(dir, file), "utf8"), url, origin) };
        })
        .sort((a, b) =>
            a.url < b.url ? -1
            : a.url > b.url ? 1
            : 0,
        );
    return { kind: "site", pages };
}

/* ------------------------------------------------------------------------ */
/*  Typst                                                                   */
/* ------------------------------------------------------------------------ */

/** The index just past the string literal that opens at `at`. */
function skipString(src, at) {
    let i = at + 1;
    while (i < src.length && src[i] !== '"') i += src[i] === "\\" ? 2 : 1;
    return i + 1;
}

/** The index just past the raw text that opens at `at` with a run of backticks. */
function skipRaw(src, at) {
    const run = /^`+/.exec(src.slice(at))[0];
    const close = src.indexOf(run, at + run.length);
    return close < 0 ? src.length : close + run.length;
}

/**
 * The index just past the bracketed span that opens at `at`.
 *
 * Strings and raw text are skipped, an escaped bracket does not count, and the
 * three bracket kinds nest.
 */
function skipBalanced(src, at) {
    const close = { "(": ")", "[": "]", "{": "}" };
    const stack = [close[src[at]]];
    let i = at + 1;
    while (i < src.length && stack.length) {
        const char = src[i];
        if (char === "\\") i += 2;
        else if (char === '"') i = skipString(src, i);
        else if (char === "`") i = skipRaw(src, i);
        else {
            if (close[char]) stack.push(close[char]);
            else if (char === stack.at(-1)) stack.pop();
            i++;
        }
    }
    return i;
}

/** The text of every content block in a stretch of code, in order. */
function codeBlocks(code) {
    const parts = [];
    let i = 0;
    while (i < code.length) {
        const char = code[i];
        if (char === '"') i = skipString(code, i);
        else if (char === "[") {
            const end = skipBalanced(code, i);
            parts.push(markup(code.slice(i + 1, end - 1)));
            i = end;
        } else if (char === "`") i = skipRaw(code, i);
        else i++;
    }
    return parts.join(" ");
}

/** The text a statement-level keyword leaves in a body: none. */
const STATEMENTS = new Set(["set", "show", "let", "import", "include", "context"]);

/** The first string literal in `code`, unescaped, or `""`. */
function firstString(code) {
    const start = code.indexOf('"');
    if (start < 0) return "";
    const end = skipString(code, start);
    return code.slice(start + 1, end - 1).replace(/\\(.)/g, "$1");
}

/**
 * The text of a `#`-expression that starts at `at`.
 *
 * @returns {[string, number]} The text and the index just past the expression.
 */
function expression(src, at) {
    const next = src[at + 1];
    if (next === "{") {
        const end = skipBalanced(src, at + 1);
        return [codeBlocks(src.slice(at + 2, end - 1)), end];
    }
    const name = /^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*/.exec(
        src.slice(at + 1, at + 200),
    );
    if (!name) return ["#", at + 1];
    let i = at + 1 + name[0].length;
    const parts = [];
    if (STATEMENTS.has(name[0])) {
        // A statement runs to the end of its line, past any bracketed span.
        while (i < src.length && src[i] !== "\n") {
            if ("([{".includes(src[i])) i = skipBalanced(src, i);
            else i++;
        }
        return ["", i];
    }
    if (src[i] === "(") {
        const end = skipBalanced(src, i);
        const args = src.slice(i + 1, end - 1);
        parts.push(name[0] === "raw" ? firstString(args) : codeBlocks(args));
        i = end;
    }
    while (src[i] === "[") {
        const end = skipBalanced(src, i);
        parts.push(markup(src.slice(i + 1, end - 1)));
        i = end;
    }
    return [parts.join(" "), i];
}

/** The text of Typst markup. */
function markup(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
        const char = src[i];
        if (char === "\\") {
            out.push(src[i + 1] === "\n" ? " " : (src[i + 1] ?? ""));
            i += 2;
        } else if (char === "#") {
            const [text, end] = expression(src, i);
            out.push(text);
            i = end;
        } else if (char === "`") {
            const end = skipRaw(src, i);
            const run = /^`+/.exec(src.slice(i))[0];
            const body = src.slice(i + run.length, end - run.length);
            // A fence's first line names its language.
            out.push(run.length >= 3 ? body.replace(/^[^\n]*\n/, "") : body);
            i = end;
        } else if (char === "<" && /^<[A-Za-z0-9_:.-]+>/.test(src.slice(i, i + 200))) {
            i += /^<[^>]+>/.exec(src.slice(i))[0].length;
        } else if (char === "/" && src[i + 1] === "/" && (i === 0 || /\s/.test(src[i - 1]))) {
            while (i < src.length && src[i] !== "\n") i++;
        } else {
            out.push(char);
            i++;
        }
    }
    return out.join("");
}

/**
 * The text of a stretch of Typst source: what a reader sees, with every
 * function, argument and label taken out.
 *
 * @param {string} source - Typst markup.
 * @returns {string} Its text, whitespace collapsed.
 */
export function typstText(source) {
    return collapse(markup(source));
}

/**
 * Snapshot a book's Typst source, entry by entry.
 *
 * @param {string} source - The book's `.typ` file.
 * @returns {Array<{anchor: string, title: string, text: string}>} The entries in
 *   reading order. Whatever precedes the first entry, and the generated index
 *   after the last, belong to no entry and are not recorded.
 */
export function bookEntries(source) {
    const starts = [...source.matchAll(/^#book-entry\(/gm)].map((m) => m.index);
    const stop = source.search(/^#set page\(columns/m);
    return starts.map((start, n) => {
        const end = starts[n + 1] ?? (stop > start ? stop : source.length);
        const entry = source.slice(start, end);
        const title = /^#book-entry\("(?:[^"\\]|\\.)*", "((?:[^"\\]|\\.)*)"/.exec(entry)?.[1] ?? "";
        const anchor = /<([A-Za-z0-9_:.-]+)>\]/.exec(entry)?.[1] ?? "";
        return { anchor, title: title.replace(/\\(.)/g, "$1"), text: typstText(entry) };
    });
}

/**
 * Snapshot every book under a directory of Typst sources.
 *
 * @param {string} dir - The directory holding the `.typ` files.
 * @returns {{kind: "book", books: Array<{id: string, entries: object[]}>}} The
 *   books ordered by id.
 */
export function snapshotBooks(dir) {
    const books = fs
        .readdirSync(dir)
        .filter((file) => file.endsWith(".typ"))
        .map((file) => ({
            id: file.replace(/\.typ$/, ""),
            entries: bookEntries(fs.readFileSync(path.join(dir, file), "utf8")),
        }))
        .sort((a, b) =>
            a.id < b.id ? -1
            : a.id > b.id ? 1
            : 0,
        );
    return { kind: "book", books };
}

/* ------------------------------------------------------------------------ */
/*  Reading, writing and comparing                                          */
/* ------------------------------------------------------------------------ */

/** Write a snapshot, Brotli-compressed at its highest quality. */
export function writeSnapshot(file, snapshot) {
    const json = Buffer.from(JSON.stringify(snapshot));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
        file,
        zlib.brotliCompressSync(json, {
            params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
                [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
                [zlib.constants.BROTLI_PARAM_SIZE_HINT]: json.length,
            },
        }),
    );
}

/** Read a snapshot written by {@link writeSnapshot}. */
export function readSnapshot(file) {
    return JSON.parse(zlib.brotliDecompressSync(fs.readFileSync(file)).toString("utf8"));
}

/** Text with every whitespace removed, which is what a comparison reads. */
const bare = (text) => text.replace(/\s+/g, "");

/** Where two strings first differ, with a little of each. */
function firstDifference(a, b) {
    let at = 0;
    while (at < a.length && at < b.length && a[at] === b[at]) at++;
    return `at character ${at}: …${a.slice(Math.max(0, at - 20), at + 40)}… against …${b.slice(Math.max(0, at - 20), at + 40)}…`;
}

/**
 * Compare two snapshots of the same kind, page for page.
 *
 * Whitespace is not compared: how a renderer breaks a line is not what a
 * reader reads.
 *
 * @param {object} expected - The recorded snapshot.
 * @param {object} actual - The snapshot of a new build.
 * @returns {string[]} One finding per difference; empty when they match.
 */
export function compareSnapshots(expected, actual) {
    const findings = [];
    const groups = (snapshot) =>
        snapshot.kind === "site" ?
            new Map([["site", new Map(snapshot.pages.map((page) => [page.url, page]))]])
        :   new Map(
                snapshot.books.map((book) => [
                    book.id,
                    new Map(book.entries.map((entry, n) => [entry.anchor || `#${n}`, entry])),
                ]),
            );
    const want = groups(expected);
    const have = groups(actual);
    for (const [group, pages] of want) {
        const found = have.get(group);
        if (!found) {
            findings.push(`${group}: missing`);
            continue;
        }
        for (const [key, page] of pages) {
            const other = found.get(key);
            if (!other) {
                findings.push(`${group} ${key}: missing`);
                continue;
            }
            if (bare(page.text) !== bare(other.text))
                findings.push(
                    `${group} ${key}: text differs ${firstDifference(bare(page.text), bare(other.text))}`,
                );
            const links = JSON.stringify(page.links ?? []);
            if (links !== JSON.stringify(other.links ?? []))
                findings.push(`${group} ${key}: links differ`);
        }
        for (const key of found.keys())
            if (!pages.has(key)) findings.push(`${group} ${key}: not in the recorded snapshot`);
    }
    for (const group of have.keys()) if (!want.has(group)) findings.push(`${group}: not recorded`);
    return findings;
}
