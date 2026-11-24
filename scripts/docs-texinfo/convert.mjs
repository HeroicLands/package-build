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
 * Convert the Markdown documentation under `docs/` into one Texinfo manual.
 *
 * Each page is a chapter, in the order `manifest.mjs` gives. A page's title is
 * its first heading when that heading is the only one at the shallowest level,
 * and otherwise its front matter `name.full`. The two heading levels below the
 * title are nodes (`@section`, `@subsection`); deeper headings are
 * `@subsubheading` with an `@anchor`, so a link can still reach them. Links
 * between pages and to anchors resolve to those nodes and anchors through the
 * same anchors `docs links` checks.
 *
 * A construct with no Texinfo mapping is a located finding, never dropped or
 * printed literally: images, raw HTML, definition lists, task lists,
 * strikethrough, fenced divs, footnotes, reference links, GitHub alerts, pipe
 * tables without a header row, and links or anchors nothing resolves.
 */

import fs from "node:fs";
import path from "node:path";

import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import YAML from "yaml";

import { docHeadingAnchors } from "../../engine/docs-checks.mjs";
import { HEADING_LINE, splitHeadingAttributes } from "../../engine/heading-attributes.mjs";
import { MANIFEST } from "./manifest.mjs";

/**
 * @typedef {{file: string, line?: number, column?: number,
 *   severity: "error", message: string}} Finding
 *
 * @typedef {object} IndexEvent
 * @property {"heading" | "item"} kind - A heading, or a keyed table's item.
 * @property {string} file - The page, relative to the repository root.
 * @property {string} node - The node or anchor the event sits under.
 * @property {string} text - The heading's plain text, or the item's code.
 * @property {number} [level] - A heading's depth below its chapter: 0 is the
 *   chapter, 1 a section, 2 a subsection, 3 and deeper a sub-subheading.
 * @property {string} [header] - An item's table: its first column's header.
 *
 * @typedef {object} Indexer
 * @property {(event: IndexEvent) => string[]} [entries] - Texinfo lines placed
 *   after the heading or `@item` the event describes, such as `@cindex`.
 * @property {() => Array<{name: string, description?: string, texinfo: string}>} [nodes]
 *   Trailing unnumbered nodes, such as the indices: each is emitted as
 *   `@node <name>` followed by `texinfo`, and listed in the master menu.
 */

/** Section commands by depth below the chapter. */
const SECTIONING = ["@chapter", "@section", "@subsection"];

/** The deepest level that is a node; deeper headings are anchored headings. */
const DEEPEST_NODE = SECTIONING.length - 1;

const processor = unified().use(remarkParse).use(remarkFrontmatter).use(remarkGfm);

/**
 * Escape text for Texinfo.
 *
 * `@`, `{` and `}` take an `@`; inside a command argument that commas separate
 * (`@ref`, `@uref`) a comma becomes `@comma{}`.
 *
 * @param {string} text
 * @param {{argument?: boolean}} [options]
 */
export function escapeTexinfo(text, { argument = false } = {}) {
    const escaped = String(text).replace(/[@{}]/g, (c) => `@${c}`);
    return argument ? escaped.replace(/,/g, "@comma{}") : escaped;
}

/**
 * A node name from a heading's plain text.
 *
 * Info readers split a cross-reference on a comma, a colon and a period, and
 * read a leading parenthesis as a manual name, so those are rewritten: `: `
 * becomes ` - `, any other colon a space, a run of periods between two word
 * characters a space, and commas, every other period and leading parentheses
 * go.
 *
 * @param {string} plain
 */
