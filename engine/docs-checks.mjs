/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import path from "node:path";

/** @param {string} root */
function* markdownFiles(root) {
    for (const entry of fs
        .readdirSync(root, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(root, entry.name);
        if (entry.isDirectory()) yield* markdownFiles(file);
        else if (entry.isFile() && file.endsWith(".md")) yield file;
    }
}

/** Preserve offsets while excluding literal examples from link scanning. */
export function maskMarkdownCode(source, spans = true) {
    const pattern =
        spans ?
            /```[\s\S]*?```|~~~[\s\S]*?~~~|``[^`]*``|`[^`]*`/g
        :   /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
    return source.replace(pattern, (match) => match.replace(/[^\n]/g, " "));
}

/** GitHub heading slug, retaining separate spaces after punctuation removal. */
export function docHeadingSlug(value) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s/g, "-");
}

/** @param {string} source */
export function docAnchors(source) {
    const body = maskMarkdownCode(source, false);
    const anchors = new Set();
    for (const [, heading] of body.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
        const explicit = heading.match(/\{#([^}]+)\}\s*$/);
        anchors.add(
            explicit ?
                explicit[1].trim()
            :   docHeadingSlug(heading.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")),
        );
    }
    for (const [, anchor] of body.matchAll(/<a\s[^>]*(?:id|name)="([^"]+)"/g)) {
        anchors.add(anchor);
    }
    return anchors;
}

/**
 * Check relative Markdown links beneath a documentation root.
 * @param {string} root
 * @returns {Array<{file: string, line: number, column: number, severity: "error", message: string}>}
 */
export function checkDocLinks(root) {
    const findings = [];
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        return [{ file: root, severity: "error", message: "documentation root does not exist" }];
    }
    const anchors = new Map();
    for (const file of markdownFiles(root)) {
        const body = maskMarkdownCode(fs.readFileSync(file, "utf8"));
        for (const match of body.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
            const link = match[1];
            if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(link) || link.startsWith("/")) continue;
            const hash = link.indexOf("#");
            const relative = hash < 0 ? link : link.slice(0, hash);
            const anchor = hash < 0 ? "" : link.slice(hash + 1);
            const offset = match.index + 2;
            const location = {
                file,
                line: body.slice(0, match.index).split("\n").length,
                column: offset - body.lastIndexOf("\n", offset),
                severity: /** @type {const} */ ("error"),
            };
            let target;
            try {
                target = relative ? path.resolve(path.dirname(file), decodeURI(relative)) : file;
            } catch {
                findings.push({ ...location, message: `link ${link} has invalid URI encoding` });
                continue;
            }
            if (!fs.existsSync(target)) {
                findings.push({
                    ...location,
                    message: `link ${link} resolves to ${path.relative(process.cwd(), target)}, which does not exist`,
                });
            } else if (anchor && target.endsWith(".md")) {
                if (!anchors.has(target))
                    anchors.set(target, docAnchors(fs.readFileSync(target, "utf8")));
                if (!anchors.get(target).has(anchor)) {
                    findings.push({
                        ...location,
                        message: `link ${link} points at an anchor nobody declares`,
                    });
                }
            }
        }
    }
    return findings;
}

/**
 * Check each direct Markdown page in each section against the root README.
 * @param {string} root
 * @returns {Array<{file: string, severity: "error", message: string}>}
 */
export function checkDocIndex(root) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        return [{ file: root, severity: "error", message: "documentation root does not exist" }];
    }
    const index = path.join(root, "README.md");
    if (!fs.existsSync(index))
        return [{ file: index, severity: "error", message: "documentation index does not exist" }];
    const readme = fs.readFileSync(index, "utf8");
    const findings = [];
    for (const section of fs
        .readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())) {
        const dir = path.join(root, section.name);
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
            const relative = `${section.name}/${entry.name}`;
            if (!readme.includes(relative)) {
                findings.push({
                    file: path.join(dir, entry.name),
                    severity: /** @type {const} */ ("error"),
                    message: `not linked from ${index}`,
                });
            }
        }
    }
    return findings;
}
