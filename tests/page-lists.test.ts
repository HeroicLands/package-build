/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A page list: a tag in, the pages carrying it out, on every surface.
 *
 * The construct is a sibling of the `sql` content table and is answered the
 * same way — prepared over the content index before the synchronous expansion
 * pass runs, then spliced into the body as ordinary Markdown so the wikilinks
 * it emits are resolved by whichever surface is building.
 *
 * Three things are asserted here. That the directive reads its own attributes
 * and reports every malformed form at the fence's own position. That the
 * selection, the order and the emitted list are what the attributes ask for.
 * And that the expanded list reaches a reader as a list of links on the web and
 * in the book — the Foundry surface is driven through a real compile in
 * `page-lists-compile.test.ts`, which is the only thing that can show the
 * directive being answered before the walk begins.
 *
 * The last block is the completeness guard: the attribute list is the one
 * list, so every name in it is derived at runtime and required of both
 * documents. A hand-copied second list is one more thing to drift.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    PAGE_LIST_ATTRIBUTES,
    PAGE_LIST_LANGUAGE,
    PAGE_LIST_SORTS,
    findPageListBlocks,
    preparePageLists,
} from "../engine/page-lists.mjs";
import { SQL_FENCE_ATTRIBUTES } from "../engine/sql-tables.mjs";
import { expandContentTables } from "../engine/content-tables.mjs";
import { resolveWebWikilinks } from "../engine/web-wikilinks.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** One authored body, as a note would carry it. */
const body = (...lines: string[]) => lines.join("\n");

/** A fence, written as an author writes it. */
const fence = (attributes: string) => body("```" + PAGE_LIST_LANGUAGE + " " + attributes, "```");

/** An index record for a written note, as `buildIndexRecord` shapes one. */
function note(
    type: string,
    shortcode: string,
    full: string,
    extra: Record<string, unknown> = {},
): Record<string, any> {
    return {
        package: "sohl",
        type,
        shortcode,
        name: { full },
        nameAscii: full,
        address: {
            slug: `${type}-${shortcode}`,
            canonical: { package: "sohl", system: "note", type, shortcode },
        },
        documentation: null,
        file: { path: `${full}.md`, folder: "", name: full },
        ...extra,
    };
}

const RECORDS: Record<string, any>[] = [
    note("lore", "harbor", "The Harbor", {
        tags: ["key-concept"],
        description: "A sheltered trading port.",
    }),
    note("lore", "assize", "Assize", { tags: ["key-concept", "draft"] }),
    note("place", "market", "Market Square", {
        tags: ["#Key-Concept"],
        description: "Where the hulls sell.",
    }),
    note("place", "reeds", "The Reed Flats", { tags: ["terrain"] }),
    // A stub publishes no page, so it holds no address and joins no list.
    { ...note("lore", "tithe", "Tithe", { tags: ["key-concept"] }), address: null },
];

/** Prepare one body's page lists, in the shape the expander reads. */
function prepared(markdown: string, records = RECORDS) {
    const map = preparePageLists(records, [{ source: "Guides/Gear.md", markdown }]);
    return map.get("Guides/Gear.md") ?? [];
}

/** Expand one body, with its page lists already answered. */
function expand(markdown: string, records = RECORDS) {
    return expandContentTables(markdown, {
        source: "Guides/Gear.md",
        pageLists: prepared(markdown, records),
    });
}

/** The site index a resolved wikilink is looked up in. */
function webContext(output?: string) {
    const page = (slug: string, name: string) => ({ url: `/${slug}/`, name });
    return {
        index: new Map<string, object>([
            ["sohl-note-lore-harbor", page("lore-harbor", "The Harbor")],
            // Tagged `draft` in the index, so the cue is the resolver's to add.
            ["sohl-note-lore-assize", { ...page("lore-assize", "Assize"), draft: true }],
            ["sohl-note-place-market", page("place-market", "Market Square")],
        ]),
        collide: new Set<string>(),
        sections: new Set<string>(),
        contentPackage: "sohl",
        contentTypes: new Set<string>(["lore", "place", "doc"]),
        type: "doc",
        errors: [] as object[],
        src: "Guides/Gear.md",
        ...(output ? { output } : {}),
    };
}

