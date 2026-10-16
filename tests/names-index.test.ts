/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    buildIndexRecord,
    emitContentIndex,
    indexRecordsFor,
    prepareContentIndex,
    serializeContentIndex,
} from "../engine/content-index.mjs";
import { createContentSession } from "../engine/content-session.mjs";
import { authoredFrontmatter } from "../engine/index-records.mjs";
import { renderFoundryMarkdown } from "../engine/helpers.mjs";
import { defineConfig } from "../content-config.mjs";
import { openNotesDatabase } from "../engine/sql-tables.mjs";
import { fixture, note, write } from "./content-session-fixture.js";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function located(raw: string, literal: string, occurrence = 0) {
    let offset = -1;
    for (let n = 0; n <= occurrence; n++) offset = raw.indexOf(literal, offset + 1);
    expect(offset).toBeGreaterThanOrEqual(0);
    const before = raw.slice(0, offset);
    return { line: before.split("\n").length, column: offset - before.lastIndexOf("\n") };
}

function typedFixture() {
    const input = fixture();
    roots.push(input.root);
    return input;
}

describe("authored marked names in captured records", () => {
    it("indexes actual visible spans throughout the body with original CRLF/UTF-16 positions", () => {
        const input = typedFixture();
        const file = [...input.files.keys()][0];
        const body = [
            '  😀 [Ravenmoor]{.name data-type="place/settlement"}',
            "",
            "# [Header]{.name}",
            "",
            "| Name |",
            "| --- |",
            '| [Table]{.name data-type="lore/history"} |',
            "",
            "> [Quote]{.name}",
            "",
            "- [List]{.name}",
            "",
            '[**Aldric** Venn]{.wide .name data-type="being"}',
            "",
            '[Aldric [Venn][person]]{.name data-type="being"}',
            "",
            '[Ordinary]{.wide data-type="not-a-kind"}',
            "",
            '`[Literal]{.name data-type="wrong"}`',
            "",
            "```markdown",
            '[Fenced]{.name data-type="wrong"}',
            "```",
            "",
            "[person]: https://example.invalid/person",
        ].join("\n");
        const raw = note(
            {
                type: "lore",
                subType: "history",
                shortcode: "n0",
                name: { full: "Reader" },
                description: '[Frontmatter]{.name data-type="wrong"}',
            },
            body,
        ).replaceAll("\n", "\r\n");
        write(file, raw);
        const parsed = new Map();
        const problems = [];
        const records = indexRecordsFor({ config: input.config, parsed, problems });
        expect(problems).toEqual([]);
        const record = records.find((entry) => entry.shortcode === "n0");
        const expected = [
            ["Ravenmoor", "place", "settlement", "[Ravenmoor]"],
            ["Header", null, null, "[Header]"],
            ["Table", "lore", "history", "[Table]"],
            ["Quote", null, null, "[Quote]"],
            ["List", null, null, "[List]"],
            ["Aldric Venn", "being", null, "[**Aldric** Venn]"],
            ["Aldric Venn", "being", null, "[Aldric [Venn][person]]"],
        ].map(([name, type, subType, literal]) => ({
            name,
            type,
            subType,
            ...located(raw, literal),
        }));
        expect(record.names).toEqual(expected);
        expect(record.names[0].column).toBe(6);
        expect(
            records
                .filter((entry) => entry.documents)
                .every((entry) => !Object.hasOwn(entry, "names")),
        ).toBe(true);
        expect(records.find((entry) => entry.shortcode === "n1").names).toEqual([]);
        expect(authoredFrontmatter(record)).not.toHaveProperty("names");
        const html = renderFoundryMarkdown(parsed.get(file).body);
        expect(html).toContain('class="name" data-type="place/settlement"');
        expect(html).toContain("<strong>Aldric</strong> Venn");
        expect(html).toContain('Aldric <a href="https://example.invalid/person">Venn</a>');
        expect(html).toContain('class="wide" data-type="not-a-kind"');
        expect(fs.readFileSync(file, "utf8")).toBe(raw);
    });

    it("reports each invalid supplied attribute at its actual site and blocks publication", async () => {
        const input = typedFixture();
        const file = [...input.files.keys()][0];
        const raw = note(
            { type: "lore", subType: "history", shortcode: "n0", name: { full: "Reader" } },
            [
                '  😀 [Bad]{.name data-hint="data-type=wrong" data-type="wrong"}',
                "",
                '[Outer [Bad]{.name data-type="place/notdeclared"}]{.wide}',
                "",
                '[Ordinary]{.wide data-type="wrong"}',
            ].join("\n"),
        ).replaceAll("\n", "\r\n");
        write(file, raw);
        const session = await createContentSession({ config: input.config });
        try {
            expect(session.problems).toMatchObject([
                { file, ...located(raw, 'data-type="wrong"'), severity: "error" },
                { file, ...located(raw, 'data-type="place/notdeclared"'), severity: "error" },
            ]);
            expect(session.records.some((record) => record.shortcode === "n0")).toBe(false);
            expect(session.parsed.get(file).raw).toBe(raw);
            await expect(session.prepare(["index", "compile"])).rejects.toMatchObject({
                message: "Content preparation failed",
                findings: session.problems,
            });
        } finally {
            session.dispose();
        }
        const sentinel = path.join(input.config.paths.contentIndex, "sentinel.txt");
        write(sentinel, "Keep this output.\n");
        expect(() => emitContentIndex({ config: input.config })).toThrow("data-type");
        expect(fs.readdirSync(input.config.paths.contentIndex)).toEqual(["sentinel.txt"]);
        expect(fs.readFileSync(sentinel, "utf8")).toBe("Keep this output.\n");
    });

    it("publishes source occurrences once and never mines generated SQL or documentation", async () => {
        const input = typedFixture();
        const file = [...input.files.keys()][0];
        const raw = note(
            { type: "lore", subType: "history", shortcode: "n0", name: { full: "Reader" } },
            [
                '[Ravenmoor]{.name data-type="place/settlement"}',
                "",
                "```sql",
                `SELECT '[Generated]{.name data-type="being"}' AS Entry, count(*) AS Authored FROM names WHERE owner = 'sessionproof-note-lore-n0'`,
                "```",
            ].join("\n"),
        );
        write(file, raw);
        const native = [...input.files.keys()][2];
        const language =
            fs.readFileSync(native, "utf8") + '\n[Tongue Guest]{.name data-type="being"}\n';
        write(native, language);
        const publication = await prepareContentIndex({ config: input.config });
        const before = serializeContentIndex(publication.records);
        const output = emitContentIndex({ config: input.config, publication });
        const records = fs
            .readFileSync(output.file, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        const reader = records.find((record) => record.shortcode === "n0");
        expect(reader.names).toEqual([
            {
                name: "Ravenmoor",
                type: "place",
                subType: "settlement",
                ...located(raw, "[Ravenmoor]"),
            },
        ]);
        const own = records.filter((record) => record.shortcode === "tongue" && !record.documents);
        expect(own).toHaveLength(1);
        expect(own[0].names).toEqual([
            {
                name: "Tongue Guest",
                type: "being",
                subType: null,
                ...located(language, "[Tongue Guest]"),
            },
        ]);
        expect(
            records
                .filter((record) => record.documents)
                .every((record) => !Object.hasOwn(record, "names")),
        ).toBe(true);
        expect(
            records
                .flatMap((record) => record.names ?? [])
                .some((name) => name.name === "Generated"),
        ).toBe(false);
        expect(publication.expandedBodies.get(file).markdown).toContain("[Generated]");
        expect(publication.expandedBodies.get(file).markdown).toContain("Authored");
        const db = await openNotesDatabase(publication.records, {
            dependencies: [{ id: "mirror", file: output.file }],
            audience: "public",
        });
        try {
            const expected = [
                { owner: "sessionproof-note-lore-n0", ...reader.names[0] },
                { owner: "sessionproof-note-skill-tongue", ...own[0].names[0] },
            ].map((row) => ({ ...row, line: BigInt(row.line), column: BigInt(row.column) }));
            for (const relation of ["names", "mirror.names"])
                expect(
                    (
                        await db.query(
                            `SELECT * FROM ${relation} WHERE owner IN ('sessionproof-note-lore-n0', 'sessionproof-note-skill-tongue') ORDER BY owner, line, "column"`,
                        )
                    ).rows,
                ).toEqual(expected);
        } finally {
            await db.close();
        }
        expect(serializeContentIndex(publication.records)).toBe(before);
        expect(fs.readFileSync(file, "utf8")).toBe(raw);
        const again = emitContentIndex({ config: input.config, publication });
        expect(fs.readFileSync(again.file, "utf8")).toBe(fs.readFileSync(output.file, "utf8"));
    });

    it("threads configured bare types without changing Address type resolution", () => {
        const input = typedFixture();
        const config = defineConfig({
            rootDir: input.root,
            contentPackage: "namesproof",
            foundryPackage: "namesproof",
            packageKind: "modules",
            compatibility: { minimum: "14", verified: "14.367" },
            stats: { lastModifiedBy: "namesproof00000" },
            itemBuilders: { rune: () => ({}) },
            packs: [{ name: "journals", type: "JournalEntry", default: true }],
        });
        const contentBase = path.join(input.root, "custom");
        const file = path.join(contentBase, "Reader.md");
        write(
            file,
            note(
                { type: "lore", subType: "history", shortcode: "n0", name: { full: "Reader" } },
                '[Sigil]{.name data-type="rune"}',
            ),
        );
        const records = indexRecordsFor({ config, contentBase });
        expect(records.find((record) => record.shortcode === "n0").names[0]).toMatchObject({
            name: "Sigil",
            type: "rune",
            subType: null,
        });
        write(
            file,
            note(
                { type: "lore", subType: "history", shortcode: "n0", name: { full: "Reader" } },
                '[Sigil]{.name data-type="rune/ward"}',
            ),
        );
        expect(() => indexRecordsFor({ config, contentBase })).toThrow("declares no subtypes");
    });

    it("gives direct builders the same fields and refuses authored derived names", () => {
        const body = '😀 [Sigil]{.name data-type="rune"}';
        const raw = `---\r\nname: Reader\r\n---\r\n\r\n   ${body}\r\n`;
        const options = {
            frontmatter: { type: "doc", shortcode: "reader", name: { full: "Reader" } },
            contentPackage: "namesproof",
            relPath: "Reader.md",
            raw,
            body,
            bodyLine: 5,
            bodyColumn: 4,
            nameTypes: new Set(["rune"]),
        };
        const record = buildIndexRecord(options);
        expect(record.names).toEqual([
            {
                name: "Sigil",
                type: "rune",
                subType: null,
                ...located(raw, "[Sigil]"),
            },
        ]);
        expect(() =>
            buildIndexRecord({ ...options, frontmatter: { ...options.frontmatter, names: [] } }),
        ).toThrow("names");
    });
});
