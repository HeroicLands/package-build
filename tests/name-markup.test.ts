/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as spans from "../engine/content-spans.mjs";
import * as names from "../engine/names.mjs";
import { parseExtensionAttributes } from "../engine/extension-attributes.mjs";
import { createContentSession } from "../engine/content-session.mjs";
import { createFirstUseChecker } from "../engine/first-use.mjs";
import { parseMarkdownFile, renderFoundryMarkdown } from "../engine/helpers.mjs";
import { fixture, note, write } from "./content-session-fixture.js";

const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** Original UTF-16 coordinates, independent of the parser's normalized input. */
function at(source: string, value: string, from = 0) {
    const start = source.indexOf(value, from);
    expect(start).toBeGreaterThanOrEqual(0);
    const prefix = source.slice(0, start);
    return {
        start,
        end: start + value.length,
        line: prefix.split("\n").length,
        column: start - prefix.lastIndexOf("\n"),
    };
}

describe("the actual authored marked-name inventory", () => {
    it("uses a supplied catalog for markers and links without rebuilding it", async () => {
        const input = fixture();
        roots.push(input.root);
        const file = [...input.files.keys()][0];
        const raw = note(
            { type: "lore", subType: "history", shortcode: "n0", name: { full: "Reader" } },
            "[Note 1]{.name} then [[lore-n1|Note 1]] and **Note 1**.",
        );
        write(file, raw);
        const session = await createContentSession({ config: input.config });
        try {
            const index = await session.audit("lint");
            const catalog = names.createNameCatalog({ records: session.records, index });
            const recognize = vi.spyOn(catalog, "recognize");
            const resolve = vi.spyOn(catalog, "resolve");
            const create = vi.spyOn(names, "createNameCatalog");
            const checker = createFirstUseChecker({
                records: session.records,
                index,
                catalog,
                parsed: session.parsed,
                syntax: session.syntax,
            } as any);
            expect(checker({ file, raw }).map((finding) => finding.rules)).toEqual([
                ["unlinked-name"],
                ["repeated-name"],
            ]);
            expect(recognize).toHaveBeenCalled();
            expect(resolve).toHaveBeenCalledWith("lore-n1");
            expect(create).not.toHaveBeenCalled();
        } finally {
            session.dispose();
        }
    });

    it("retains optional parsed attribute ranges without changing default grammar or duplicate ownership", () => {
        const source =
            '.name data-type="place/settlement" title="a \\"quoted\\" value" data-type=being';
        const plain = parseExtensionAttributes(source);
        const located: any = parseExtensionAttributes(source, { positions: true } as any);
        const { positions, ...unchanged } = located;
        expect(unchanged).toEqual(plain);
        expect(Object.hasOwn(plain, "positions")).toBe(false);
        expect(plain.values["data-type"]).toBe("place/settlement");
        expect(plain.problems).toEqual(["data-type is written twice"]);
        expect(positions["data-type"]).toEqual({
            key: { start: source.indexOf("data-type"), end: source.indexOf("data-type") + 9 },
            value: {
                start: source.indexOf("place/settlement"),
                end: source.indexOf("place/settlement") + 16,
            },
        });
        expect(source.slice(positions.title.value.start, positions.title.value.end)).toBe(
            'a \\"quoted\\" value',
        );
    });

    it("reads visible names from actual parsed children with the body's reference context", () => {
        const source =
            '[**Arden** [Vale][person]]{.wide .name data-type="place/region"}\n\n[person]: https://example.invalid/vale';
        const html = renderFoundryMarkdown(source);
        expect(html).toContain('<span class="wide name" data-type="place/region">');
        expect(html).toContain(
            '<strong>Arden</strong> <a href="https://example.invalid/vale">Vale</a>',
        );
        const result: any = spans.scanSpans(source);
        expect(result.names).toHaveLength(1);
        expect(result.names[0]).toBe(result.spans[0]);
        expect(result.names[0]).toMatchObject({
            visible: "Arden Vale",
            text: "**Arden** [Vale][person]",
            attrs: [
                ["class", "wide name"],
                ["data-type", "place/region"],
            ],
        });
    });

    it("retains nested marker and attribute positions through CRLF and original UTF-16 text", () => {
        const source =
            '😀 Before [outer\r\n[**Arden** [Vale][person]]{.name title="x } y" data-type="place/region"}]{.wide}\r\n\r\n[person]: https://example.invalid/vale';
        expect(renderFoundryMarkdown(source)).toContain(
            '<strong>Arden</strong> <a href="https://example.invalid/vale">Vale</a>',
        );
        const result: any = spans.scanSpans(source);
        expect(result.names).toHaveLength(1);
        const marker = result.names[0];
        expect(marker).toMatchObject({
            ...at(
                source,
                '[**Arden** [Vale][person]]{.name title="x } y" data-type="place/region"}',
            ),
            visible: "Arden Vale",
        });
        expect(marker.attributePositions["data-type"]).toEqual({
            key: at(source, "data-type"),
            value: at(source, "place/region"),
        });
        expect(marker.attributePositions.title.value).toEqual(at(source, "x } y"));
    });

    it("keeps footnote context and real span scope without creating names from labels or literals", () => {
        const source = [
            "# [Heading]{.name}",
            "",
            "| Named | Other |",
            "| --- | --- |",
            "| [Cell]{.name} | [ordinary](https://example.invalid) |",
            "",
            "[Arden[^aside] Vale]{.name} and [ordinary]{.named data-type=anything}.",
            "",
            "`[code]{.name}` and \\[escaped]{.name}.",
            "",
            "<!-- [comment]{.name} -->",
            "",
            "```text",
            "[literal]{.name}",
            "```",
            "",
            "```verse",
            "[Verse]{.name}",
            "```",
            "",
            "[^aside]: Written aside.",
        ].join("\n");
        const html = renderFoundryMarkdown(source);
        expect(html).toContain('class="footnote-ref"');
        const result: any = spans.scanSpans(source);
        expect(result.names.map((marker: any) => marker.visible)).toEqual([
            "Heading",
            "Cell",
            "Arden Vale",
            "Verse",
        ]);
        expect(result.names.every((marker: any) => result.spans.includes(marker))).toBe(true);
    });

    it("maps actual table header and body cells through duplicate text, escaped pipes and CRLF", () => {
        const source =
            '😀 Before.\r\n\r\n> | [Same]{.name} | [Same]{.name} |\r\n> | --- | --- |\r\n> | [Pipe \\| Name]{.name data-type="place/region"} | [Same]{.name} |';
        const html = renderFoundryMarkdown(source);
        expect(html).toContain('<span class="name" data-type="place/region">Pipe | Name</span>');
        const result: any = spans.scanSpans(source);
        expect(result.names.map((marker: any) => marker.visible)).toEqual([
            "Same",
            "Same",
            "Pipe | Name",
            "Same",
        ]);
        let from = 0;
        for (const [index, marker] of result.names.entries()) {
            const written =
                index === 2 ? '[Pipe \\| Name]{.name data-type="place/region"}' : "[Same]{.name}";
            const expected = at(source, written, from);
            expect(marker).toMatchObject(expected);
            from = expected.end;
        }
        expect(result.names[2].attributePositions["data-type"]).toEqual({
            key: at(source, "data-type"),
            value: at(source, "place/region"),
        });
        const web = spans.renderSpans(source);
        expect(web.errors).toEqual([]);
        expect(web.markdown).toContain(
            '<span class="name" data-type="place/region">Pipe \\| Name</span>',
        );
        expect(renderFoundryMarkdown(web.markdown)).toBe(html);
    });

    it("rebases the captured body inventory without mutating it or scanning another projection", async () => {
        const input = fixture();
        roots.push(input.root);
        const file = [...input.files.keys()][0];
        const raw = note(
            { type: "lore", subType: "history", shortcode: "n0", name: { full: "Reader" } },
            '  😀 [Outer [Inner]{.name data-type=being}]{.name data-type="place/region"}\r\n\r\n[Later]{.name}',
        )
            .replaceAll("\n", "\r\n")
            .replaceAll("\r\r\n", "\r\n");
        write(file, raw);
        const parsed = parseMarkdownFile(file, { renderDescription: false });
        const inventory: any = spans.scanSpans(parsed.body);
        expect(inventory.names).toHaveLength(3);
        const before = structuredClone(inventory);
        const { rebaseNameSpans } = await import("../engine/name-markup.mjs");
        const rebased = rebaseNameSpans(inventory.names, {
            raw,
            bodyLine: parsed.bodyLine,
            bodyColumn: parsed.bodyColumn,
        });
        expect(rebased.map((marker: any) => [marker.start, marker.line, marker.column])).toEqual(
            [
                at(raw, '[Outer [Inner]{.name data-type=being}]{.name data-type="place/region"}'),
                at(raw, "[Inner]{.name data-type=being}"),
                at(raw, "[Later]{.name}"),
            ].map(({ start, line, column }) => [start, line, column]),
        );
        expect(rebased[1].attributePositions["data-type"].key).toEqual(at(raw, "data-type"));
        expect(inventory).toEqual(before);
    });

    it.each([8, 16])(
        "reuses one captured body inventory for %i notes in the first-use adapter",
        async (size) => {
            const input = fixture(size);
            roots.push(input.root);
            const file = [...input.files.keys()][0];
            const raw = note(
                { type: "lore", subType: "history", shortcode: "n0", name: { full: "Reader" } },
                '😀 [**Note** [1][person]]{.name data-type="lore/history"}\r\n\r\n[person]: https://example.invalid/one',
            );
            write(file, raw);
            const session = await createContentSession({ config: input.config });
            try {
                const index = await session.audit("lint");
                const body = session.parsed.get(file)!.body;
                const captured: any = session.syntax(body).spans;
                const scan = vi.spyOn(spans, "scanSpans");
                const checker = createFirstUseChecker({
                    records: session.records,
                    index,
                    parsed: session.parsed,
                    syntax: session.syntax,
                } as any);
                const findings = index.notes.flatMap(checker);
                expect(scan).not.toHaveBeenCalled();
                expect(findings).toHaveLength(1);
                const { line, column } = at(
                    raw,
                    '[**Note** [1][person]]{.name data-type="lore/history"}',
                );
                expect(findings[0]).toMatchObject({
                    line,
                    column,
                    rules: ["unlinked-name"],
                    severity: "warning",
                });
                expect(findings[0].message).toContain("Note 1");
                expect(session.syntax(body).spans).toBe(captured);
                const changed = checker({ file, raw: "[New]{.name} and [New]{.name}." });
                expect(scan).toHaveBeenCalledTimes(1);
                expect(changed.map((finding) => finding.rules)).toEqual([["repeated-name"]]);
            } finally {
                session.dispose();
            }
        },
    );
});
