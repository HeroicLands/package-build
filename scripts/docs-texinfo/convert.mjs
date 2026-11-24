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
 * Convert the Markdown notes under `docs/` into Texinfo manuals.
 *
 * A manual starts at a top page, follows links to discover pages, and takes its
 * structure from each page's `texinfo` front matter:
 *
 *     texinfo:
 *       parent: <Address> | null
 *       before: [<Address>, ...]
 *       after: [<Address>, ...]
 *
 * A page without `texinfo` does not take part: it is never converted, and the
 * crawl does not follow its links. `parent` is required; `null` marks the top
 * page, and a manual has exactly one. `before` and `after` order siblings, and
 * a hint that does not resolve, names a page outside the manual, or names a
 * page with another parent is ignored and reported. A page is named by its
 * Address, read by the repository's Address parser with the default type
 * `doc`; the page's `type` and `shortcode` give it one.
 *
 * Planning (pass 1) builds the tree, names every node and anchor, and builds
 * the symbol table links resolve through. Emission (pass 2) walks the tree in
 * order. Every chapter and its subtree is written to its own file that the
 * master file includes. Pages deeper than four levels fold into their level-4
 * ancestor as anchored `@subsubheading` blocks.
 *
 * Findings are `error` (no manual is written) or `warning` (the manual is
 * written and the finding is part of the build report).
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import YAML from "yaml";

import { isAddressTuple, parseAddress, renderAddress } from "../../engine/address.mjs";
import { positionOfYamlPath } from "../../engine/diagnostics.mjs";
import { docHeadingAnchors } from "../../engine/docs-checks.mjs";
import { HEADING_LINE, splitHeadingAttributes } from "../../engine/heading-attributes.mjs";
import {
    INDENT,
    columnFractions,
    escapeTexinfo,
    formatFinding,
    headingContent,
    infoText,
    nodeNameFor,
    plainText,
    texSafe,
} from "./text.mjs";

export { columnFractions, escapeTexinfo, formatFinding, infoText, nodeNameFor };
export { FILL_COLUMN } from "./text.mjs";

/**
 * @typedef {{file: string, line?: number, column?: number,
 *   severity: "error" | "warning", kind: string, message: string}} Finding
 */

/** Sectioning commands by tree depth below Top (1 is a chapter). */
const SECTIONING = [undefined, "@chapter", "@section", "@subsection", "@subsubsection"];

/** The deepest tree depth that is a node; deeper pages fold into it. */
const DEEPEST_NODE = SECTIONING.length - 1;

/**
 * The index a note's `subType` adds it to, besides the concept index. A
 * subType that is not a key adds the note to the concept index alone.
 */
export const SUBTYPE_INDEXES = Object.freeze({
    reference: Object.freeze({
        code: "rf",
        node: "Reference Index",
        description: "Index of reference pages.",
    }),
});

/** The concept index every note enters. */
const CONCEPT_INDEX = Object.freeze({
    code: "cp",
    node: "Concept Index",
    description: "Index of concepts.",
});

/**
 * The indexes the text itself fills: options and environment variables enter
 * the variable index, and commands enter the program index.
 */
const VARIABLE_INDEX = Object.freeze({
    code: "vr",
    command: "@vindex",
    node: "Variable Index",
    description: "Index of options and environment variables.",
});
const PROGRAM_INDEX = Object.freeze({
    code: "pg",
    command: "@pindex",
    node: "Program Index",
    description: "Index of commands.",
});

/** Commands whose spans are `@command`. */
const COMMANDS = new Set([
    "npm",
    "npx",
    "node",
    "git",
    "docker",
    "texi2any",
    "texi2pdf",
    "makeinfo",
    "package-build",
]);

/** File extensions that mark a code span as a file name. */
const FILE_EXTENSIONS = new Set(
    "md yaml yml json jsonl mjs cjs js ts mts css html txt png jpg jpeg svg pdf texi info toml xml csv".split(
        " ",
    ),
);

/** Whether a code span reads as a file or path. */
function isPath(value) {
    if (/\s/.test(value) || /^(?:--?|https?:)/.test(value)) return false;
    if (/^[.~]?\/?[\w.@*-]+(?:\/[\w.@*-]+)+\/?$/.test(value)) return true;
    const extension = /^[\w.@*-]+\.([A-Za-z0-9]+)$/.exec(value)?.[1];
    return extension !== undefined && FILE_EXTENSIONS.has(extension.toLowerCase());
}

/** Image types TeX, HTML and Info can all show. */
const IMAGE_TYPES = new Set([".png", ".jpg", ".jpeg", ".pdf"]);

const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

const processor = unified().use(remarkParse).use(remarkFrontmatter).use(remarkGfm);

/**
 * The seconds since the epoch the manual is dated by: `SOURCE_DATE_EPOCH` when
 * set, otherwise the commit time of the last git commit at `root`. Never the
 * current time.
 *
 * @param {string} root
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number | undefined}
 */
export function sourceEpoch(root, env = process.env) {
    const given = Number(env.SOURCE_DATE_EPOCH);
    if (env.SOURCE_DATE_EPOCH && Number.isInteger(given) && given >= 0) return given;
    const run = spawnSync("git", ["-C", root, "log", "-1", "--format=%ct"], { encoding: "utf8" });
    const value = Number(run.stdout?.trim());
    return run.status === 0 && Number.isInteger(value) ? value : undefined;
}

/** `24 November 2026`, in UTC. */
function dateText(epoch) {
    const date = new Date(epoch * 1000);
    return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** The names of a `package.json` person or list of people. */
function personNames(value) {
    const list =
        Array.isArray(value) ? value
        : value === undefined ? []
        : [value];
    return list
        .map((entry) =>
            typeof entry === "string" ?
                entry
                    .replace(/<[^>]*>|\([^)]*\)/g, "")
                    .replace(/\s+/g, " ")
                    .trim()
            : typeof entry?.name === "string" ? entry.name.trim()
            : "",
        )
        .filter(Boolean);
}

/** A repository URL a reader can open. */
function publicUrl(value) {
    const url = typeof value === "string" ? value : value?.url;
    if (typeof url !== "string") return undefined;
    return url.replace(/^git\+/, "").replace(/\.git$/, "") || undefined;
}

/**
 * The license statement of the manual, one sentence per line. The manual's own
 * license is `texinfo.license` in `package.json`; the software it documents is
 * what the package's `license` expression names besides it. Without
 * `texinfo.license` the package's expression is the whole statement.
 *
 * @param {any} pkg
 * @returns {string[]}
 */
function licenseStatement(pkg) {
    const manual = typeof pkg.texinfo?.license === "string" ? pkg.texinfo.license.trim() : "";
    const full = typeof pkg.license === "string" ? pkg.license.trim() : "";
    if (!manual && !full) return [];
    if (!manual) return [`Licensed under ${escapeTexinfo(full)}.`];
    const software = full
        .split(/\s+(?:AND|OR|WITH)\s+|[()]/)
        .map((token) => token.trim())
        .filter((token) => token && token !== manual);
    return [
        `The text of this manual is licensed under ${escapeTexinfo(manual)}.`,
        ...(software.length ?
            [
                `The software it documents is licensed under ${escapeTexinfo(software.join(" and "))}.`,
            ]
        :   []),
    ];
}

