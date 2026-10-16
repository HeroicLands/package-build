/* SPDX-License-Identifier: GPL-3.0-or-later */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { collectContentIndex, emitContentIndex } from "../engine/content-index.mjs";
import { auditLinks, buildLinkIndex } from "../engine/content-links.mjs";
import { checkText } from "../engine/content-charset.mjs";
import { lintContentHtml } from "../engine/content-html.mjs";
import { lintContentImages } from "../engine/content-images.mjs";
import { lintContentTaskLists } from "../engine/content-tasklists.mjs";
import {
    frontmatterValueAt,
    positionInFrontmatter,
    positionOfFrontmatterPath,
    positionOfLiteral,
} from "../engine/diagnostics.mjs";
import { parseMarkdownFile } from "../engine/helpers.mjs";
import { buildJournalEntry } from "../engine/journals.mjs";
import { configFromData } from "../engine/pack-config.mjs";
import { frontmatterProcessor, lintYaml } from "../engine/yaml-lint.mjs";

const roots: string[] = [];
afterAll(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));
const body = "  😀 **Visible body.**\n\n## Known {#known}\n\nRead [[doc-target#known|Target]].\n";

function fixture(
    newline: string,
    sourceBody = body,
    description = "description: '😀 [[doc-frontmatter|Frontmatter]]'",
) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "crlf-frontmatter-"));
    roots.push(root);
    fs.writeFileSync(path.join(root, "package.json"), '{"name":"demo","version":"1.0.0"}');
    const config = configFromData(
        {
            contentPackage: "demo",
            packageKind: "modules",
            compatibility: { minimum: "14", verified: "14.367" },
            stats: { lastModifiedBy: "preflightbuild00" },
            skipDirectories: [],
            packs: [{ name: "journals", type: "JournalEntry", default: true }],
        },
        path.join(root, "package-build.config.yaml"),
    );
    fs.mkdirSync(config.paths.content, { recursive: true });
    const file = path.join(config.paths.content, "Sample.md");
    const raw = [
        "---",
        "type: doc",
        "subType: rules",
        "shortcode: sample",
        "name: {full: Sample}",
        description,
        "---",
        "",
        sourceBody,
    ]
        .join("\n")
        .replaceAll("\n", newline);
    fs.writeFileSync(file, raw);
    fs.writeFileSync(
        path.join(config.paths.content, "Target.md"),
        "---\ntype: doc\nsubType: rules\nshortcode: target\nname: {full: Target}\n---\n\n## Known {#known}\n\nA destination.\n",
    );
    return { root, config, file, raw };
}

function capture(repo: ReturnType<typeof fixture>) {
    const parsed = new Map();
    const problems: any[] = [];
    const records = collectContentIndex(repo.config.paths.content, {
        config: repo.config,
        contentPackage: "demo",
        skipDirectories: [],
        parsed,
        problems,
    });
    return { parsed, problems, records };
}

