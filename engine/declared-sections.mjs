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
/** Place declared content in its authored section, or create that section. */
import { scanHeadingAttributes } from "./heading-attributes.mjs";
import { scanBlocks } from "./content-blocks.mjs";

/** Authored headings, excluding literal examples and named containers. */
export function declaredHeadings(markdown, syntax) {
    const blocks = (syntax ? syntax(markdown).blocks : scanBlocks(markdown)).blocks;
    return scanHeadingAttributes(markdown).headings.filter(
        (heading) =>
            !blocks.some(
                (block) => heading.line - 1 >= block.start && heading.line - 1 <= block.end,
            ),
    );
}

/**
 * Insert indexed content at its heading while preserving subsequent source lines.
 * @param {string} markdown - Expanded body.
 * @param {Array<{slug:string,heading:string,markdown:string}>} [sections] - Declared content.
 * @param {{authored?:string,lineMap?:object[],generatedFrom?:number,syntax?:Function}} [context] - Captured source mappings.
 * @returns {{markdown:string,lineMap:object[],generatedFrom?:number}} Expanded body and locations.
 */
export function insertDeclaredSections(
    markdown,
    sections = [],
    { authored = markdown, lineMap, generatedFrom, syntax } = {},
) {
    const lines = String(markdown ?? "").split("\n");
    const locations = lineMap ? [...lineMap] : lines.map((_, line) => ({ line, generated: false }));
    if (!sections.length)
        return {
            markdown: lines.join("\n"),
            lineMap: locations,
            ...(generatedFrom === undefined ? {} : { generatedFrom }),
        };
    const headings = declaredHeadings(authored, syntax)
        .map((heading) => ({
            ...heading,
            sourceLine: heading.line - 1,
            line: locations.findIndex(
                (location, at) =>
                    location.line === heading.line - 1 &&
                    !location.generated &&
                    (generatedFrom === undefined || at < generatedFrom),
            ),
        }))
        .filter((h) => h.line >= 0);
    const edits = [];
    for (const section of sections) {
        const own = headings.find((h) => h.id === section.slug || h.text === section.heading);
        const next = own && headings.find((h) => h.line > own.line && h.level <= own.level);
        const at = next?.line ?? generatedFrom ?? lines.length;
        if (own && !own.id) {
            const line = lines[own.line].replace(/\s*#*\s*$/, "");
            lines[own.line] =
                /\{[^{}]*\}$/.test(line) ?
                    line.replace(/\}$/, ` #${section.slug}}`)
                :   line + ` {#${section.slug}}`;
        }
        edits.push({
            at,
            source: own?.sourceLine ?? Math.max(0, String(authored).split("\n").length - 1),
            lines: [
                "",
                ...(own ?
                    section.markdown
                :   `# ${section.heading} {#${section.slug}}\n\n${section.markdown}`
                ).split("\n"),
                "",
            ],
        });
    }
    for (const edit of edits.sort((a, b) => b.at - a.at)) {
        lines.splice(edit.at, 0, ...edit.lines);
        locations.splice(
            edit.at,
            0,
            ...edit.lines.map(() => ({ line: edit.source, generated: true })),
        );
        if (generatedFrom !== undefined && edit.at <= generatedFrom)
            generatedFrom += edit.lines.length;
    }
    return {
        markdown: lines.join("\n"),
        lineMap: locations,
        ...(generatedFrom === undefined ? {} : { generatedFrom }),
    };
}
