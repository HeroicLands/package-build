// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, it, expect } from "vitest";
import YAML from "yaml";

import { nameSortKey } from "../engine/name-sort.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_NAME_KEYS } from "../engine/note-frontmatter.mjs";
import { indexTerms } from "../engine/pdf-index.mjs";
import { relatedPages } from "../engine/related-pages.mjs";
import { holdingsPages } from "../engine/holdings.mjs";
import { worksNode, worksPages } from "../engine/literature-works.mjs";
import { preparePageLists } from "../engine/page-lists.mjs";
import { openNotesDatabase, runSqlQuery } from "../engine/sql-tables.mjs";
import * as pdfToc from "../engine/pdf-toc.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const { parseDocumentTree, planDocument } = pdfToc as any;

const lint = (name: unknown) =>
    lintNote(
        {
            file: "/tree/lore.md",
            type: "lore",
            raw: "---\ntype: lore\nname:\n    full: X\n---\n",
            fm: { type: "lore", name },
        } as any,
        { schemas: NOTE_SCHEMAS } as any,
    ).map((finding: any) => finding.message);

describe("name.sort in the frontmatter", () => {
    it("is a declared name key", () => {
        expect(NOTE_NAME_KEYS).toContain("sort");
    });

    it("is accepted as a nonempty string", () => {
        expect(lint({ full: "The Black Flame", sort: "Black Flame" }).join("\n")).not.toContain(
            "name.sort",
        );
    });

    it("is refused when empty or not a string", () => {
        for (const sort of ["", "  ", 4, ["Black Flame"], null]) {
            expect(lint({ full: "The Black Flame", sort }).join("\n")).toContain(
                "`name.sort` must be a nonempty string",
            );
        }
    });
});

describe("the sort key", () => {
    it("is the declared sort, otherwise the full name, folded to ASCII", () => {
        expect(nameSortKey({ name: { full: "The Black Flame", sort: "Black Flame" } })).toBe(
            "Black Flame",
        );
        expect(nameSortKey({ name: { full: "Árdavon" } })).toBe("Ardavon");
        expect(nameSortKey({ name: { full: "Árdavon", sort: "Édavon" } })).toBe("Edavon");
    });
});

describe("the book index", () => {
    const note = (slug: string, full: string, sort?: string) => ({
        kind: "note",
        depth: 1,
        anchor: `a-${slug}`,
        trail: [],
        record: { name: { full, ...(sort ? { sort } : {}) }, address: { slug: `lore-${slug}` } },
    });

    it("prints a note's sort form as its entry and files and letters it by that form", () => {
        const terms = indexTerms([
            note("brazemas", "Brazemas"),
            note("flame", "The Black Flame", "Black Flame, The"),
            note("bryn", "Bryn"),
            note("tower", "The Tower"),
        ]);
        expect(terms.map((t: any) => [t.letter, t.name])).toEqual([
            ["B", "Black Flame, The"],
            ["B", "Brazemas"],
            ["B", "Bryn"],
            ["T", "The Tower"],
        ]);
    });

    it("lists a note with no sort under its full name", () => {
        const terms = indexTerms([note("flame", "The Black Flame"), note("ash", "Ash")]);
        expect(terms.map((t: any) => t.letter)).toEqual(["A", "T"]);
    });
});

describe("the entries relation", () => {
    it("exposes nameSort: the declared sort, otherwise the full name", async () => {
        const db = await openNotesDatabase([
            {
                type: "lore",
                shortcode: "flame",
                name: { full: "The Black Flame", sort: "Black Flame" },
            },
            { type: "lore", shortcode: "tower", name: { full: "The Tower" } },
        ] as any);
        try {
            const { rows } = await runSqlQuery(
                db,
                "SELECT shortcode, nameSort FROM entries ORDER BY nameSort",
            );
            expect(rows).toEqual([
                { shortcode: "flame", nameSort: "Black Flame" },
                { shortcode: "tower", nameSort: "The Tower" },
            ]);
        } finally {
            await db.close();
        }
    }, 60_000);
});

