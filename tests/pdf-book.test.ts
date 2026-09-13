// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(__dirname, "..");

/** Whether a Typst compiler is reachable, which the PDF-level cases need. */
const HAS_TYPST = spawnSync("typst", ["--version"], { encoding: "utf8" }).status === 0;

let root = "";

/**
 * A repository with a small content tree and a document tree over it.
 *
 * @param mode - What `publish.site` declares.
 * @param withPdf - Whether a `pdf:` block is configured.
 * @param withTree - Whether the content tree exists at all.
 */
function makeRepo(mode: string, withPdf = true, withTree = true): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-book-"));
    fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "bookpkg", version: "2.0.0" }),
    );

    if (withTree) {
        const content = path.join(dir, "assets", "content", "Gear");
        fs.mkdirSync(content, { recursive: true });
        const note = (file: string, fm: string, body: string) =>
            fs.writeFileSync(path.join(content, file), `---\n${fm}\n---\n\n${body}\n`);
        note(
            "dagger.md",
            "type: weapongear\nshortcode: dagger\nname:\n  full: Dagger",
            [
                "## Description {#description}",
                "",
                "A short blade of Saṃgha. See [[weapongear-sword|the sword]].",
                "",
                "| Attribute | Value |",
                "| --------- | ----: |",
                "| Weight    |     1 |",
            ].join("\n"),
        );
        note("sword.md", "type: weapongear\nshortcode: sword\nname:\n  full: Sword", "A blade.");
        fs.writeFileSync(
            path.join(dir, "assets", "content", "homepage.md"),
            "---\ntype: homepage\nshortcode: root\nname:\n  full: Book Package\n---\n\nFront.\n",
        );
    }

    fs.writeFileSync(
        path.join(dir, "book.yaml"),
        [
            "contents:",
            "  - sectionName: Gear",
            "    contents:",
            "      - filter: \"type = 'weapongear'\"",
        ].join("\n") + "\n",
    );

    const config = [
        "contentPackage: sohl",
        "packageKind: modules",
        "compatibility:",
        '    minimum: "14.359"',
        '    verified: "14.359"',
        "stats:",
        "    lastModifiedBy: sohlbuilder00000",
        "packs:",
        "    - name: items",
        "      type: Item",
        "publish:",
        `    site: ${mode}`,
    ];
    if (withPdf) {
        config.push(
            "pdf:",
            "    title: The Test Volume",
            "    document: book.yaml",
            "    fonts:",
            "        serif: Libertinus Serif",
        );
    }
    fs.writeFileSync(path.join(dir, "package-build.config.yaml"), config.join("\n") + "\n");
    return dir;
}

/** Run `content-build pdf` against a fixture repository. */
function build(dir: string, ...args: string[]) {
    const r = spawnSync(
        process.execPath,
        [path.join(ROOT, "bin", "content-build.mjs"), "pdf", ...args],
        {
            cwd: dir,
            env: {
                ...process.env,
                PACKAGE_BUILD_CONFIG: path.join(dir, "package-build.config.yaml"),
            },
            encoding: "utf8",
        },
    );
    return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, status: r.status };
}

afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe("the homepage fence", () => {
    // The criterion most likely to be regressed by a later refactor, and the
    // most expensive to get wrong: four of the six packages that would adopt
    // this run `homepage`, and a book appearing there would breach the fence
    // silently — nothing in their configuration would say so.
    it("builds no book in `homepage` mode, and says why", () => {
        const dir = makeRepo("homepage");
        const { out, status } = build(dir);

        expect(out).toMatch(/fences the content surfaces off/);
        expect(out).not.toMatch(/Book:/);
        // Publishing no book is a declaration, not a failure — a release that
        // exited non-zero here would break four packages.
        expect(status).toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("writes no file at all in `homepage` mode", () => {
        const dir = makeRepo("homepage");
        build(dir);

        expect(fs.existsSync(path.join(dir, "build", "dist"))).toBe(false);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("builds one in `content` mode, so one switch decides it", () => {
        const dir = makeRepo("content");
        const { out } = build(dir, "--no-compile");

        expect(out).toMatch(/Typst source:/);
        fs.rmSync(dir, { recursive: true, force: true });
    });
});

describe("a package with nothing to print", () => {
    it("is a no-op when no `pdf:` block is configured", () => {
        const dir = makeRepo("content", false);
        const { out, status } = build(dir);

        expect(out).toMatch(/publishes no book/);
        expect(status).toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("is a no-op when there is no content tree", () => {
        const dir = makeRepo("content", true, false);
        const { out, status } = build(dir);

        expect(out).toMatch(/no content tree/);
        expect(status).toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
    });
});

describe("the emitted document", () => {
    let source = "";

    beforeAll(() => {
        root = makeRepo("content");
        build(root, "--no-compile");
        const dist = path.join(root, "build", "dist");
        const typ = fs.readdirSync(dist).find((f) => f.endsWith(".typ"))!;
        source = fs.readFileSync(path.join(dist, typ), "utf8");
    });

    it("gives every section and entry its own heading, which is the outline", () => {
        // Typst builds the PDF bookmark outline from headings, so a heading per
        // entry *is* the navigational interface a 2,500-entry roster needs.
        expect(source).toContain("= Gear <gear>");
        expect(source).toContain("== Dagger <weapongear-dagger>");
        expect(source).toContain("== Sword <weapongear-sword>");
    });

    it("opens on a table of contents", () => {
        expect(source).toMatch(/#outline\(title: \[Contents\], depth: \d+\)/);
    });

    it("orders entries by name rather than by the order notes were walked", () => {
        expect(source.indexOf("== Dagger")).toBeLessThan(source.indexOf("== Sword"));
    });

    it("resolves a wikilink between two notes of the book to an internal destination", () => {
        expect(source).toContain("#link(<weapongear-sword>)[the sword]");
        expect(source).not.toMatch(/#link\("[^"]*weapongear-sword/);
    });

    it("strips a heading's anchor markup and namespaces the label", () => {
        expect(source).toContain("<weapongear-dagger--description>");
        expect(source).not.toContain("{#description}");
    });

    it("keeps the table's header as a repeating header", () => {
        expect(source).toContain("table.header([Attribute], [Value])");
    });

    it("carries the corpus's diacritics through unescaped", () => {
        expect(source).toContain("Saṃgha");
    });
});

describe.runIf(HAS_TYPST)("the compiled PDF", () => {
    let pdf = Buffer.alloc(0);

    beforeAll(() => {
        const dir = makeRepo("content");
        build(dir);
        const dist = path.join(dir, "build", "dist");
        const file = fs.readdirSync(dist).find((f) => f.endsWith(".pdf"));
        if (file) pdf = fs.readFileSync(path.join(dist, file));
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("is produced at all", () => {
        expect(pdf.length).toBeGreaterThan(0);
        expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    });

    it("carries a bookmark outline", () => {
        // `/Outlines` is the PDF object a viewer's sidebar reads. Without it the
        // reader of a thousand-page roster has no way in.
        expect(pdf.toString("latin1")).toContain("/Outlines");
    });

    it("is searchable, because every embedded font maps back to Unicode", () => {
        // `/ToUnicode` is precisely what makes text extraction, search and
        // copy-paste work on a subsetted font. A book of names that cannot be
        // searched for a name is the failure that matters most here.
        expect(pdf.toString("latin1")).toContain("/ToUnicode");
    });

    it("names the document, so a viewer's title bar is not the file name", () => {
        expect(pdf.toString("latin1")).toMatch(/Title/);
    });
});
