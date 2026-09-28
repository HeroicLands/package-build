/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import {
    renderMarkdownExpressions,
    sqlQueriesInMarkdown,
} from "../engine/markdown-expressions.mjs";
import { prepareInlineSqlExpressions } from "../engine/sql-tables.mjs";
import { parseAddress } from "../engine/address.mjs";
import { resolveReckoningMarkers } from "../engine/reckoning-markers.mjs";
import { numberWords, numberDigits } from "../engine/number-words.mjs";

const months = Array.from({ length: 12 }, (_, index) => ({
    name: `Month ${index + 1}`,
    days: index === 11 ? 35 : 30,
}));
const dates = {
    ...resolveReckoningMarkers(
        {
            notes: [
                {
                    fm: {
                        package: "thalorna",
                        shortcode: "vrcal",
                        type: "lore",
                        subType: "calendar",
                        data: {
                            months,
                            eras: [
                                {
                                    shortcode: "founding",
                                    marker: "VR",
                                    start: "1.1",
                                    label: { after: "{date} AF", before: "{date} BF" },
                                },
                            ],
                        },
                    },
                },
            ],
        },
        365,
    ),
    daysPerYear: 365,
};

describe("Markdown expressions", () => {
    it("replaces frontmatter values and converts a canonical date in prose", () => {
        const result = renderMarkdownExpressions(
            '{{name.full}} reached port on {{dateformat "vrcal" "300.25"}}.',
            { fm: { name: { full: "Aran" } }, dates },
        );
        expect(result).toEqual({ markdown: "Aran reached port on 300/1/25 AF.", findings: [] });
    });

    it("accepts an era qualifier and a frontmatter date argument", () => {
        const result = renderMarkdownExpressions('{{dateformat "vrcal.founding" data.born}}', {
            fm: { data: { born: "-300.25" } },
            dates,
        });
        expect(result).toEqual({ markdown: "301/1/25 BF", findings: [] });
    });

    it("uses the note's calendar Address as a helper argument", () => {
        const fm = {
            data: {
                calendar: parseAddress("thalorna-note-lore-vrcal", {
                    types: new Set(["lore"]),
                    packages: new Set(["thalorna"]),
                }),
                born: "300.25",
            },
        };
        expect(
            renderMarkdownExpressions("{{dateformat data.calendar data.born}}", { fm, dates }),
        ).toEqual({ markdown: "300/1/25 AF", findings: [] });
    });

    it("evaluates Boolean comparisons and nested helpers", () => {
        const result = renderMarkdownExpressions(
            "{{and (gt 3 5) (lt 4 2)}} {{or (eq data.count 3) (not false)}}",
            { fm: { data: { count: 3 } }, dates },
        );
        expect(result).toEqual({ markdown: "false true", findings: [] });
    });

    it("prepares scalar SQL for an inline value and a nested comparison", async () => {
        const query = "SELECT COUNT(*) AS n FROM notes";
        const source = `{{sql "${query}"}} {{gt (sql "${query}") 10}}`;
        expect(sqlQueriesInMarkdown(source)).toEqual([query, query]);
        const called: string[] = [];
        const db = {
            query: async (sql: string) => {
                called.push(sql);
                return { columnNames: ["n"], rows: [{ n: 12n }] };
            },
        };
        const prepared = await prepareInlineSqlExpressions(db, [
            { source: "Aran.md", markdown: source, frontmatter: {} },
        ]);
        expect(called).toEqual([query]);
        expect(renderMarkdownExpressions(source, { sqlResults: prepared.get("Aran.md") })).toEqual({
            markdown: "12 true",
            findings: [],
        });
    });

    it("formats a scalar count as words or grouped digits without changing its numeric value", async () => {
        const query = "SELECT 12345 AS n";
        const source = `{{words (sql "${query}")}}; {{digits (sql "${query}")}}; {{gt (sql "${query}") 10000}}`;
        const prepared = await prepareInlineSqlExpressions(
            { query: async () => ({ columnNames: ["n"], rows: [{ n: 12345n }] }) },
            [{ source: "Aran.md", markdown: source, frontmatter: {} }],
        );
        expect(renderMarkdownExpressions(source, { sqlResults: prepared.get("Aran.md") })).toEqual({
            markdown: "twelve thousand three hundred forty-five; 12,345; true",
            findings: [],
        });
        expect(numberWords(-201n)).toBe("minus two hundred one");
        expect(numberDigits(1200.5)).toBe("1,200.5");
    });

    it("leaves escaped expressions, Hugo shortcodes, and code examples literal", () => {
        const source = "\\{{words 12}} {{< photo >}} `{{words 12}}` {{words 12}}";
        expect(renderMarkdownExpressions(source)).toEqual({
            markdown: "\\{{words 12}} {{< photo >}} `{{words 12}}` twelve",
            findings: [],
        });
    });

    it("reports empty SQL values instead of inserting an empty string into prose", async () => {
        const source = '{{sql "SELECT NULL AS n"}}';
        const prepared = await prepareInlineSqlExpressions(
            { query: async () => ({ columnNames: ["n"], rows: [{ n: null }] }) },
            [{ source: "Aran.md", markdown: source, frontmatter: {} }],
        );
        const result = renderMarkdownExpressions(source, {
            sqlResults: prepared.get("Aran.md"),
            file: "Aran.md",
            bodyLine: 8,
        });
        expect(result.findings).toEqual([
            expect.objectContaining({
                line: 8,
                column: 1,
                severity: "error",
                message: expect.stringContaining("scalar SQL result is empty"),
            }),
        ]);
    });

    it("reads a SQL query string from frontmatter", async () => {
        const fm = { description: "SELECT 7 AS value" };
        const prepared = await prepareInlineSqlExpressions(
            {
                query: async () => ({
                    columnNames: ["value"],
                    rows: [{ value: 7 }],
                }),
            },
            [{ source: "Aran.md", markdown: "{{sql description}}", frontmatter: fm }],
        );
        expect(
            renderMarkdownExpressions("{{sql description}}", {
                fm,
                sqlResults: prepared.get("Aran.md"),
            }).markdown,
        ).toBe("7");
    });

    it("reports a SQL query that is not scalar", async () => {
        const query = "SELECT name FROM notes";
        const source = `{{sql "${query}"}}`;
        const prepared = await prepareInlineSqlExpressions(
            {
                query: async () => ({
                    columnNames: ["name"],
                    rows: [{ name: "A" }, { name: "B" }],
                }),
            },
            [{ source: "Aran.md", markdown: source, frontmatter: {} }],
        );
        const result = renderMarkdownExpressions(source, {
            sqlResults: prepared.get("Aran.md"),
            file: "Aran.md",
            bodyLine: 4,
        });
        expect(result.findings).toEqual([
            expect.objectContaining({
                line: 4,
                column: 1,
                message: expect.stringContaining("one column and one row"),
            }),
        ]);
    });

    it("preserves code and Hugo shortcodes and locates invalid expressions", () => {
        const source =
            '`{{name.full}}` {{< glyph slug="bes" >}}\n{{dateformat "missing" "300.25"}}';
        const result = renderMarkdownExpressions(source, {
            fm: { name: { full: "Aran" } },
            dates,
            file: "Aran.md",
            bodyLine: 10,
        });
        expect(result.markdown).toBe(source);
        expect(result.findings).toEqual([
            expect.objectContaining({
                file: "Aran.md",
                line: 11,
                column: 1,
                severity: "error",
                message: expect.stringContaining("does not resolve"),
            }),
        ]);
    });
});
