/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const skipped = new Set([".git", "build", "node_modules", "nogit", "types", "assets", "fixtures"]);
// Every spelling of `#` a string literal or a comment can carry: the character or an escape for it.
const MAY_CONTAIN_HASH = /#|\\x23|\\u0*23(?![0-9a-f])|\\u\{0*23\}|\\0*43(?![0-7])/i;
const ISSUE = /(?:[\w.-]+\/)?[\w.-]*#\d+\b/g;

function sources(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (skipped.has(entry.name)) return [];
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) return sources(file);
        return /\.(?:mjs|js|ts)$/.test(entry.name) ? [file] : [];
    });
}

describe("source prose", () => {
    it("states rules without tracker citations in comments or test titles", () => {
        const citations: string[] = [];
        for (const file of sources(root)) {
            const source = fs.readFileSync(file, "utf8");
            const scanner = ts.createScanner(
                ts.ScriptTarget.Latest,
                false,
                ts.LanguageVariant.Standard,
                // A comment cannot escape its characters, so a citation in one is a literal `#<digits>`.
                /#\d/.test(source) ? source : "",
            );
            for (
                let token = scanner.scan();
                token !== ts.SyntaxKind.EndOfFileToken;
                token = scanner.scan()
            ) {
                if (
                    token !== ts.SyntaxKind.SingleLineCommentTrivia &&
                    token !== ts.SyntaxKind.MultiLineCommentTrivia
                )
                    continue;
                for (const match of scanner.getTokenText().matchAll(ISSUE))
                    citations.push(`${path.relative(root, file)}:${match[0]}`);
            }
            if (!file.includes(`${path.sep}tests${path.sep}`)) continue;
            if (!MAY_CONTAIN_HASH.test(source)) continue;
            const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
            const visit = (node: ts.Node) => {
                if (
                    ts.isCallExpression(node) &&
                    ts.isIdentifier(node.expression) &&
                    ["it", "test", "describe"].includes(node.expression.text) &&
                    node.arguments.length &&
                    ts.isStringLiteral(node.arguments[0])
                ) {
                    for (const match of node.arguments[0].text.matchAll(ISSUE))
                        citations.push(`${path.relative(root, file)}:${match[0]}`);
                }
                ts.forEachChild(node, visit);
            };
            visit(tree);
        }
        expect(citations).toEqual([]);
        // The time goes to scanning and parsing every source file in the package.
    }, 20_000);
});
