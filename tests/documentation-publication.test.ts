// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { configFromData } from "../engine/pack-config.mjs";
import { parseMarkdownFile } from "../engine/helpers.mjs";
import { documentationLinksPass } from "../engine/documentation-links.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configFile = path.join(root, "package-build.config.yaml");
const config = configFromData(YAML.parse(readFileSync(configFile, "utf8")), configFile);

function markdownFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(directory, entry.name);
        return (
            entry.isDirectory() ? markdownFiles(full)
            : entry.isFile() && entry.name.endsWith(".md") ? [full]
            : []
        );
    });
}

describe("package documentation publication", () => {
    it("uses the toolchain's namespace only for this repository's documentation", () => {
        expect(config.packageKind).toBe("documentation");
        expect(config.contentPackage).toBe("packagebuild");
        expect(config.paths.content).toBe(path.join(root, "docs"));
        expect(config.publish.site).toBe("content");
    });

    it("selects every authored guide and reference for the book exactly once", () => {
        const notes = markdownFiles(config.paths.content).map(
            (file) => parseMarkdownFile(file).frontmatter,
        );
        const docs = notes.filter((fm) => fm?.type === "doc");
        expect(notes.filter((fm) => fm?.type === "homepage")).toHaveLength(1);
        expect(docs).toHaveLength(markdownFiles(config.paths.content).length - 1);
        const book = YAML.parse(readFileSync(path.join(root, "book.yaml"), "utf8"));
        const selected = book.contents.flatMap((section: any) =>
            section.contents.map((entry: any) => /shortcode = '([^']+)'/.exec(entry.filter)?.[1]),
        );
        expect(selected.sort()).toEqual(docs.map((fm) => fm.shortcode).sort());
    });

    it("resolves repository-relative links for web pages and page-level book references", () => {
        const file = path.join(root, "docs", "getting-started.md");
        const text = "[Commands](commands.md#package-build-init-directory)";
        const web = documentationLinksPass({ config }).beforeLinks(text, { file });
        const book = documentationLinksPass({ config, book: true }).beforeLinks(text, { file });
        expect(web).toBe("[Commands](/packagebuild/doc-commands/#package-build-init-directory)");
        expect(book).toBe("[Commands](/packagebuild/doc-commands/)");
    });

    it("keeps every local Markdown link inside the addressable guide tree", () => {
        for (const file of markdownFiles(config.paths.content)) {
            const body = readFileSync(file, "utf8");
            for (const match of body.matchAll(/\[[^\]\n]+\]\(([^\s)]+\.md)(?:#[^\s)]*)?\)/g)) {
                const target = path.resolve(path.dirname(file), match[1]);
                expect(target.startsWith(`${config.paths.content}${path.sep}`), file).toBe(true);
                const fm = parseMarkdownFile(target).frontmatter;
                expect(fm?.type, target).toBe("doc");
                expect(fm?.shortcode, target).toMatch(/^[a-z0-9]+$/);
            }
        }
    });
});
