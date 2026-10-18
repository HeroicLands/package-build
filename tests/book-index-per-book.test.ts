// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Each book's index lists the notes whose home book it is, with that book's
 * pages. A reprint is indexed in its home book alone, the pages agree with the
 * table the cross-book references read, and `pdf.indexSeeAlso` adds a
 * `Name: Book title, p. N` line for a note another book prints.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { configFromData } from "../engine/pack-config.mjs";
import { buildPdf } from "../engine/pdf-build.mjs";
import { indexChapter, indexPreamble, indexTerms } from "../engine/pdf-index.mjs";

const ok = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: "utf8" }).status === 0;
const HAS_TYPST = ok("typst", ["--version"]);
const HAS_POPPLER = ok("pdftotext", ["-v"]) && ok("pdfinfo", ["-v"]);

const entry = (slug: string, name: string) => ({
    kind: "note",
    anchor: `a-${slug}`,
    record: { name: { full: name }, address: { slug: `place-${slug}` }, type: "place" },
});

describe("the terms of one book's index", () => {
    const entries = [entry("a", "Alpha"), entry("b", "Beta")];

    it("leaves out a note the book prints but another book is home to", () => {
        const terms = indexTerms(entries, { owns: (e: any) => e.anchor !== "a-b" });
        expect(terms.map((t: any) => t.name)).toEqual(["Alpha"]);
    });

    it("lists a note another book prints only when see-also lines are asked for", () => {
        const foreign = [{ slug: "place-z", name: "Zeta", title: "Book Z", page: 7 }];
        expect(indexTerms(entries).map((t: any) => t.name)).toEqual(["Alpha", "Beta"]);
        const terms = indexTerms(entries, { foreign });
        expect(terms.map((t: any) => t.name)).toEqual(["Alpha", "Beta", "Zeta"]);
        expect(terms[2]).toMatchObject({
            slug: "place-z",
            foreign: { title: "Book Z", page: "7" },
        });
    });

    it("carries a home book's abbreviation into the term and the source", () => {
        const foreign = [
            { slug: "place-z", name: "Zeta", title: "Book Z", abbreviation: "Zed.", page: 7 },
        ];
        const terms = indexTerms(entries, { foreign });
        expect(terms[2].foreign).toEqual({ title: "Book Z", abbreviation: "Zed.", page: "7" });
        const source = indexChapter(entries, "T", { foreign });
        expect(source).toContain('abbreviation: "Zed."');
        expect(indexPreamble({ seeAlso: true })).toContain("#short~p#away.page");
    });

    it("writes the see-also machinery into the source only when asked", () => {
        const foreign = [{ slug: "place-z", name: "Zeta", title: "Book Z", page: 7 }];
        expect(indexChapter(entries, "T", { foreign })).toContain("foreign:");
        expect(indexChapter(entries, "T")).not.toContain("foreign");
    });
});

