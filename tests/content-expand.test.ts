/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * **`expandContent`: the one expansion step.** A note's body is expanded into
 * markdown with every index-dependent construct resolved — tables and the
 * generated sections, figure numbers, expressions and wikilinks — before any
 * target renders it.
 *
 * The target chooses only what the design says it chooses: the form a resolved
 * link takes (a Foundry `@UUID` content link, or a web URL), the form a `ref`
 * takes, and whether the generated sections are returned apart from the
 * author's text. A table, a figure's number and an expression's value read the
 * same on every target.
 */

import { describe, expect, it } from "vitest";

import { EXPANSION_TARGETS, expandContent } from "../engine/content-expand.mjs";
import { buildSiteIndex } from "../engine/site-index.mjs";
import { buildWikilinkIndex } from "../engine/wikilinks.mjs";

const PACKAGE = "demo";

const HARBOR = { type: "place", id: "a1b2c3d4e5f6a7b8", shortcode: "harbor", name: "Harbor" };
const SELF = { type: "lore", id: "1111222233334444", shortcode: "corpus", name: "The Corpus" };

/** The body every case expands. */
const BODY = [
    "The harbor is [[place-harbor|the harbor]], and the test {{eq 2 2}} holds.",
    "",
    ":@ Regional routes {#routes}",
    "",
    "```sql",
    "SELECT shortcode FROM notes",
    "```",
    "",
    'The table is {{ref "#routes"}}, and [[#routes|the routes]] are listed.',
    "",
    "```js",
    'const link = "[[place-harbor|not a link]]";',
    "```",
].join("\n");

/** The SQL preparation's results for {@link BODY}: one table, and a generated section. */
function prepared(): { sqlTables: any } {
    const sqlTables: any = [{ markdown: "| shortcode |\n| --- |\n| harbor |", rows: 1 }];
    sqlTables.generated = "## From here\n\nThe road leads to [[place-harbor|Harbor]].";
    return { sqlTables };
}

/** The note {@link BODY} belongs to. */
const NOTE = {
    fm: { type: "lore", subType: "concept", shortcode: "corpus", id: SELF.id, name: SELF.name },
    file: "/tree/assets/content/Lore/lore-corpus.md",
    source: "Lore/lore-corpus.md",
    bodyLine: 9,
    bodyColumn: 1,
};

/** The pack compile's link index, holding both notes. */
const foundryIndex = () => buildWikilinkIndex([HARBOR, SELF], PACKAGE, new Map(), PACKAGE);

/** The site's index, holding both pages. */
const webIndex = () =>
    buildSiteIndex(
        [
            {
                kind: "content",
                fm: { type: "place", shortcode: "harbor" },
                body: "",
                name: "Harbor",
                url: "/demo/place-harbor/",
                pkg: PACKAGE,
            },
            {
                kind: "content",
                fm: NOTE.fm,
                body: BODY,
                name: SELF.name,
                url: "/demo/lore-corpus/",
                pkg: PACKAGE,
            },
        ],
        { package: PACKAGE },
    );

const foundry = (body = BODY, options: Record<string, unknown> = {}) =>
    expandContent(body, {
        target: "foundry",
        index: foundryIndex(),
        note: NOTE,
        prepared: prepared(),
        links: { pack: "journals", docPack: "journals" },
        ...options,
    });

const web = (body = BODY, options: Record<string, unknown> = {}) =>
    expandContent(body, {
        target: "web",
        index: webIndex(),
        note: NOTE,
        prepared: prepared(),
        ...options,
    });

const UUID = String.raw`@UUID\[Compendium\.demo\.journals\.JournalEntry\.`;

/** A body with every resolved link reduced to its label. */
function labels(markdown: string): string {
    return markdown
        .replace(/@UUID\[[^\]]+\]\{([^}]*)\}/g, "$1")
        .replace(/\[([^\]]*)\]\((?:\/demo\/[^)]*|#[^)]*)\)/g, "$1");
}

describe("the targets", () => {
    it("are the pack compile, the website and the book", () => {
        expect(EXPANSION_TARGETS).toEqual(["foundry", "web", "book"]);
    });

    it("refuses a target it does not know, naming the ones it does", () => {
        expect(() => expandContent(BODY, { target: "pdf", index: {}, note: NOTE } as any)).toThrow(
            /`pdf` is not an expansion target; expected `foundry`, `web` or `book`$/,
        );
    });
});