/** A collapsed single-line string, or the empty string. */
function oneLine(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** A file-name stem for a node name. */
function slugOf(name) {
    return (
        name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "chapter"
    );
}

/** Code-point comparison, which does not depend on the locale. */
function compare(a, b) {
    return (
        a < b ? -1
        : a > b ? 1
        : 0
    );
}

/**
 * One Info directory entry: `* Title: (name).   Description`.
 * @param {string} title
 * @param {string} name - The Info file, without extension.
 * @param {string} description
 * @returns {string}
 */
function direntry(title, name, description) {
    // A colon ends the entry's label, so the title carries none.
    const label = escapeTexinfo(title).replace(/:/g, "");
    return `${`* ${label}: (${escapeTexinfo(name)}).`.padEnd(32)} ${escapeTexinfo(description)}`.trimEnd();
}

/**
 * Convert one manual.
 *
 * @param {object} options
 * @param {string} options.docsDir
 * @param {string} options.page - The top page, relative to `docsDir`.
 * @param {string} options.out - The output name, without extension.
 * @param {string | undefined} options.title
 * @param {any} options.pkg - The parsed `package.json`.
 * @param {string[]} options.authors
 * @param {number} options.epoch
 * @param {string} options.contentPackage - The package the pages belong to.
 * @param {(file: string) => string} options.read
 * @param {(file: string) => boolean} options.exists
 * @param {(dir: string) => string[]} options.list
 * @param {string[]} options.shipped
 */
function convertManual({
    docsDir,
    page,
    out: outName,
    title: declaredTitle,
    pkg,
    authors,
    epoch,
    contentPackage,
    read,
    exists,
    list,
    shipped: shippedPaths,
}) {
    /** @type {Finding[]} */
    const findings = [];
    const problem = (file, position, severity, kind, message) => {
        findings.push({
            file,
            ...(position?.line !== undefined ?
                { line: position.line, column: position.column }
            :   {}),
            severity,
            kind,
            message,
        });
    };
    const report = (doc, node, message, kind = "construct") =>
        problem(doc.file, node?.position?.start, "warning", kind, message);
    const fatal = (doc, node, message, kind) =>
        problem(doc.file, node?.position?.start, "error", kind, message);

    // ---- Documents ----------------------------------------------------------

    /** @type {Map<string, any>} */
    const docs = new Map();
    const loadDoc = (relative) => {
        if (docs.has(relative)) return docs.get(relative);
        const file = path.posix.join(docsDir, relative);
        let source;
        try {
            source = read(file);
        } catch {
            docs.set(relative, undefined);
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
            yaml: undefined,
            anchors: new Map(docHeadingAnchors(source).map(({ line, anchor }) => [line, anchor])),
            definitions: new Map(),
            footnotes: new Map(),
            headings: new Map(),
        };
        const yamlNode = tree.children.find((node) => node.type === "yaml");
        if (yamlNode) {
            doc.yaml = yamlNode;
            try {
                const parsed = YAML.parse(yamlNode.value);
                doc.front = parsed && typeof parsed === "object" ? parsed : {};
            } catch (error) {
                fatal(doc, yamlNode, `front matter is not YAML: ${error.message}`, "frontmatter");
            }
        }
        const walk = (node) => {
            if (node.type === "definition")
                doc.definitions.set(node.identifier.toLowerCase(), node);
            if (node.type === "footnoteDefinition")
                doc.footnotes.set(node.identifier.toLowerCase(), node);
            for (const child of node.children ?? []) walk(child);
        };
        walk(tree);
        const roots = tree.children.filter((node) => node.type === "heading");
        const shallowest = roots.length ? Math.min(...roots.map((node) => node.depth)) : 1;
        const single =
            roots.length > 0 &&
            roots[0].depth === shallowest &&
            roots.filter((node) => node.depth === shallowest).length === 1;
        doc.titleHeading = single ? roots[0] : undefined;
        doc.base = single ? shallowest : shallowest - 1;
        for (const node of roots) {
            const slug = doc.anchors.get(node.position.start.line);
            if (slug !== undefined) doc.headings.set(slug, node);
        }
        docs.set(relative, doc);
        return doc;
    };

    const participates = (doc) => doc.front?.texinfo !== undefined;

    /** The title of a page, and where it came from. */
    const titleOf = (doc) => {
        if (doc.title !== undefined) return doc.title;
        const full = doc.front?.name?.full;
        if (typeof full === "string" && full.trim()) {
            doc.title = oneLine(full);
        } else if (doc.titleHeading) {
            doc.title = oneLine(plainText(doc.titleHeading.children));
            report(
                doc,
                doc.yaml,
                "the page has no name.full; its first heading names the node",
                "fallback",
            );
        } else {
            doc.title = path.posix.basename(doc.relative, ".md");
            report(
                doc,
                doc.yaml,
                "the page has no name.full and no title heading; its file name names the node",
                "fallback",
            );
        }
        return doc.title;
    };

    /**
     * The canonical Address of every page that has a `type` and a `shortcode`,
     * mapped to the page.
     * @type {Map<string, string>}
     */
    const addressIndex = new Map();
    let allFiles = [];
    try {
        allFiles = list(docsDir)
            .filter((file) => file.endsWith(".md"))
            .sort(compare);
    } catch {
        allFiles = [];
    }
    const addressTypes = new Set(["doc"]);
    for (const file of allFiles) {
        const type = loadDoc(path.posix.relative(docsDir, file))?.front.type;
        if (typeof type === "string") addressTypes.add(type);
    }
    const addressDefaults = {
        package: contentPackage,
        system: "note",
        type: "doc",
        types: addressTypes,
        packages: new Set([contentPackage]),
    };
    for (const file of allFiles) {
        const relative = path.posix.relative(docsDir, file);
        const doc = loadDoc(relative);
        if (!doc || typeof doc.front.type !== "string" || typeof doc.front.shortcode !== "string")
            continue;
        const parsed = parseAddress(
            [doc.front.type, doc.front.shortcode].join("-"),
            addressDefaults,
            { declared: true },
        );
        if (!isAddressTuple(parsed)) {
            report(
                doc,
                doc.yaml,
                `the type and shortcode of the page do not form an Address (${parsed.reason})`,
                "address",
            );
            continue;
        }
        const canonical = renderAddress(parsed);
        if (addressIndex.has(canonical)) {
            report(
                doc,
                doc.yaml,
                `the Address ${canonical} also names ${addressIndex.get(canonical)}; no page can name this one`,
                "address",
            );
            continue;
        }
        addressIndex.set(canonical, relative);
    }

    /**
     * The page an Address names, relative to `docsDir`. A written Address
     * takes its package, the system `note` and the type `doc` from where it is
     * written.
     */
    const resolveAddress = (address) => {
        if (typeof address !== "string" || !address.trim()) return undefined;
        const parsed = parseAddress(address.trim(), addressDefaults, { declared: true });
        return isAddressTuple(parsed) ? addressIndex.get(renderAddress(parsed)) : undefined;
    };

    /** Where the front matter key at `keyPath` sits in the file. */
    const frontPosition = (doc, keyPath) => {
        if (!doc.yaml) return undefined;
        const at = positionOfYamlPath(doc.yaml.value, keyPath);
        if (at.line === undefined) return doc.yaml.position.start;
        return { line: doc.yaml.position.start.line + at.line, column: at.column };
    };
    const frontProblem = (doc, keyPath, kind, message, severity = "warning") =>
        problem(doc.file, frontPosition(doc, keyPath), severity, kind, message);

    /**
     * What a link points at: `external`, `page` (a Markdown page under docs),
     * `file` (another file) or `invalid`.
     */
    const targetOf = (doc, url) => {
        if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(url)) return { kind: "external" };
        const hash = url.indexOf("#");
        const target = hash < 0 ? url : url.slice(0, hash);
        const anchor = hash < 0 ? "" : url.slice(hash + 1);
        if (!target) return { kind: "page", relative: doc.relative, anchor };
        let decoded;
        try {
            decoded = decodeURI(target);
        } catch {
            return { kind: "invalid", reason: `link ${url} has invalid URI encoding` };
        }
        const relative = path.posix.normalize(
            path.posix.join(path.posix.dirname(doc.relative), decoded),
        );
        const file = path.posix.join(docsDir, relative);
        if (relative.startsWith("../") && file.startsWith("../"))
            return { kind: "invalid", reason: `link ${url} leaves the project` };
        if (!exists(file))
            return {
                kind: "invalid",
                reason: `link ${url} resolves to ${file}, which does not exist`,
            };
        if (relative.endsWith(".md") && !relative.startsWith("../"))
            return { kind: "page", relative, anchor };
        return { kind: "file", file };
    };

    /** The URL of a link, link reference or image node, if it has one. */
    const urlOf = (doc, node) => {
        if (node.type === "link" || node.type === "image") return node.url;
        const definition = doc.definitions.get(node.identifier?.toLowerCase());
        return definition?.url;
    };

    /** Every link of a page, in order. */
    const linksOf = (doc) => {
        const found = [];
        const walk = (node) => {
            if (node.type === "link" || node.type === "linkReference") found.push(node);
            for (const child of node.children ?? []) walk(child);
        };
        walk(doc.tree);
        return found;
    };

    // ---- Pass 1: crawl and plan ----------------------------------------------

    const topDoc = loadDoc(page);
    if (!topDoc) {
        problem(
            path.posix.join(docsDir, page),
            undefined,
            "error",
            "structure",
            "the top page does not exist",
        );
        return { findings };
    }
    if (!participates(topDoc)) {
        fatal(topDoc, topDoc.yaml, "the top page has no texinfo front matter", "structure");
        return { findings };
    }
    if (topDoc.front.texinfo?.parent !== null) {
        frontProblem(
            topDoc,
            ["texinfo", "parent"],
            "structure",
            "the top page must declare `parent: null`",
            "error",
        );
        return { findings };
    }

    /** Pages reached through participating pages, in crawl order. */
    const reached = [page];
    const visited = new Set(reached);
    const stopped = new Map();
    for (const relative of reached) {
        const doc = loadDoc(relative);
        for (const node of linksOf(doc)) {
            const url = urlOf(doc, node);
            if (url === undefined) continue;
            const target = targetOf(doc, url);
            if (target.kind !== "page" || visited.has(target.relative)) continue;
            visited.add(target.relative);
            const next = loadDoc(target.relative);
            if (!next) continue;
            if (!participates(next)) {
                stopped.set(target.relative, { doc, node });
                continue;
            }
            reached.push(target.relative);
        }
    }
    for (const [relative, { doc, node }] of stopped)
        report(
            doc,
            node,
            `the crawl stops at ${path.posix.join(docsDir, relative)}, which has no texinfo front matter`,
            "non-participating",
        );

    // Participating pages that no chain of links reaches.
    let allPages = [];
    try {
        allPages = list(docsDir).filter((file) => file.endsWith(".md"));
    } catch {
        allPages = [];
    }
    const reachedFiles = new Set(reached.map((rel) => path.posix.join(docsDir, rel)));
    for (const file of allPages.sort(compare)) {
        if (reachedFiles.has(file)) continue;
        const rel = path.posix.relative(docsDir, file);
        const doc = loadDoc(rel);
        if (doc && participates(doc) && !stopped.has(rel))
            report(
                doc,
                doc.yaml,
                "the page has texinfo front matter but no chain of links through participating pages reaches it from the top page",
                "unreached",
            );
    }

    // Attach each reached page under its parent.
    /** @type {Map<string, string>} */
    const parentOf = new Map();
    const excluded = new Map();
    const exclude = (relative, keyPath, message) => {
        if (excluded.has(relative)) return;
        excluded.set(relative, message);
        frontProblem(loadDoc(relative), keyPath, "excluded", `the page is excluded: ${message}`);
    };
    for (const relative of reached.slice(1)) {
        const doc = loadDoc(relative);
        const texinfo = doc.front.texinfo;
        if (texinfo === null || typeof texinfo !== "object" || Array.isArray(texinfo)) {
            exclude(relative, ["texinfo"], "texinfo must be a mapping");
            continue;
        }
        if (!("parent" in texinfo)) {
            exclude(relative, ["texinfo"], "texinfo has no parent");
            continue;
        }
        if (texinfo.parent === null) {
            exclude(
                relative,
                ["texinfo", "parent"],
                "it declares `parent: null`, and the manual has one top page",
            );
            continue;
        }
        const parent = resolveAddress(texinfo.parent);
        if (parent === undefined) {
            exclude(
                relative,
                ["texinfo", "parent"],
                `parent ${JSON.stringify(texinfo.parent)} does not resolve to a page`,
            );
            continue;
        }
        const parentDoc = loadDoc(parent);
        if (!participates(parentDoc)) {
            exclude(relative, ["texinfo", "parent"], `parent ${parent} is not part of the manual`);
            continue;
        }
        if (!reached.includes(parent)) {
            exclude(
                relative,
                ["texinfo", "parent"],
                `parent ${parent} is not reached from the top page`,
            );
            continue;
        }
        parentOf.set(relative, parent);
    }
    // A chain that does not end at the top page, or that loops, excludes its pages.
    const leadsToTop = new Map([[page, true]]);
    const chainOk = (relative) => {
        const trail = [];
        let current = relative;
        let ok;
        while (ok === undefined) {
            if (leadsToTop.has(current)) ok = leadsToTop.get(current);
            else if (trail.includes(current) || excluded.has(current) || !parentOf.has(current))
                ok = false;
            else {
                trail.push(current);
                current = parentOf.get(current);
            }
        }
        for (const step of trail) leadsToTop.set(step, ok);
        return ok;
    };
    for (const relative of reached.slice(1)) {
        if (excluded.has(relative) || chainOk(relative)) continue;
        exclude(relative, ["texinfo", "parent"], "its parent chain does not lead to the top page");
    }
    const included = reached.filter((relative) => !excluded.has(relative));
    const includedSet = new Set(included);

    /**
     * @typedef {object} Entry
     * @property {string} relative
     * @property {any} doc
     * @property {string} title
     * @property {Entry | undefined} parent
     * @property {Entry[]} children
     * @property {number} depth
     * @property {boolean} folded
     * @property {Entry | undefined} host
     * @property {string} name
     */
    /** @type {Map<string, Entry>} */
    const entries = new Map();
    for (const relative of included) {
        const doc = loadDoc(relative);
        entries.set(relative, {
            relative,
            doc,
            title: relative === page ? (declaredTitle ?? titleOf(doc)) : titleOf(doc),
            parent: undefined,
            children: [],
            depth: 0,
            folded: false,
            host: undefined,
            name: relative === page ? "Top" : "",
        });
    }
    const byKey = (a, b) => compare(a.title, b.title) || compare(a.relative, b.relative);

    /** Order a sibling group by its hints, then by key; report the hints it cannot use. */
    const orderGroup = (members) => {
        const set = new Set(members.map((entry) => entry.relative));
        /** @type {Map<string, Set<string>>} */
        const after = new Map(members.map((entry) => [entry.relative, new Set()]));
        const edges = [];
        for (const entry of members) {
            for (const kind of ["before", "after"]) {
                const list = entry.doc.front.texinfo[kind];
                if (list === undefined) continue;
                if (!Array.isArray(list)) {
                    frontProblem(
                        entry.doc,
                        ["texinfo", kind],
                        "hint",
                        `texinfo.${kind} must be a list; the hints are ignored`,
                    );
                    continue;
                }
                for (const [index, address] of list.entries()) {
                    const keyPath = ["texinfo", kind, index];
                    const target = resolveAddress(address);
                    let reason;
                    if (target === undefined) reason = "does not resolve to a page";
                    else if (!participates(loadDoc(target))) reason = "is not part of the manual";
                    else if (target === entry.relative) reason = "names the page itself";
                    else if (!set.has(target)) reason = "is not a sibling";
                    if (reason) {
                        frontProblem(
                            entry.doc,
                            keyPath,
                            "hint",
                            `the ${kind} hint ${JSON.stringify(address)} is ignored: it ${reason}`,
                        );
                        continue;
                    }
                    edges.push(
                        kind === "before" ? [entry.relative, target] : [target, entry.relative],
                    );
                }
            }
        }
        for (const [from, to] of edges) after.get(to).add(from);
        const remaining = [...members].sort(byKey);
        const ordered = [];
        while (remaining.length) {
            const index = remaining.findIndex((entry) =>
                [...after.get(entry.relative)].every((from) =>
                    ordered.some((o) => o.relative === from),
                ),
            );
            if (index < 0) {
                const first = members[0];
                frontProblem(
                    first.doc,
                    ["texinfo"],
                    "hint-cycle",
                    `the ordering hints among the children of ${first.parent?.title ?? "the top page"} contradict each other; the group is ordered by title`,
                );
                return [...members].sort(byKey);
            }
            ordered.push(...remaining.splice(index, 1));
        }
        return ordered;
    };

    const top = entries.get(page);
    for (const relative of included.slice(1)) {
        const entry = entries.get(relative);
        entry.parent = entries.get(parentOf.get(relative));
        entry.parent.children.push(entry);
    }
    for (const entry of entries.values()) {
        if (entry.children.length) entry.children = orderGroup(entry.children);
    }

    /** @type {Entry[]} */
    const preorder = [];
    const assignDepth = (entry, depth) => {
        entry.depth = depth;
        preorder.push(entry);
        if (depth > DEEPEST_NODE) {
            entry.folded = true;
            entry.host = depth === DEEPEST_NODE + 1 ? entry.parent : entry.parent.host;
            report(
                entry.doc,
                entry.doc.yaml,
                `the page is ${depth} levels deep and folds into ${entry.host.title} as a subsubheading`,
                "fold",
            );
        }
        for (const child of entry.children) assignDepth(child, depth + 1);
    };
    assignDepth(top, 0);

    // Names: nodes first, then folded pages, then linked headings.
    const taken = new Set(
        [
            "top",
            CONCEPT_INDEX.node,
            VARIABLE_INDEX.node,
            PROGRAM_INDEX.node,
            ...Object.values(SUBTYPE_INDEXES).map((index) => index.node),
        ].map((name) => name.toLowerCase()),
    );
    const indexNodes = new Set();
    const subtypeIndex = (doc) => {
        const subType = doc.front.subType;
        return typeof subType === "string" && Object.hasOwn(SUBTYPE_INDEXES, subType) ?
                SUBTYPE_INDEXES[subType]
            :   undefined;
    };
    for (const entry of preorder) {
        const index = subtypeIndex(entry.doc);
        if (index) indexNodes.add(index);
    }
    const free = (name) => !taken.has(name.toLowerCase());
    const claim = (base, qualifiers, fallback, qualify = false) => {
        let name = base;
        let first = qualify;
        for (const qualifier of qualifiers) {
            if (free(name) && !first) break;
            first = false;
            name = `${name} - ${qualifier}`;
        }
        if (!free(name)) name = `${base} - ${fallback}`;
        if (!free(name))
            problem(
                path.posix.join(docsDir),
                undefined,
                "error",
                "name",
                `the name ${name} cannot be made unique`,
            );
        taken.add(name.toLowerCase());
        return name;
    };
    const ancestorsOf = (entry) => {
        const names = [];
        for (let up = entry.parent; up; up = up.parent) names.push(nodeNameFor(up.title));
        return names;
    };
    const nodeEntries = preorder.filter((entry) => entry !== top && !entry.folded);
    const counts = new Map();
    for (const entry of nodeEntries) {
        const key = nodeNameFor(entry.title).toLowerCase();
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const reserved = new Set(taken);
    for (const entry of nodeEntries) {
        const base = nodeNameFor(entry.title);
        const key = base.toLowerCase();
        if (counts.get(key) === 1 && !reserved.has(key)) {
            entry.name = base;
            taken.add(key);
        }
    }
    for (const entry of nodeEntries) {
        if (entry.name) continue;
        const base = nodeNameFor(entry.title);
        entry.name = claim(
            base,
            ancestorsOf(entry),
            nodeNameFor(entry.relative.replace(/\.md$/, "")),
            true,
        );
        report(
            entry.doc,
            entry.doc.yaml,
            `the node name ${base} collides with another name and becomes ${entry.name}`,
            "rename",
        );
    }
    for (const entry of preorder.filter((candidate) => candidate.folded)) {
        const base = nodeNameFor(entry.title);
        entry.name = claim(
            base,
            ancestorsOf(entry),
            nodeNameFor(entry.relative.replace(/\.md$/, "")),
        );
        if (entry.name !== base)
            report(
                entry.doc,
                entry.doc.yaml,
                `the anchor name ${base} collides with another name and becomes ${entry.name}`,
                "rename",
            );
    }

    // The headings a link points at need anchors.
    const needed = new Set();
    for (const entry of preorder) {
        if (entry === top) continue;
        for (const node of linksOf(entry.doc)) {
            const url = urlOf(entry.doc, node);
            if (url === undefined) continue;
            const target = targetOf(entry.doc, url);
            if (target.kind !== "page" || !target.anchor || !includedSet.has(target.relative))
                continue;
            if (target.relative === page) continue;
            needed.add(`${target.relative}#${target.anchor}`);
        }
    }
    for (const node of linksOf(top.doc)) {
        const url = urlOf(top.doc, node);
        if (url === undefined) continue;
        const target = targetOf(top.doc, url);
        if (
            target.kind === "page" &&
            target.anchor &&
            includedSet.has(target.relative) &&
            target.relative !== page
        )
            needed.add(`${target.relative}#${target.anchor}`);
    }
    /** (page, slug) to the anchor or node name that stands for it. */
    const symbols = new Map();
    for (const entry of preorder) {
        if (entry !== top) symbols.set(entry.relative, entry.name);
        for (const [slug, heading] of entry.doc.headings) {
            if (entry === top) continue;
            if (heading === entry.doc.titleHeading) {
                symbols.set(`${entry.relative}#${slug}`, entry.name);
                continue;
            }
            if (!needed.has(`${entry.relative}#${slug}`)) continue;
            const raw =
                HEADING_LINE.exec(entry.doc.lines[heading.position.start.line - 1] ?? "")?.[2] ??
                "";
            const content = headingContent(heading, raw);
            const base = nodeNameFor(plainText(content));
            symbols.set(
                `${entry.relative}#${slug}`,
                claim(base, [entry.name], `${entry.name} - ${slug}`),
            );
        }
    }

    // ---- Pass 2: emit ------------------------------------------------------

    const shippedFile = (file) =>
        shippedPaths.some(
            (item) => file === item || file.startsWith(`${item.replace(/\/$/, "")}/`),
        );

    /** @type {Map<string, string>} */
    const assets = new Map();
    const imageName = (file) => `${outName}-images/${file.replace(/[^A-Za-z0-9._-]+/g, "-")}`;

    /** A node or anchor name, or undefined when the target is not in the manual. */
    const symbolFor = (relative, anchor) => {
        if (relative === page) return undefined;
        return anchor ? symbols.get(`${relative}#${anchor}`) : symbols.get(relative);
    };

    /**
     * @param {any[]} children
     * @param {{doc: any, argument?: boolean, heading?: boolean}} ctx
     */
    const inline = (children, ctx) => {
        const parts = [];
        for (const [index, node] of children.entries()) {
            if (node.type === "link" || node.type === "linkReference") {
                const before = plainText(children.slice(0, index));
                const after = plainText(children.slice(index + 1));
                parts.push(link(node, ctx, parts, before, after));
            } else if (node.type === "inlineCode") {
                const before = plainText(children.slice(0, index));
                const after = plainText(children.slice(index + 1));
                parts.push(inlineCode(node.value, { ...ctx, before, after }));
            } else parts.push(inlineNode(node, ctx));
        }
        return parts.join("");
    };

    /** The index terms the page being rendered collects. */
    let collected;

    /**
     * A code span as the Texinfo command for what it is: an option, a
     * placeholder, an environment variable, a command, a file, or code.
     */
    const inlineCode = (value, ctx) => {
        const escaped =
            ctx.argument ? escapeTexinfo(value, { argument: true }) : texSafe(escapeTexinfo(value));
        // A long option, or a single-letter short one; `-rith` or `-print` is an affix.
        if (/^(?:--[A-Za-z][A-Za-z0-9-]*|-[A-Za-z])(?:=\S*)?$/.test(value)) {
            collected?.variables.add(value.replace(/=.*$/, ""));
            return `@option{${escaped}}`;
        }
        const placeholder = /^<([A-Za-z][A-Za-z0-9_-]*)>$/.exec(value);
        if (placeholder)
            return `@var{${escapeTexinfo(placeholder[1], { argument: ctx.argument })}}`;
        // An environment variable is a `$NAME` span, or a capitalised name the
        // text calls an environment variable (the words "environment variable"
        // directly before or after it) or lists in the first column of a table
        // that has "environment" in a header. Other capitalised names are code.
        const variable =
            /^\$([A-Z][A-Z0-9_]*)$/.exec(value) ??
            ((
                ctx.environment ||
                /environment variables?\s*$/i.test(ctx.before ?? "") ||
                /^\s*(?:and\s+\S+\s+)?environment variables?/i.test(ctx.after ?? "")
            ) ?
                /^([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)$/.exec(value)
            :   null);
        if (variable) {
            collected?.variables.add(variable[1]);
            return `@env{${escapeTexinfo(variable[1])}}`;
        }
        const command = /^(\S+)(?:\s.*)?$/.exec(value)?.[1];
        if (command !== undefined && COMMANDS.has(command)) {
            collected?.programs.add(command);
            // A program name is `@command`; a command line with arguments is `@samp`.
            return value === command ? `@command{${escaped}}` : `@samp{${escaped}}`;
        }
        if (isPath(value)) return `@file{${escaped}}`;
        return `@code{${escaped}}`;
    };

    /** Plain text, with each option written in it kept literal. */
    const textOf = (value, ctx) => {
        if (ctx.argument) return escapeTexinfo(value, { argument: true });
        return value
            .split(/((?<![\w-])--[A-Za-z][\w-]*|(?<![\w-])-[A-Za-z](?![\w-]))/)
            .map((piece, index) => {
                if (index % 2 === 0) return texSafe(escapeTexinfo(piece));
                collected?.variables.add(piece);
                return `@option{${escapeTexinfo(piece)}}`;
            })
            .join("");
    };

    const inlineNode = (node, ctx) => {
        const { doc, argument } = ctx;
        switch (node.type) {
            case "text":
                return textOf(node.value, ctx);
            case "inlineCode":
                return inlineCode(node.value, ctx);
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
            case "html": {
                if (/^(?:\s*<!--[\s\S]*?-->)+\s*$/.test(node.value)) return "";
                if (/[@{}]/.test(node.value)) {
                    report(
                        doc,
                        node,
                        `raw HTML ${JSON.stringify(node.value)} is dropped`,
                        "dropped",
                    );
                    return "";
                }
                return `@inlineraw{html,${node.value}}`;
            }
            case "delete":
                report(
                    doc,
                    node,
                    "strikethrough has no Texinfo mapping and is written as plain text",
                    "dropped",
                );
                return inline(node.children, ctx);
            case "image":
            case "imageReference":
                return image(node, ctx);
            case "footnoteReference": {
                const definition = doc.footnotes.get(node.identifier.toLowerCase());
                if (!definition) {
                    report(
                        doc,
                        node,
                        `footnote [^${node.identifier}] has no definition`,
                        "dropped",
                    );
                    return "";
                }
                const text = definition.children
                    .filter((child) => child.type === "paragraph")
                    .map((child) => inline(child.children, { doc }).trim())
                    .join(" ")
                    .replace(/\s*\n\s*/g, " ");
                return `@footnote{${text}}`;
            }
            default:
                report(doc, node, `Markdown ${node.type} has no Texinfo mapping`, "dropped");
                return "";
        }
    };

    const image = (node, ctx) => {
        const { doc } = ctx;
        const alt = node.alt ?? "";
        const url = urlOf(doc, node);
        const fallback = escapeTexinfo(alt);
        if (url === undefined || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) {
            report(
                doc,
                node,
                `image ${url ?? node.identifier} is not a local file and is written as its alt text`,
                "dropped",
            );
            return fallback;
        }
        let decoded;
        try {
            decoded = decodeURI(url);
        } catch {
            decoded = url;
        }
        const file = path.posix.normalize(
            path.posix.join(docsDir, path.posix.dirname(doc.relative), decoded),
        );
        const extension = path.posix.extname(file).toLowerCase();
        if (!exists(file)) {
            report(
                doc,
                node,
                `image ${url} resolves to ${file}, which does not exist; it is written as its alt text`,
                "dropped",
            );
            return fallback;
        }
        if (!IMAGE_TYPES.has(extension)) {
            report(
                doc,
                node,
                `image ${url} is not a PNG, JPEG or PDF; it is written as its alt text`,
                "dropped",
            );
            return fallback;
        }
        const target = imageName(file);
        assets.set(target, file);
        const stem = target.slice(0, -extension.length);
        return `@image{${stem},,,${escapeTexinfo(alt, { argument: true })},${extension}}`;
    };

    const link = (node, ctx, parts, before, after) => {
        const { doc } = ctx;
        const url = urlOf(doc, node);
        const children = node.children ?? [];
        if (url === undefined) {
            report(
                doc,
                node,
                `reference link [${plainText(children)}] has no definition`,
                "unresolved",
            );
            return inline(children, ctx);
        }
        const text = inline(children, { ...ctx, argument: true }).replace(/\s*\n\s*/g, " ");
        const plain = plainText(children);
        const plainChildren = () => inline(children, ctx);
        const ref = (name) => {
            const argument = escapeTexinfo(name, { argument: true });
            const label = plain === name || !text ? "" : `,,${text}`;
            if (plain.includes(":") && label) return `${plainChildren()} (@pxref{${argument}})`;
            const last = parts.length - 1;
            const open = /\(\s*(?:see\s+)?$/i.test(before) && after.startsWith(")");
            if (open && last >= 0) {
                parts[last] = parts[last].replace(/(?:see\s+)?$/i, "");
                return `@pxref{${argument}${label}}`;
            }
            const see = /(?:^|[.!?]\s+)See\s+$/.test(before) && /^[.,]/.test(after);
            if (see && last >= 0) {
                parts[last] = parts[last].replace(/See\s+$/, "");
                return `@xref{${argument}${label}}`;
            }
            return `@ref{${argument}${label}}`;
        };
        const unresolved = (message) => {
            report(doc, node, message, "unresolved");
            return plainChildren();
        };
        if (ctx.heading) return plainChildren();
        const mail = /^mailto:([^?]+)/i.exec(url);
        if (mail) {
            const address = escapeTexinfo(decodeURIComponent(mail[1]), { argument: true });
            return plain === decodeURIComponent(mail[1]) || !text ?
                    `@email{${address}}`
                :   `@email{${address}, ${text}}`;
        }
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) {
            const target = escapeTexinfo(url, { argument: true });
            return plain === url || !text ? `@uref{${target}}` : `@uref{${target}, ${text}}`;
        }
        if (url.startsWith("/")) return `${plainChildren()} (@code{${escapeTexinfo(url)}})`;
        const target = targetOf(doc, url);
        if (target.kind === "invalid") return unresolved(target.reason);
        if (target.kind === "file") {
            if (!shippedFile(target.file))
                return unresolved(
                    `link ${url} points at ${target.file}, which the package does not ship`,
                );
            return `${plainChildren()} (@file{${escapeTexinfo(target.file)}})`;
        }
        if (!includedSet.has(target.relative)) {
            const message = `link ${url} points at ${path.posix.join(docsDir, target.relative)}, which is not part of the manual`;
            // A page has a public URL only when its own front matter declares one.
            const declared = loadDoc(target.relative)?.front.url;
            if (typeof declared !== "string" || !/^https?:\/\/\S+$/.test(declared))
                return unresolved(message);
            report(doc, node, message, "unresolved");
            const address = escapeTexinfo(
                `${declared.replace(/#.*$/, "")}${target.anchor ? `#${target.anchor}` : ""}`,
                { argument: true },
            );
            return `@url{${address}${text ? `, ${text}` : ""}}`;
        }
        if (target.relative === page) return plainChildren();
        const name = symbolFor(target.relative, target.anchor);
        if (name === undefined)
            return unresolved(
                `link ${url} points at an anchor no heading in ${path.posix.join(docsDir, target.relative)} declares`,
            );
        return ref(name);
    };

    /** One line: inline content with its line breaks folded. */
    const line = (children, ctx) =>
        inline(children, ctx)
            .replace(/@\*\n/g, " ")
            .replace(/\s*\n\s*/g, " ")
            .trim();

    /** Inline nodes of a Markdown snippet. */
    const inlineOf = (source) =>
        processor
            .parse(source)
            .children.flatMap((node) => (node.type === "paragraph" ? node.children : []));

    const definitionList = (node, doc) => {
        const { start, end } = node.position;
        const lines = doc.source.slice(start.offset, end.offset).split("\n");
        const items = [];
        let current;
        let lastWasDefinition = false;
        for (const text of lines) {
            if (/^ {0,3}:[ \t]/.test(text)) {
                if (!current) return undefined;
                current.definitions.push(text.replace(/^ {0,3}:[ \t]+/, ""));
                lastWasDefinition = true;
            } else if (lastWasDefinition && /^\s+\S/.test(text)) {
                current.definitions[current.definitions.length - 1] += ` ${text.trim()}`;
            } else {
                if (lastWasDefinition || !current) {
                    current = { terms: [], definitions: [] };
                    items.push(current);
                }
                current.terms.push(text.trim());
                lastWasDefinition = false;
            }
        }
        if (!items.length || items.some((item) => !item.definitions.length)) return undefined;
        const coded = items.every((item) =>
            item.terms.every((term) => {
                const nodes = inlineOf(term);
                return nodes.length === 1 && nodes[0].type === "inlineCode";
            }),
        );
        const body = items.map((item) => {
            const terms = item.terms.map((term, index) => {
                const text = line(inlineOf(term), { doc });
                return `${index ? "@itemx" : "@item"} ${text}`;
            });
            const defs = item.definitions.map((definition) => line(inlineOf(definition), { doc }));
            return [...terms, defs.join("\n\n")].join("\n");
        });
        return `@table ${coded ? "@code" : "@asis"}\n${body.join("\n\n")}\n@end table`;
    };

    /**
     * A GFM table is a `@multitable` when every column can be as wide as its
     * longest word, and otherwise a `@table` keyed on its first column with the
     * other columns following as paragraphs; a table of headers alone that
     * cannot fit is a list of those headers.
     */
    const table = (node, doc, indent) => {
        const [header, ...rows] = node.children;
        const environment = header.children.some((cell) =>
            /environment/i.test(plainText(cell.children)),
        );
        const cellText = (cell, column = 1) =>
            line(cell.children, { doc, environment: environment && column === 0 });
        const headers = header.children.map((cell, column) => cellText(cell, column));
        const cells = (row) =>
            header.children.map((_, column) =>
                row.children[column] ? cellText(row.children[column], column) : "",
            );
        const texts = rows.map(cells);
        const all = [headers, ...texts];
        const fractions = columnFractions(
            all.map((row) => row.map(infoText)),
            indent,
        );
        if (fractions) {
            return [
                `@multitable @columnfractions ${fractions.join(" ")}`,
                `@headitem ${all[0].join(" @tab ")}`,
                ...all.slice(1).map((row) => `@item ${row.join(" @tab ")}`),
                "@end multitable",
            ]
                .map((text) => text.replace(/ +$/, ""))
                .join("\n");
        }
        report(
            doc,
            node,
            "the table is too wide for its columns and is restructured as a list keyed on its first column",
            "restructured",
        );
        if (!rows.length)
            return [
                "@itemize @bullet",
                ...headers.map((text) => `@item ${text}`),
                "@end itemize",
            ].join("\n");
        const out = ["@table @asis"];
        for (const row of texts) {
            out.push(`@item ${row[0] || "@w{}"}`);
            const body = row
                .slice(1)
                .map((text, i) => {
                    if (!text) return "";
                    const label = headers[i + 1];
                    return headers.length > 2 && label ? `@emph{${label}}: ${text}` : text;
                })
                .filter(Boolean);
            if (body.length) out.push(body.join("\n\n"));
        }
        out.push("@end table");
        return out.join("\n");
    };

    /**
     * @param {any} node
     * @param {any} doc
     * @param {number} [indent]
     * @returns {string}
     */
    const block = (node, doc, indent = 0) => {
        const blocks = (children) =>
            children
                .map((child) => block(child, doc, indent + INDENT))
                .filter((text) => text !== "")
                .join("\n\n");
        switch (node.type) {
            case "paragraph": {
                const { start, end } = node.position;
                const source = doc.source.slice(start.offset, end.offset);
                if (/^ {0,3}:::/m.test(source)) {
                    report(
                        doc,
                        node,
                        "a fenced div (`:::`) has no Texinfo mapping and is dropped",
                        "dropped",
                    );
                    return "";
                }
                if (/^ {0,3}:[ \t]/m.test(source)) {
                    const result = definitionList(node, doc);
                    if (result) return result;
                    report(
                        doc,
                        node,
                        "a definition list needs a term line before each definition; it is dropped",
                        "dropped",
                    );
                    return "";
                }
                if (/^ {0,3}\|.*\|[ \t]*$/m.test(source)) {
                    report(
                        doc,
                        node,
                        "a pipe table needs a header row followed by a delimiter row; it is dropped",
                        "dropped",
                    );
                    return "";
                }
                return inline(node.children, { doc }).trim();
            }
            case "code": {
                const lang = (node.lang ?? "").toLowerCase();
                const verbatim = lang === "verbatim" || /\bverbatim\b/i.test(node.meta ?? "");
                if (verbatim) {
                    if (/^@end verbatim\b/m.test(node.value)) {
                        report(
                            doc,
                            node,
                            "a verbatim block containing `@end verbatim` is dropped",
                            "dropped",
                        );
                        return "";
                    }
                    return `@verbatim\n${node.value}\n@end verbatim`;
                }
                const command =
                    /^(?:lisp|elisp|emacs-lisp|scheme|clojure)$/.test(lang) ? "lisp" : "example";
                return `@${command}\n${texSafe(escapeTexinfo(node.value))}\n@end ${command}`;
            }
            case "list": {
                if (node.children.some((item) => typeof item.checked === "boolean")) {
                    report(
                        doc,
                        node,
                        "a task list has no Texinfo mapping and is written as a list",
                        "dropped",
                    );
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
                    first?.type === "paragraph" ?
                        /^\[!(note|tip|important|warning|caution)\]\s*/i.exec(
                            plainText(first.children),
                        )
                    :   null;
                if (alert) {
                    const label = alert[1][0].toUpperCase() + alert[1].slice(1).toLowerCase();
                    const [firstText, ...rest] = first.children;
                    const stripped =
                        firstText?.type === "text" ?
                            [
                                {
                                    ...firstText,
                                    value: firstText.value.replace(/^\[![A-Za-z]+\]\s*/, ""),
                                },
                                ...rest,
                            ]
                        :   first.children;
                    const body = [{ ...first, children: stripped }, ...node.children.slice(1)]
                        .map((child) => block(child, doc, indent + INDENT))
                        .filter((text) => text !== "")
                        .join("\n\n");
                    return `@quotation ${label}\n${body}\n@end quotation`;
                }
                return `@quotation\n${blocks(node.children)}\n@end quotation`;
            }
            case "table":
                return table(node, doc, indent);
            case "thematicBreak":
            case "yaml":
            case "definition":
            case "footnoteDefinition":
                return "";
            case "html":
                if (/^(?:\s*<!--[\s\S]*?-->)+\s*$/.test(node.value)) return "";
                if (/^@end html\b/m.test(node.value)) {
                    report(doc, node, "raw HTML containing `@end html` is dropped", "dropped");
                    return "";
                }
                return `@html\n${node.value}\n@end html`;
            case "heading":
                report(
                    doc,
                    node,
                    "a heading inside a list or quotation has no Texinfo mapping and is dropped",
                    "dropped",
                );
                return "";
            default:
                report(
                    doc,
                    node,
                    `Markdown ${node.type} has no Texinfo mapping and is dropped`,
                    "dropped",
                );
                return "";
        }
    };

    /** Index commands for a page: its name, its tags, its subType index. */
    const indexLines = (entry, terms) => {
        const lines = [`@cindex ${escapeTexinfo(entry.title)}`];
        const tags = entry.doc.front.tags;
        if (Array.isArray(tags))
            for (const tag of tags)
                if (typeof tag === "string" && tag.trim())
                    lines.push(`@cindex ${escapeTexinfo(oneLine(tag))}`);
        const index = subtypeIndex(entry.doc);
        if (index) lines.push(`@${index.code}index ${escapeTexinfo(entry.title)}`);
        for (const term of terms.variables) {
            lines.push(`${VARIABLE_INDEX.command} ${escapeTexinfo(term)}`);
            used.add(VARIABLE_INDEX);
        }
        for (const term of terms.programs) {
            lines.push(`${PROGRAM_INDEX.command} ${escapeTexinfo(term)}`);
            used.add(PROGRAM_INDEX);
        }
        return lines;
    };

    /** The usage indexes some page fills. */
    const used = new Set();

    /**
     * The page's body blocks, with its inner headings as unnumbered headings,
     * and the index terms the body names. With `summaryOnly`, the body stops at
     * its first heading.
     */
    const bodyOf = (entry, { summaryOnly = false } = {}) => {
        const { doc } = entry;
        const out = [];
        const terms = { variables: new Set(), programs: new Set() };
        const outer = collected;
        collected = terms;
        for (const node of doc.tree.children) {
            if (node === doc.titleHeading) continue;
            if (summaryOnly && node.type === "heading") break;
            if (node.type !== "heading") {
                const text = block(node, doc);
                if (text) out.push(text);
                continue;
            }
            const raw = HEADING_LINE.exec(doc.lines[node.position.start.line - 1] ?? "")?.[2] ?? "";
            const slug = doc.anchors.get(node.position.start.line);
            if (slug === undefined)
                report(
                    doc,
                    node,
                    "a heading that is not one line of `#` marks has no anchor",
                    "dropped",
                );
            const title = line(headingContent(node, raw), { doc, heading: true });
            const depth = Math.max(1, node.depth - doc.base);
            const level = Math.min(entry.depth + depth, 4);
            const command =
                entry.folded || level >= 4 ? "@subsubheading"
                : level === 3 ? "@subheading"
                : "@heading";
            const anchor =
                (
                    slug !== undefined &&
                    symbols.has(`${entry.relative}#${slug}`) &&
                    node !== doc.titleHeading
                ) ?
                    `@anchor{${escapeTexinfo(symbols.get(`${entry.relative}#${slug}`))}}\n`
                :   "";
            out.push(`${anchor}${command} ${title}`);
        }
        collected = outer;
        return Object.assign(out, { terms });
    };

    const menuEntry = (name, description) => {
        const text = `* ${escapeTexinfo(name)}::`;
        const detail = oneLine(description);
        return detail ? `${text.padEnd(32)} ${escapeTexinfo(detail)}` : text;
    };

    /** The chapter files, in order. */
    const chapters = [];
    const chapterSlugs = new Set();
    const nodeText = (entry) => {
        const body = bodyOf(entry);
        const lines = [
            `@node ${escapeTexinfo(entry.name)}`,
            `${SECTIONING[entry.depth]} ${escapeTexinfo(entry.title)}`,
            ...indexLines(entry, body.terms),
        ];
        const parts = [lines.join("\n"), ...body];
        const folded = [];
        const gather = (parent) => {
            for (const child of parent.children) {
                if (!child.folded) continue;
                folded.push(child);
                gather(child);
            }
        };
        gather(entry);
        for (const child of folded) {
            const childBody = bodyOf(child);
            parts.push(
                [
                    `@anchor{${escapeTexinfo(child.name)}}`,
                    `@subsubheading ${escapeTexinfo(child.title)}`,
                    ...indexLines(child, childBody.terms),
                ].join("\n"),
                ...childBody,
            );
        }
        const kids = entry.children.filter((child) => !child.folded);
        if (kids.length)
            parts.push(
                [
                    "@menu",
                    ...kids.map((child) => menuEntry(child.name, child.doc.front.description)),
                    "@end menu",
                ].join("\n"),
            );
        const subtree = kids.map(nodeText);
        return [...parts, ...subtree].join("\n\n");
    };
    for (const entry of top.children) {
        let slug = slugOf(entry.name);
        if (chapterSlugs.has(slug)) slug = slugOf(entry.relative.replace(/\.md$/, ""));
        if (chapterSlugs.has(slug))
            problem(
                path.posix.join(docsDir, entry.relative),
                undefined,
                "error",
                "name",
                `the chapter file name ${slug} cannot be made unique`,
            );
        chapterSlugs.add(slug);
        chapters.push({
            path: `${outName}-chapters/${slug}.texi`,
            texinfo: `${nodeText(entry)}\n`,
        });
    }

    // ---- Master file ---------------------------------------------------------

    const title = top.title;
    const description = oneLine(top.doc.front.description);
    const bare = String(pkg.name).replace(/^@[^/]+\//, "");
    const updated = dateText(epoch);
    const year = new Date(epoch * 1000).getUTCFullYear();
    const holders = authors.join(", ");
    const dircategory = pkg.texinfo?.dircategory;
    if (typeof dircategory !== "string" || !dircategory.trim())
        problem(
            "package.json",
            undefined,
            "warning",
            "dircategory",
            "package.json has no texinfo.dircategory; the manual has no dircategory and no direntry",
        );
    if (!authors.length)
        problem(
            "package.json",
            undefined,
            "warning",
            "author",
            "package.json has no author or contributors; the manual names no author",
        );
    const licenseLines = licenseStatement(pkg);
    const directoryDescription = description || oneLine(pkg.description);
    const links = [
        ["Homepage", pkg.homepage],
        ["Repository", publicUrl(pkg.repository)],
        ["Bug reports", publicUrl(pkg.bugs)],
    ].filter(([, value]) => typeof value === "string" && value);
    const topBody = bodyOf(top, { summaryOnly: true });

    const topNode = [
        "@ifnottex",
        "@node Top",
        `@top ${escapeTexinfo(title)}`,
        "",
        description ?
            escapeTexinfo(description)
        :   `This manual documents @code{${escapeTexinfo(bare)}}, version @value{VERSION}.`,
        ...(links.length ?
            [
                "",
                links
                    .map(
                        ([label, value]) =>
                            `${label}: @url{${escapeTexinfo(value, { argument: true })}}`,
                    )
                    .join("@*\n"),
            ]
        :   []),
        ...(topBody.length ? ["", topBody.join("\n\n")] : []),
        "@end ifnottex",
    ].join("\n");

    const trailing = [
        CONCEPT_INDEX,
        ...[VARIABLE_INDEX, PROGRAM_INDEX].filter((index) => used.has(index)),
        ...[...indexNodes].sort((a, b) => compare(a.node, b.node)),
    ];
    const detail = [];
    for (const chapter of top.children) {
        const below = [];
        const walk = (entry) => {
            for (const child of entry.children) {
                if (child.folded) continue;
                below.push(child);
                walk(child);
            }
        };
        walk(chapter);
        if (!below.length) continue;
        detail.push("", escapeTexinfo(chapter.title), "");
        for (const child of below) detail.push(menuEntry(child.name));
    }
    const masterMenu = [
        "@menu",
        ...top.children.map((child) => menuEntry(child.name, child.doc.front.description)),
        ...trailing.map((index) => menuEntry(index.node, index.description)),
        ...(detail.length ?
            ["", "@detailmenu", " --- The Detailed Node Listing ---", ...detail, "@end detailmenu"]
        :   []),
        "@end menu",
    ].join("\n");

    const texinfo = [
        [
            "\\input texinfo   @c -*-texinfo-*-",
            "@c %**start of header",
            `@setfilename ${escapeTexinfo(outName)}.info`,
            ...[...indexNodes].map((index) => `@defindex ${index.code}`),
            `@set VERSION ${escapeTexinfo(String(pkg.version))}`,
            `@set UPDATED ${updated}`,
            `@settitle ${escapeTexinfo(title)}`,
            "@documentencoding UTF-8",
            "@documentlanguage en",
            "@c %**end of header",
        ].join("\n"),
        [
            "@copying",
            `This manual is for @code{${escapeTexinfo(bare)}} (version @value{VERSION}, @value{UPDATED}).`,
            "",
            `Copyright @copyright{} ${year}${holders ? ` ${escapeTexinfo(holders)}` : ""}.`,
            ...(licenseLines.length ? ["", "@quotation", ...licenseLines, "@end quotation"] : []),
            "@end copying",
        ].join("\n"),
        ...(typeof dircategory === "string" && dircategory.trim() ?
            [
                [
                    `@dircategory ${escapeTexinfo(oneLine(dircategory))}`,
                    "@direntry",
                    direntry(title, outName, directoryDescription),
                    "@end direntry",
                ].join("\n"),
            ]
        :   []),
        [
            "@titlepage",
            `@title ${escapeTexinfo(title)}`,
            "@subtitle For version @value{VERSION}, @value{UPDATED}",
            ...authors.map((name) => `@author ${escapeTexinfo(name)}`),
            "@page",
            "@vskip 0pt plus 1filll",
            "@insertcopying",
            "@end titlepage",
        ].join("\n"),
        "@contents",
        topNode,
        masterMenu,
        ...chapters.map((chapter) => `@include ${chapter.path}`),
        ...trailing.map((index) =>
            [`@node ${index.node}`, `@unnumbered ${index.node}`, `@printindex ${index.code}`].join(
                "\n",
            ),
        ),
        "@bye",
    ].join("\n\n");

    return {
        texinfo: `${texinfo}\n`,
        title,
        description: directoryDescription,
        hasDirentry: typeof dircategory === "string" && Boolean(dircategory.trim()),
        dircategory: typeof dircategory === "string" ? oneLine(dircategory) : "",
        chapters,
        assets: [...assets].map(([to, from]) => ({ from, to })).sort((a, b) => compare(a.to, b.to)),
        findings,
    };
}

/**
 * The files under a root-relative directory, recursively.
 * @param {string} root
 * @param {string} dir
 * @returns {string[]}
 */
function listFiles(root, dir) {
    return fs
        .readdirSync(path.join(root, dir), { withFileTypes: true })
        .flatMap((entry) =>
            entry.isDirectory() ?
                listFiles(root, path.posix.join(dir, entry.name))
            :   [path.posix.join(dir, entry.name)],
        );
}

/**
 * Convert the documentation to Texinfo manuals, one per declared top page.
 *
 * @param {object} options
 * @param {ReadonlyArray<{page: string, out?: string|null, title?: string|null}>} options.manuals
 *   Each manual's top page relative to `docsDir`, output name without
 *   extension (the page's stem, or the package name for `index`, by default)
 *   and title (the top page's by default).
 * @param {string} [options.root] - The repository root.
 * @param {string} [options.docsDir] - The documentation, relative to the root.
 * @param {(file: string) => string} [options.read] - Reads a root-relative file.
 * @param {(file: string) => boolean} [options.exists]
 * @param {(dir: string) => string[]} [options.list] - The root-relative files
 *   under a root-relative directory.
 * @param {string} [options.contentPackage] - The package the pages belong to,
 *   which completes a written Address; the package name without punctuation by
 *   default.
 * @param {number} [options.epoch] - The date of the manual in seconds since
 *   the epoch; `SOURCE_DATE_EPOCH` or the last commit's time by default.
 * @param {string[]} [options.authors] - Author names used when `package.json`
 *   names none.
 * @param {{file: string, text: string}} [options.config] - The configuration
 *   file findings about a declaration are positioned in.
 * @returns {{manuals: Array<{out: string, title: string, texinfo: string,
 *   chapters: Array<{path: string, texinfo: string}>,
 *   assets: Array<{from: string, to: string}>}>, dir: string, findings: Finding[]}}
 */
export function convertDocs({
    manuals,
    root = process.cwd(),
    docsDir = "docs",
    read = (file) => fs.readFileSync(path.join(root, file), "utf8"),
    exists = (file) => fs.existsSync(path.join(root, file)),
    list = (dir) => listFiles(root, dir),
    epoch,
    contentPackage: configuredPackage,
    authors: configuredAuthors = [],
    config,
}) {
    /** @type {Finding[]} */
    const findings = [];
    const seen = new Set();
    const note = (finding) => {
        const key = formatFinding(finding);
        if (seen.has(key)) return;
        seen.add(key);
        findings.push(finding);
    };
    const packageError = (message) =>
        note({ file: "package.json", severity: "error", kind: "package", message });

    let pkg;
    try {
        pkg = JSON.parse(read("package.json"));
    } catch (error) {
        packageError(`package.json cannot be read: ${error.message}`);
        return { manuals: [], dir: "", findings };
    }
    for (const key of ["name", "version"])
        if (typeof pkg[key] !== "string" || !pkg[key])
            packageError(`package.json has no \`${key}\``);
    if (findings.length) return { manuals: [], dir: "", findings };
    const bare = pkg.name.replace(/^@[^/]+\//, "");
    const contentPackage =
        configuredPackage ?? (bare.toLowerCase().replace(/[^a-z0-9]/g, "") || "docs");
    const authors = personNames([pkg.author, ...(pkg.contributors ?? [])].filter(Boolean));
    const resolvedEpoch = epoch ?? sourceEpoch(root);
    if (resolvedEpoch === undefined) {
        packageError(
            "the manual date is unknown: set SOURCE_DATE_EPOCH or build inside a git checkout with a commit",
        );
        return { manuals: [], dir: "", findings };
    }

    const written = new Map();
    const results = [];
    const declared = (index, manual, message) => ({
        ...(config ?
            {
                file: config.file,
                ...positionOfYamlPath(config.text, ["packageBuild", "texinfo", index, "page"]),
            }
        :   { file: path.posix.join(docsDir, manual.page) }),
        severity: "error",
        kind: "configuration",
        message,
    });
    for (const [index, manual] of manuals.entries()) {
        const stem = path.posix.basename(manual.page, ".md");
        const out = manual.out ?? (stem === "index" && bare ? bare : stem);
        if (written.has(out)) {
            note(
                declared(
                    index,
                    manual,
                    `the manual output name ${out} is used by ${written.get(out)} as well; give one an \`out\``,
                ),
            );
            continue;
        }
        if (!exists(path.posix.join(docsDir, manual.page))) {
            note(
                declared(
                    index,
                    manual,
                    `the top page ${path.posix.join(docsDir, manual.page)} does not exist`,
                ),
            );
            continue;
        }
        written.set(out, path.posix.join(docsDir, manual.page));
        const result = convertManual({
            docsDir,
            page: manual.page,
            out,
            title: manual.title ?? undefined,
            pkg,
            authors: authors.length ? authors : configuredAuthors,
            epoch: resolvedEpoch,
            contentPackage,
            read,
            exists,
            list,
            shipped: pkg.files ?? [],
        });
        for (const finding of result.findings) note(finding);
        if (result.texinfo) results.push({ out, ...result });
    }

    const categories = new Map();
    for (const manual of results) {
        if (!manual.hasDirentry) continue;
        const entries = categories.get(manual.dircategory) ?? [];
        entries.push(direntry(manual.title, manual.out, manual.description));
        categories.set(manual.dircategory, entries);
    }
    const dir = [
        "-*- Text -*-",
        "This is the Info directory of the generated manuals.",
        "",
        "\x1f",
        "File: dir,\tNode: Top\tThis is the top of the INFO tree",
        "",
        "* Menu:",
        "",
        ...[...categories]
            .sort(([a], [b]) => compare(a, b))
            .flatMap(([category, lines]) => [
                category,
                ...lines.map((l) => l.replace(/@([@{}])/g, "$1")),
                "",
            ]),
    ].join("\n");

    return {
        manuals: results.map(({ out, title, texinfo, chapters, assets, findings: own }) => ({
            out,
            title,
            texinfo,
            chapters,
            assets,
            findings: own,
        })),
        dir,
        findings,
    };
}
