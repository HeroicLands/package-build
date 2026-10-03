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

/**
 * Every helper an expression may call, with the parameters it takes.
 *
 * **This is the one list.** The engine registers from it and the authoring
 * document is checked against it, so a helper added here is a helper the
 * document must describe, and a helper the document describes but the engine
 * does not register fails the same test.
 *
 * `make` receives the render's context — the prepared SQL results and the date
 * rules — and returns the function Handlebars calls. A helper that needs
 * neither ignores it.
 */
const HELPERS = Object.freeze([
    Object.freeze({
        name: "eq",
        params: "a b",
        summary: 'True when both are the same value. Compares exactly, so 1 and "1" differ.',
        make: () => (left, right) => left === right,
    }),
    Object.freeze({
        name: "gt",
        params: "a b",
        summary: "True when a is greater than b. Both must be finite numbers.",
        make: () => numericCompare("gt", (a, b) => a > b),
    }),
    Object.freeze({
        name: "gte",
        params: "a b",
        summary: "True when a is greater than or equal to b. Both must be finite numbers.",
        make: () => numericCompare("gte", (a, b) => a >= b),
    }),
    Object.freeze({
        name: "lt",
        params: "a b",
        summary: "True when a is less than b. Both must be finite numbers.",
        make: () => numericCompare("lt", (a, b) => a < b),
    }),
    Object.freeze({
        name: "lte",
        params: "a b",
        summary: "True when a is less than or equal to b. Both must be finite numbers.",
        make: () => numericCompare("lte", (a, b) => a <= b),
    }),
    Object.freeze({
        name: "not",
        params: "value",
        summary: "True when the value is false, zero, empty or absent.",
        make: () => (value) => !value,
    }),
    Object.freeze({
        name: "and",
        params: "value …",
        summary: "True when every value given is true. Takes two or more.",
        make:
            () =>
            (...args) =>
                args.slice(0, -1).every(Boolean),
    }),
    Object.freeze({
        name: "or",
        params: "value …",
        summary: "True when any value given is true. Takes two or more.",
        make:
            () =>
            (...args) =>
                args.slice(0, -1).some(Boolean),
    }),
    Object.freeze({
        name: "words",
        params: "number",
        summary:
            "The number spelled out for running prose — `1200` becomes one thousand two hundred. " +
            "Whole numbers only; a decimal is a finding, and `digits` takes one.",
        make: () => (value) => numberWords(value),
    }),
    Object.freeze({
        name: "digits",
        params: "number",
        summary:
            "The number as a grouped numeral — `1200` becomes 1,200, and a fractional part is kept.",
        make: () => (value) => numberDigits(value),
    }),
    Object.freeze({
        name: "sql",
        params: '"query"',
        summary:
            "The single value a query returns, for use inside a sentence. The query is a quoted " +
            "string, the same SQL a table fence takes.",
        make:
            ({ sqlResults }) =>
            (query) => {
                if (typeof query !== "string" || !query.trim())
                    throw new TypeError("sql needs a nonempty query string");
                const result = sqlResults?.get(query);
                if (!result)
                    throw new RangeError(`SQL expression has no prepared result: ${query}`);
                if (result.error) throw new RangeError(`SQL expression failed: ${result.error}`);
                return result.value;
            },
    }),
    Object.freeze({
        name: "dateformat",
        params: 'calendar date ["format"]',
        summary:
            "A date written in a calendar. The calendar is an Address or its shortcode, the date " +
            "is the value a note carries, and the optional third argument names an output pattern.",
        make:
            ({ dates }) =>
            (calendar, authored, formatOrOptions) => {
                if (
                    !(typeof calendar === "string" || isAddressTuple(calendar)) ||
                    !["string", "number"].includes(typeof authored)
                )
                    throw new TypeError("dateformat needs a calendar Address and a date");
                const parsed = parseNoteDate(authored, { ...dates, allowUnknown: false });
                const error = parsed.findings.find((item) => item.severity === "error");
                if (error || !parsed.date)
                    throw new RangeError(error?.message ?? "date does not resolve");
                const printable = formatDateInCalendar(
                    parsed.date,
                    isAddressTuple(calendar) ? renderAddress(calendar) : calendar,
                    dates,
                    typeof formatOrOptions === "string" ? formatOrOptions : undefined,
                );
                if (!printable)
                    throw new RangeError(`date cannot be printed in calendar ${calendar}`);
                return printable.prose ?? printable.text;
            },
    }),
]);

/**
 * A comparison of two numbers, which refuses anything else.
 *
 * Four helpers differ only in the comparison, and a value that is not a finite
 * number is a finding rather than a silent `false`.
 *
 * @param {string} name - The helper's name, for the message.
 * @param {(a: number, b: number) => boolean} compare - The comparison.
 * @returns {(left: unknown, right: unknown) => boolean} The helper.
 */
function numericCompare(name, compare) {
    return (left, right) => {
        const finite = (value) =>
            typeof value === "bigint" || (typeof value === "number" && Number.isFinite(value));
        if (!finite(left) || !finite(right))
            throw new TypeError(`${name} needs two finite numbers`);
        return compare(left, right);
    };
}

/**
 * Each helper's parameters and what it does, keyed by name.
 *
 * The authoring document describes this surface, and a test holds the two
 * together. A consumer reads it to list what an expression may call.
 *
 * @type {Readonly<Record<string, Readonly<{params: string, summary: string}>>>}
 */
export const EXPRESSION_HELPERS = Object.freeze(
    Object.fromEntries(
        HELPERS.map(({ name, params, summary }) => [name, Object.freeze({ params, summary })]),
    ),
);

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
    for (const helper of HELPERS)
        engine.registerHelper(helper.name, helper.make({ sqlResults, dates }));
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