describe("what every target expands alike", () => {
    it("replaces a sql fence with the table its query returned", () => {
        for (const expanded of [foundry(), web()]) {
            expect(expanded.markdown).toContain("| shortcode |\n| --- |\n| harbor |");
            expect(expanded.markdown).not.toContain("SELECT shortcode FROM notes");
            expect(expanded.findings.tables).toEqual([]);
        }
    });

    it("maps every expanded line to the authored line it came from", () => {
        for (const expanded of [foundry(), web()]) {
            const at = expanded.lineMap.findIndex((entry: any) => entry.generated);
            expect(expanded.lineMap[at].line).toBe(4);
        }
    });

    it("appends the generated sections after the author's text", () => {
        expect(foundry().markdown).toMatch(/are listed\.[\s\S]*## From here/);
        expect(web().markdown).toMatch(/are listed\.[\s\S]*## From here/);
    });

    it("numbers the figures, and an expression and a link read the number", () => {
        for (const expanded of [foundry(), web()]) {
            expect(
                expanded.figures.figures.map((figure: any) => [figure.id, figure.label]),
            ).toEqual([["routes", "Table 1"]]);
            expect(labels(expanded.markdown)).toContain(
                "The table is Table 1, and the routes are listed.",
            );
        }
    });

    it("evaluates an expression to the same value", () => {
        for (const expanded of [foundry(), web()]) {
            expect(expanded.markdown).toContain("the test true holds.");
            expect(expanded.findings.expressions).toEqual([]);
        }
    });

    it("leaves a code fence as written", () => {
        for (const expanded of [foundry(), web()])
            expect(expanded.markdown).toContain(
                '```js\nconst link = "[[place-harbor|not a link]]";\n```',
            );
    });

    it("reads the same on both targets once each link is reduced to its label", () => {
        expect(labels(foundry().markdown)).toBe(labels(web().markdown));
    });
});

describe("what the target changes", () => {
    it("writes a link as a Foundry content link, or as a web URL", () => {
        expect(foundry().markdown).toMatch(
            new RegExp(`The harbor is ${UUID}a1b2c3d4e5f6a7b8\\]\\{the harbor\\}`),
        );
        expect(web().markdown).toContain("The harbor is [the harbor](/demo/place-harbor/)");
    });

    it("writes a ref as a link to the figure's journal page, or to its anchor", () => {
        expect(foundry().markdown).toMatch(
            new RegExp(
                String.raw`The table is ${UUID}1111222233334444\.JournalEntryPage\.\w+\]\{Table 1\}`,
            ),
        );
        expect(web().markdown).toContain("The table is [Table 1](#routes)");
    });

    it("returns the generated sections apart from the author's text on the web", () => {
        const expanded = web();
        expect(expanded.authored).toMatch(/are listed\.[\s\S]*```\s*$/);
        expect(expanded.authored).not.toContain("From here");
        expect(expanded.generated).toBe(
            "## From here\n\nThe road leads to [Harbor](/demo/place-harbor/).",
        );
        expect(expanded.markdown).toBe(`${expanded.authored}\n${expanded.generated}`);
    });

    it("counts the links the author's text made apart from the generated ones on the web", () => {
        const expanded = web();
        expect(expanded.resolved.map((entry: any) => entry.url)).toEqual([
            "/demo/place-harbor/",
            "/demo/place-harbor/",
        ]);
        expect(expanded.authoredLinks).toBe(1);
    });

    it("keeps the generated sections in the one body in Foundry", () => {
        const expanded = foundry();
        expect(expanded.generated).toBe("");
        expect(expanded.authored).toBe(expanded.markdown);
        expect(expanded.markdown).toMatch(new RegExp(`The road leads to ${UUID}a1b2c3d4e5f6a7b8`));
    });

    it("runs the web's own passes on either side of the link pass", () => {
        const seen: string[] = [];
        const expanded = web(BODY, {
            links: {
                beforeLinks: (text: string) => {
                    seen.push("before");
                    return text.replace("The harbor is", "The port is");
                },
                afterLinks: (text: string) => {
                    seen.push("after");
                    expect(text).not.toContain("[[place-harbor|the harbor]]");
                    return text.replace("(/demo/place-harbor/)", "(/elsewhere/)");
                },
            },
        });
        expect(expanded.markdown).toContain("The port is [the harbor](/elsewhere/)");
        expect(seen.slice(0, 2)).toEqual(["before", "after"]);
    });
});

describe("what a target reports", () => {
    const LOST = "The way is [[place-nowhere|lost]].";

    it("marks an unresolved link on the web and reports it", () => {
        const expanded = web(LOST, { prepared: {} });
        expect(expanded.markdown).toBe(
            'The way is <span class="sohl-unresolved-link" title="Unresolved link: place-nowhere">lost</span>.',
        );
        expect(expanded.findings.links).toMatchObject([
            { target: "place-nowhere", reason: "unresolved", file: NOTE.file },
        ]);
        expect(expanded.linkError).toBeUndefined();
    });

    it("returns the error that fails the note for an unresolved link in Foundry", () => {
        const expanded = foundry(LOST, { prepared: {} });
        expect(expanded.linkError?.message).toMatch(
            /address \[\[place-nowhere\]\] resolves to no note[\s\S]* — in "Lore\/lore-corpus\.md"\./,
        );
        expect(expanded.linkError?.position).toMatchObject({ line: 9, column: 12 });
        expect(expanded.findings.links).toEqual([]);
    });

    it("reports a table the preparation did not answer, on both targets", () => {
        for (const expanded of [foundry(BODY, { prepared: {} }), web(BODY, { prepared: {} })])
            expect(expanded.findings.tables).toMatchObject([
                { reason: "SQL content table was not prepared", line: 4, column: 1 },
            ]);
    });

    it("reports a caption with no text, on both targets", () => {
        const body = ":@\n\nProse.";
        for (const expanded of [foundry(body), web(body)])
            expect(expanded.findings.captions).toEqual([
                { line: 1, column: 1, message: "a caption needs text" },
            ]);
    });

    it("reports an expression it cannot evaluate, on both targets", () => {
        const body = "It reads {{nosuchhelper 1}}.";
        for (const expanded of [foundry(body, { prepared: {} }), web(body, { prepared: {} })]) {
            expect(expanded.findings.expressions.length).toBe(1);
            expect(expanded.findings.expressions[0].line).toBe(9);
        }
    });
});