export function nodeNameFor(plain) {
    const name = String(plain)
        .replace(/\s+/g, " ")
        .replace(/:\s/g, " - ")
        .replace(/:/g, " ")
        .replace(/,/g, "")
        .replace(/(?<=\w)\.+(?=\w)/g, " ")
        .replace(/\./g, "")
        .replace(/^[\s(]+/, "")
        .replace(/\s+/g, " ")
        .trim();
    return name || "Section";
}

/**
 * One finding as the toolchain prints it: `file:line:column: severity: message`.
 * @param {Finding} finding
 */
export function formatFinding({ file, line, column, severity, message }) {
    const where = [file, line, line === undefined ? undefined : column]
        .filter((part) => part !== undefined)
        .join(":");
    return `${where}: ${severity}: ${message}`;
}

/** The Info fill column a multitable's column fractions are measured against. */
export const FILL_COLUMN = 72;

/** The columns Texinfo indents an item or quotation body by. */
const INDENT = 5;

/**
 * The text Info prints for a line of inline Texinfo, as near as the width of a
 * table column needs: quotes around code, asterisks around strong text,
 * underscores around emphasis, and a cross-reference spelled out. makeinfo
 * never breaks a line inside a cross-reference, so its spaces are no-break
 * spaces.
 *
 * @param {string} texinfo - Inline Texinfo, as the converter writes it.
 */
export function infoText(texinfo) {
    const COMMA = "\u0001";
    let text = String(texinfo)
        .replace(/@comma\{\}/g, COMMA)
        .replace(/@@/g, "\u0002")
        .replace(/@\{/g, "\u0003")
        .replace(/@\}/g, "\u0004")
        .replace(/@\*/g, " ");
    const render = (command, argument) => {
        const args = argument.split(",").map((part) => part.trim());
        switch (command) {
            case "code":
            case "file":
                return `‘${argument}’`;
            case "strong":
                return `*${argument}*`;
            case "emph":
                return `_${argument}_`;
            case "ref":
            case "pxref":
                return (args[2] ? `*note ${args[2]}: ${args[0]}.` : `*note ${args[0]}::`).replace(
                    / /g,
                    "\u00a0",
                );
            case "uref":
                return args[1] ? `${args[1]} (${args[0]})` : args[0];
            default:
                return argument;
        }
    };
    for (let before; before !== text;) {
        before = text;
        text = text.replace(/@([A-Za-z]+)\{([^{}]*)\}/g, (_, command, argument) =>
            render(command, argument),
        );
    }
    return text
        .replace(new RegExp(COMMA, "g"), ",")
        .replace(/\u0002/g, "@")
        .replace(/\u0003/g, "{")
        .replace(/\u0004/g, "}");
}

/**
 * Column fractions for a multitable, or `undefined` when the columns cannot fit.
 *
 * Info fills each cell to its column's width less two, and prints a word wider
 * than that across the next cell, so every column is at least its longest word
 * plus two. Columns share what is left of the line in proportion to how much
 * more their longest cell wants, and one column of separators is kept between
 * cells. makeinfo sizes columns against the fill column wherever the table
 * sits, so an indented table has that much less line to fill.
 *
 * @param {string[][]} rows - Every row's cells as Info prints them.
 * @param {number} [indent] - The columns the table is indented by.
 * @returns {string[] | undefined}
 */
export function columnFractions(rows, indent = 0) {
    const columns = Math.max(...rows.map((row) => row.length));
    const length = (text) => [...text].length;
    const minimum = [];
    const wanted = [];
    for (let column = 0; column < columns; column++) {
        const cells = rows.map((row) => row[column] ?? "");
        const word = Math.max(1, ...cells.flatMap((cell) => cell.split(/[ \t\n]+/).map(length)));
        minimum.push(word + 2);
        wanted.push(Math.max(word, ...cells.map(length)) + 2);
    }
    const available = FILL_COLUMN - indent - columns;
    const sum = (values) => values.reduce((total, value) => total + value, 0);
    if (sum(minimum) > available) return undefined;
    let sizes = wanted;
    if (sum(wanted) > available) {
        const spare = available - sum(minimum);
        const extra = sum(wanted) - sum(minimum);
        sizes = minimum.map((value, i) =>
            Math.floor(value + (spare * (wanted[i] - value)) / extra),
        );
    }
    // makeinfo rounds `fraction * FILL_COLUMN` to a size; four decimals land on it.
    return sizes.map((size) => (size / FILL_COLUMN).toFixed(4));
}

/** The text a reader sees in a run of inline nodes, without markup. */
function plainText(nodes) {
    return nodes
        .map((node) =>
            "value" in node && node.type !== "html" ? node.value
            : node.children ? plainText(node.children)
            : "",
        )
        .join("");
}

/** A heading's inline content without the attribute block it ends with. */
function headingContent(node, raw) {
    const attributes = splitHeadingAttributes(raw);
    if (!attributes.braces || attributes.problems.length) return node.children;
    const children = [...node.children];
    const last = children.at(-1);
    if (last?.type === "text") {
        children[children.length - 1] = {
            ...last,
            value: last.value.replace(/\s*\{[^}\n]*\}\s*$/, ""),
        };
    }
    return children;
}