describe("a page-list directive reads its own attributes", () => {
    it("finds the directive and reports where it sits", () => {
        const blocks = findPageListBlocks(
            body("Prose.", "", ...fence('{tag="key-concept"}').split("\n"), "", "After."),
        );
        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toMatchObject({ line: 2, close: 3, tag: "key-concept", problems: [] });
    });

    it("takes its defaults from the attribute list", () => {
        const [block] = findPageListBlocks(fence('{tag="key-concept"}'));
        expect(block).toMatchObject({
            type: "",
            sort: "name",
            descriptions: false,
            allowEmpty: false,
        });
    });

    it("reads every attribute it accepts", () => {
        const [block] = findPageListBlocks(
            fence('{tag="key-concept" type=place sort=type descriptions=true allow-empty=true}'),
        );
        expect(block).toMatchObject({
            tag: "key-concept",
            type: "place",
            sort: "type",
            descriptions: true,
            allowEmpty: true,
            problems: [],
        });
    });

    it("reports an attribute it does not accept, by name", () => {
        const [block] = findPageListBlocks(fence('{tag="key-concept" colour=red}'));
        expect(block.problems.join("; ")).toContain("colour");
    });

    it("reports a directive with no tag", () => {
        const [block] = findPageListBlocks(fence("{sort=type}"));
        expect(block.problems.join("; ")).toMatch(/needs a tag/);
    });

    it("reports a sort order it does not know", () => {
        const [block] = findPageListBlocks(fence('{tag="key-concept" sort=weight}'));
        expect(block.problems.join("; ")).toMatch(/sort needs/);
    });

    it("reports a type that is no note type", () => {
        const [block] = findPageListBlocks(fence('{tag="key-concept" type=plce}'));
        expect(block.problems.join("; ")).toMatch(/plce/);
    });

    it("reports a value that is not a Boolean", () => {
        const [block] = findPageListBlocks(fence('{tag="key-concept" descriptions=yes}'));
        expect(block.problems.join("; ")).toMatch(/true or false/);
    });

    it("reports a body written inside the fence", () => {
        const [block] = findPageListBlocks(
            body("```" + PAGE_LIST_LANGUAGE + ' {tag="key-concept"}', "key-concept", "```"),
        );
        expect(block.problems.join("; ")).toMatch(/takes no body/);
    });

    it("reports a fence that is never closed", () => {
        const [block] = findPageListBlocks(
            body("```" + PAGE_LIST_LANGUAGE + ' {tag="key-concept"}', "Prose that follows."),
        );
        expect(block.problems.join("; ")).toMatch(/closing fence/);
    });

    it("leaves a directive shown as an example alone", () => {
        const shown = body(
            "````markdown",
            "```" + PAGE_LIST_LANGUAGE + ' {tag="key-concept"}',
            "```",
            "````",
        );
        expect(findPageListBlocks(shown)).toEqual([]);
    });
});

describe("a page list selects and orders the pages carrying its tag", () => {
    it("lists every page carrying the tag, in name order", () => {
        const [result] = prepared(fence('{tag="key-concept"}'));
        expect(result.markdown).toBe(
            body(
                "- [[lore-assize|Assize]]",
                "- [[place-market|Market Square]]",
                "- [[lore-harbor|The Harbor]]",
            ),
        );
        expect(result.pages).toBe(3);
    });

    it("matches a tag however the author wrote it", () => {
        // `#Key-Concept` on one note and `key-concept` on another are the same
        // tag, which is the frontmatter rule rather than a second reading of it.
        const [result] = prepared(fence('{tag="key-concept"}'));
        expect(result.markdown).toContain("Market Square");
    });

    it("leaves a stub out, because a stub publishes no page", () => {
        const [result] = prepared(fence('{tag="key-concept"}'));
        expect(result.markdown).not.toContain("Tithe");
    });

    it("restricts the list to one note type", () => {
        const [result] = prepared(fence('{tag="key-concept" type=lore}'));
        expect(result.pages).toBe(2);
        expect(result.markdown).not.toContain("Market Square");
    });

    it("orders by type and then by name", () => {
        const [result] = prepared(fence('{tag="key-concept" sort=type}'));
        expect(result.markdown).toBe(
            body(
                "- [[lore-assize|Assize]]",
                "- [[lore-harbor|The Harbor]]",
                "- [[place-market|Market Square]]",
            ),
        );
    });

    it("prints each page's description when asked", () => {
        const [result] = prepared(fence('{tag="key-concept" descriptions=true}'));
        expect(result.markdown).toContain("[[lore-harbor|The Harbor]] — A sheltered");
        // A page with no description of its own carries its link alone.
        expect(result.markdown).toContain("- [[lore-assize|Assize]]\n");
    });

    it("names the tag when nothing carries it", () => {
        const [result] = prepared(fence('{tag="key-concpet"}'));
        expect(result.pages).toBe(0);
        expect(result.empty).toContain("key-concpet");
    });

    it("names the type as well, when the directive restricts one", () => {
        const [result] = prepared(fence('{tag="terrain" type=lore}'));
        expect(result.empty).toContain("terrain");
        expect(result.empty).toContain("lore");
    });

    it("carries a malformed directive's reason rather than a list", () => {
        const [result] = prepared(fence("{sort=name}"));
        expect(result.reason).toMatch(/needs a tag/);
        expect(result.markdown).toBeUndefined();
    });
});

