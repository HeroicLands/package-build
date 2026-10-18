// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * A reference to a note another book prints names that book and the page the
 * note's entry starts on, read from a two-pass build.
 *
 * The page assertions read the compiled PDFs, not the build's own table: the
 * page a reference prints is checked against the page the target's first line
 * sits on (`pdftotext`) and against the page Typst's named destination for the
 * entry sits on (`pdfinfo -dests`), neither of which the build reads.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { configFromData } from "../engine/pack-config.mjs";
import { buildPdf } from "../engine/pdf-build.mjs";
import {
    elsewhereFor,
    evalArgs,
    homeEntries,
    movedPages,
    pageTable,
    readEntryPages,
} from "../engine/pdf-pages.mjs";
import { crossBookReference, markdownToTypst } from "../engine/pdf-render.mjs";
import { linkToTypst } from "../engine/infobox-render.mjs";
import { labelFor } from "../engine/pdf-render.mjs";

const ok = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: "utf8" }).status === 0;
const HAS_TYPST = ok("typst", ["--version"]);
const HAS_POPPLER = ok("pdftotext", ["-v"]) && ok("pdfinfo", ["-v"]);

const rec = (slug: string, type = "weapongear") => ({
    type,
    shortcode: slug,
    address: { canonical: `pkg-note-${type}-${slug}`, slug: `${type}-${slug}` },
    name: { full: slug },
});

describe("the page table", () => {
    const dagger = rec("dagger");
    const sword = rec("sword");
    const helm = rec("helm", "armorgear");
    const plan = (...records: object[]) => ({
        entries: [
            { kind: "section", anchor: "gear" },
            ...records.map((record: any) => ({
                kind: "note",
                record,
                anchor: record.address.slug,
            })),
        ],
    });
    const books = [
        { id: "a", title: "Book A", plan: plan(dagger, sword) },
        { id: "b", title: "Book B", plan: plan(helm, dagger) },
    ];
    const homes = new Map([
        ["pkg-note-weapongear-dagger", "a"],
        ["pkg-note-weapongear-sword", "a"],
        ["pkg-note-armorgear-helm", "b"],
    ]);

    it("names each note's home book and its first anchor, a reprint included", () => {
        const entries = homeEntries({ books, homes });
        expect(entries.map((e: any) => [e.key, e.book, e.anchor])).toEqual([
            ["pkg-note-weapongear-dagger", "a", "weapongear-dagger"],
            ["pkg-note-weapongear-sword", "a", "weapongear-sword"],
            ["pkg-note-armorgear-helm", "b", "armorgear-helm"],
        ]);
    });

    it("lists the measured pages with sorted keys, leaving out an unmeasured note", () => {
        const entries = homeEntries({ books, homes });
        const measured = new Map([
            ["a", new Map([[labelFor("weapongear-sword"), 7]])],
            ["b", new Map([[labelFor("armorgear-helm"), 4]])],
        ]);
        const table = pageTable(entries, measured);
        expect(JSON.stringify(table)).toBe(
            '{"pkg-note-armorgear-helm":{"book":"b","page":4},' +
                '"pkg-note-weapongear-sword":{"book":"a","page":7}}',
        );
    });

    it("reports the notes whose page differs between two tables", () => {
        const before = { x: { book: "a", page: 3 }, y: { book: "a", page: 4 } };
        const after = {
            x: { book: "a", page: 3 },
            y: { book: "a", page: 5 },
            z: { book: "b", page: 1 },
        };
        expect(movedPages(before, after)).toEqual([
            { key: "y", book: "a", before: 4, after: 5 },
            { key: "z", book: "b", before: undefined, after: 1 },
        ]);
        expect(movedPages(before, before)).toEqual([]);
    });

    it("answers a book for the notes it does not print, counting each answer", () => {
        const entries = homeEntries({ books, homes });
        const forB = elsewhereFor({
            entries,
            book: "b",
            printed: new Map([["weapongear-dagger", "weapongear-dagger"]]),
            table: { "pkg-note-weapongear-sword": { book: "a", page: 9 } },
        });
        // The reprinted dagger is b's own; the helm is b's home.
        expect(forB.get("weapongear-dagger")).toBeUndefined();
        expect(forB.get("armorgear-helm")).toBeUndefined();
        expect(forB.used).toBe(0);
        expect(forB.get("weapongear-sword")).toMatchObject({ title: "Book A", page: 9 });
        expect(forB.get("pkg-note-weapongear-sword")).toMatchObject({ title: "Book A", page: 9 });
        expect(forB.used).toBe(2);
    });

    it("carries a home book's abbreviation to the lookup and the listing", () => {
        const withAbbr = books.map((b) => (b.id === "a" ? { ...b, abbreviation: "Aelw." } : b));
        const entries = homeEntries({ books: withAbbr, homes });
        const forB = elsewhereFor({ entries, book: "b", printed: new Map(), seeAlso: true });
        expect(forB.get("weapongear-sword")).toMatchObject({ abbreviation: "Aelw." });
        expect(forB.listed[0]).toMatchObject({ abbreviation: "Aelw." });
    });

    it("prints `?` for every page before a table exists", () => {
        const entries = homeEntries({ books, homes });
        const forB = elsewhereFor({ entries, book: "b", printed: new Map() });
        expect(forB.get("weapongear-sword")).toMatchObject({ title: "Book A", page: "?" });
    });
});