/** Claims node and anchor names, which share one namespace in a manual. */
class NodeNames {
    constructor() {
        /** @type {Set<string>} */
        this.taken = new Set(["top"]);
    }

    /**
     * @param {string} base
     * @param {string} [chapter] - The chapter a repeated name is qualified by.
     */
    claim(base, chapter) {
        const free = (name) => !this.taken.has(name.toLowerCase());
        let name = base;
        if (!free(name) && chapter) name = `${base} (${chapter})`;
        const stem = name;
        for (let n = 2; !free(name); n++) name = `${stem} ${n}`;
        this.taken.add(name.toLowerCase());
        return name;
    }
}

/**
 * Convert the documentation to a Texinfo manual.
 *
 * @param {object} options
 * @param {string} [options.root] - The repository root.
 * @param {string} [options.docsDir] - The documentation, relative to the root.
 * @param {ReadonlyArray<import("./manifest.mjs").ManifestEntry>} [options.manifest]
 * @param {string} [options.version] - Defaults to the root `package.json`'s.
 * @param {(file: string) => string} [options.read] - Reads a root-relative file.
 * @param {(file: string) => boolean} [options.exists] - Whether a root-relative
 *   file exists.
 * @param {string[]} [options.shipped] - The root `package.json` `files` list:
 *   what a link to a repository file may point into.
 * @param {Indexer} [options.indexer] - Index entries and index nodes; none by
 *   default.
 * @returns {{texinfo: string, findings: Finding[]}}
 */
