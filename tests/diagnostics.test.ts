/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";

// Build-time pack helpers (plain ESM, no Foundry). Imported by relative path
// because the pack-build scripts live outside the `@src` alias tree.
import {
    formatDiagnostic,
    emitDiagnostic,
    positionInBody,
    positionInFrontmatter,
} from "../engine/diagnostics.mjs";

describe("formatDiagnostic — the compiler-style locator", () => {
    // The whole point of the format: a line a tool can parse without being
    // told anything about this build. `file:line:column: severity: message` is
    // what every C-family compiler, ESLint and tsc emit, so an editor's error
    // matcher already understands it.
    it("emits file:line:column: severity: message", () => {
        expect(
            formatDiagnostic({
                file: "notes/Capital.md",
                line: 12,
                column: 5,
                severity: "warning",
                message: "unresolved wikilink [[Kenbet_Pat]]",
            }),
        ).toBe("notes/Capital.md:12:5: warning: unresolved wikilink [[Kenbet_Pat]]");
    });

    it("degrades one field at a time rather than inventing a position", () => {
        const base = { file: "a.md", severity: "error", message: "boom" };
        expect(formatDiagnostic({ ...base, line: 3 })).toBe("a.md:3: error: boom");
        expect(formatDiagnostic(base)).toBe("a.md: error: boom");
        // A column without a line cannot be placed, so it is dropped with it.
        expect(formatDiagnostic({ ...base, column: 9 })).toBe("a.md: error: boom");
        expect(formatDiagnostic({ severity: "error", message: "boom" })).toBe("error: boom");
    });

    it("reports a path relative to the working directory", () => {
        // Absolute paths are what the walk carries; a relative one is both
        // shorter to read and what an editor resolves against the task cwd.
        expect(
            formatDiagnostic({
                file: path.join(process.cwd(), "assets/content/A.md"),
                line: 1,
                column: 1,
                severity: "warning",
                message: "x",
            }),
        ).toBe("assets/content/A.md:1:1: warning: x");
    });

    it("leaves a path outside the working directory absolute", () => {
        const outside = path.resolve("/tmp/elsewhere/A.md");
        expect(
            formatDiagnostic({
                file: outside,
                severity: "warning",
                message: "x",
            }),
        ).toBe(`${outside}: warning: x`);
    });
});

describe("emitDiagnostic", () => {
    let warn: any;
    let error: any;

    beforeEach(() => {
        warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        error = vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => vi.restoreAllMocks());

    // The build's other lines carry a `[timestamp] [WARN]:` prefix from
    // loglevel. A diagnostic must not: the prefix sits where a parser expects
    // the path, so it would swallow the locator it exists to expose.
    it("writes the bare formatted line, with no log prefix", () => {
        emitDiagnostic({
            file: "a.md",
            line: 2,
            column: 3,
            severity: "warning",
            message: "hi",
        });
        expect(warn).toHaveBeenCalledWith("a.md:2:3: warning: hi");
        expect(error).not.toHaveBeenCalled();
    });

    it("routes an error to stderr", () => {
        emitDiagnostic({ file: "a.md", severity: "error", message: "bad" });
        expect(error).toHaveBeenCalledWith("a.md: error: bad");
    });
});

describe("positionInBody — an offset becomes a file position", () => {
    const body = "line one\nline two has [[a link]] in it\nline three";

    it("counts lines and columns from one", () => {
        expect(positionInBody(body, 0)).toMatchObject({ line: 1, column: 1 });
        expect(positionInBody(body, body.indexOf("[[a link]]"))).toMatchObject({
            line: 2,
            column: 14,
        });
    });

    it("shifts by where the body starts in the file", () => {
        // A note's body is what follows the frontmatter, so an offset within
        // it is not a file line until the frontmatter's own lines are added.
        expect(positionInBody(body, body.indexOf("[[a link]]"), { bodyLine: 9 })).toMatchObject({
            line: 10,
            column: 14,
        });
    });

    it("applies the body's starting column to its first line only", () => {
        // `parseMarkdownFile` trims the body, so its first line may have lost
        // indentation the file still has. Later lines are untouched.
        expect(positionInBody(body, 0, { bodyLine: 4, bodyColumn: 5 })).toMatchObject({
            line: 4,
            column: 5,
        });
        expect(
            positionInBody(body, body.indexOf("line three"), {
                bodyLine: 4,
                bodyColumn: 5,
            }),
        ).toMatchObject({ line: 6, column: 1 });
    });

    it("maps through a line map, and marks a generated line", () => {
        // Table expansion rewrites the body it scans, so an offset in the
        // scanned text is not an authored position until it is mapped back.
        const lineMap = [
            { line: 0, generated: false },
            { line: 7, generated: true },
            { line: 9, generated: false },
        ];
        expect(positionInBody(body, 0, { lineMap })).toMatchObject({
            line: 1,
            column: 1,
            generated: false,
        });
        // A generated line has no authored column — only the directive's line.
        expect(positionInBody(body, body.indexOf("[[a link]]"), { lineMap })).toMatchObject({
            line: 8,
            generated: true,
            column: undefined,
        });
        expect(positionInBody(body, body.indexOf("line three"), { lineMap })).toMatchObject({
            line: 10,
            generated: false,
            column: 1,
        });
    });
});

/* ---------------------------------------------------------------------- */
/*  Plumbing: what has to travel for a position to be knowable at all      */
/* ---------------------------------------------------------------------- */

import fs from "node:fs";
import os from "node:os";
import { parseMarkdownFile } from "../engine/helpers.mjs";
import { expandContentTables } from "../engine/content-tables.mjs";
import { convertWikilinks, buildWikilinkIndex } from "../engine/wikilinks.mjs";

describe("parseMarkdownFile reports where the body starts", () => {
    let tmp: string;
    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cb-diag-"));
    });
    afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

    /** Writes `text` to a note and parses it. */
    function parse(text: string): any {
        const file = path.join(tmp, "Note.md");
        fs.writeFileSync(file, text);
        return parseMarkdownFile(file);
    }

    it("counts the frontmatter's lines", () => {
        // ---(1) type(2) ---(3) blank(4) body(5)
        const out = parse("---\ntype: doc\n---\n\nThe body.\n");
        expect(out.body).toBe("The body.");
        expect(out.bodyLine).toBe(5);
        expect(out.bodyColumn).toBe(1);
    });

    it("accounts for the blank lines the trim removes", () => {
        const out = parse("---\ntype: doc\n---\n\n\n\nThe body.\n");
        expect(out.bodyLine).toBe(7);
    });

    it("accounts for indentation the trim removes from the first line", () => {
        const out = parse("---\ntype: doc\n---\n\n    Indented.\n");
        expect(out.bodyLine).toBe(5);
        expect(out.bodyColumn).toBe(5);
    });

    it("reports nothing for a note with no frontmatter", () => {
        const out = parse("No frontmatter here.\n");
        expect(out.frontmatter).toBeNull();
        expect(out.bodyLine).toBeUndefined();
    });
});

