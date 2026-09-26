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

import YAML from "yaml";
import { NOTE_TOP_LEVEL_KEYS } from "./note-frontmatter.mjs";

const MAX_FLOW_LINE = 99;

/**
 * Format one addressed note's YAML without changing its Markdown body.
 * Invalid YAML remains the YAML linter's finding.
 *
 * @param {string} markdown - The complete Markdown source.
 * @returns {string} The source with canonical frontmatter.
 */
export function formatNoteFrontmatter(markdown) {
    const match = markdown.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)([\s\S]*)$/);
    if (!match) return markdown;
    const [, opening, source, closing, body] = match;
    const document = YAML.parseDocument(source, { keepSourceTokens: true });
    if (document.errors.length || !YAML.isMap(document.contents)) return markdown;
    const root = document.contents;
    const values = Object.fromEntries(
        root.items.map((pair) => [String(pair.key?.value), pair.value]),
    );
    if (!nonempty(values.shortcode) || !nonempty(values.type)) return markdown;

    const order = new Map(NOTE_TOP_LEVEL_KEYS.map((key, index) => [key, index]));
    const rank = (key) => order.get(key) ?? NOTE_TOP_LEVEL_KEYS.length;
    root.items.sort((left, right) => {
        const a = String(left.key?.value);
        const b = String(right.key?.value);
        const difference = rank(a) - rank(b);
        return difference;
    });
    for (const pair of root.items) {
        const key = String(pair.key?.value);
        formatCollection(pair.value, key.length + 2, 0);
    }
    const formatted = document.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd();
    return `${opening}${formatted}${closing}${body}`;
}

function nonempty(node) {
    return YAML.isScalar(node) && typeof node.value === "string" && node.value.trim() !== "";
}

/** Format nested collections before testing the enclosing line. */
function formatCollection(node, prefix, depth) {
    if (!YAML.isMap(node) && !YAML.isSeq(node)) return;
    if (YAML.isMap(node)) {
        for (const pair of node.items) {
            formatCollection(
                pair.value,
                2 * (depth + 1) + String(pair.key?.value).length + 2,
                depth + 1,
            );
        }
    } else {
        for (const item of node.items) formatCollection(item, 2 * (depth + 1) + 2, depth + 1);
    }
    if (hasBlockScalar(node) || hasAlias(node)) {
        node.flow = false;
        return;
    }
    node.flow = true;
    const candidate = new YAML.Document(node)
        .toString({
            lineWidth: 0,
            flowCollectionPadding: false,
        })
        .trimEnd();
    if (candidate.includes("\n") || Array.from(candidate).length + prefix > MAX_FLOW_LINE) {
        node.flow = false;
    }
}

function hasBlockScalar(node) {
    if (YAML.isScalar(node)) return node.type === "BLOCK_LITERAL" || node.type === "BLOCK_FOLDED";
    if (YAML.isMap(node)) return node.items.some((pair) => hasBlockScalar(pair.value));
    if (YAML.isSeq(node)) return node.items.some(hasBlockScalar);
    return false;
}

function hasAlias(node) {
    if (YAML.isAlias(node)) return true;
    if (YAML.isMap(node)) return node.items.some((pair) => hasAlias(pair.value));
    if (YAML.isSeq(node)) return node.items.some(hasAlias);
    return false;
}
