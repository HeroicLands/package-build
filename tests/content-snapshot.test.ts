/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * **The content snapshots.** A site and a book render the same notes by
 * different routes, and a change to how either is built must leave what a
 * reader reads alone. The snapshots record that reading as text: for every page
 * of thalorna's site its title, its visible text and its outgoing link targets,
 * and for every entry of its books the text of the Typst source. Text is
 * compared, never markup.
 *
 * Regenerate them from a thalorna checkout whose dependencies are installed:
 *
 *     node tests/snapshots/regenerate.mjs <thalorna-checkout> [--verify]
 *
 * The script installs this package into the checkout from a tarball, builds
 * the site with `package-build site build` and builds each book's Typst source
 * without compiling it. With `--verify` it builds twice and requires the two
 * snapshots to be identical.
 *
 * A change that is meant to leave a reader's page alone compares a new build
 * with these fixtures using `compareSnapshots` in
 * `tests/snapshots/content-snapshot.mjs`.
 *
 * This case holds the extraction to its rules and the committed fixtures to
 * their shape.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
    bookEntries,
    compareSnapshots,
    linkTarget,
    pageText,
    pageUrl,
    readSnapshot,
    typstText,
} from "./snapshots/content-snapshot.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures", "snapshots");

describe("the text of a page", () => {
    const page = `<!doctype html><html><head><title>Harbor &mdash; Demo</title>
<script>var chrome = "not text";</script></head><body>
<header><a href="/demo/">Home</a></header>
<main>
  <article><span data-pagefind-filter="type" hidden>place</span>
    <h1>Harbor</h1>
    <p>A <em>sheltered</em> place, where <strong>ships</strong>&nbsp;lie &amp; wait.</p>
    <p>See <a href="/demo/place-quay/">the quay</a>, <a href="../lore-sea/#tides">tides</a>
       and <a href="https://example.org/x">elsewhere</a>.</p>
    <script>var alsoNot = "text";</script>
    <style>.x { color: red }</style>
    <ul><li>One</li><li>Two</li></ul>
  </article>
</main>
<footer>&copy; Someone</footer></body></html>`;
    const result = pageText(page, "/place-harbor/", "https://www.heroiclands.org");

    it("is the title and the text of main, with inline tags joined and block tags apart", () => {
        expect(result.title).toBe("Harbor — Demo");
        expect(result.text).toBe(
            "Harbor A sheltered place, where ships lie & wait. See the quay, tides and elsewhere. One Two",
        );
    });

    it("leaves out the chrome around main, scripts, styles and search metadata", () => {
        expect(result.text).not.toMatch(/Home|Someone|chrome|alsoNot|color|place\b(?!,)/);
    });

    it("lists the links a reader can follow, resolved and sorted", () => {
        expect(result.links).toEqual([
            "/demo/place-quay/",
            "/lore-sea/#tides",
            "https://example.org/x",
        ]);
    });

    it("reads a link to the site's own origin as a path", () => {
        expect(
            linkTarget("https://www.heroiclands.org/demo/x/", "/y/", "https://www.heroiclands.org"),
        ).toBe("/demo/x/");
        expect(linkTarget("javascript:void(0)", "/y/")).toBeNull();
        expect(linkTarget("", "/y/")).toBeNull();
    });

    it("names the page a built file is served at", () => {
        expect(pageUrl("index.html")).toBe("/");
        expect(pageUrl("place-harbor/index.html")).toBe("/place-harbor/");
        expect(pageUrl("404.html")).toBe("/404.html");
    });
});

describe("the text of Typst source", () => {
    it("keeps content and drops functions, arguments and labels", () => {
        expect(
            typstText(
                '#heading(level: 2, outlined: false)[Names] <lore--names>\n\n#strong[Hidden] #emph[Hand] #link("https://x.invalid")[keeps] watch.',
            ),
        ).toBe("Names Hidden Hand keeps watch.");
    });

    it("reads escapes, hard breaks and comments as a reader does", () => {
        expect(typstText("a \\#b \\[c\\] \\\nd // a comment\ne")).toBe("a #b [c] d e");
    });

    it("keeps the text of a raw span and of a raw fence", () => {
        expect(typstText('#raw("a code span", block: false) and\n```js\nlet x = 1;\n```')).toBe(
            "a code span and let x = 1;",
        );
    });

    it("keeps the cells of a table and the caption of an image", () => {
        expect(
            typstText(
                '#table(columns: 2, table.header([Route], [Days]), [North], [4])\n#book-image("a.png", requested: auto, caption: [Figure 1: A pennant.])',
            ),
        ).toBe("Route Days North 4 Figure 1: A pennant.");
    });

    it("keeps the content a code block passes to a function", () => {
        expect(
            typstText(
                '#{\n  let row(term, body) = block[#set par(leading: 1em)#text(weight: "bold", term)#body]\n  row([Janapada],[A community.])\n}',
            ),
        ).toBe("Janapada A community.");
    });

    it("drops a statement and an image but keeps a footnote", () => {
        expect(
            typstText(
                '#set page(columns: 2)\nText#footnote[A note.] <fn> here #image("a.svg") end',
            ),
        ).toBe("TextA note. here end");
    });

    it("splits a book into its entries", () => {
        const source = [
            "#let preamble = [not an entry]",
            '#book-entry("Places", "Harbor", none, none)[#heading(level: 2)[Harbor] <place-harbor>]',
            "A sheltered place.",
            '#book-entry("Places", "Quay", none, none)[#heading(level: 2)[Quay] <place-quay>]',
            "A landing.",
            "#set page(columns: 2)",
            '#book-index(((letter: "H", name: "Harbor"),))',
        ].join("\n");
        expect(bookEntries(source)).toEqual([
            { anchor: "place-harbor", title: "Harbor", text: "Harbor A sheltered place." },
            { anchor: "place-quay", title: "Quay", text: "Quay A landing." },
        ]);
    });
});