describe("expandContentTables reports where its output came from", () => {
    // Without this the whole position chain breaks the moment a note has a
    // table: the body wikilinks are scanned in is not the body that was
    // authored, so every offset after an expansion is off by the rows added.
    const NOTE = [
        "Before the table.", // body line 0
        "", // 1
        "```dataview", // 2
        "TABLE name", // 3
        "FROM #doc", // 4
        "```", // 5
        "", // 6
        "After the table.", // 7
    ].join("\n");

    it("maps every emitted line back to the line it came from", () => {
        const { markdown, lineMap } = expandContentTables(NOTE, {
            docs: [],
            source: "Probe",
        });
        const out = markdown.split("\n");
        expect(lineMap).toHaveLength(out.length);
        // The authored lines keep their own identity...
        expect(lineMap[0]).toEqual({ line: 0, generated: false });
        expect(lineMap[lineMap.length - 1]).toEqual({
            line: 7,
            generated: false,
        });
        // ...and the "After" line is still findable at its authored number
        // however many rows the table grew to.
        const after = out.indexOf("After the table.");
        expect(lineMap[after]).toEqual({ line: 7, generated: false });
    });

    it("marks a generated row, and blames the directive that made it", () => {
        const { markdown, lineMap } = expandContentTables(NOTE, {
            docs: [],
            source: "Probe",
        });
        const generated = markdown
            .split("\n")
            .map((_line, i) => lineMap[i])
            .filter((entry: any) => entry.generated);
        expect(generated.length).toBeGreaterThan(0);
        // The fence opens on body line 2 — the thing an author can actually
        // edit. A generated row is not at any authored line of its own.
        for (const entry of generated) expect(entry.line).toBe(2);
    });

    it("maps one-to-one when the note has no table at all", () => {
        const plain = "One\nTwo\nThree";
        const { markdown, lineMap } = expandContentTables(plain, { docs: [] });
        expect(markdown).toBe(plain);
        expect(lineMap).toEqual([
            { line: 0, generated: false },
            { line: 1, generated: false },
            { line: 2, generated: false },
        ]);
    });
});

describe("convertWikilinks records where each unresolved link sat", () => {
    const index = buildWikilinkIndex([], "sohl", new Map(), "sohl");

    it("carries the offset of the link it could not resolve", () => {
        const body = "prose\nmore [[Nowhere]] prose";
        const { unresolved } = convertWikilinks(body, {
            type: "doc",
            id: "aaaaaaaaaaaaaaa1",
            index,
        });
        expect(unresolved).toHaveLength(1);
        expect(unresolved[0].offset).toBe(body.indexOf("[[Nowhere]]"));
    });

    it("distinguishes repeated identical links by offset", () => {
        // The symptom that started this: four warnings on one note, all
        // reading the same, none of them findable.
        const body = "[[Nowhere]] and\n[[Nowhere]] again";
        const { unresolved } = convertWikilinks(body, {
            type: "doc",
            id: "aaaaaaaaaaaaaaa1",
            index,
        });
        expect(unresolved.map((u: any) => u.offset)).toEqual([0, body.lastIndexOf("[[Nowhere]]")]);
    });
});

/* ---------------------------------------------------------------------- */
/*  End to end: what an author actually sees                              */
/* ---------------------------------------------------------------------- */

