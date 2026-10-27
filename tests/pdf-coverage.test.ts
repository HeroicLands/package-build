// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

import { coverage, summaryLines } from "../engine/pdf-coverage.mjs";
import { buildPdf } from "../engine/pdf-build.mjs";
import { renderBook } from "../engine/pdf-render.mjs";
import { formatDiagnostic } from "../engine/diagnostics.mjs";
import { configFromData } from "../engine/pack-config.mjs";

const MESSAGE = "no book selects this note; add it to a book's query or to `pdf.unprinted`";

/** A corpus record: address, name, file and the resolved culture. */
function rec(
    slug: string,
    { gm = false, stub = false, culture = null as string | null, type = "weapongear" } = {},
) {
    return {
        type,
        shortcode: slug,
        ...(stub ? {} : { address: { canonical: `pkg-note-${type}-${slug}`, slug } }),
        name: { full: slug.toUpperCase() },
        file: { path: `Gear/${slug}.md` },
        ...(gm ? { tags: ["gm"] } : {}),
        data: culture ? { culture } : {},
    };
}

const n0 = rec("none"); // in no book
const n1 = rec("one"); // in book a only
const n2 = rec("two", { culture: "pkg-note-lore-vedyari" }); // in books a and c
const n3 = rec("twice"); // twice in book b
const n4 = rec("shelved"); // matched by `unprinted`
const n5 = rec("secret", { gm: true }); // not a candidate
const n6 = rec("blank", { stub: true }); // not a candidate
const CORPUS = [n0, n1, n2, n3, n4, n5, n6];

const A = { id: "a", records: [n1, n2] };
const B = { id: "b", records: [n3, n3] };
const C = { id: "c", records: [n2] };

/** Where a record's `type:` line sits, as the build locates it. */
const locate = (record: any) => ({ file: record.file.path, line: 2, column: 1 });

function run(books: any[], mode = "warning") {
    return coverage({ books, corpus: CORPUS, unprinted: [n4], mode, locate });
}

describe("coverage: a note in no book", () => {
    it.each([
        ["warning", "Gear/none.md:2:1: warning: "],
        ["error", "Gear/none.md:2:1: error: "],
    ])("is a finding at the type line when pdf.coverage is %s", (mode, prefix) => {
        const { findings } = run([A, B, C], mode);
        expect(findings.map(formatDiagnostic)).toEqual([`${prefix}${MESSAGE}`]);
    });

    it("emits nothing when pdf.coverage is off", () => {
        expect(run([A, B, C], "off").findings).toEqual([]);
    });

    it("drops a position it cannot find rather than guessing one", () => {
        const { findings } = coverage({
            books: [A, B, C],
            corpus: CORPUS,
            unprinted: [n4],
            mode: "warning",
            locate: (record: any) => ({ file: record.file.path }),
        });
        expect(findings.map(formatDiagnostic)).toEqual([`Gear/none.md: warning: ${MESSAGE}`]);
    });

    it("does not report a note matched by unprinted, a gm note or a stub", () => {
        const { findings } = run([A, B, C]);
        expect(findings).toHaveLength(1);
        expect(findings[0].file).toBe("Gear/none.md");
    });
});

describe("coverage: the home book and the summary", () => {
    it("homes a note on the first book in config order that selects it", () => {
        const { homes } = run([A, B, C]);
        expect(Object.fromEntries(homes)).toEqual({
            "pkg-note-weapongear-one": "a",
            "pkg-note-weapongear-two": "a",
            "pkg-note-weapongear-twice": "b",
        });
    });

    it("moves the home when the books move", () => {
        const { homes } = run([C, B, A]);
        expect(homes.get("pkg-note-weapongear-two")).toBe("c");
        expect(homes.get("pkg-note-weapongear-one")).toBe("a");
    });

    it("counts a note selected twice in one book as one book", () => {
        const { summary } = run([A, B, C]);
        expect(summary.multiple.map((m: any) => m.name)).toEqual(["TWO"]);
        expect(summary.books.find((b: any) => b.id === "b")).toMatchObject({
            entries: 2,
            notes: 1,
        });
    });

    it("reports per-book counts, totals and each multiply-selected note", () => {
        const { summary } = run([A, B, C]);
        expect(summary).toEqual({
            books: [
                { id: "a", entries: 2, notes: 2, uncultured: 1 },
                { id: "b", entries: 2, notes: 1, uncultured: 1 },
                { id: "c", entries: 1, notes: 1, uncultured: 0 },
            ],
            totals: { candidates: 4, uncovered: 1, unprinted: 1 },
            multiple: [{ name: "TWO", path: "Gear/two.md", books: ["a", "c"], home: "a" }],
        });
    });

    it("words the summary as lines in a fixed order", () => {
        expect(summaryLines(run([A, B, C]).summary)).toEqual([
            "a: 2 entries, 2 notes, 1 without a culture",
            "b: 2 entries, 1 note, 1 without a culture",
            "c: 1 entry, 1 note, 0 without a culture",
            "4 printable notes, 1 in no book, 1 in pdf.unprinted",
            "TWO (Gear/two.md) is printed by a, c; home: a",
        ]);
    });

    it("gives the same result for the same input", () => {
        expect(run([A, B, C])).toEqual(run([A, B, C]));
    });
});