export function convertDocs({
    root = process.cwd(),
    docsDir = "docs",
    manifest = MANIFEST,
    version,
    read = (file) => fs.readFileSync(path.join(root, file), "utf8"),
    exists = (file) => fs.existsSync(path.join(root, file)),
    shipped,
    indexer = {},
} = {}) {
    /** @type {Finding[]} */
    const findings = [];
    const pkg =
        version === undefined || shipped === undefined ? JSON.parse(read("package.json")) : {};
    const packageVersion = version ?? pkg.version;
    const shippedPaths = shipped ?? pkg.files ?? [];

    const report = (doc, node, message) => {
        const start = node?.position?.start;
        findings.push({
            file: doc.file,
            ...(start ? { line: start.line, column: start.column } : {}),
            severity: "error",
            message,
        });
    };

    // Pass 1: read every page and lay each chapter out as a stream of headings
    // and blocks, attached pages spliced in.

    /** @type {Map<string, any>} */
    const docs = new Map();
    const loadDoc = (relative) => {
        const file = path.posix.join(docsDir, relative);
        let source;
        try {
            source = read(file);
        } catch {
            findings.push({
                file,
                severity: "error",
                message: "the manifest names a page that does not exist",
            });
            return undefined;
        }
        const tree = processor.parse(source);
        const doc = {
            relative,
            file,
            source,
            tree,
            lines: source.split("\n"),
            front: {},
            anchors: new Map(docHeadingAnchors(source).map(({ line, anchor }) => [line, anchor])),
            slugs: new Map(),
            target: undefined,
        };
        const yamlNode = tree.children.find((node) => node.type === "yaml");
        if (yamlNode) {
            try {
                doc.front = YAML.parse(yamlNode.value) ?? {};
            } catch (error) {
                report(doc, yamlNode, `front matter is not YAML: ${error.message}`);
            }
        }
        docs.set(relative, doc);
        return doc;
    };

    /**
     * A page as a stream: its title first, then its blocks with each heading
     * at its depth below the chapter, counted from `offset`.
     */
    const pageStream = (doc, offset, top) => {
        const headings = doc.tree.children.filter((node) => node.type === "heading");
        const shallowest = Math.min(...headings.map((node) => node.depth));
        const single =
            headings.length > 0 &&
            headings[0].depth === shallowest &&
            headings.filter((node) => node.depth === shallowest).length === 1;
        const fullName = doc.front?.name?.full;
        const heading = (node, level) => {
            const raw = HEADING_LINE.exec(doc.lines[node.position.start.line - 1] ?? "")?.[2] ?? "";
            const content = headingContent(node, raw);
            const anchor = doc.anchors.get(node.position.start.line);
            if (anchor === undefined)
                report(doc, node, "a heading that is not one line of `#` marks has no anchor");
            return {
                type: "heading",
                doc,
                node,
                level,
                content,
                plain: plainText(content),
                anchor,
            };
        };
        /** @type {any[]} */
        const stream = [];
        let base;
        if (single) {
            base = shallowest;
            stream.push({ ...heading(headings[0], offset), title: true });
        } else if (typeof fullName === "string" && fullName.trim()) {
            base = headings.length ? shallowest - 1 : 0;
            const content = [{ type: "text", value: fullName.trim() }];
            stream.push({
                type: "heading",
                doc,
                level: offset,
                content,
                plain: fullName.trim(),
                title: true,
            });
        } else {
            findings.push({
                file: doc.file,
                severity: "error",
                message:
                    "the page has no title: no single first heading at the shallowest level, and no front matter name.full",
            });
            return [];
        }
        for (const node of doc.tree.children) {
            if (node.type === "yaml" || (single && node === headings[0])) continue;
            if (node.type === "heading") {
                const level = top ? DEEPEST_NODE + 1 : node.depth - base + offset;
                stream.push(heading(node, level));
            } else stream.push({ type: "block", doc, node });
        }
        return stream;
    };

    const chapters = [];
    for (const [index, entry] of manifest.entries()) {
        const relative = typeof entry === "string" ? entry : entry.file;
        const doc = loadDoc(relative);
        if (!doc) continue;
        const stream = pageStream(doc, 0, index === 0);
        for (const { file, after } of typeof entry === "string" ? [] : entry.attach || []) {
            const attached = loadDoc(file);
            if (!attached) continue;
            const at = stream.findIndex(
                (event) => event.type === "heading" && event.anchor === after,
            );
            if (at < 0) {
                findings.push({
                    file: doc.file,
                    severity: "error",
                    message: `the manifest attaches ${file} after #${after}, which no heading here declares`,
                });
                continue;
            }
            const level = stream[at].level;
            let end = stream.findIndex(
                (event, i) => i > at && event.type === "heading" && event.level <= level,
            );
            if (end < 0) end = stream.length;
            stream.splice(end, 0, ...pageStream(attached, level, false));
        }
        // A heading never sits more than one level below the one before it,
        // so the sectioning nests.
        let previous = -1;
        for (const event of stream) {
            if (event.type !== "heading") continue;
            event.level = Math.min(event.level, previous + 1);
            previous = event.level;
        }
        if (stream.length) chapters.push({ doc, stream, top: index === 0 });
    }

    // Name every node and anchor, and map each page's anchors to them.

    const names = new NodeNames();
    /** @type {any[]} */
    const nodes = [];
    for (const chapter of chapters) {
        let chapterName = "Top";
        const stack = [];
        for (const event of chapter.stream) {
            if (event.type !== "heading") continue;
            if (chapter.top && event.title) {
                event.name = "Top";
            } else {
                event.name = names.claim(
                    nodeNameFor(event.plain),
                    event.level ? chapterName : undefined,
                );
            }
            if (event.level === 0 && !chapter.top) chapterName = event.name;
            if (event.anchor !== undefined) event.doc.slugs.set(event.anchor, event.name);
            if (event.title && event.doc.target === undefined) event.doc.target = event.name;
            // The Top node is written by the header; the other headings of the
            // Top page are anchored headings.
            event.isNode = event.level <= DEEPEST_NODE && !chapter.top;
            if (!event.isNode) continue;
            event.children = [];
            while (stack.length && stack.at(-1).level >= event.level) stack.pop();
            const parent = stack.at(-1);
            if (parent) parent.children.push(event);
            event.parent = parent;
            stack.push(event);
            nodes.push(event);
        }
    }

    // Pass 2: render.

    const shippedFile = (file) =>
        shippedPaths.some(
            (entry) => file === entry || file.startsWith(`${entry.replace(/\/$/, "")}/`),
        );

    const resolveAnchor = (doc, anchor, node, link) => {
        const name = doc.slugs.get(anchor);
        if (name === undefined)
            report(
                link.doc,
                node,
                `link ${link.url} points at an anchor no heading in ${doc.file} declares`,
            );
        return name;
    };

    /**
     * @param {any[]} children
     * @param {{doc: any, argument?: boolean, heading?: boolean}} ctx
     * @returns {string}
     */
    const inline = (children, ctx) => children.map((node) => inlineNode(node, ctx)).join("");

    const inlineNode = (node, ctx) => {
        const { doc, argument } = ctx;
        switch (node.type) {
            case "text":
                return escapeTexinfo(node.value, { argument });
            case "inlineCode":
                return `@code{${escapeTexinfo(node.value, { argument })}}`;
            case "strong":
                // Info writes `@strong` as `*text*`, and `*note ` there opens a
                // cross-reference, so a run that starts with "note" is `@b`.
                return /^note\s/i.test(plainText(node.children)) ?
                        `@b{${inline(node.children, ctx)}}`
                    :   `@strong{${inline(node.children, ctx)}}`;
            case "emphasis":
                return `@emph{${inline(node.children, ctx)}}`;
            case "break":
                return "@*\n";
            case "link":
                return ctx.heading ? inline(node.children, ctx) : link(node, ctx);
            case "html":
                if (/^(?:\s*<!--[\s\S]*?-->)+\s*$/.test(node.value)) return "";
                report(
                    doc,
                    node,
                    `raw HTML ${JSON.stringify(node.value)} has no Texinfo mapping; write it as code or text`,
                );
                return "";
            case "delete":
                report(doc, node, "strikethrough has no Texinfo mapping");
                return inline(node.children, ctx);
            case "image":
            case "imageReference":
                report(doc, node, "an image has no Texinfo mapping");
                return "";
            case "linkReference":
                report(
                    doc,
                    node,
                    `reference link [${plainText(node.children)}] has no Texinfo mapping; write an inline link`,
                );
                return inline(node.children, ctx);
            case "footnoteReference":
                report(doc, node, "a footnote has no Texinfo mapping");
                return "";
            default:
                report(doc, node, `Markdown ${node.type} has no Texinfo mapping`);
                return "";
        }
    };

    const link = (node, ctx) => {
        const { doc } = ctx;
        const url = node.url;
        // A cross-reference's arguments stay on one line.
        const text = inline(node.children, { ...ctx, argument: true }).replace(/\s*\n\s*/g, " ");
        const plain = plainText(node.children);
        // Info ends a cross-reference's label at a colon, so a label with one
        // is written as text followed by a reference to the node.
        const ref = (name) =>
            name === undefined ? inline(node.children, ctx)
            : plain === name || !text ? `@ref{${escapeTexinfo(name, { argument: true })}}`
            : plain.includes(":") ?
                `${inline(node.children, ctx)} (@pxref{${escapeTexinfo(name, { argument: true })}})`
            :   `@ref{${escapeTexinfo(name, { argument: true })},,${text}}`;
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) {
            const target = escapeTexinfo(url, { argument: true });
            return plain === url || !text ? `@uref{${target}}` : `@uref{${target}, ${text}}`;
        }
        if (url.startsWith("/")) {
            return `${inline(node.children, ctx)} (@code{${escapeTexinfo(url, ctx)}})`;
        }
        const hash = url.indexOf("#");
        const target = hash < 0 ? url : url.slice(0, hash);
        const anchor = hash < 0 ? "" : url.slice(hash + 1);
        const owner = { doc, url };
        if (!target) return ref(resolveAnchor(doc, anchor, node, owner));
        let decoded;
        try {
            decoded = decodeURI(target);
        } catch {
            report(doc, node, `link ${url} has invalid URI encoding`);
            return inline(node.children, ctx);
        }
        const withinDocs = path.posix.normalize(
            path.posix.join(path.posix.dirname(doc.relative), decoded),
        );
        const page = docs.get(withinDocs);
        if (page) return ref(anchor ? resolveAnchor(page, anchor, node, owner) : page.target);
        const file = path.posix.normalize(path.posix.join(docsDir, withinDocs));
        if (file.startsWith("../") || !exists(file)) {
            report(doc, node, `link ${url} resolves to ${file}, which does not exist`);
            return inline(node.children, ctx);
        }
        if (file.startsWith(`${docsDir}/`) && file.endsWith(".md")) {
            report(
                doc,
                node,
                `link ${url} points at ${file}, which the manual's manifest does not include`,
            );
            return inline(node.children, ctx);
        }
        if (!shippedFile(file)) {
            report(doc, node, `link ${url} points at ${file}, which the package does not ship`);
            return inline(node.children, ctx);
        }
        return `${inline(node.children, ctx)} (@file{${escapeTexinfo(file, ctx)}})`;
    };

    /** One line: inline content with its line breaks folded. */
    const line = (children, ctx) =>
        inline(children, ctx)
            .replace(/@\*\n/g, " ")
            .replace(/\s*\n\s*/g, " ")
            .trim();

    const entries = (event) => (indexer.entries ? indexer.entries(event) : []);

    /**
     * A table whose first column is all inline code is a `@table @code` keyed
     * on it. Any other table is a `@multitable` when every column can be as
     * wide as its longest word, and otherwise a `@table` keyed on its first
     * column. In either keyed form the other columns follow the key as
     * paragraphs, labelled by their headers when there is more than one. A
     * table of headers alone that cannot fit is a list of those headers.
     *
     * @param {any} node
     * @param {any} doc
     * @param {string} currentNode
     * @param {number} indent - The columns the table is indented by.
     */
    const table = (node, doc, currentNode, indent) => {
        const [header, ...rows] = node.children;
        const cellText = (cell) => line(cell.children, { doc });
        const meaningful = (cell) =>
            cell.children.filter((c) => !(c.type === "text" && !c.value.trim()));
        const headers = header.children.map(cellText);
        const cells = (row) =>
            header.children.map((_, column) =>
                row.children[column] ? cellText(row.children[column]) : "",
            );
        const texts = rows.map(cells);
        const keyedTable = (kind, item) => {
            const out = [`@table ${kind}`];
            for (const [index, row] of rows.entries()) {
                out.push(...item(row, texts[index]));
                const body = texts[index]
                    .slice(1)
                    .map((text, i) => {
                        if (!text) return "";
                        const label = headers[i + 1];
                        return headers.length > 2 && label ? `@emph{${label}}: ${text}` : text;
                    })
                    .filter(Boolean);
                out.push(body.join("\n\n"));
            }
            out.push("@end table");
            return out.filter((part) => part !== "").join("\n");
        };
        const coded =
            rows.length > 0 &&
            rows.every((row) => {
                const first = meaningful(row.children[0] ?? { children: [] });
                return first.length === 1 && first[0].type === "inlineCode";
            });
        if (coded) {
            return keyedTable("@code", (row) => {
                const key = meaningful(row.children[0])[0].value;
                return [
                    `@item ${escapeTexinfo(key)}`,
                    ...entries({
                        kind: "item",
                        file: doc.file,
                        node: currentNode,
                        text: key,
                        header: plainText(header.children[0]?.children ?? []),
                    }),
                ];
            });
        }
        const all = [headers, ...texts];
        const fractions = columnFractions(
            all.map((row) => row.map(infoText)),
            indent,
        );
        if (!fractions && !rows.length) {
            return [
                "@itemize @bullet",
                ...headers.map((text) => `@item ${text}`),
                "@end itemize",
            ].join("\n");
        }
        if (!fractions) {
            return keyedTable("@asis", (_, [key]) => [`@item ${key || "@w{}"}`]);
        }
        return [
            `@multitable @columnfractions ${fractions.join(" ")}`,
            `@headitem ${all[0].join(" @tab ")}`,
            ...all.slice(1).map((row) => `@item ${row.join(" @tab ")}`),
            "@end multitable",
        ]
            .map((text) => text.replace(/ +$/, ""))
            .join("\n");
    };

    /**
     * @param {any} node
     * @param {any} doc
     * @param {string} currentNode
     * @param {number} [indent] - The columns the block is indented by.
     * @returns {string}
     */
    const block = (node, doc, currentNode, indent = 0) => {
        const blocks = (children) =>
            children
                .map((child) => block(child, doc, currentNode, indent + INDENT))
                .filter((text) => text !== "")
                .join("\n\n");
        switch (node.type) {
            case "paragraph": {
                const { start, end } = node.position;
                const source = doc.source.slice(start.offset, end.offset);
                if (/^ {0,3}:::/m.test(source)) {
                    report(doc, node, "a fenced div (`:::`) has no Texinfo mapping");
                    return "";
                }
                if (/^ {0,3}:[ \t]/m.test(source)) {
                    report(doc, node, "a definition list has no Texinfo mapping");
                    return "";
                }
                if (/^ {0,3}\|.*\|[ \t]*$/m.test(source)) {
                    report(
                        doc,
                        node,
                        "a pipe table needs a header row followed by a delimiter row; this one reads as a paragraph",
                    );
                    return "";
                }
                return inline(node.children, { doc }).trim();
            }
            case "code":
                return `@example\n${escapeTexinfo(node.value)}\n@end example`;
            case "list": {
                if (node.children.some((item) => typeof item.checked === "boolean")) {
                    report(doc, node, "a task list has no Texinfo mapping");
                    return "";
                }
                const kind = node.ordered ? "enumerate" : "itemize";
                const open =
                    node.ordered ?
                        node.start && node.start !== 1 ?
                            `@enumerate ${node.start}`
                        :   "@enumerate"
                    :   "@itemize @bullet";
                const items = node.children.map((item) => `@item\n${blocks(item.children)}`);
                return `${open}\n${items.join("\n\n")}\n@end ${kind}`;
            }
            case "blockquote": {
                const first = node.children[0];
                const alert =
                    first?.type === "paragraph" &&
                    /^\[!(?:note|tip|important|warning|caution)\]/i.exec(plainText(first.children));
                if (alert) {
                    report(
                        doc,
                        node,
                        `a GitHub alert (${alert[0]}) has no Texinfo mapping; write a plain quotation`,
                    );
                    return "";
                }
                return `@quotation\n${blocks(node.children)}\n@end quotation`;
            }
            case "table":
                return table(node, doc, currentNode, indent);
            case "thematicBreak":
            case "yaml":
                return "";
            case "html":
                if (/^(?:\s*<!--[\s\S]*?-->)+\s*$/.test(node.value)) return "";
                report(doc, node, "raw HTML has no Texinfo mapping; write it as Markdown or code");
                return "";
            case "heading":
                report(doc, node, "a heading inside a list or quotation has no Texinfo mapping");
                return "";
            case "definition":
                report(
                    doc,
                    node,
                    "a link reference definition has no Texinfo mapping; write inline links",
                );
                return "";
            case "footnoteDefinition":
                report(doc, node, "a footnote has no Texinfo mapping");
                return "";
            default:
                report(doc, node, `Markdown ${node.type} has no Texinfo mapping`);
                return "";
        }
    };

    const menuEntry = (name, description) => {
        const entry = `* ${escapeTexinfo(name)}::`;
        if (!description) return entry;
        return `${entry.padEnd(32)} ${escapeTexinfo(String(description).replace(/\s+/g, " ").trim())}`;
    };
    const menu = (children) =>
        [
            "@menu",
            ...children.map((child) =>
                menuEntry(child.name, child.level === 0 ? child.doc.front?.description : undefined),
            ),
            "@end menu",
        ].join("\n");

    const trailing = indexer.nodes ? indexer.nodes() : [];
    const parts = [];
    let topBody = "";
    let topTitle = "Top";
    for (const chapter of chapters) {
        const out = [];
        let current = "Top";
        const menus = new Set();
        for (const event of chapter.stream) {
            if (event.type === "block") {
                const text = block(event.node, event.doc, current);
                if (text) out.push(text);
                continue;
            }
            const title = line(event.content, { doc: event.doc, heading: true });
            if (chapter.top && event.title) {
                topTitle = title;
                continue;
            }
            if (!event.isNode) {
                out.push(
                    [
                        `@anchor{${escapeTexinfo(event.name)}}`,
                        `@subsubheading ${title}`,
                        ...entries({
                            kind: "heading",
                            file: event.doc.file,
                            node: event.name,
                            text: event.plain,
                            level: event.level,
                        }),
                    ].join("\n"),
                );
                continue;
            }
            if (event.parent && !menus.has(event.parent)) {
                out.push(menu(event.parent.children));
                menus.add(event.parent);
            }
            current = event.name;
            out.push(
                [
                    `@node ${escapeTexinfo(event.name)}`,
                    `${SECTIONING[event.level]} ${title}`,
                    ...entries({
                        kind: "heading",
                        file: event.doc.file,
                        node: event.name,
                        text: event.plain,
                        level: event.level,
                    }),
                ].join("\n"),
            );
        }
        if (chapter.top) topBody = out.join("\n\n");
        else parts.push(out.join("\n\n"));
    }

    const chapterNodes = nodes.filter((event) => event.level === 0);
    const detail = [];
    for (const event of nodes) {
        if (!event.children.length) continue;
        detail.push("", plainText(event.content), "");
        for (const child of event.children) detail.push(menuEntry(child.name));
    }
    const top = chapters.find((chapter) => chapter.top);
    const description = top?.doc.front?.description ?? "";
    const masterMenu = [
        "@menu",
        ...chapterNodes.map((event) => menuEntry(event.name, event.doc.front?.description)),
        ...trailing.map((node) => menuEntry(node.name, node.description)),
        ...(detail.length ?
            ["", "@detailmenu", " --- The Detailed Node Listing ---", ...detail, "@end detailmenu"]
        :   []),
        "@end menu",
    ].join("\n");

    const texinfo = [
        [
            "\\input texinfo",
            "@c Generated from the Markdown under docs/ by scripts/docs-texinfo.mjs.",
            "@setfilename package-build.info",
            "@documentencoding UTF-8",
            "@documentlanguage en",
            "@settitle Package Build",
            `@set VERSION ${escapeTexinfo(packageVersion ?? "")}`,
        ].join("\n"),
        [
            "@copying",
            "This manual documents @code{@@heroiclands/package-build}, version @value{VERSION}.",
            "",
            'Copyright @copyright{} 2024-2026 Tom Rodriguez ("Toasty").',
            "",
            "@quotation",
            "The text of this manual is licensed under the Creative Commons",
            "Attribution-ShareAlike 4.0 International License (CC-BY-SA-4.0). See",
            "@uref{https://creativecommons.org/licenses/by-sa/4.0/}. The software it",
            "documents is licensed under GPL-3.0-or-later.",
            "@end quotation",
            "@end copying",
        ].join("\n"),
        [
            "@dircategory HeroicLands",
            "@direntry",
            `${"* Package Build: (package-build).".padEnd(32)} ${escapeTexinfo(description.replace(/\s+/g, " ").trim())}`.trimEnd(),
            "@end direntry",
        ].join("\n"),
        [
            "@titlepage",
            "@title Package Build",
            "@subtitle Version @value{VERSION}",
            "@page",
            "@vskip 0pt plus 1filll",
            "@insertcopying",
            "@end titlepage",
        ].join("\n"),
        "@contents",
        ["@ifnottex", "@node Top", `@top ${topTitle}`].join("\n"),
        "@insertcopying",
        ...(topBody ? [topBody] : []),
        `${masterMenu}\n@end ifnottex`,
        ...parts,
        ...trailing.map((node) => `@node ${escapeTexinfo(node.name)}\n${node.texinfo}`),
        "@bye",
    ].join("\n\n");

    return { texinfo: `${texinfo}\n`, findings };
}
