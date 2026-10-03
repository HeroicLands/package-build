/* SPDX-License-Identifier: GPL-3.0-or-later */

import Handlebars from "handlebars";

import { isAddressTuple, renderAddress } from "./address.mjs";
import { matchAllOutsideCode, replaceOutsideCode } from "./code-fences.mjs";
import { formatDateInCalendar, parseNoteDate } from "./note-dates.mjs";
import { numberWords, numberDigits } from "./number-words.mjs";
import { slugify } from "./content-slug.mjs";
import { WIKILINK, authoredLabel, isSamePage, parseWikilink } from "./wikilink-syntax.mjs";

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
    Object.freeze({
        name: "ref",
        params: 'address [form="number"|"full"|"title"]',
        summary:
            'A link to a `:::figure` fence, by its anchor — `"#thorn"` on this note, ' +
            '`"note-address#thorn"` on another. `form` is `number` (the default, and ' +
            'admitted explicitly), rendering "Figure 13"; `full`, the number and the ' +
            "caption; or `title`, the caption alone. Always renders as a link to the " +
            "figure, and a link inside the caption contributes only its label text.",
        make:
            ({ figures }) =>
            (address, options) => {
                const hash = options?.hash ?? {};
                const form = Object.hasOwn(hash, "form") ? hash.form : "number";
                const formFault = refFormFault(form);
                if (formFault) throw new RangeError(formFault);
                if (typeof address !== "string" || !address.trim())
                    throw new TypeError("ref needs an address naming a figure's anchor");
                const { parsed, figure, crossNote } = refFigure(address, figures);
                if (!figure) throw new RangeError(refNotFoundFault(address, parsed, crossNote));
                if (form !== "number" && !figure.hasCaption)
                    throw new RangeError(refNoCaptionFault(form, parsed));
                return renderRef(figure, parsed, form);
            },
    }),
]);

/** The closed set of forms a figure reference may render as; `number` is the default. */
const REF_FORMS = Object.freeze(["number", "full", "title"]);

/**
 * Whether a `ref` helper's `form` is one of {@link REF_FORMS}.
 * @param {unknown} form - The resolved value, quoted or not.
 * @returns {string|null} A finding message, or `null` when the form is valid.
 */
function refFormFault(form) {
    return REF_FORMS.includes(form) ? null : `ref's form must be one of ${REF_FORMS.join(", ")}`;
}

/**
 * The figure a `ref` address names, read through the wikilink grammar's own
 * address parsing rather than a second parser.
 *
 * @param {string} address - `"#thorn"` or `"note-address#thorn"`.
 * @param {Map<string, {label: string, caption: string, hasCaption: boolean}>} [figures]
 *   This note's figures, by the id a `:::figure` fence declares.
 * @returns {{parsed: object, figure: object|null, crossNote: boolean}} The
 *   parsed address, the figure it names (`null` when none matches), and
 *   whether the address names another note.
 */
function refFigure(address, figures) {
    const parsed = parseWikilink(address);
    if (!isSamePage(parsed)) return { parsed, figure: null, crossNote: true };
    return { parsed, figure: figures?.get(parsed.anchor) ?? null, crossNote: false };
}

/** The message for a `ref` address naming no figure, same-note or across notes. */
function refNotFoundFault(address, parsed, crossNote) {
    return crossNote ?
            `ref "${address}" addresses a figure in another note, which this build does not resolve`
        :   `ref "${address}" names no figure for anchor "#${parsed.anchor}"`;
}

/** The message for a `full` or `title` reference to a figure with no caption. */
function refNoCaptionFault(form, parsed) {
    return `ref form="${form}" needs a caption, and figure "#${parsed.anchor}" has none`;
}

/**
 * A figure caption's markdown, with every link flattened to its label text.
 *
 * `ref` renders as a link, so a link nested inside the label it wraps would be
 * a second anchor — invalid HTML, and unreadable in Typst. Emphasis and an
 * icon embed nest inside an anchor legally, and are left as written.
 *
 * @param {string} caption - The figure's raw caption markdown.
 * @returns {string} The caption, every link reduced to its label.
 */
function flattenCaptionLinks(caption) {
    return String(caption ?? "")
        .replace(WIKILINK, (_all, inner) => {
            const link = parseWikilink(inner);
            return authoredLabel(link) ?? link.inner;
        })
        .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, "$1");
}

