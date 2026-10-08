// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { markdownToTypst, renderBook } from "../engine/pdf-render.mjs";
import { compileTypst } from "../engine/pdf-build.mjs";
import { indexTerms } from "../engine/pdf-index.mjs";

const HAS_TYPST = spawnSync("typst", ["--version"], { encoding: "utf8" }).status === 0;
const HAS_PDFTOTEXT = spawnSync("pdftotext", ["-v"], { encoding: "utf8" }).status === 0;

/** A note entry as the plan carries it. */
function note(slug: string, name: string, extra: Record<string, unknown> = {}) {
    return {
        kind: "note",
        depth: 1,
        anchor: `a-${slug}`,
        trail: ["Places"],
        record: { name: { full: name }, address: { slug: `place-${slug}` }, ...extra },
    };
}

const SECTION = { kind: "section", title: "Places", depth: 1, anchor: "places", trail: ["Places"] };

const PLAN = {
    entries: [
        SECTION,
        note("zed", "Zed Keep", {
            data: { events: [{ id: "siege", names: [{ name: "The Long Siege" }] }] },
        }),
        note("eclair", "Éclair Harbour", {
            name: { full: "Éclair Harbour", aliases: ["Port Eclair"] },
        }),
        note("apple", "Apple Hill"),
    ],
    links: new Map([
        ["place-zed", "a-zed"],
        ["place-eclair", "a-eclair"],
        ["place-apple", "a-apple"],
    ]),
    stats: {},
};

describe("index terms", () => {
    const terms = indexTerms(PLAN.entries);

    it("files an accented name under its base letter, in folded order", () => {
        expect(terms.map((t: any) => t.name)).toEqual([
            "Apple Hill",
            "Éclair Harbour",
            "Port Eclair",
            "The Long Siege",
            "Zed Keep",
        ]);
        expect(terms.map((t: any) => t.letter)).toEqual(["A", "E", "P", "T", "Z"]);
    });

    it("turns an alias and an event name into a cross-reference to the main name", () => {
        const alias = terms.find((t: any) => t.name === "Port Eclair");
        expect(alias).toMatchObject({ see: "Éclair Harbour", slug: "place-eclair" });
        const event = terms.find((t: any) => t.name === "The Long Siege");
        expect(event).toMatchObject({ see: "Zed Keep", slug: "place-zed" });
    });

    it("lists a note selected twice once", () => {
        const twice = indexTerms([...PLAN.entries, PLAN.entries[3]]);
        expect(twice.filter((t: any) => t.name === "Apple Hill")).toHaveLength(1);
    });

    it("qualifies two notes printing one name with their subtype, then their parent place", () => {
        const withKind = (slug: string, name: string, type: string, subType: string, data = {}) =>
            note(slug, name, {
                type,
                subType,
                data,
                address: { slug, canonical: `pkg-note-${slug}` },
            });
        const plain = indexTerms([
            withKind("place-ashkabel", "Ashkabel", "place", "settlement"),
            withKind("being-ashkabel", "Ashkabel", "being", "character"),
            withKind("being-ashkabel-dwarf", "Ashkabel Dwarf", "being", "creature", {}),
        ]);
        expect(plain.map((t: any) => t.name)).toEqual([
            "Ashkabel (character)",
            "Ashkabel (settlement)",
            "Ashkabel Dwarf",
        ]);

        const parents = indexTerms([
            withKind("place-north", "North", "place", "region"),
            withKind("place-south", "South", "place", "region"),
            withKind("place-a", "Ashkabel", "place", "settlement", {
                parents: ["pkg-note-place-north"],
            }),
            withKind("place-b", "Ashkabel", "place", "settlement", {
                parents: ["pkg-note-place-south"],
            }),
        ]);
        expect(
            parents.filter((t: any) => t.name.startsWith("Ashkabel")).map((t: any) => t.name),
        ).toEqual(["Ashkabel (settlement, North)", "Ashkabel (settlement, South)"]);
    });

    it("prints the qualifier in a cross-reference to a qualified name", () => {
        const aliased = indexTerms([
            note("a", "Ashkabel", {
                type: "place",
                subType: "settlement",
                name: { full: "Ashkabel", aliases: ["The Hold"] },
            }),
            note("b", "Ashkabel", { type: "being", subType: "character" }),
        ]);
        expect(aliased.find((t: any) => t.name === "The Hold")).toMatchObject({
            see: "Ashkabel (settlement)",
        });
    });

    it("sets a main entry's page in bold and a mention's in regular weight", () => {
        const out = renderBook({ plan: PLAN, title: "A Book" });
        expect(out).toContain('weight: if p.main { "bold" } else { "regular" }');
    });

    it("drops an alias that folds to the main name", () => {
        const same = indexTerms([
            note("a", "Eclair", { name: { full: "Eclair", aliases: ["Éclair", "eclair"] } }),
        ]);
        expect(same.map((t: any) => t.name)).toEqual(["Eclair"]);
    });
});