describe("comparing two snapshots", () => {
    const site = (pages: object[]) => ({ kind: "site", pages });
    const page = (url: string, text: string, links: string[] = []) => ({
        url,
        title: url,
        text,
        links,
    });

    it("finds no difference between a snapshot and itself", () => {
        const one = site([page("/a/", "Alpha beta", ["/b/"]), page("/b/", "Gamma")]);
        expect(compareSnapshots(one, structuredClone(one))).toEqual([]);
    });

    it("does not read whitespace", () => {
        expect(
            compareSnapshots(
                site([page("/a/", "Alpha beta")]),
                site([page("/a/", " Alpha\nbeta ")]),
            ),
        ).toEqual([]);
    });

    it("names a dropped page, an added page, changed text and changed links", () => {
        const recorded = site([page("/a/", "Alpha", ["/b/"]), page("/b/", "Beta")]);
        const actual = site([page("/a/", "Alpha!", ["/c/"]), page("/c/", "Gamma")]);
        const findings = compareSnapshots(recorded, actual);
        expect(findings).toEqual(
            expect.arrayContaining([
                expect.stringContaining("site /a/: text differs"),
                "site /a/: links differ",
                "site /b/: missing",
                "site /c/: not in the recorded snapshot",
            ]),
        );
    });
});

describe.each([
    ["site", "thalorna-site.json.br"],
    ["book", "thalorna-book.json.br"],
])("the recorded %s snapshot", (kind, file) => {
    const path_ = path.join(FIXTURES, file);
    const snapshot = fs.existsSync(path_) ? readSnapshot(path_) : undefined;

    it("is committed", () => {
        expect(snapshot, `${file} is missing; regenerate it`).toBeTruthy();
        expect(snapshot.kind).toBe(kind);
        expect(snapshot.source.repository).toBe("thalorna");
        expect(snapshot.source.commit).toMatch(/^[0-9a-f]{40}$/);
    });

    if (kind === "site") {
        it("holds each page once, in order, with its text", () => {
            const urls = snapshot.pages.map((p: any) => p.url);
            expect(urls.length).toBeGreaterThan(100);
            expect(new Set(urls).size).toBe(urls.length);
            expect(urls).toEqual([...urls].sort());
            for (const p of snapshot.pages) {
                expect(p.title, p.url).toBeTruthy();
                expect(p.text.length, p.url).toBeGreaterThan(0);
                expect(p.links, p.url).toEqual([...new Set<string>(p.links)].sort());
            }
        });

        it("records text and no date stamp", () => {
            for (const p of snapshot.pages) {
                expect(p.text, p.url).not.toMatch(/\bLast built\b|\bGenerated on\b/);
            }
        });

        it("links only to pages the snapshot holds", () => {
            const base = snapshot.source.base as string;
            const urls = new Set<string>(snapshot.pages.map((p: any) => p.url));
            const dangling: string[] = [];
            for (const p of snapshot.pages)
                for (const link of p.links as string[]) {
                    if (!link.startsWith(base)) continue;
                    const target = `/${link.slice(base.length).replace(/[?#].*$/, "")}`;
                    if (!urls.has(target)) dangling.push(`${p.url} -> ${link}`);
                }
            expect(dangling.slice(0, 20)).toEqual([]);
        });
    } else {
        it("holds each book once, with its entries' text", () => {
            const ids = snapshot.books.map((b: any) => b.id);
            expect(ids.length).toBeGreaterThan(0);
            expect(ids).toEqual([...ids].sort());
            for (const book of snapshot.books) {
                expect(book.entries.length, book.id).toBeGreaterThan(0);
                for (const entry of book.entries) {
                    expect(entry.title, book.id).toBeTruthy();
                    expect(entry.text.length, `${book.id} ${entry.title}`).toBeGreaterThan(0);
                }
            }
        });

        it("records text and no Typst markup", () => {
            for (const book of snapshot.books)
                for (const entry of book.entries)
                    expect(entry.text, `${book.id} ${entry.title}`).not.toMatch(
                        /#(?:book-|heading|strong|emph|link|block|text)\b/,
                    );
        });
    }
});