/** A `ref` call's rendered Markdown, always a link to the figure's anchor. */
function renderRef(figure, parsed, form) {
    const href = `#${slugify(parsed.anchor)}`;
    if (form === "number") return `[${figure.label}](${href})`;
    const title = flattenCaptionLinks(figure.caption);
    return form === "title" ? `[${title}](${href})` : `[${figure.label}: ${title}](${href})`;
}

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
 * A `ref` call's fault, told from its AST node rather than its rendered
 * result. **Only the AST tells a quoted `"full"` from an unquoted `full`** —
 * Handlebars resolves the unquoted form against the render context before a
 * helper ever sees it, so by the time `ref` runs the two are the same value
 * and the distinction is gone.
 *
 * @param {object} node - A `MustacheStatement`/`SubExpression` AST node.
 * @param {Map<string, object>} [figures] - This note's figures, by id.
 * @returns {string|null} A finding message, or `null` when the call is sound.
 */
function refCallFault(node, figures) {
    const pair = node.hash?.pairs?.find((entry) => entry.key === "form");
    if (pair && pair.value.type !== "StringLiteral")
        return `ref's form must be a quoted string — one of ${REF_FORMS.join(", ")}`;
    const form = pair ? pair.value.value : "number";
    const formFault = refFormFault(form);
    if (formFault) return formFault;
    const addressParam = node.params?.[0];
    const address = addressParam?.type === "StringLiteral" ? addressParam.value : null;
    // Not a literal address: left to the render pass, which reports whatever
    // the resolved value turns out to be.
    if (typeof address !== "string" || !address.trim()) return null;
    const { parsed, figure, crossNote } = refFigure(address, figures);
    if (!figure) return refNotFoundFault(address, parsed, crossNote);
    if (form !== "number" && !figure.hasCaption) return refNoCaptionFault(form, parsed);
    return null;
}

/**
 * Every `ref` call's fault in a body, reachable without rendering a thing —
 * walked from the same parsed AST {@link sqlQueriesInMarkdown} walks, since a
 * `ref` call can sit nested inside a Boolean helper exactly as a `sql` one
 * can.
 *
 * @param {string} body
 * @param {Map<string, object>} [figures] - This note's figures, by id.
 * @returns {Array<{offset: number, message: string}>} One entry per faulty
 *   `{{...}}` expression, `offset` into `body`.
 */
function refFaults(body, figures) {
    const faults = [];
    for (const match of matchAllOutsideCode(body, EXPRESSION)) {
        let program;
        try {
            program = Handlebars.parse(match[0]).body;
        } catch {
            continue; // The render pass reports the malformed expression itself.
        }
        const visit = (node) => {
            if (!node || typeof node !== "object") return;
            if (node.path?.original === "ref") {
                const message = refCallFault(node, figures);
                if (message) faults.push({ offset: match.index, message });
            }
            for (const parameter of node.params ?? []) visit(parameter);
        };
        for (const node of program) visit(node);
    }
    return faults;
}

/** Where an offset into `body` sits, in the file's own line and column. */
function positionAt(body, offset, bodyLine) {
    const before = String(body).slice(0, offset);
    const lines = before.split("\n");
    return { line: bodyLine + lines.length - 1, column: lines.at(-1).length + 1 };
}

/**
 * Expand scalar frontmatter references and registered functions in Markdown prose.
 * @param {string} body
 * @param {{fm?: object, dates?: object, sqlResults?: Map<string, object>,
 *   figures?: Map<string, {label: string, caption: string, hasCaption: boolean}>,
 *   file?: string, bodyLine?: number}} [options] - `figures` is this note's
 *   own `:::figure` fences, by id, for the `ref` helper; a cross-note address
 *   is reported as unresolved rather than looked up.
 */
export function renderMarkdownExpressions(
    body,
    { fm, dates, sqlResults, figures, file, bodyLine = 1 } = {},
) {
    const findings = [];
    const engine = Handlebars.create();
    for (const helper of HELPERS)
        engine.registerHelper(helper.name, helper.make({ sqlResults, dates, figures }));
    const staticFaults = new Map(refFaults(body, figures).map((f) => [f.offset, f.message]));
    const markdown = replaceOutsideCode(body, EXPRESSION, (source, _inside, offset) => {
        const fault = staticFaults.get(offset);
        if (fault) {
            const { line, column } = positionAt(body, offset, bodyLine);
            findings.push({
                ...(file ? { file } : {}),
                line,
                column,
                severity: "error",
                message: `Markdown expression ${source} failed: ${fault}`,
            });
            return source;
        }
        try {
            return engine.compile(source, { strict: true })(fm ?? {});
        } catch (error) {
            const { line, column } = positionAt(body, offset, bodyLine);
            findings.push({
                ...(file ? { file } : {}),
                line,
                column,
                severity: "error",
                message: `Markdown expression ${source} failed: ${error.message}`,
            });
            return source;
        }
    });
    return { markdown, findings };
}