describe("the printed form", () => {
    const away = { title: "The Core Volume", page: 12 };

    it("is the link's words, the book in emphasis and the page", () => {
        expect(crossBookReference("the sword", away)).toBe(
            "the sword (#emph[The Core Volume], p.~12)",
        );
        expect(crossBookReference("x", { title: "A *B* #C", page: "?" })).toContain(
            "#emph[A \\*B\\* \\#C], p.~?",
        );
    });

    it("is the abbreviation and `p` against the page when the book has one", () => {
        const short = { ...away, abbreviation: "Aelw." };
        expect(crossBookReference("the sword", short)).toBe("the sword (Aelw.~p12)");
        expect(crossBookReference("x", { ...short, abbreviation: "A *B*" })).toBe(
            "x (A \\*B\\*~p12)",
        );
        expect(crossBookReference("x", { ...away, abbreviation: "" })).toContain("#emph[");
    });

    it("replaces a prose link to another book's note, and only that", () => {
        const elsewhere = { get: (key: string) => (key === "weapongear-sword" ? away : undefined) };
        const links = new Map([["weapongear-dagger", "weapongear-dagger"]]);
        const out = markdownToTypst(
            "[the sword](/sohl/weapongear-sword/), [a dagger](/sohl/weapongear-dagger/), " +
                "[a cap](/sohl/armorgear-cap/)",
            { links, elsewhere, url: "https://www.heroiclands.org/sohl/" },
        );
        expect(out).toContain("the sword (#emph[The Core Volume], p.~12)");
        expect(out).not.toContain("weapongear-sword/");
        expect(out).toContain("#link(<weapongear-dagger>)[a dagger]");
        expect(out).toContain('#link("https://www.heroiclands.org/sohl/armorgear-cap/")[a cap]');
    });

    it("renders a prose link and an infobox link with the home book's abbreviation", () => {
        const short = { ...away, abbreviation: "Core." };
        const elsewhere = { get: () => short };
        const out = markdownToTypst("[the sword](/sohl/weapongear-sword/)", {
            links: new Map(),
            elsewhere,
            url: "https://www.heroiclands.org/sohl/",
        });
        expect(out).toContain("the sword (Core.~p12)");
        expect(out).not.toContain("#emph[The Core Volume]");
        const value = { text: "Sword", address: "pkg-note-x", url: "/sohl/x/" };
        expect(linkToTypst(value, new Map(), labelFor, "https://h/sohl/", elsewhere)).toBe(
            "Sword (Core.~p12)",
        );
    });

    it("joins the bracket a link closes rather than opening its own", () => {
        const short = { ...away, abbreviation: "Core." };
        const render = (markdown: string, book = short) =>
            markdownToTypst(markdown, {
                links: new Map(),
                elsewhere: { get: () => book },
                url: "https://www.heroiclands.org/sohl/",
            });
        expect(render("Steel ([the sword](/sohl/weapongear-sword/)) is old.")).toContain(
            "Steel (the sword, Core.~p12) is old.",
        );
        expect(render("Steel (see [the sword](/sohl/weapongear-sword/)).")).toContain(
            "(see the sword, Core.~p12).",
        );
        expect(render("Steel ([the sword](/sohl/weapongear-sword/)).", away)).toContain(
            "(the sword, #emph[The Core Volume], p.~12).",
        );
        // In running text the reference keeps its own brackets.
        expect(render("Steel from [the sword](/sohl/weapongear-sword/) is old.")).toContain(
            "the sword (Core.~p12) is old.",
        );
        expect(crossBookReference("x", short, { bracketed: true })).toBe("x, Core.~p12");
    });

    it("applies to an infobox link by address", () => {
        const elsewhere = { get: (key: string) => (key === "pkg-note-x" ? away : undefined) };
        const value = { text: "Sword", address: "pkg-note-x", url: "/sohl/x/" };
        expect(linkToTypst(value, new Map(), labelFor, "https://h/sohl/", elsewhere)).toBe(
            "Sword (#emph[The Core Volume], p.~12)",
        );
        expect(linkToTypst(value, new Map(), labelFor, "https://h/sohl/")).toContain("#link(");
    });
});