describe.skipIf(!HAS_TYPST || !HAS_POPPLER)("a package of two books", () => {
    const dirs: string[] = [];
    const savedEpoch = process.env.SOURCE_DATE_EPOCH;
    const savedConfig = process.env.PACKAGE_BUILD_CONFIG;

    const filler = Array.from(
        { length: 40 },
        (_, i) => `Paragraph ${i} of text that runs on.`,
    ).join("\n\n");
    const NOTES: Array<[string, string, string, string]> = [
        [
            "dagger",
            "weapongear",
            "Dagger",
            `See [the sword](/sohl/weapongear-sword/).\n\nSee [the aegis](/sohl/armorgear-aegis/).\n\n${filler}`,
        ],
        ["sword", "weapongear", "Sword", `See [the aegis](/sohl/armorgear-aegis/).\n\n${filler}`],
        ["aegis", "armorgear", "Aegis", `See [the sword](/sohl/weapongear-sword/).\n\n${filler}`],
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
    // Book B reprints the dagger, whose home is book A.
    const TWO = [gear("a", ["dagger", "sword"]), gear("b", ["aegis", "dagger"])];

    function make(extra: Record<string, unknown> = {}) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "book-index-"));
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
        for (const [shortcode, type, name, body] of NOTES) {
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
                unprinted: "type = 'homepage'",
                books: TWO,
                ...extra,
            },
        };
        const configPath = path.join(dir, "package-build.config.yaml");
        fs.writeFileSync(configPath, JSON.stringify(data));
        process.env.PACKAGE_BUILD_CONFIG = configPath;
        return { config: configFromData(data, configPath), out: path.join(dir, "build", "dist") };
    }

    /** The text of the pages the Index chapter occupies, reading order. */
    const indexText = (pdf: string) => {
        const pages = String(spawnSync("pdftotext", [pdf, "-"], { encoding: "utf8" }).stdout).split(
            "\f",
        );
        const first = pages.findIndex((page) => /^Index$/m.test(page) && /^[A-Z#]$/m.test(page));
        return pages.slice(first).join("\n");
    };
    /** The page numbers listed after a term in the index text. */
    const pagesOfTerm = (text: string, term: string) => {
        const found = text.match(new RegExp(`^${term}\\s+([\\d, ]+)$`, "m"));
        return found ? found[1].split(",").map((n) => Number(n.trim())) : undefined;
    };
    const slugsOf = (typ: string) =>
        [
            ...fs
                .readFileSync(typ, "utf8")
                .matchAll(/\(letter: "[^"]*", name: "[^"]*", slug: "([^"]*)"/g),
        ]
            .map((m) => m[1])
            .sort();

    let off: ReturnType<typeof make>;
    let on: ReturnType<typeof make>;
    let again: ReturnType<typeof make>;
    let table: Record<string, { book: string; page: number }>;

    beforeAll(async () => {
        process.env.SOURCE_DATE_EPOCH = "1700000000";
        off = make();
        expect((await buildPdf({ config: off.config })).findings).toEqual([]);
        on = make({ indexSeeAlso: true });
        expect((await buildPdf({ config: on.config })).findings).toEqual([]);
        again = make({ indexSeeAlso: true });
        await buildPdf({ config: again.config });
        table = JSON.parse(fs.readFileSync(path.join(off.out, "pages.json"), "utf8"));
    }, 240000);

    afterAll(() => {
        for (const dir of dirs.splice(0))
            if (!process.env.KEEP_FIXTURES) fs.rmSync(dir, { recursive: true, force: true });
        if (savedEpoch === undefined) delete process.env.SOURCE_DATE_EPOCH;
        else process.env.SOURCE_DATE_EPOCH = savedEpoch;
        if (savedConfig === undefined) delete process.env.PACKAGE_BUILD_CONFIG;
        else process.env.PACKAGE_BUILD_CONFIG = savedConfig;
    });

    it("holds only a book's own notes in its index, a reprint excluded", () => {
        expect(slugsOf(path.join(off.out, "sohl-a.typ"))).toEqual([
            "weapongear-dagger",
            "weapongear-sword",
        ]);
        expect(slugsOf(path.join(off.out, "sohl-b.typ"))).toEqual(["armorgear-aegis"]);
        const b = indexText(path.join(off.out, "sohl-b.pdf"));
        expect(b).toContain("Aegis");
        expect(b).not.toMatch(/^Dagger\b/m);
        expect(b).not.toMatch(/^Sword\b/m);
    });

    it("lists the home book's pages, the ones the cross-book references print", () => {
        const a = indexText(path.join(off.out, "sohl-a.pdf"));
        for (const [name, key] of [
            ["Dagger", "weapongear-dagger"],
            ["Sword", "weapongear-sword"],
        ]) {
            const note = Object.entries(table).find(([k]) => k.endsWith(key));
            expect(note?.[1].book).toBe("a");
            expect(pagesOfTerm(a, name)).toContain(note![1].page);
        }
        const b = indexText(path.join(off.out, "sohl-b.pdf"));
        const aegis = Object.entries(table).find(([k]) => k.endsWith("armorgear-aegis"))!;
        expect(pagesOfTerm(b, "Aegis")).toContain(aegis[1].page);
        // Book B prints "(Book A, p. N)" for the sword; N is the sword's page in A's index.
        const body = String(
            spawnSync("pdftotext", [path.join(off.out, "sohl-b.pdf"), "-"], { encoding: "utf8" })
                .stdout,
        ).replace(/\s+/g, " ");
        const printed = Number(body.match(/the sword \(Book A, p\. (\d+)\)/)?.[1]);
        expect(pagesOfTerm(a, "Sword")).toContain(printed);
    });

    it("prints no see-also line unless asked", () => {
        expect(indexText(path.join(off.out, "sohl-b.pdf"))).not.toMatch(/Book A, p\./);
        expect(indexText(path.join(off.out, "sohl-a.pdf"))).not.toMatch(/Book B, p\./);
    });

    it("prints Name: Book title, p. N for a mention of a note another book prints", () => {
        const sword = Object.entries(table).find(([k]) => k.endsWith("weapongear-sword"))![1].page;
        const aegis = Object.entries(table).find(([k]) => k.endsWith("armorgear-aegis"))![1].page;
        const b = indexText(path.join(on.out, "sohl-b.pdf")).replace(/\s+/g, " ");
        expect(b).toContain(`Sword: Book A, p. ${sword}`);
        const a = indexText(path.join(on.out, "sohl-a.pdf")).replace(/\s+/g, " ");
        expect(a).toContain(`Aegis: Book B, p. ${aegis}`);
        expect(slugsOf(path.join(on.out, "sohl-b.typ"))).toContain("weapongear-sword");
    });

    it("builds identical sources and books twice", () => {
        for (const stem of ["sohl-a", "sohl-b"]) {
            for (const ext of ["typ", "pdf"]) {
                expect(
                    fs
                        .readFileSync(path.join(on.out, `${stem}.${ext}`))
                        .equals(fs.readFileSync(path.join(again.out, `${stem}.${ext}`))),
                ).toBe(true);
            }
        }
    });
});
