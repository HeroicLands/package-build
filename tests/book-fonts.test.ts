/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The book is set in faces the toolchain ships, not in whatever the machine
 * happens to carry.
 *
 * The families are read out of the renderer's own emitted source rather than
 * listed here, so naming a default the package does not ship fails these cases
 * instead of falling back to another face at compile time — which is what the
 * failure looks like in a PDF: silent, and only visible to someone comparing
 * two builds side by side.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { describe, it, expect } from "vitest";

import { BOOK_FONTS_PATH, compileTypst, typstArgs, typstWarnings } from "../engine/pdf-build.mjs";
import { renderBook } from "../engine/pdf-render.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** Whether a Typst compiler is reachable, which the resolution cases need. */
const HAS_TYPST = spawnSync("typst", ["--version"], { encoding: "utf8" }).status === 0;

/** A one-entry plan, enough to make the renderer emit a whole document. */
const PLAN = {
    entries: [{ kind: "section", title: "Gear", depth: 1, anchor: "gear", trail: ["Gear"] }],
    links: new Map(),
    stats: {},
};

/** Every family the emitted document names, in the order the rules set them. */
function familiesOfDefaultBook(): string[] {
    const source = renderBook({ plan: PLAN, title: "A Book" });
    return [...source.matchAll(/set text\(font: "([^"]+)"/g)].map((m) => m[1]);
}

describe("the faces the book is set in", () => {
    it("names a serif, a sans and a mono with nothing configured", () => {
        const families = familiesOfDefaultBook();

        // Guards the guard: were the rules reshaped, every case below would
        // pass over an empty list without proving anything.
        expect(families.length).toBeGreaterThanOrEqual(3);
        expect(new Set(families)).toEqual(
            new Set(["Libertinus Serif", "Libertinus Sans", "DejaVu Sans Mono"]),
        );
    });

    it("sets headings in the sans, which is the half that was resolving to the serif", () => {
        const source = renderBook({ plan: PLAN, title: "A Book" });

        expect(source).toContain('#show heading: set text(font: "Libertinus Sans")');
        expect(source).toContain('#set text(font: "Libertinus Serif"');
    });

    it("still takes a consumer's own faces for all three roles", () => {
        const source = renderBook({
            plan: PLAN,
            title: "A Book",
            fonts: { serif: "A Serif", sans: "A Sans", mono: "A Mono" },
        });

        expect(source).toContain('#set text(font: "A Serif"');
        expect(source).toContain('#show heading: set text(font: "A Sans")');
        expect(source).toContain('#show raw: set text(font: "A Mono")');
    });
});

describe("the shipped font directory", () => {
    it("is inside the package, so it travels with the toolchain version", () => {
        expect(path.relative(ROOT, BOOK_FONTS_PATH).split(path.sep)[0]).not.toBe("..");
        expect(fs.existsSync(BOOK_FONTS_PATH)).toBe(true);
    });

    it("carries the licence the faces travel under, beside them", () => {
        const dir = path.join(BOOK_FONTS_PATH, "libertinus");
        const files = fs.readdirSync(dir);

        expect(files.filter((f) => f.endsWith(".otf")).length).toBeGreaterThan(0);
        expect(fs.readFileSync(path.join(dir, "OFL.txt"), "utf8")).toContain(
            "SIL OPEN FONT LICENSE",
        );
        expect(fs.readFileSync(path.join(dir, "provenance.yaml"), "utf8")).toContain("OFL-1.1");
    });

    it("is published, so a consumer's install carries it", () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

        expect(pkg.files).toContain("assets");
    });
});

describe("the compile invocation", () => {
    it("searches the shipped directory and nothing the machine installed", () => {
        const args = typstArgs("book.typ", "book.pdf");

        expect(args).toContain("--ignore-system-fonts");
        expect(args[args.indexOf("--font-path") + 1]).toBe(BOOK_FONTS_PATH);
        expect(args.slice(-2)).toEqual(["book.typ", "book.pdf"]);
    });

    it("searches a consumer's own directory as well as the shipped one", () => {
        const args = typstArgs("book.typ", "book.pdf", { fonts: { path: "/pkg/assets/fonts" } });
        const searched = args[args.indexOf("--font-path") + 1].split(path.delimiter);

        expect(searched).toEqual([BOOK_FONTS_PATH, "/pkg/assets/fonts"]);
    });
});

describe("a face that resolves to nothing", () => {
    it("is a finding, with the position the compiler gave it", () => {
        // The compile exits 0 and writes a book set in the fallback, so the
        // warning is the only place this is visible at all.
        const findings = typstWarnings(
            [
                "warning: unknown font family: libertinus sans",
                "  ┌─ /out/book.typ:12:34",
                "   │",
                '12 │ #show heading: set text(font: "Libertinus Sans")',
                "",
            ].join("\n"),
        );

        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            file: "/out/book.typ",
            line: 12,
            column: 34,
            severity: "warning",
            message: "unknown font family: libertinus sans",
        });
    });

    it("reports a warning the compiler gave no position for, rather than inventing one", () => {
        const findings = typstWarnings("warning: layout did not converge within 5 attempts\n");

        expect(findings).toHaveLength(1);
        expect(findings[0].line).toBeUndefined();
        expect(findings[0].file).toBe("");
    });

    it("finds nothing in a clean compile", () => {
        expect(typstWarnings("")).toEqual([]);
    });
});

describe.runIf(HAS_TYPST)("what the compiler actually resolves", () => {
    it("resolves every family the default book names", () => {
        const listed = spawnSync(
            "typst",
            ["fonts", "--ignore-system-fonts", "--font-path", BOOK_FONTS_PATH],
            { encoding: "utf8" },
        );
        const available = new Set(String(listed.stdout).trim().split("\n"));

        for (const family of familiesOfDefaultBook()) {
            expect(available).toContain(family);
        }
    });

    it("reports a family it could not find, over a compile that still succeeded", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "book-fonts-"));
        const typ = path.join(dir, "book.typ");
        fs.writeFileSync(typ, '#set text(font: "No Such Family")\nA line.\n');

        const compiled = compileTypst(typ, path.join(dir, "book.pdf"));

        expect(compiled.ok).toBe(true);
        expect(compiled.findings).toHaveLength(1);
        // Through `realpath` on both sides: a temporary directory reaches the
        // compiler through a symlinked prefix on macOS, and the file is the
        // same file either way.
        expect(fs.realpathSync(compiled.findings[0].file)).toBe(fs.realpathSync(typ));
        expect(compiled.findings[0]).toMatchObject({ line: 1, severity: "warning" });
        expect(compiled.findings[0].message).toContain("unknown font family");
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("compiles the default book's own faces with no warning at all", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "book-fonts-"));
        const typ = path.join(dir, "book.typ");
        fs.writeFileSync(typ, renderBook({ plan: PLAN, title: "A Book" }));

        const compiled = compileTypst(typ, path.join(dir, "book.pdf"));

        expect(compiled.ok).toBe(true);
        expect(compiled.findings).toEqual([]);
        fs.rmSync(dir, { recursive: true, force: true });
    });
});