describe.skipIf(!HAS_TYPST)("evaluating a book's pages", () => {
    it("builds the measuring command from the compile's own flags", () => {
        const args = evalArgs("/x/book.typ", ["--ignore-system-fonts", "--font-path", "/f"]);
        expect(args.slice(0, 5)).toEqual([
            "eval",
            "--in",
            "/x/book.typ",
            "--ignore-system-fonts",
            "--font-path",
        ]);
    });

    it("reports a book Typst cannot lay out", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-pages-bad-"));
        const typ = path.join(dir, "bad.typ");
        fs.writeFileSync(typ, "#let = broken");
        const result = readEntryPages(typ, []);
        fs.rmSync(dir, { recursive: true, force: true });
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/`typst eval` failed/);
    });
});

describe.skipIf(!HAS_TYPST || !HAS_POPPLER)("a package of three books", () => {
    const dirs: string[] = [];
    const savedEpoch = process.env.SOURCE_DATE_EPOCH;
    const savedConfig = process.env.PACKAGE_BUILD_CONFIG;

    const filler = Array.from(
        { length: 40 },
        (_, i) => `Paragraph ${i} of text that runs the entry on across the page.`,
    ).join("\n\n");

    /** [shortcode, type, name, body]. Names sort a-before-b inside each book. */
    const NOTES: Array<[string, string, string, string]> = [
        [
            "dagger",
            "weapongear",
            "Dagger",
            `MARK-DAGGER\n\nSee [the sword](/sohl/weapongear-sword/).\n\n` +
                `See [the aegis](/sohl/armorgear-aegis/).\n\nSee [a cap](/sohl/armorgear-cap/).\n\n${filler}`,
        ],
        [
            "sword",
            "weapongear",
            "Sword",
            `MARK-SWORD\n\nSee [the aegis](/sohl/armorgear-aegis/).\n\n${filler}`,
        ],
        [
            "aegis",
            "armorgear",
            "Aegis",
            `MARK-AEGIS\n\nSee [the sword](/sohl/weapongear-sword/).\n\n${filler}`,
        ],
        ["cap", "armorgear", "Cap", "MARK-CAP"],
        [
            "axe",
            "weapongear",
            "Axe",
            `MARK-AXE\n\nSee [the dagger](/sohl/weapongear-dagger/).\n\nSee [the aegis](/sohl/armorgear-aegis/).\n\n${filler}`,
        ],
    ];

    const gear = (id: string, shortcodes: string[]) => ({
        id,
        title: `Book ${id.toUpperCase()}`,
        contents: [
            {
                sectionName: "Gear",
                contents: [
                    { filter: `shortcode IN (${shortcodes.map((s) => `'${s}'`).join(",")})` },
                ],
            },
        ],
    });

    function make(books: object[], notes = NOTES) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-pages-"));
        dirs.push(dir);
        fs.writeFileSync(
            path.join(dir, "package.json"),
            JSON.stringify({
                name: "bookpkg",
                version: "1.0.0",
                homepage: "https://www.heroiclands.org/sohl/",
            }),
        );
        const content = path.join(dir, "assets", "content");
        fs.mkdirSync(path.join(content, "Gear"), { recursive: true });
        fs.writeFileSync(
            path.join(content, "homepage.md"),
            "---\ntype: homepage\nshortcode: root\nname:\n  full: Book Package\n---\n\nFront.\n",
        );
        for (const [shortcode, type, name, body] of notes) {
            fs.writeFileSync(
                path.join(content, "Gear", `${shortcode}.md`),
                `---\ntype: ${type}\nshortcode: ${shortcode}\nname:\n  full: ${name}\n---\n\n${body}\n`,
            );
        }
        const data = {
            contentPackage: "sohl",
            packageKind: "modules",
            compatibility: { minimum: "14.359", verified: "14.359" },
            stats: { lastModifiedBy: "sohlbuilder00000" },
            packs: [{ name: "items", type: "Item" }],
            pdf: {
                fonts: { serif: "Libertinus Serif" },
                unprinted: "type = 'homepage' OR shortcode = 'cap'",
                books,
            },
        };
        const configPath = path.join(dir, "package-build.config.yaml");
        fs.writeFileSync(configPath, JSON.stringify(data));
        process.env.PACKAGE_BUILD_CONFIG = configPath;
        return {
            dir,
            config: configFromData(data, configPath),
            out: path.join(dir, "build", "dist"),
        };
    }

    const THREE = [
        gear("a", ["dagger", "sword"]),
        gear("b", ["aegis", "dagger"]),
        gear("c", ["axe"]),
    ];

    /** A book's PDF, one string per physical page, whitespace collapsed. */
    const pagesOf = (pdf: string) =>
        String(spawnSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8" }).stdout)
            .split("\f")
            .map((page) => page.replace(/\s+/g, " "));
    /** The physical page the first line of a note sits on. */
    const startOf = (pages: string[], mark: string) =>
        pages.findIndex((page) => page.includes(mark)) + 1;
    /** The page Typst's named destination for an entry sits on. */
    const destination = (pdf: string, name: string) => {
        const row = spawnSync("pdfinfo", ["-dests", pdf], { encoding: "utf8" })
            .stdout.split("\n")
            .find((line) => line.endsWith(`"${name}"`));
        return Number(row?.trim().split(/\s+/)[0]);
    };
    const printed = (pages: string[], words: string, book: string) => {
        const found = pages.join(" ").match(new RegExp(`${words} \\(Book ${book}, p\\. (\\d+)\\)`));
        return found ? Number(found[1]) : undefined;
    };

    let run: ReturnType<typeof make>;
    let result: any;
    let second: ReturnType<typeof make>;
    let secondResult: any;
    let pages: Record<string, string[]>;
    let table: Record<string, { book: string; page: number }>;
    let reads = 0;

    beforeAll(async () => {
        process.env.SOURCE_DATE_EPOCH = "1700000000";
        const counted = (typ: string, fonts: string[], bin: string) => {
            reads += 1;
            return readEntryPages(typ, fonts, bin);
        };
        run = make(THREE);
        result = await buildPdf({ config: run.config, readPages: counted });
        second = make(THREE);
        secondResult = await buildPdf({ config: second.config });
        pages = Object.fromEntries(
            ["a", "b", "c"].map((id) => [id, pagesOf(path.join(run.out, `sohl-${id}.pdf`))]),
        );
        table = JSON.parse(fs.readFileSync(path.join(run.out, "pages.json"), "utf8"));
    }, 120000);

    afterAll(() => {
        for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
        if (savedEpoch === undefined) delete process.env.SOURCE_DATE_EPOCH;
        else process.env.SOURCE_DATE_EPOCH = savedEpoch;
        if (savedConfig === undefined) delete process.env.PACKAGE_BUILD_CONFIG;
        else process.env.PACKAGE_BUILD_CONFIG = savedConfig;
    });

    it("builds every book without findings", () => {
        expect(result.findings).toEqual([]);
        expect(result.books.map((b: any) => b.pdf && path.basename(b.pdf))).toEqual([
            "sohl-a.pdf",
            "sohl-b.pdf",
            "sohl-c.pdf",
        ]);
    });

    it("measures each book twice when references cross books", () => {
        expect(reads).toBe(6);
    });

    it("writes pages.json with a home book and a page for every printed note, sorted", () => {
        expect(Object.keys(table)).toEqual([
            "sohl-sohl-armorgear-aegis",
            "sohl-sohl-weapongear-axe",
            "sohl-sohl-weapongear-dagger",
            "sohl-sohl-weapongear-sword",
        ]);
        expect(table["sohl-sohl-weapongear-dagger"].book).toBe("a");
        expect(table["sohl-sohl-armorgear-aegis"].book).toBe("b");
        expect(table["sohl-sohl-weapongear-axe"].book).toBe("c");
    });

    it("records the page each entry starts on, as the compiled books place it", () => {
        const homes = { a: ["dagger", "sword"], b: ["aegis"], c: ["axe"] } as Record<
            string,
            string[]
        >;
        for (const [book, names] of Object.entries(homes)) {
            const pdf = path.join(run.out, `sohl-${book}.pdf`);
            for (const name of names) {
                const type = name === "aegis" ? "armorgear" : "weapongear";
                const recorded = table[`sohl-sohl-${type}-${name}`].page;
                expect(recorded).toBe(startOf(pages[book], `MARK-${name.toUpperCase()}`));
                expect(recorded).toBe(destination(pdf, `${type}-${name}`));
            }
        }
    });

    it("prints the home book's page in each direction", () => {
        expect(printed(pages.a, "the aegis", "B")).toBe(table["sohl-sohl-armorgear-aegis"].page);
        expect(printed(pages.b, "the sword", "A")).toBe(table["sohl-sohl-weapongear-sword"].page);
        expect(printed(pages.c, "the aegis", "B")).toBe(table["sohl-sohl-armorgear-aegis"].page);
    });

    it("names the home book's page for a note another book reprints", () => {
        const home = table["sohl-sohl-weapongear-dagger"].page;
        const reprinted = startOf(pages.b, "MARK-DAGGER");
        expect(printed(pages.c, "the dagger", "A")).toBe(home);
        // The reprint sits on another page, so naming it would be wrong.
        expect(reprinted).not.toBe(home);
        expect(pages.c.join(" ")).not.toMatch(/the dagger \(Book B/);
    });

    it("keeps an internal destination inside one book and a web address for a note in no book", () => {
        const a = fs.readFileSync(path.join(run.out, "sohl-a.typ"), "utf8");
        const b = fs.readFileSync(path.join(run.out, "sohl-b.typ"), "utf8");
        expect(a).toContain("#link(<weapongear-sword>)[the sword]");
        expect(pages.a.join(" ")).not.toMatch(/the sword \(Book/);
        // Book b reprints the dagger, whose body links to the sword in book a.
        expect(b).toContain("the sword (#emph[Book A], p.~");
        for (const typ of [a, b]) {
            expect(typ).toContain(
                '#link("https://www.heroiclands.org/sohl/armorgear-cap/")[a cap]',
            );
        }
        expect(pages.a.join(" ")).not.toMatch(/a cap \(/);
    });

    it("produces identical tables, sources and books when built twice from clean", () => {
        expect(secondResult.findings).toEqual([]);
        const hash = (dir: string, name: string) =>
            crypto
                .createHash("sha256")
                .update(fs.readFileSync(path.join(dir, "build", "dist", name)))
                .digest("hex");
        for (const name of [
            "pages.json",
            "sohl-a.typ",
            "sohl-b.typ",
            "sohl-c.typ",
            "sohl-a.pdf",
            "sohl-b.pdf",
            "sohl-c.pdf",
        ]) {
            expect(hash(second.dir, name), name).toBe(hash(run.dir, name));
        }
    });

    it("runs one pass for one book, with nothing to name and no second layout", async () => {
        const one = make([gear("a", ["dagger", "sword", "aegis", "axe"])]);
        let count = 0;
        const out = await buildPdf({
            config: one.config,
            readPages: (typ: string, fonts: string[], bin: string) => {
                count += 1;
                return readEntryPages(typ, fonts, bin);
            },
        });
        expect(out.findings).toEqual([]);
        expect(count).toBe(1);
        expect(fs.readFileSync(path.join(one.out, "sohl-a.typ"), "utf8")).not.toContain(
            "#emph[Book",
        );
        expect(
            Object.keys(JSON.parse(fs.readFileSync(path.join(one.out, "pages.json"), "utf8"))),
        ).toHaveLength(4);
    });

    it("builds a third time and reports what still differs when pages keep moving", async () => {
        const drifting = make(THREE);
        let count = 0;
        const out = await buildPdf({
            config: drifting.config,
            readPages: (typ: string, fonts: string[], bin: string) => {
                const round = Math.floor(count / 3);
                count += 1;
                const read = readEntryPages(typ, fonts, bin);
                return {
                    ...read,
                    pages: new Map([...read.pages].map(([label, page]) => [label, page + round])),
                };
            },
        });
        expect(count).toBe(9);
        const moved = out.findings.filter((f: any) => f.severity === "warning");
        expect(moved).toHaveLength(4);
        expect(moved[0].file).toMatch(/\.md$/);
        expect(moved[0].message).toMatch(
            /starts on page \d+ of `Book [A-C]`, but the references to it in other books print page \d+/,
        );
    });

    it("leaves a source that prints `?` and no table when Typst is not run", async () => {
        const dry = make(THREE);
        const out = await buildPdf({ config: dry.config, compile: false });
        expect(out.findings).toEqual([]);
        expect(fs.readFileSync(path.join(dry.out, "sohl-a.typ"), "utf8")).toContain("p.~?)");
        expect(fs.existsSync(path.join(dry.out, "pages.json"))).toBe(false);
    });
});
