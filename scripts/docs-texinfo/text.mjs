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
 * Text helpers of the Markdown-to-Texinfo converter: escaping, node names,
 * findings, the width of Info text and the column fractions of a multitable.
 */

import { splitHeadingAttributes } from "../../engine/heading-attributes.mjs";

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
 * A node name from a title's plain text.
 *
 * Info readers split a cross-reference on a comma, a colon and a period, read
 * a leading parenthesis as a manual name, and Texinfo reserves `@`, `{` and
 * `}`. A colon followed by a space becomes ` - `; every other `.`, `,`, `:`,
 * `(`, `)`, `@`, `{` and `}` becomes a space, and whitespace collapses.
 *
 * @param {string} plain
 */
export function nodeNameFor(plain) {
    const name = String(plain)
        .replace(/:\s/g, " - ")
        .replace(/[.,:()@{}]/g, " ")
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
export const INDENT = 5;

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
export function plainText(nodes) {
    return nodes
        .map((node) =>
            "value" in node && node.type !== "html" ? node.value
            : node.children ? plainText(node.children)
            : "",
        )
        .join("");
}

/** A heading's inline content without the attribute block it ends with. */
export function headingContent(node, raw) {
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

/** ASCII stand-ins the printed manual uses for box-drawing characters. */
const BOX_DRAWING = new Map([
    ...[..."─━┄┅┈┉╌╍"].map((c) => [c, "-"]),
    ...[..."│┃┆┇┊┋╎╏"].map((c) => [c, "|"]),
    ...[..."═"].map((c) => [c, "="]),
    ...[..."║"].map((c) => [c, "|"]),
]);

/** Whether the printed manual has a glyph for a character. */
function printable(code) {
    return code <= 0x24f || (code >= 0x2010 && code <= 0x2027 && code !== 0x2011);
}

/**
 * Text for Info and HTML as written, and for the printed manual with each
 * character its fonts lack replaced by an ASCII stand-in or `U+XXXX`.
 *
 * Box-drawing characters become `-`, `|` or `+`; any other character the
 * fonts lack becomes its code point. Apply to already escaped text.
 *
 * @param {string} escaped
 */
export function texSafe(escaped) {
    return [...escaped]
        .map((char) => {
            const code = char.codePointAt(0);
            if (printable(code)) return char;
            const box = BOX_DRAWING.get(char);
            const stand =
                box ??
                (code >= 0x2500 && code <= 0x257f ?
                    "+"
                :   `U+${code.toString(16).toUpperCase().padStart(4, "0")}`);
            return `@inlinefmtifelse{tex,${stand},${char}}`;
        })
        .join("");
}
