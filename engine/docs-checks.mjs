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

import fs from "node:fs";
import path from "node:path";

import { splitHeadingAttributes } from "./heading-attributes.mjs";

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
    const mask = (value) => value.replace(/[^\n]/g, " ");
    let fence;
    let body = "";
    for (const line of source.match(/[^\n]*\n|[^\n]+$/g) || []) {
        if (fence) {
            body += mask(line);
            const close = line.match(/^ {0,3}(`+|~+)[ \t]*\r?\n?$/);
            if (close && close[1][0] === fence[0] && close[1].length >= fence.length)
                fence = undefined;
        } else {
            const open = line.match(/^ {0,3}(`{3,}|~{3,})(.*)/);
            if (open && (open[1][0] !== "`" || !open[2].includes("`"))) {
                fence = open[1];
                body += mask(line);
            } else body += line;
        }
    }
    if (!spans) return body;
    const delimiters = [...body.matchAll(/`+/g)];
    let offset = 0;
    let result = "";
    for (let i = 0; i < delimiters.length; i++) {
        const start = delimiters[i];
        const end = delimiters.findIndex(
            (candidate, index) => index > i && candidate[0].length === start[0].length,
        );
        if (end < 0) continue;
        const stop = delimiters[end].index + delimiters[end][0].length;
        result += body.slice(offset, start.index) + mask(body.slice(start.index, stop));
        offset = stop;
        i = end;
    }
    return result + body.slice(offset);
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
    const suffixes = new Map();
    for (const [, heading] of body.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
        const explicit = splitHeadingAttributes(heading);
        const base =
            explicit.id || docHeadingSlug(explicit.text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"));
        let anchor = base;
        let suffix = suffixes.get(base) || 0;
        while (anchors.has(anchor)) anchor = `${base}-${++suffix}`;
        suffixes.set(base, suffix);
        anchors.add(anchor);
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