describe("index markers in the book source", () => {
    const mention = (opts = {}) =>
        markdownToTypst("See [the keep](/p/place-zed/) and [x](https://example.org/).", {
            links: PLAN.links,
            ...opts,
        });

    it("marks an authored wikilink to a note in the book", () => {
        const out = mention({ indexMentions: true, url: "https://example.org/" });
        expect(out).toContain("#link(<a-zed>)[");
        expect(out).toContain('#book-ix("place-zed")');
    });

    it("marks nothing unless the caller asks for mentions to be indexed", () => {
        expect(mention()).not.toContain("book-ix");
    });

    it("marks nothing for a note that is not in the book", () => {
        const out = markdownToTypst("A link to [far](/places/place-far/).", {
            indexMentions: true,
            links: new Map(),
        });
        expect(out).not.toContain("book-ix");
    });

    it("marks each entry's own heading as its main entry", () => {
        const out = renderBook({ plan: PLAN, title: "A Book" });
        expect(out).toContain('#book-ix("place-zed", main: true)');
        expect(out).toContain('#book-ix("place-apple", main: true)');
    });

    it("ends with an Index chapter, and has none when no note is printed", () => {
        const out = renderBook({ plan: PLAN, title: "A Book" });
        expect(out).toContain("[Index]");
        expect(out.lastIndexOf("#book-index((")).toBeGreaterThan(out.lastIndexOf("#book-entry("));
        const empty = renderBook({
            plan: { entries: [SECTION], links: new Map() },
            title: "A Book",
        });
        expect(empty).not.toContain("[Index]");
        expect(empty).not.toContain("#book-index((");
    });
});

describe.runIf(HAS_TYPST && HAS_PDFTOTEXT)("the compiled index", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "book-index-"));
    const typ = path.join(dir, "book.typ");
    const pdf = path.join(dir, "book.pdf");
    const render = (text: string) =>
        markdownToTypst(text, { links: PLAN.links, indexMentions: true });
    // A generated section is rendered without `indexMentions`.
    const generated = markdownToTypst("Generated [apple](/p/place-apple/) [zed](/p/place-zed/)", {
        links: PLAN.links,
    });
    const bodies = new Map([
        ["a-zed", render("Zed prose sentence. See [the hill](/p/place-apple/).")],
        ["a-eclair", `Eclair prose sentence.\n\n${generated}\n\n${render("[far](/x/place-far/)")}`],
        ["a-apple", render("Apple prose sentence.")],
    ]);
    fs.writeFileSync(typ, renderBook({ plan: PLAN, title: "A Book", bodies }));
    const compiled = compileTypst(typ, pdf);
    const pages = spawnSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8" }).stdout.split(
        "\f",
    );
    const pageOf = (needle: string) => pages.findIndex((p) => p.includes(needle)) + 1;
    const indexText = pages.slice(pageOf("Apple prose sentence")).join("\n");

    it("compiles", () => {
        expect(compiled.ok, compiled.message).toBe(true);
    });

    it("lists terms in folded order under letter headings", () => {
        const order = ["Apple Hill", "Éclair Harbour", "Port Eclair", "The Long Siege", "Zed Keep"];
        const lines = indexText.split("\n");
        const positions = order.map((s) => lines.findIndex((l) => l.trim().startsWith(s)));
        expect(positions.every((p) => p >= 0)).toBe(true);
        expect([...positions].sort((a, b) => a - b)).toEqual(positions);
        for (const letter of ["A", "E", "P", "T", "Z"]) {
            expect(indexText).toMatch(new RegExp(`^\\s*${letter}\\s*$`, "m"));
        }
    });

    it("gives an entry its own page and each authored mention's page, once", () => {
        const apple = pageOf("Apple prose sentence");
        const zed = pageOf("Zed prose sentence");
        const line = indexText.split("\n").find((l) => /^\s*Apple Hill/.test(l)) ?? "";
        expect(line).toMatch(new RegExp(`${zed},\\s*${apple}|${apple},\\s*${zed}`));
        // The generated mention on Éclair's page adds nothing.
        expect(line).not.toContain(String(pageOf("Eclair prose sentence")));
    });

    it("cross-references an alias and an event name to the main name", () => {
        expect(indexText).toMatch(/Port Eclair,?\s+see\s+Éclair Harbour/);
        expect(indexText).toMatch(/The Long Siege,?\s+see\s+Zed Keep/);
    });
});
