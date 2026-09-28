/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import YAML from "yaml";
import { publishesContentPages } from "../content-config.mjs";
import { configFromData } from "../engine/pack-config.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(dir, entry.name);
        return (
            entry.isDirectory() ? sourceFiles(file)
            : entry.name.endsWith(".mjs") ? [file]
            : []
        );
    });
}

describe("publication is determined by the authored content tree", () => {
    it("locates a declared site mode at its YAML key", () => {
        const tree = fs.mkdtempSync(path.join(os.tmpdir(), "publish-config-"));
        const file = path.join(tree, "package-build.config.yaml");
        const source =
            "contentPackage: example\npackageKind: documentation\npublish:\n  site: content\n";
        try {
            fs.writeFileSync(
                path.join(tree, "package.json"),
                '{"name":"example","version":"1.0.0"}',
            );
            fs.writeFileSync(file, source);
            expect(() => configFromData(YAML.parse(source), file)).toThrow(
                `${file}:4:3: error: package-build config: \`publish.site\` is not configured; publishing follows the authored content tree.`,
            );
        } finally {
            fs.rmSync(tree, { recursive: true, force: true });
        }
    });

    it("recognizes content notes by type and respects skipped directories", () => {
        const tree = fs.mkdtempSync(path.join(os.tmpdir(), "publish-tree-"));
        const write = (name: string, type: string) => {
            const file = path.join(tree, name);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, `---\nshortcode: sample\ntype: ${type}\n---\n\nText.\n`);
        };
        const config = { paths: { content: tree }, skipDirectories: ["Hidden"] };
        try {
            write("FrontPage.md", "homepage");
            fs.writeFileSync(path.join(tree, "README.md"), "Ordinary Markdown.\n");
            write("Hidden/Secret.md", "lore");
            expect(publishesContentPages(config)).toBe(false);
            write("Lore/History.md", "lore");
            expect(publishesContentPages(config)).toBe(true);
        } finally {
            fs.rmSync(tree, { recursive: true, force: true });
        }
    });

    it("has no source module reading a configured site mode", () => {
        const files = [
            path.join(root, "content-config.mjs"),
            ...sourceFiles(path.join(root, "engine")),
            ...sourceFiles(path.join(root, "bin")),
        ];
        const reads = files.flatMap((file) => {
            const source = ts.createSourceFile(
                file,
                fs.readFileSync(file, "utf8"),
                ts.ScriptTarget.Latest,
                true,
                ts.ScriptKind.JS,
            );
            const locations: string[] = [];
            const visit = (node: ts.Node) => {
                const site =
                    ts.isPropertyAccessExpression(node) && node.name.text === "site" ?
                        node.expression
                    : (
                        ts.isElementAccessExpression(node) &&
                        ts.isStringLiteral(node.argumentExpression) &&
                        node.argumentExpression.text === "site"
                    ) ?
                        node.expression
                    :   null;
                if (
                    site &&
                    ((ts.isIdentifier(site) && site.text === "publish") ||
                        (ts.isPropertyAccessExpression(site) && site.name.text === "publish"))
                ) {
                    locations.push(
                        `${path.relative(root, file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`,
                    );
                }
                ts.forEachChild(node, visit);
            };
            visit(source);
            return locations;
        });
        expect(reads).toEqual([]);
    });
});
