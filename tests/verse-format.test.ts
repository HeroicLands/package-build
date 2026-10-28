/* SPDX-License-Identifier: GPL-3.0-or-later */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkFormatting } from "../engine/prose-lint.mjs";

let root: string;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "verse-format-"));
});
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});
const note = (source: string) => {
    const file = path.join(root, "note.md");
    fs.writeFileSync(file, source);
    return file;
};

describe("verse source formatting", () => {
    it.each(["::: {.verse   lang=en}", ":::verse {lang=en}"])(
        "preserves the complete %s region while formatting prose",
        async (opening) => {
            const verse = `${opening}\nA   word/..Another   word//\n- literal   line/\n    # more text\n:::`;
            const file = note(`Before   *word*.\n\n${verse}\n\nAfter   *word*.\n`);
            const result = await checkFormatting(root, { write: true });
            expect(result.findings).toEqual([]);
            expect(fs.readFileSync(file, "utf8")).toBe(
                `Before _word_.\n\n${verse}\n\nAfter _word_.\n`,
            );
            expect((await checkFormatting(root)).findings).toEqual([]);
            expect((await checkFormatting(root, { write: true })).written).toEqual([]);
        },
    );
    it("preserves multiple balanced inline quotations and all their attributes", async () => {
        const first = "[A   [speaker]{.speaker}/..another//]{.verse   lang=en}";
        const second = "[a source\n  line/..another]{.verse}";
        const file = note(`Before   *word* ${first}, and ${second}.\n`);
        const result = await checkFormatting(root, { write: true });
        expect(result.findings).toEqual([]);
        const out = fs.readFileSync(file, "utf8");
        expect(out).toContain(first);
        expect(out).toContain(second);
        expect(out).toContain("Before _word_");
        expect((await checkFormatting(root)).findings).toEqual([]);
    });
    it("preserves adjacent quotations and distinct placeholders beyond ten spans", async () => {
        const quotes = Array.from({ length: 12 }, (_, index) => `[A   ${index}/B]{.verse}`);
        const source = `before${quotes.join("and")}after.\n`;
        const file = note(source);
        expect((await checkFormatting(root, { write: true })).findings).toEqual([]);
        for (const quote of quotes) expect(fs.readFileSync(file, "utf8")).toContain(quote);
        expect((await checkFormatting(root)).findings).toEqual([]);
    });
    it("protects original CRLF verse bytes and literal code examples", async () => {
        const verse = "::: {.verse   lang=en}\r\nA   word/\r\n..Another\r\n:::\r\n";
        const literal = "```text\n::: {.verse}\nA   word/\n:::\n```";
        const file = note(`Before   *word*.\n\n${verse}\n${literal}\n`);
        expect((await checkFormatting(root, { write: true })).findings).toEqual([]);
        expect(fs.readFileSync(file, "utf8")).toContain(verse);
        expect(fs.readFileSync(file, "utf8")).toContain(literal);
        expect((await checkFormatting(root)).findings).toEqual([]);
    });
    it("protects verse through every write fixpoint pass and check pass", async () => {
        const quote = "[A   word/..Another]{.verse   lang=en}";
        const file = note(`Before   word ${quote}.\n`);
        const inputs: string[] = [];
        const prettier = {
            getFileInfo: async () => ({ ignored: false, inferredParser: "markdown" }),
            resolveConfig: async () => null,
            format: async (input: string) => {
                inputs.push(input);
                return input.replace("Before   word", "Before word");
            },
        };
        expect((await checkFormatting(root, { write: true, prettier })).findings).toEqual([]);
        expect(inputs.length).toBeGreaterThan(1);
        expect((await checkFormatting(root, { prettier })).findings).toEqual([]);
        for (const input of inputs) expect(input).not.toContain(".verse");
        expect(fs.readFileSync(file, "utf8")).toContain(quote);
    });
    it.each(["[One\n\nTwo]{.verse}", "One]{.verse}", "[One]{.verse"])(
        "refuses malformed inline verse %s without rewriting",
        async (quote) => {
            const source = `Before   *word* ${quote}\n`;
            const file = note(source);
            const result = await checkFormatting(root, { write: true });
            expect(result.findings.length).toBeGreaterThan(0);
            expect(result.written).toEqual([]);
            expect(fs.readFileSync(file, "utf8")).toBe(source);
        },
    );
    it("leaves a malformed verse file untouched", async () => {
        const source = "Before   *word*.\n\n::: {.verse}\nA/line\n";
        const file = note(source);
        const result = await checkFormatting(root, { write: true });
        expect(result.findings.length).toBeGreaterThan(0);
        expect(result.written).toEqual([]);
        expect(fs.readFileSync(file, "utf8")).toBe(source);
    });
});
