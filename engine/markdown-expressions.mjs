/* SPDX-License-Identifier: GPL-3.0-or-later */

import Handlebars from "handlebars";

import { isAddressTuple, renderAddress } from "./address.mjs";
import { matchAllOutsideCode, replaceOutsideCode } from "./code-fences.mjs";
import { formatDateInCalendar, parseNoteDate } from "./note-dates.mjs";
import { numberWords, numberDigits } from "./number-words.mjs";

/**
 * An inline expression, as an author writes one.
 *
 * Hugo shortcodes begin `{{<` or `{{%` and stay in the source for Hugo.
 *
 * Exported because a renderer that meets one has met a body this pass never ran
 * over, and has to be able to say so.
 *
 * @type {RegExp}
 */
export const EXPRESSION = /(?<![\\{])\{\{(?![{<%])([^{}\n]+)\}\}(?!\})/g;

/** Find SQL helper calls, including calls nested inside Boolean expressions. */
export function sqlQueriesInMarkdown(body, fm = {}) {
    const queries = [];
    const queryValue = (parameter) => {
        if (parameter?.type === "StringLiteral") return parameter.value;
        if (parameter?.type !== "PathExpression") return null;
        return parameter.parts.reduce((value, part) => value?.[part], fm);
    };
    const visit = (node) => {
        if (!node || typeof node !== "object") return;
        if (node.path?.original === "sql") {
            const query = queryValue(node.params?.[0]);
            if (typeof query === "string") queries.push(query);
        }
        for (const parameter of node.params ?? []) visit(parameter);
    };
    for (const match of matchAllOutsideCode(body, EXPRESSION)) {
        try {
            for (const node of Handlebars.parse(match[0]).body) visit(node);
        } catch {
            // The render pass reports the malformed expression at its source position.
        }
    }
    return queries;
}

/**
 * Expand scalar frontmatter references and registered functions in Markdown prose.
 * @param {string} body
 * @param {{fm?: object, dates?: object, sqlResults?: Map<string, object>, file?: string, bodyLine?: number}} [options]
 */
export function renderMarkdownExpressions(
    body,
    { fm, dates, sqlResults, file, bodyLine = 1 } = {},
) {
    const findings = [];
    const engine = Handlebars.create();
    const numeric = (name, left, right) => {
        if (
            !["number", "bigint"].includes(typeof left) ||
            !["number", "bigint"].includes(typeof right) ||
            (typeof left === "number" && !Number.isFinite(left)) ||
            (typeof right === "number" && !Number.isFinite(right))
        )
            throw new TypeError(`${name} needs two finite numbers`);
    };
    for (const [name, compare] of Object.entries({
        gt: (a, b) => a > b,
        gte: (a, b) => a >= b,
        lt: (a, b) => a < b,
        lte: (a, b) => a <= b,
    }))
        engine.registerHelper(name, (left, right) => {
            numeric(name, left, right);
            return compare(left, right);
        });
    engine.registerHelper("eq", (left, right) => left === right);
    engine.registerHelper("not", (value) => !value);
    engine.registerHelper("and", (...args) => args.slice(0, -1).every(Boolean));
    engine.registerHelper("or", (...args) => args.slice(0, -1).some(Boolean));
    engine.registerHelper("words", (value) => numberWords(value));
    engine.registerHelper("digits", (value) => numberDigits(value));
    engine.registerHelper("sql", (query) => {
        if (typeof query !== "string" || !query.trim())
            throw new TypeError("sql needs a nonempty query string");
        const result = sqlResults?.get(query);
        if (!result) throw new RangeError(`SQL expression has no prepared result: ${query}`);
        if (result.error) throw new RangeError(`SQL expression failed: ${result.error}`);
        return result.value;
    });
    engine.registerHelper("dateformat", (calendar, authored, formatOrOptions) => {
        if (
            !(typeof calendar === "string" || isAddressTuple(calendar)) ||
            !["string", "number"].includes(typeof authored)
        )
            throw new TypeError("dateformat needs a calendar Address and a date");
        const parsed = parseNoteDate(authored, { ...dates, allowUnknown: false });
        const error = parsed.findings.find((item) => item.severity === "error");
        if (error || !parsed.date) throw new RangeError(error?.message ?? "date does not resolve");
        const printable = formatDateInCalendar(
            parsed.date,
            isAddressTuple(calendar) ? renderAddress(calendar) : calendar,
            dates,
            typeof formatOrOptions === "string" ? formatOrOptions : undefined,
        );
        if (!printable) throw new RangeError(`date cannot be printed in calendar ${calendar}`);
        return printable.prose ?? printable.text;
    });
    const markdown = replaceOutsideCode(body, EXPRESSION, (source, _inside, offset) => {
        try {
            return engine.compile(source, { strict: true })(fm ?? {});
        } catch (error) {
            const before = String(body).slice(0, offset);
            const lines = before.split("\n");
            findings.push({
                ...(file ? { file } : {}),
                line: bodyLine + lines.length - 1,
                column: lines.at(-1).length + 1,
                severity: "error",
                message: `Markdown expression ${source} failed: ${error.message}`,
            });
            return source;
        }
    });
    return { markdown, findings };
}
