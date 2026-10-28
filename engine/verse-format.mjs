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

/** Preserve complete authored verse regions through surrounding prose formatting. @module */

import { verseRegions } from "./verse-regions.mjs";
import { scanSpans } from "./content-spans.mjs";

/**
 * Replace verse markup with opaque placeholders and restore its original bytes.
 * @param {string} source - Complete Markdown source.
 * @returns {{markdown: string, restore: (formatted: string) => string}} Protected source and exact restoration.
 */
export function protectVerseSource(source) {
    const syntax = source.replace(/^\uFEFF?---\r?\n[^]*?\r?\n---(?:\r?\n|$)/, (frontmatter) =>
        frontmatter.replace(/[^\r\n]/g, " "),
    );
    const ranges = [
        ...verseRegions(syntax)
            .filter((region) => region.closed)
            .map((region) => ({ from: region.from, to: region.to, block: true })),
        ...scanSpans(syntax)
            .spans.filter((span) =>
                span.attrs.some(
                    ([key, value]) => key === "class" && value.split(/\s+/).includes("verse"),
                ),
            )
            .map((span) => ({ from: span.start, to: span.end, block: false })),
    ].sort((a, b) => a.from - b.from || b.to - a.to);
    const outer = ranges.filter(
        (range, index) =>
            !ranges
                .slice(0, index)
                .some((parent) => parent.from <= range.from && parent.to >= range.to),
    );
    let prefix = "VERSEPROTECTEDTOKEN";
    while (source.includes(prefix)) prefix += "X";
    const replacements = outer.map((range, index) => {
        const original = source.slice(range.from, range.to);
        const marker = range.block ? `<!--${prefix}${index}-->` : `${prefix}${index}END`;
        return { ...range, original, marker, newline: range.block && /\r?\n$/.test(original) };
    });
    let markdown = source;
    for (const entry of [...replacements].reverse())
        markdown =
            markdown.slice(0, entry.from) +
            entry.marker +
            (entry.newline ? "\n" : "") +
            markdown.slice(entry.to);
    return {
        markdown,
        restore(formatted) {
            let restored = formatted;
            for (const entry of replacements) {
                const escaped = entry.marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const pattern =
                    entry.block ?
                        new RegExp(`^[ \t]*${escaped}${entry.newline ? "\\r?\\n" : ""}`, "m")
                    :   new RegExp(escaped);
                if (!pattern.test(restored))
                    throw new Error("the formatter changed a protected verse placeholder");
                restored = restored.replace(pattern, () => entry.original);
            }
            return restored;
        },
    };
}
