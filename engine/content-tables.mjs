/* SPDX-License-Identifier: GPL-3.0-or-later */

import { FENCE_LINE } from "./code-fences.mjs";

/**
 * Replace prepared SQL fences with Markdown tables while retaining source lines.
 * Query execution happens in the asynchronous SQL preparation pass.
 * @param {string} markdown - The authored body.
 * @param {{source?: string, sqlTables?: object[]}} [context] - Prepared results.
 * @returns {{markdown: string, errors: object[], warnings: object[], lineMap: object[]}}
 */
export function expandContentTables(markdown, { source = "", sqlTables } = {}) {
    const lines = String(markdown ?? "").split("\n");
    const out = [];
    const lineMap = [];
    const errors = [];
    const warnings = [];
    let sqlOrdinal = 0;
    const emit = (value, line, generated = false) => {
        out.push(value);
        lineMap.push({ line, generated });
    };
    for (let i = 0; i < lines.length; i++) {
        const opening = FENCE_LINE.exec(lines[i]);
        if (!opening) {
            emit(lines[i], i);
            continue;
        }
        const [, indent, marker, info] = opening;
        const closer = new RegExp(`^[ \\t]*${marker[0]}{${marker.length},}[ \\t]*$`);
        let close = i + 1;
        while (close < lines.length && !closer.test(lines[close])) close++;
        const block = lines.slice(i, Math.min(close + 1, lines.length));
        const language = info.trim().split(/\s+/)[0]?.toLowerCase();
        if (language === "dataview") {
            errors.push({
                source,
                directive: block.join("\n"),
                reason: "this table query language is unsupported; use a SQL fence",
                line: i,
                column: indent.length + 1,
            });
        }
        if (language !== "sql" || close >= lines.length) {
            block.forEach((value, offset) => emit(value, i + offset));
            i = close;
            continue;
        }
        const prepared = sqlTables?.[sqlOrdinal++];
        const failure =
            !prepared ? "SQL content table was not prepared"
            : prepared.reason ? prepared.reason
            : prepared.rows === 0 && !prepared.allowEmpty ?
                prepared.stubsExcluded > 0 ?
                    `SQL query selects no notes; ${prepared.stubsExcluded} matching stubs are excluded by FROM notes. Use FROM entries or {allow-empty=true}`
                :   "SQL query selects no notes; use {allow-empty=true} if this is intended"
            :   undefined;
        if (failure) {
            errors.push({
                source,
                directive: block.join("\n"),
                reason: failure,
                line: i,
                column: indent.length + 1,
            });
            block.forEach((value, offset) => emit(value, i + offset));
            i = close;
            continue;
        }
        if (prepared.stubsExcluded > 0) {
            warnings.push({
                source,
                line: i,
                column: indent.length + 1,
                reason: `this table selects FROM notes; ${prepared.stubsExcluded} matching stubs require FROM entries`,
            });
        }
        if (out.length && out.at(-1).trim()) emit("", i, true);
        for (const row of prepared.markdown.split("\n")) emit(`${indent}${row}`, i, true);
        if (close + 1 < lines.length && lines[close + 1].trim()) emit("", i, true);
        i = close;
    }
    return { markdown: out.join("\n"), errors, warnings, lineMap };
}