import { BasePackCompiler } from "../engine/base-compiler.mjs";

/** A minimal pass, as `base-compiler.test.ts` defines one. */
class Probe extends BasePackCompiler {
    static override id = "probes";
    static override label = "probe";

    override selects(fm: any): boolean {
        return fm.type === "probe";
    }

    override buildEntry(fm: any, markdown: string): any {
        return {
            name: fm.name.full,
            _id: fm.id,
            body: markdown,
            folder: this.folderResolver(null),
            _key: `!probes!${fm.id}`,
        };
    }
}

describe("an unresolved wikilink names the file, line and column", () => {
    let tmp: string;

    /**
     * The note that reproduces the reported symptom: identical links, which
     * are indistinguishable unless each is reported at its own position.
     *
     * Both are addresses that resolve nowhere. A compile fails the note on the
     * first one it meets, so each is compiled on its own here — what #17 is
     * about is that the position reported is the *link's*, not the note's.
     */
    const line = (n: number) =>
        [
            "---",
            'name: { "full": "The Capital Nome" }',
            'id: "PROBEPROBE000001"',
            'shortcode: "capital"',
            'type: "probe"',
            "---",
            "",
            n === 1 ? "The nome is administered from [[probe-nosuch|Kenbet Pat]]." : "",
            "",
            n === 2 ? "Its court, the [[probe-nosuch|Kenbet Pat]], sits there." : "",
            "",
        ].join("\n");

    /** Compile a one-note tree and return whatever it reported. */
    async function compile(body: string): Promise<string[]> {
        const out: string[] = [];
        const content = path.join(tmp, `c${out.length}-${Math.random()}`);
        fs.mkdirSync(content, { recursive: true });
        fs.writeFileSync(path.join(content, "Capital.md"), body);
        const spy = vi
            .spyOn(console, "error")
            .mockImplementation((l: any) => void out.push(String(l)));
        const dest = path.join(content, "probes");
        fs.mkdirSync(dest, { recursive: true });
        try {
            await new Probe({ contentBase: content, dest }).compile();
        } finally {
            spy.mockRestore();
        }
        return out;
    }

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cb-diag-e2e-"));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("reports each link at its own line and column", async () => {
        const first = await compile(line(1));
        const second = await compile(line(2));
        // Line 8, column 31 and line 10, column 16 — the positions of the two
        // links in their respective bodies, counted from the file's start.
        expect(first).toEqual([expect.stringContaining("Capital.md:8:31: error: ")]);
        expect(second).toEqual([expect.stringContaining("Capital.md:10:16: error: ")]);
    });

    it("still says what is wrong, and about which link", async () => {
        const [only] = await compile(line(1));
        // The message names the **address**, not the whole authored link: the
        // label is not at fault, and it is the same message the link checker
        // and the site build report through (#184). The position, already
        // asserted above, is what locates the exact link on the line.
        expect(only).toContain("resolves to no note");
        expect(only).toContain("[[probe-nosuch]]");
        // And the note it sits in, which is the pack build's own context.
        expect(only).toContain("The Capital Nome");
    });

    it("carries no log prefix ahead of the path", async () => {
        // A `[timestamp] [ERROR]:` prefix sits exactly where a parser reads the
        // filename from, so the line must begin with the path itself.
        for (const l of await compile(line(1))) {
            expect(l).toMatch(/^[^\s]*Capital\.md:\d+:\d+: error: /);
        }
    });
});

describe("positionInFrontmatter — where a key is declared", () => {
    const raw = [
        "---",
        "name:",
        "  full: Aconite",
        "type: affliction",
        "shortcode: aconite",
        "aliases:",
        "  - affliction-aconite",
        "  - Wolfsbane",
        "---",
        "",
        "Body prose that also mentions type: here.",
        "",
    ].join("\n");

    it("locates a top-level key, counting the opening fence", () => {
        // File line 1 is `---`, so the block's first line is file line 2.
        expect(positionInFrontmatter(raw, "shortcode")).toEqual({
            line: 5,
            column: 1,
        });
    });

    // A bare search would match the first occurrence anywhere in the file,
    // which for a key like `type` is routinely a line of prose.
    it("does not escape into the body", () => {
        expect(positionInFrontmatter(raw, "type")).toEqual({
            line: 4,
            column: 1,
        });
    });

    it("locates a list entry when one is named", () => {
        expect(positionInFrontmatter(raw, "aliases", "Wolfsbane")).toEqual({
            line: 8,
            column: 5,
        });
    });

    it("drops the position rather than guessing it", () => {
        expect(positionInFrontmatter(raw, "nosuchkey")).toEqual({});
        expect(positionInFrontmatter("no frontmatter here", "type")).toEqual({});
        expect(positionInFrontmatter(undefined as never, "type")).toEqual({});
    });

    it("is not fooled by a key that is a prefix of another", () => {
        const doc = ["---", "shortcodeExtra: x", "shortcode: y", "---", ""].join("\n");
        expect(positionInFrontmatter(doc, "shortcode")).toEqual({
            line: 3,
            column: 1,
        });
    });
});
