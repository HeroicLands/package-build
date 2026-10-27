// SPDX-License-Identifier: GPL-3.0-or-later
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { encodingsFromRecords } from "../engine/encoding-notes.mjs";
import { markupFindings } from "../engine/markup-validation.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";
import { renderSitePage } from "../engine/site-build.mjs";
import { BasePackCompiler } from "../engine/base-compiler.mjs";
it("preserves encoding-document schema positions across lint, Foundry, site and book", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "encoding-targets-"));
    try {
        const file = path.join(root, "Encoding.md");
        const raw =
            "---\ntype: doc\ndata:\n  language: test\n  font: face\n  mappings: {a: UNKNOWN}\n  rules: {normalization: NFC, matching: longest-first}\n---\n";
        fs.writeFileSync(file, raw);
        const record = {
            type: "doc",
            shortcode: "bad",
            package: "demo",
            file,
            raw,
            data: {
                language: "test",
                font: "face",
                mappings: { a: "UNKNOWN" },
                rules: { normalization: "NFC", matching: "longest-first" },
            },
        };
        const fonts: any = {
            root,
            version: "1.0.0",
            manifest: {
                families: [{ class: "hl-face", codepoints: [{ codepoint: "U+03B1", code: "A" }] }],
            },
        };
        const loaded = encodingsFromRecords(
            [record],
            { contentPackage: "demo", languages: { test: { tag: "art-x-test" } } },
            fonts,
        );
        expect(loaded.findings).toHaveLength(1);
        const runs = { encodings: loaded.encodings, encodingFindings: loaded.findings };
        const body = "[a]{enc=bad} [b]{enc=bad}";
        const expected = { file, line: 6, column: 17, message: loaded.findings[0].message };
        expect(
            markupFindings(`---\nname: Source\n---\n\n${body}`, "note.md", undefined, runs),
        ).toEqual([expect.objectContaining(expected)]);
        const findings: any[] = [];
        markdownToTypst(body, { runs, file: "note.md", bodyLine: 40, bodyColumn: 8, findings });
        expect(findings).toEqual([expect.objectContaining(expected)]);
        markdownToTypst(body, { runs, file: "other.md", bodyLine: 80, findings });
        expect(findings).toHaveLength(1);
        const page = {
            file: "note.md",
            body,
            bodyLine: 40,
            fm: { type: "lore", name: { full: "Source" } },
            slug: "source",
            base: "note.md",
            url: "/source/",
        };
        const web = renderSitePage(page, {
            runs,
            index: {},
            foreign: { index: new Map() },
            config: { contentPackage: "demo" },
        });
        expect(web.secretErrors).toEqual([expect.objectContaining(expected)]);
        const compiler: any = Object.create(BasePackCompiler.prototype);
        compiler.constructor = { convertsWikilinks: false };
        compiler.currentNote = { absPath: "note.md", bodyLine: 40, bodyColumn: 8 };
        compiler.corpus = { runs };
        let captured: any[] = [];
        compiler.reportConvertBodyFindings = (errors: any[]) => {
            captured = errors;
        };
        compiler.convertBody({}, body);
        expect(captured).toEqual([expect.objectContaining(expected)]);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