describe("frontmatter newline boundaries", () => {
    it.each(["\n", "\r\n"])("captures typed notes and original coordinates with %j", (newline) => {
        const repo = fixture(newline);
        const source = parseMarkdownFile(repo.file);
        expect(source.frontmatter?.type).toBe("doc");
        expect(source.raw).toBe(repo.raw);
        expect(source.body).toBe(body.replaceAll("\n", newline).trim());
        expect(source).toMatchObject({ bodyLine: 9, bodyColumn: 3 });
        expect(source.description).toContain("<strong>Visible body.</strong>");
        const captured = capture(repo);
        expect(captured.problems).toEqual([]);
        expect(captured.records.find((record) => record.shortcode === "sample")).toMatchObject({
            type: "doc",
            address: {
                slug: "doc-sample",
                canonical: { package: "demo", system: "note", type: "doc", shortcode: "sample" },
            },
        });
        expect(captured.parsed.get(repo.file)).toMatchObject({
            raw: repo.raw,
            bodyLine: 9,
            bodyColumn: 3,
        });
        expect(fs.readFileSync(repo.file, "utf8")).toBe(repo.raw);
        const carriageReturns = checkText(repo.raw, repo.file).filter((finding) =>
            finding.message.includes("U+000D"),
        );
        expect(carriageReturns.length).toBe(newline === "\n" ? 0 : repo.raw.split("\n").length - 1);
        expect(carriageReturns.every((finding) => finding.severity === "warning")).toBe(true);
    });

    it.each([
        ["name: [ }", 9, 8],
        ['name: ["😀", }', 14, 13],
    ])(
        "locates malformed CRLF YAML %j instead of treating it as scaffolding",
        async (entry, column, lintColumn) => {
            const repo = fixture("\r\n");
            const raw = `---\r\ntype: doc\r\nshortcode: sample\r\n${entry}\r\n---\r\n\r\nA body.\r\n`;
            fs.writeFileSync(repo.file, raw);
            const source = parseMarkdownFile(repo.file);
            expect(source.parseError).toMatchObject({ line: 4, column });
            expect(source.raw).toBe(raw);
            const captured = capture(repo);
            expect(captured.problems).toEqual([
                expect.objectContaining({ file: repo.file, line: 4, column, severity: "error" }),
            ]);
            expect(() =>
                collectContentIndex(repo.config.paths.content, {
                    contentPackage: "demo",
                    skipDirectories: [],
                }),
            ).toThrow(/YAML parse error/);
            expect(frontmatterProcessor.preprocess(raw)).toEqual([
                { text: `type: doc\r\nshortcode: sample\r\n${entry}`, filename: "0.yaml" },
            ]);
            const checked = await lintYaml(repo.root, { paths: [repo.file] });
            expect(checked.findings).toEqual([
                expect.objectContaining({
                    file: repo.file,
                    line: 4,
                    column: lintColumn,
                    severity: "error",
                }),
            ]);
        },
    );

    it("locates keys, values and paths within CRLF frontmatter", () => {
        const repo = fixture("\r\n");
        expect(positionInFrontmatter(repo.raw, "shortcode")).toEqual({ line: 4, column: 1 });
        expect(positionOfFrontmatterPath(repo.raw, ["name", "full"])).toEqual({
            line: 5,
            column: 14,
        });
        expect(positionOfFrontmatterPath(repo.raw, ["description"], { key: true })).toEqual({
            line: 6,
            column: 1,
        });
        expect(frontmatterValueAt(repo.raw, ["description"])).toBe(
            "😀 [[doc-frontmatter|Frontmatter]]",
        );
    });

    it("keeps frontmatter links out of body links on cached and file-backed paths", () => {
        const repo = fixture("\r\n");
        const source = capture(repo);
        const options = { config: repo.config, records: source.records, skipDirectories: [] };
        const cached = buildLinkIndex(repo.config.paths.content, {
            ...options,
            parsed: source.parsed,
        });
        const fallback = buildLinkIndex(repo.config.paths.content, options);
        const view = (index: any) => {
            const note = index.notes.find((one: any) => one.rel === "Sample.md");
            return {
                raw: note.raw,
                body: note.body,
                links: index.linksOf(note),
                frontmatter: index.frontmatterLinks
                    .filter((one: any) => one.note === note)
                    .map(({ note: _, ...one }: any) => one),
            };
        };
        const observed = view(cached);
        expect(observed).toEqual(view(fallback));
        expect(observed.raw).toBe(repo.raw);
        expect(observed.body.startsWith("\r\n  😀")).toBe(true);
        expect(observed.links.map((link: any) => link.target)).toEqual([
            { package: "demo", system: "note", type: "doc", shortcode: "target" },
        ]);
        expect(observed.frontmatter).toHaveLength(1);
        expect(auditLinks(cached).deadAnchors).toEqual([]);
    });

    it("scans only CRLF body HTML, image attributes and task markers at exact source positions", () => {
        const content =
            "  😀 <b>Body HTML</b>\n\n![Body](https://example.invalid/body.webp){.fullwidth}\n\n  - [ ] Body task.\n";
        const description =
            "description: |\n  <i>Frontmatter HTML</i>\n  ![Frontmatter](https://example.invalid/front.webp){.fullwidth}\n  - [ ] Frontmatter task.";
        const repo = fixture("\r\n", content, description);
        const options = { skipDirectories: [] };
        const html = lintContentHtml(repo.config.paths.content, options).findings;
        expect(html).toEqual([
            expect.objectContaining({ ...positionOfLiteral(repo.raw, "<b>"), severity: "warning" }),
            expect.objectContaining({
                ...positionOfLiteral(repo.raw, "</b>"),
                severity: "warning",
            }),
        ]);
        const images = lintContentImages(repo.config.paths.content, {
            ...options,
            config: repo.config,
        }).findings;
        expect(images).toEqual([
            expect.objectContaining({
                ...positionOfLiteral(repo.raw, "{.fullwidth}", 2),
                severity: "error",
            }),
        ]);
        const tasks = lintContentTaskLists(repo.config.paths.content, options).findings;
        expect(tasks).toEqual([
            expect.objectContaining({
                ...positionOfLiteral(repo.raw, "- [ ] Body"),
                severity: "warning",
            }),
        ]);
    });

    it("publishes a CRLF typed note with real journal body and matching anchor target", () => {
        const repo = fixture("\r\n");
        const published = emitContentIndex({ config: repo.config });
        const records = fs
            .readFileSync(published.file, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        const record = records.find((one) => one.shortcode === "sample");
        expect(record).toMatchObject({
            type: "doc",
            address: {
                canonical: { address: "demo-note-doc-sample", anchor: null, anchorKind: null },
            },
        });
        const journal = buildJournalEntry({
            id: record.id,
            name: record.name.full,
            markdown: parseMarkdownFile(repo.file).body,
        });
        expect(journal.pages.map((page: any) => page.text.content).join("\n")).toContain(
            "<strong>Visible body.</strong>",
        );
        const target = record.foundry.note.anchors.known;
        expect(
            journal.pages.some((page: any) => target.endsWith(`JournalEntryPage.${page._id}`)),
        ).toBe(true);
        expect(fs.readFileSync(repo.file, "utf8")).toBe(repo.raw);
    });
});