describe("generated name-ordered lists", () => {
    it("orders a page list by the sort key", () => {
        const record = (shortcode: string, full: string, sort?: string) => ({
            package: "sohl",
            type: "lore",
            shortcode,
            name: { full, ...(sort ? { sort } : {}) },
            nameAscii: full,
            tags: ["t"],
            address: {
                slug: `lore-${shortcode}`,
                canonical: { package: "sohl", system: "note", type: "lore", shortcode },
            },
            documentation: null,
            file: { path: `${full}.md`, folder: "", name: full },
        });
        const markdown = '```pagelist {tag="t"}\n```';
        const out = preparePageLists(
            [
                record("a", "Brazemas"),
                record("f", "The Black Flame", "Black Flame"),
                record("z", "Zed"),
            ] as any,
            [{ source: "G.md", markdown }],
        ).get("G.md");
        expect(out?.[0].markdown).toBe(
            ["- [[lore-f|The Black Flame]]", "- [[lore-a|Brazemas]]", "- [[lore-z|Zed]]"].join(
                "\n",
            ),
        );
    });

    it("orders a book section's notes by the sort key", () => {
        const yaml =
            "contents:\n  - sectionName: S\n    contents:\n      - filter: type = 'lore'\n";
        const { nodes } = parseDocumentTree(YAML.parse(yaml), { text: yaml });
        const rec = (slug: string, full: string, sort?: string) => ({
            address: { slug, canonical: `sohl-sohl-${slug}` },
            name: { full, ...(sort ? { sort } : {}) },
            nameAscii: full,
        });
        const { entries } = planDocument(nodes, {
            selections: new Map([
                [
                    nodes[0].items[0].id,
                    [rec("a", "Brazemas"), rec("f", "The Black Flame", "Black Flame")],
                ],
            ]),
        });
        expect(
            entries.filter((e: any) => e.kind === "note").map((e: any) => e.record.name.full),
        ).toEqual(["The Black Flame", "Brazemas"]);
    });

    it("orders the places a place holds by the sort key", () => {
        const node = (shortcode: string, title: string, sort?: string, extra: any = {}) => ({
            shortcode,
            type: "place" as const,
            subType: "settlement",
            title,
            ...(sort ? { sort } : {}),
            url: `/d/place-${shortcode}/`,
            parents: [],
            package: "d",
            ...extra,
        });
        const pages = holdingsPages([
            node("home", "Home", undefined, { subType: "region" }),
            node("a", "Brazemas", undefined, { parents: ["home"] }),
            node("f", "The Black Flame", "Black Flame", { parents: ["home"] }),
        ] as any);
        expect(pages.get("/d/place-home/")?.contains?.map((e: any) => e.title)).toEqual([
            "The Black Flame",
            "Brazemas",
        ]);
    });

    it("orders the works naming a note by the sort key", () => {
        const types = new Set(["place", "lore"]);
        const place = worksNode(
            { type: "place", shortcode: "home", name: { full: "Home" } },
            { title: "Home", url: "/d/place-home/", package: "d" },
        );
        const work = (shortcode: string, title: string, sort?: string) =>
            worksNode(
                {
                    type: "lore",
                    subType: "literature",
                    shortcode,
                    name: { full: title, ...(sort ? { sort } : {}) },
                    data: { subjects: ["place-home"] },
                },
                { title, url: `/d/lore-${shortcode}/`, package: "d" },
            );
        const pages = worksPages(
            [place, work("a", "Brazemas"), work("f", "The Black Flame", "Black Flame")],
            { types },
        );
        expect(pages.get("/d/place-home/")?.works.map((e: any) => e.title)).toEqual([
            "The Black Flame",
            "Brazemas",
        ]);
    });

    it("orders backlinks by the sort key without publishing it", () => {
        const entry = (n: string, title: string, sort?: string) => [
            `/d/${n}/`,
            { title, url: `/d/${n}/`, type: "lore", ...(sort ? { sort } : {}) },
        ];
        const entries = new Map([
            entry("home", "Home"),
            entry("a", "Brazemas"),
            entry("f", "The Black Flame", "Black Flame"),
        ] as any);
        const related = relatedPages(
            [
                ["/d/a/", "/d/home/"],
                ["/d/f/", "/d/home/"],
            ],
            entries as any,
        );
        expect(related.get("/d/home/")?.backlinks).toEqual([
            { title: "The Black Flame", url: "/d/f/", type: "lore" },
            { title: "Brazemas", url: "/d/a/", type: "lore" },
        ]);
    });
});
