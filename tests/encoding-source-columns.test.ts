/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { compileRows as compileEncoding } from "../engine/encoding.mjs";
import { scanRuns, renderRuns } from "../engine/content-scripts.mjs";
import { recordRuns } from "../engine/run-rows.mjs";
const ctx = {
    encodings: new Map([
        [
            "custom",
            compileEncoding({
                name: "custom",
                fonts: ["symbols"],
                accepts: ["😀"],
                separator: " ",
                rows: [["😀", "\u{F0230}"]],
                codes: [],
            }),
        ],
    ]),
    faces: new Map([
        [
            "symbols",
            {
                slug: "symbols",
                family: "Symbols",
                class: "hl-symbols",
                features: [],
                draws: new Set([0xf0230]),
            },
        ],
    ]),
};
const column = (source: string, offset: number) =>
    [...source.slice(source.lastIndexOf("\n", offset) + 1, offset)].length + 1;

describe("encoding diagnostic columns and source indices", () => {
    it("counts a supplementary character as one diagnostic column", () => {
        const source = "[😀$]{enc=custom}";
        expect(scanRuns(source, ctx).errors).toEqual([
            expect.objectContaining({ line: 1, column: 3 }),
        ]);
        const rendered = renderRuns(source, ctx);
        expect(rendered.errors).toEqual([expect.objectContaining({ line: 1, column: 3 })]);
        expect(rendered.markdown).toBe(source);
    });
    it("retains source-unit coordinates while reporting nested escaped refusals in code points", () => {
        const source = "😀 prefix [😀 [😀\\$]{.emph}]{enc=custom}";
        const scanned = scanRuns(source, ctx);
        expect(scanned.errors).toEqual([
            expect.objectContaining({ line: 1, column: column(source, source.indexOf("$")) }),
        ]);
        expect(renderRuns(source, ctx).errors).toEqual(scanned.errors);
        expect(scanned.runs[0]).toMatchObject({
            start: source.indexOf("["),
            column: source.indexOf("[") + 1,
        });
        expect(scanned.runs[1]).toMatchObject({
            start: source.lastIndexOf("["),
            column: source.lastIndexOf("[") + 1,
        });
        expect(recordRuns(source, { context: ctx }).map(({ column }) => column)).toEqual(
            scanned.runs.map(({ column }) => column),
        );
    });
    it("counts supplementary prefixes independently on subsequent lines", () => {
        const source = "😀\n😀 [😀\\$]{enc=custom}";
        expect(scanRuns(source, ctx).errors).toEqual([
            expect.objectContaining({ line: 2, column: column(source, source.indexOf("$")) }),
        ]);
    });
    it("serializes native scan results without private render plans", () => {
        const result = scanRuns("[😀]{enc=custom}", ctx);
        expect(result.errors).toEqual([]);
        expect(() => JSON.stringify(result)).not.toThrow();
        expect(JSON.parse(JSON.stringify(result))).toEqual({
            runs: result.runs,
            errors: [],
            warnings: [],
        });
    });
    it("checks visible Roman source at its authored position after selection fails", () => {
        const unresolved = {
            ...ctx,
            languages: { vyl: { tag: "art-x-vyl" } },
            romanInventories: new Map([["vyl", { language: "vyl", characters: new Set("a") }]]),
        };
        const sign = "\u{F0230}";
        for (const source of [
            `😀 [${sign}]{lang=vyl}`,
            `😀 [[doc-target#anchor|${sign}]]{lang=vyl}`,
            "😀 [a\\;]{lang=vyl}",
        ]) {
            const marker = source.includes(sign) ? sign : ";";
            const findings = scanRuns(source, unresolved).errors;
            const sourceFindings = findings.filter((finding) =>
                /setting-script character|not standard Roman|data\.roman.*inventory/.test(
                    finding.message,
                ),
            );
            expect(sourceFindings).toEqual([
                expect.objectContaining({
                    line: 1,
                    column: column(source, source.indexOf(marker)),
                    message: expect.stringContaining(marker === sign ? "⟦U+F0230⟧" : "U+003B"),
                }),
            ]);
            expect(renderRuns(source, unresolved).errors).toEqual(findings);
        }
    });
    it("keeps external encoding file positions unchanged", () => {
        const external = {
            ...ctx,
            encodings: new Map(),
            encodingFindings: [
                { file: "encoding.json", line: 3, column: 9, message: "Invalid encoding" },
            ],
        };
        expect(scanRuns("😀 [😀]{enc=custom}", external).errors).toEqual([
            { file: "encoding.json", line: 3, column: 9, message: "Invalid encoding" },
        ]);
        expect(renderRuns("😀 [😀]{enc=custom}", external).errors).toEqual([
            { file: "encoding.json", line: 3, column: 9, message: "Invalid encoding" },
        ]);
    });
});
