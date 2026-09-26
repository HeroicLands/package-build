/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import {
    ContentWorkspace,
    respond,
    runLanguageServer,
} from "../engine/content-language-server.mjs";

let root: string;
let workspace: ContentWorkspace;

function note(file: string, text: string): string {
    const full = path.join(root, "assets/content", file);
    fs.writeFileSync(full, text);
    return pathToFileURL(full).href;
}

function index(records: object[]): void {
    fs.writeFileSync(
        path.join(root, "build/content-index/test-metadata.jsonl"),
        records.map((record) => JSON.stringify(record)).join("\n") + "\n",
    );
}

const alpha = {
    package: "test",
    type: "lore",
    shortcode: "alpha",
    name: { full: "Ályra", aliases: ["First Light"] },
    nameAscii: "Alyra",
    aliasesAscii: ["First Light"],
    tags: ["myth"],
    address: { slug: "lore-alpha", canonical: "test-none-lore-alpha" },
    anchors: [{ slug: "history", line: 7, name: "History" }],
    file: { path: "Alpha.md" },
};

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "heroiclands-lsp-"));
    fs.mkdirSync(path.join(root, "assets/content"), { recursive: true });
    fs.mkdirSync(path.join(root, "build/content-index"), { recursive: true });
    workspace = new ContentWorkspace({
        contentPackage: "test",
        paths: {
            content: path.join(root, "assets/content"),
            assets: path.join(root, "assets"),
            contentIndex: path.join(root, "build/content-index"),
        },
    } as any);
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("content language server", () => {
    it("searches indexed names, aliases, shortcodes, and tags once per note", () => {
        note("Alpha.md", "---\ntype: lore\nshortcode: alpha\n---\nÁlyra\n");
        index([alpha, { ...alpha, type: "doclore" }]);
        expect(workspace.symbols("alyra")).toHaveLength(1);
        expect(workspace.symbols("first light")).toHaveLength(1);
        expect(workspace.symbols("lore-alpha")).toHaveLength(1);
        expect(workspace.symbols("tag:myth")).toHaveLength(1);
        expect(workspace.symbols("tag:other")).toHaveLength(0);
    });

    it("finds indexed draft and stub notes without published addresses", () => {
        note("Stub.md", "---\ntype: lore\nshortcode: stub\n---\n");
        index([
            {
                ...alpha,
                name: { full: "Unwritten Legend" },
                address: null,
                file: { path: "Stub.md" },
            },
        ]);
        expect(workspace.symbols("unwritten")).toHaveLength(1);
    });

    it("follows an indexed anchor from an unsaved buffer", () => {
        note("Alpha.md", "One\nTwo\nThree\nFour\nFive\nSix\nHistory\n");
        const source = note("Source.md", "See [[lore-alpha#history|Ályra]].\n");
        index([alpha]);
        respond(workspace, {
            method: "textDocument/didOpen",
            params: {
                textDocument: { uri: source, text: "See [[lore-alpha#history|Ályra]] and more.\n" },
            },
        });
        expect(workspace.definition(source, { line: 0, character: 10 })?.range.start).toEqual({
            line: 6,
            character: 0,
        });
    });

    it("follows a same-note anchor", () => {
        const source = note(
            "Alpha.md",
            "See [[#history|History]].\n\nOne\nTwo\nThree\nFour\nHistory\n",
        );
        index([alpha]);
        expect(workspace.definition(source, { line: 0, character: 9 })?.range.start).toEqual({
            line: 6,
            character: 0,
        });
    });

    it("finds actual links, excluding prose and unrelated frontmatter", () => {
        const target = note("Alpha.md", "---\ntype: lore\nshortcode: alpha\n---\nÁlyra\n");
        note(
            "Source.md",
            "---\ntype: lore\nshortcode: source\n---\nSee [[lore-alpha|Ályra]]. lore-alpha is prose.\n",
        );
        index([alpha]);
        expect(workspace.references(target, { line: 2, character: 12 })).toEqual([
            expect.objectContaining({
                range: { start: { line: 4, character: 6 }, end: { line: 4, character: 16 } },
            }),
        ]);
    });

    it("counts embeds but excludes links written as code examples", () => {
        const target = note("Icon.md", "---\ntype: icon\nshortcode: sun\n---\n");
        note(
            "Source.md",
            "![[icon-sun|Sun]]\n\n```markdown\n![[icon-sun|Example]]\n[[icon-sun|Example]]\n```\n",
        );
        index([
            {
                ...alpha,
                type: "icon",
                shortcode: "sun",
                name: { full: "Sun" },
                address: { slug: "icon-sun", canonical: "test-none-icon-sun" },
                file: { path: "Icon.md" },
            },
        ]);
        expect(workspace.references(target, { line: 2, character: 13 })).toEqual([
            expect.objectContaining({
                range: { start: { line: 0, character: 3 }, end: { line: 0, character: 11 } },
            }),
        ]);
    });

    it("opens indexed assets from the asset root", () => {
        const source = note("Source.md", "![[icon-sun|Sun]]\n");
        const asset = path.join(root, "assets/icons/sun.webp");
        fs.mkdirSync(path.dirname(asset), { recursive: true });
        fs.writeFileSync(asset, "image bytes");
        index([
            {
                package: "test",
                type: "icon",
                shortcode: "sun",
                address: { canonical: "test-none-icon-sun" },
                asset: { path: "icons/sun.webp" },
            },
        ]);
        expect(workspace.definition(source, { line: 0, character: 7 })?.uri).toBe(
            pathToFileURL(asset).href,
        );
    });

    it("finds declared Address keys in frontmatter", () => {
        const target = note("Guild.md", "---\ntype: affiliation\nshortcode: guild\n---\nGuild.\n");
        note(
            "Ally.md",
            "---\ntype: affiliation\nshortcode: ally\ndata:\n  relations:\n    guild: ally\n---\nThe guild is nearby.\n",
        );
        index([
            {
                ...alpha,
                type: "docaffiliation",
                shortcode: "guild",
                address: { slug: "affiliation-guild", canonical: "test-none-docaffiliation-guild" },
                file: { path: "Guild.md" },
            },
        ]);
        expect(workspace.references(target, { line: 2, character: 13 })).toEqual([
            expect.objectContaining({
                range: { start: { line: 5, character: 4 }, end: { line: 5, character: 9 } },
            }),
        ]);
    });

    it("reloads the index after a completed rebuild", () => {
        note("Alpha.md", "---\ntype: lore\nshortcode: alpha\n---\nÁlyra\n");
        index([alpha]);
        expect(workspace.symbols("alpha")).toHaveLength(1);
        index([{ ...alpha, name: { full: "Changed" } }, alpha]);
        expect(workspace.symbols("changed")).toHaveLength(1);
    });

    it("reports a missing index with the rebuild command", () => {
        expect(() => workspace.symbols("alpha")).toThrow("content-build content-index");
    });

    it("accepts framed JSON-RPC requests split across input chunks", () => {
        note("Alpha.md", "---\ntype: lore\nshortcode: alpha\n---\nÁlyra\n");
        index([alpha]);
        const input = new PassThrough();
        const output = new PassThrough();
        let reply = "";
        output.on("data", (chunk) => {
            reply += chunk.toString();
        });
        runLanguageServer(input, output, workspace);
        const body = JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "workspace/symbol",
            params: { query: "Alyra" },
        });
        const frame = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
        input.write(frame.slice(0, 9));
        input.write(frame.slice(9));
        expect(reply).toContain('"id":1');
        expect(reply).toContain('"name":"Ályra"');
    });
});