describe("the expander splices a page list where its directive sat", () => {
    it("replaces the directive with the list and keeps the prose around it", () => {
        const source = body(
            "Before.",
            "",
            ...fence('{tag="key-concept"}').split("\n"),
            "",
            "After.",
        );
        const result = expand(source);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toContain("- [[lore-harbor|The Harbor]]");
        expect(result.markdown).not.toContain(PAGE_LIST_LANGUAGE);
        expect(result.markdown).toContain("Before.");
        expect(result.markdown).toContain("After.");
    });

    it("maps every generated line back to the directive's own line", () => {
        const source = body("Before.", "", ...fence('{tag="key-concept"}').split("\n"));
        const result = expand(source);
        expect(result.lineMap.some((line) => line.generated && line.line === 2)).toBe(true);
    });

    it("reports a tag that selects nothing, at the fence's line and column", () => {
        const result = expand(body("Prose.", "", ...fence('{tag="key-concpet"}').split("\n")));
        expect(result.errors[0]).toMatchObject({
            source: "Guides/Gear.md",
            line: 2,
            column: 1,
        });
        expect(result.errors[0].reason).toContain("key-concpet");
    });

    it("permits an empty list where the directive says so", () => {
        const source = fence('{tag="key-concpet" allow-empty=true}');
        const result = expand(source);
        expect(result.errors).toEqual([]);
        expect(result.markdown.trim()).toBe("");
    });

    it("reports a directive nothing prepared, rather than printing it", () => {
        const result = expandContentTables(fence('{tag="key-concept"}'), {
            source: "Guides/Gear.md",
        });
        expect(result.errors[0]).toMatchObject({ source: "Guides/Gear.md", line: 0, column: 1 });
        expect(result.errors[0].reason).toMatch(/not prepared/);
    });

    it("keeps a table and a page list in one body apart", () => {
        const source = body(
            "```sql",
            "SELECT name.full AS Name FROM notes",
            "```",
            "",
            ...fence('{tag="key-concept"}').split("\n"),
        );
        const result = expandContentTables(source, {
            source: "Guides/Gear.md",
            sqlTables: [{ markdown: "| Name |\n| --- |\n| A |", rows: 1, allowEmpty: false }],
            pageLists: prepared(source),
        });
        expect(result.errors).toEqual([]);
        expect(result.markdown).toContain("| A |");
        expect(result.markdown).toContain("- [[lore-harbor|The Harbor]]");
    });
});

describe("a page list reaches the reader on every surface", () => {
    const expanded = () => expand(fence('{tag="key-concept" descriptions=true}')).markdown;

    it("renders as a list of links on the web", () => {
        const web = resolveWebWikilinks(expanded(), webContext() as never);
        expect(web).toContain("- [The Harbor](/lore-harbor/)");
        expect(web).toContain("A sheltered trading port.");
        expect(web).not.toContain("[[");
    });

    it("carries a draft note's cue, because the link is an ordinary one", () => {
        const web = resolveWebWikilinks(expanded(), webContext() as never);
        expect(web).toContain("sohl-draft-link");
    });

    it("renders as a list of links in the book", () => {
        const resolved = resolveWebWikilinks(expanded(), webContext("book") as never);
        const findings: object[] = [];
        const typst = markdownToTypst(resolved, { findings });
        expect(typst).toContain("#list(");
        expect(typst).toContain("The Harbor");
        expect(findings).toEqual([]);
    });
});

/**
 * The documents name every attribute the directive accepts.
 *
 * Derived from the frozen list rather than from a second copy, so an attribute
 * added to the code fails here until both documents describe it. The same
 * assertion covers the `sql` fence, whose attribute list makes the same claim
 * about its own documentation.
 */
describe("the documents enumerate what the directive accepts", () => {
    const MARKUP = fs.readFileSync(path.join(ROOT, "docs/authoring/links-and-markup.md"), "utf8");
    const DETAILS = fs.readFileSync(path.join(ROOT, "docs/reference/format-details.md"), "utf8");

    it("names the directive itself in both documents", () => {
        expect(MARKUP).toContain(PAGE_LIST_LANGUAGE);
        expect(DETAILS).toContain(PAGE_LIST_LANGUAGE);
    });

    for (const name of Object.keys(PAGE_LIST_ATTRIBUTES)) {
        it(`names the page-list attribute \`${name}\``, () => {
            expect(MARKUP, `\`${name}\` is not named`).toContain(`\`${name}\``);
            expect(DETAILS, `\`${name}\` is not named`).toContain(`${name}`);
        });
    }

    for (const name of PAGE_LIST_SORTS) {
        it(`names the sort order \`${name}\``, () => {
            expect(MARKUP, `sort \`${name}\` is not named`).toContain(`\`${name}\``);
        });
    }

    for (const name of Object.keys(SQL_FENCE_ATTRIBUTES)) {
        it(`names the SQL fence attribute \`${name}\``, () => {
            expect(MARKUP, `\`${name}\` is not named`).toContain(`\`${name}\``);
            expect(DETAILS, `\`${name}\` is not named`).toContain(`${name}`);
        });
    }
});