describe("renderBook: the cover page", () => {
    const base = { plan: { entries: [] }, title: "A Book", subtitle: "Volume One" };

    it("starts on the cover when a cover image is given", () => {
        const out = renderBook({ ...base, coverImage: "core/plates/cover.png" });
        const cover = out.indexOf('#book-cover("core/plates/cover.png", "A Book", "Volume One")');
        const title = out.indexOf("size: 30pt");
        expect(cover).toBeGreaterThan(-1);
        expect(title).toBeGreaterThan(cover);
        // The cover is page 1 and carries no running foot or number.
        expect(out).toMatch(/#let book-cover\([^\n]*\{?[\s\S]*?footer: none/);
    });

    it("starts on the title page without one", () => {
        const out = renderBook(base);
        expect(out).not.toContain("#book-cover(");
        expect(out).toContain("size: 30pt");
    });
});

describe("renderBook: the title page", () => {
    const base = { plan: { entries: [] }, title: "A Book" };

    it("lists authors one per line, with a role after a comma in title case", () => {
        const out = renderBook({
            ...base,
            authors: [{ name: "Tom Rodriguez", role: "artist" }, { name: "Jo Smith" }],
        });
        expect(out).toContain("Tom Rodriguez, Artist");
        expect(out).toMatch(/Jo Smith(?!,)/);
        expect(out.indexOf("Tom Rodriguez, Artist")).toBeLessThan(out.indexOf("Jo Smith"));
    });

    it("prints no author block without authors", () => {
        const out = renderBook(base);
        expect(out).not.toContain("title-authors");
    });

    it.each([
        ["copyright only", { copyright: "© 2026 Ann" }, ["© 2026 Ann"], []],
        [
            "licence only",
            { license: "CC BY-SA 4.0\nSee LICENSE" },
            ["CC BY-SA 4.0", "See LICENSE"],
            [],
        ],
        [
            "both",
            { copyright: "© 2026 Ann", license: "CC BY-SA 4.0" },
            ["© 2026 Ann", "CC BY-SA 4.0"],
            [],
        ],
        ["neither", {}, [], ["title-foot"]],
    ])("sets the foot with %s", (_name, given, present, absent) => {
        const out = renderBook({ ...base, ...given });
        for (const text of present) expect(out).toContain(text);
        for (const text of absent) expect(out).not.toContain(text);
        if (present.length) expect(out).toContain("place(bottom + center");
        else expect(out).not.toContain("place(bottom + center");
        // The foot comes after the title and before the contents.
        if (present.length) {
            expect(out.indexOf(present[0])).toBeGreaterThan(out.indexOf("size: 30pt"));
            expect(out.indexOf(present[0])).toBeLessThan(out.indexOf("#outline("));
        }
    });
});

describe("buildPdf over several books", () => {
    const dirs: string[] = [];
    const savedConfigEnv = process.env.PACKAGE_BUILD_CONFIG;

    afterEach(() => {
        for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
        if (savedConfigEnv === undefined) delete process.env.PACKAGE_BUILD_CONFIG;
        else process.env.PACKAGE_BUILD_CONFIG = savedConfigEnv;
    });

    /** Write a note under the content tree. */
    function note(dir: string, rel: string, fm: string) {
        const file = path.join(dir, "assets", "content", rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `---\n${fm}\n---\n\nBody.\n`);
    }

    /**
     * A package whose notes are a dagger, a sword, a helm (armor), a folder,
     * a culture and a place two levels below the cultured realm.
     */
    function makeBooks(pdf: Record<string, unknown>, authors?: object[]) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-coverage-"));
        dirs.push(dir);
        fs.writeFileSync(
            path.join(dir, "package.json"),
            JSON.stringify({
                name: "bookpkg",
                version: "1.0.0",
                homepage: "https://www.heroiclands.org/sohl/",
            }),
        );
        fs.mkdirSync(path.join(dir, "assets", "content"), { recursive: true });
        fs.writeFileSync(
            path.join(dir, "assets", "content", "homepage.md"),
            "---\ntype: homepage\nshortcode: root\nname:\n  full: Book Package\n---\n\nFront.\n",
        );
        note(dir, "Gear/dagger.md", "type: weapongear\nshortcode: dagger\nname:\n  full: Dagger");
        note(dir, "Gear/sword.md", "type: weapongear\nshortcode: sword\nname:\n  full: Sword");
        note(dir, "Gear/helm.md", "type: armorgear\nshortcode: helm\nname:\n  full: Helm");
        note(
            dir,
            "Lore/Vedyari.md",
            "type: lore\nsubType: culture\nshortcode: vedyari\nname:\n  full: Vedyari\ndata: {lang: en}",
        );
        note(
            dir,
            "Places/realm.md",
            "type: place\nshortcode: realm\nname:\n  full: Realm\ndata: {culture: lore-vedyari}",
        );
        note(
            dir,
            "Places/vale.md",
            "type: place\nshortcode: vale\nname:\n  full: Vale\ndata: {parents: [realm]}",
        );
        note(
            dir,
            "Places/hamlet.md",
            "type: place\nshortcode: hamlet\nname:\n  full: Hamlet\ndata: {parents: [vale]}",
        );
        const data = {
            contentPackage: "sohl",
            packageKind: "modules",
            compatibility: { minimum: "14.359", verified: "14.359" },
            stats: { lastModifiedBy: "sohlbuilder00000" },
            packs: [{ name: "items", type: "Item" }],
            ...(authors ? { authors } : {}),
            pdf: { fonts: { serif: "Libertinus Serif" }, ...pdf },
        };
        const configPath = path.join(dir, "package-build.config.yaml");
        fs.writeFileSync(configPath, JSON.stringify(data));
        process.env.PACKAGE_BUILD_CONFIG = configPath;
        return { dir, config: configFromData(data, configPath), configPath };
    }

    const gear = (id: string, filter: string) => ({
        id,
        title: `Book ${id}`,
        contents: [{ sectionName: "Gear", contents: [{ filter }] }],
    });

    /** A hash of every file under a directory, for the inputs-unchanged check. */
    function hashTree(dir: string): string {
        const hash = crypto.createHash("sha256");
        const walk = (d: string) => {
            for (const name of fs.readdirSync(d).sort()) {
                const full = path.join(d, name);
                if (fs.statSync(full).isDirectory()) walk(full);
                else hash.update(full).update(fs.readFileSync(full));
            }
        };
        walk(dir);
        return hash.digest("hex");
    }

    it("renders every declared book from one run", async () => {
        const { config } = makeBooks({
            unprinted: "type IN ('lore', 'place', 'homepage')",
            books: [gear("a", "type = 'weapongear'"), gear("b", "type = 'armorgear'")],
        });
        const result = await buildPdf({ config, compile: false });
        expect(result.findings).toEqual([]);
        expect(result.books.map((b: any) => path.basename(b.typ))).toEqual([
            "sohl-a.typ",
            "sohl-b.typ",
        ]);
        expect(result.homes.get("sohl-sohl-weapongear-dagger")).toBe("a");
        expect(summaryLines(result.summary)).toContain(
            "a: 2 entries, 2 notes, 2 without a culture",
        );
    });

    it("drops a section whose filter matches nothing, with no finding", async () => {
        const { config } = makeBooks({
            unprinted: "type IN ('lore', 'place', 'homepage', 'armorgear')",
            books: [
                {
                    id: "a",
                    title: "Book a",
                    contents: [
                        { sectionName: "Gear", contents: [{ filter: "type = 'weapongear'" }] },
                        { sectionName: "Mounts", contents: [{ filter: "type = 'mount'" }] },
                    ],
                },
            ],
        });
        const result = await buildPdf({ config, compile: false });
        expect(result.findings).toEqual([]);
        const typ = fs.readFileSync(result.books[0].typ, "utf8");
        expect(typ).toContain("Gear");
        expect(typ).not.toContain("Mounts");
    });

    it("refuses a book that selects nothing, naming it, and still builds the other", async () => {
        const { config, configPath } = makeBooks({
            unprinted: "type IN ('lore', 'place', 'homepage', 'armorgear')",
            books: [gear("a", "type = 'weapongear'"), gear("b", "type = 'mount'")],
        });
        const result = await buildPdf({ config, compile: false });
        const errors = result.findings.filter((f: any) => f.severity === "error");
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ file: configPath, severity: "error" });
        expect(errors[0].message).toBe("book `b` selects no note");
        expect(result.books.map((b: any) => b.id)).toEqual(["a"]);
        expect(result.built).toBe(false);
    });

    it("renders the book --book names yet reports coverage over every book", async () => {
        const { config } = makeBooks({
            unprinted: "type IN ('lore', 'place', 'homepage')",
            books: [gear("a", "type = 'weapongear'"), gear("b", "type = 'armorgear'")],
        });
        const only = await buildPdf({ config, compile: false, book: "b" });
        expect(only.books.map((b: any) => b.id)).toEqual(["b"]);
        expect(only.findings).toEqual([]);
        expect(only.summary.books.map((b: any) => b.id)).toEqual(["a", "b"]);
        expect(only.homes.get("sohl-sohl-weapongear-dagger")).toBe("a");

        const uncovered = makeBooks({
            unprinted: "type IN ('lore', 'place', 'homepage')",
            books: [gear("a", "type = 'weapongear'"), gear("b", "type = 'mount'")],
        });
        // Book `a` alone is requested; `helm` is in no book, and that is
        // reported although `b` is never rendered.
        const partial = await buildPdf({ config: uncovered.config, compile: false, book: "a" });
        expect(partial.findings.map((f: any) => f.message)).toContain(MESSAGE);
    });

    it("selects a place two levels below a cultured root by its resolved culture", async () => {
        const { config } = makeBooks({
            unprinted: "type IN ('lore', 'weapongear', 'armorgear', 'homepage')",
            books: [
                {
                    id: "vedyara",
                    title: "Vedyara",
                    contents: [
                        {
                            sectionName: "Places",
                            contents: [
                                {
                                    filter: "type = 'place' AND data.culture = 'sohl-note-lore-vedyari'",
                                },
                            ],
                        },
                    ],
                },
            ],
        });
        const result = await buildPdf({ config, compile: false });
        expect(result.findings).toEqual([]);
        expect(result.summary.books[0]).toEqual({
            id: "vedyara",
            entries: 3,
            notes: 3,
            uncultured: 0,
        });
    });

    it("leaves the inputs unchanged and gives byte-identical output twice", async () => {
        const { dir, config } = makeBooks({
            unprinted: "type IN ('lore', 'place', 'homepage')",
            books: [
                gear("a", "type = 'weapongear'"),
                gear("b", "type IN ('weapongear','armorgear')"),
            ],
        });
        const before = hashTree(dir);
        const first = await buildPdf({ config, compile: false });
        const typs = first.books.map((b: any) => fs.readFileSync(b.typ, "utf8"));
        const second = await buildPdf({ config, compile: false });
        expect(second.books.map((b: any) => fs.readFileSync(b.typ, "utf8"))).toEqual(typs);
        expect(summaryLines(second.summary)).toEqual(summaryLines(first.summary));
        // Only `build/` changed.
        fs.rmSync(path.join(dir, "build"), { recursive: true, force: true });
        expect(hashTree(dir)).toBe(before);
    });

    it("stages pictures per book, and opens a book on its cover only when it has one", async () => {
        const { dir, config } = makeBooks({
            unprinted: "type IN ('lore', 'place', 'homepage')",
            books: [
                { ...gear("a", "type = 'weapongear'"), coverImage: "art/cover.png" },
                gear("b", "type = 'armorgear'"),
            ],
        });
        fs.mkdirSync(path.join(dir, "art"));
        await sharp({
            create: { width: 40, height: 60, channels: 3, background: "#336699" },
        })
            .png()
            .toFile(path.join(dir, "art", "cover.png"));
        const result = await buildPdf({ config, compile: false });
        expect(result.findings).toEqual([]);
        const [a, b] = result.books.map((x: any) => fs.readFileSync(x.typ, "utf8"));
        expect(a).toContain('#book-cover("sohl-a/cover/cover.png", "Book a", "")');
        expect(a.indexOf("#book-cover(")).toBeLessThan(a.indexOf("size: 30pt"));
        expect(b).not.toContain("#book-cover(");
        expect(fs.existsSync(path.join(dir, "build", "dist", "sohl-a", "cover", "cover.png"))).toBe(
            true,
        );
    });

    it("prints the authors, copyright and licence on every book's title page", async () => {
        const { config } = makeBooks(
            {
                unprinted: "type IN ('lore', 'place', 'homepage')",
                copyright: "© 2026 Ann Author",
                license: "CC BY-SA 4.0",
                books: [gear("a", "type = 'weapongear'"), gear("b", "type = 'armorgear'")],
            },
            [{ name: "Ann Author", role: "designer" }, { name: "Bo Builder" }],
        );
        const result = await buildPdf({ config, compile: false });
        for (const book of result.books) {
            const typ = fs.readFileSync(book.typ, "utf8");
            expect(typ).toContain("Ann Author, Designer");
            expect(typ).toContain("Bo Builder");
            expect(typ).toContain("© 2026 Ann Author");
            expect(typ).toContain("CC BY-SA 4.0");
        }
    });
});
