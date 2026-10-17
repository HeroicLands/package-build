/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { buildIndexRecord } from "../engine/content-index.mjs";
import { buildSiteIndex, wikiContext } from "../engine/site-index.mjs";
import { parseWikilink, WIKILINK } from "../engine/wikilink-syntax.mjs";
import { renderSpans } from "../engine/content-spans.mjs";
import { resolveWebWikilinks } from "../engine/web-wikilinks.mjs";
import { buildWikilinkIndex, convertWikilinks } from "../engine/wikilinks.mjs";
import { collectAnchors } from "../engine/anchors.mjs";
import { renderFoundryMarkdown } from "../engine/helpers.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";

const body =
    "# Open {#open}\n\n# Truth {#truth .secret}\n\nA [detail]{#detail}\n\nText.\n\n# End {#end}\n";
const anchors = collectAnchors(body);
function web(gm = true, url: string | undefined = undefined) {
    const hit = { name: "The truth", gm, url, noteAnchors: anchors };
    return {
        index: new Map([["demo-note-doc-truth", hit]]),
        contentPackage: "demo",
        packages: new Set(["demo"]),
        contentTypes: new Set(["doc"]),
        errors: [] as object[],
        anchors: new Set(anchors.map((a) => a.slug)),
    };
}

describe("inline spoiler presentation", () => {
    it("keeps names and emphasis behind a separate native button and hidden inline content", () => {
        const html = renderSpans(
            "Before [Joe *Blow*]{.name .secret data-type=being/npc} after.",
        ).markdown;
        expect(html).toContain('class="name secret"');
        expect(html).toContain('<button type="button"');
        expect(html).toContain('aria-expanded="false"');
        expect(html).toContain("hidden");
        expect(html).toContain('data-type="being/npc"');
        expect(html).toContain("Joe *Blow*");
        expect(html).toMatch(/^Before .* after\.$/);
    });
    it("conceals private labels, consumes .show and emits plain text for unavailable targets", () => {
        const ctx = web();
        expect(resolveWebWikilinks("[[doc-truth|The *truth*]]", ctx)).toBe(
            "[The *truth*]{.secret}",
        );
        expect(resolveWebWikilinks("[[doc-truth|Visible]]{.show}", ctx)).toBe("Visible");
        expect(ctx.errors).toEqual([]);
    });
    it("retains available links and only conceals secret destinations", () => {
        const ctx = web(false, "/truth/");
        expect(resolveWebWikilinks("[[doc-truth#detail|Detail]]", ctx)).toBe(
            "[[Detail](/truth/#detail)]{.secret}",
        );
        expect(resolveWebWikilinks("[[doc-truth#open|Open]]{.show}", ctx)).toBe(
            "[Open](/truth/#open)",
        );
        expect(resolveWebWikilinks("[[doc-truth#end|End]]", ctx)).toBe("[End](/truth/#end)");
        expect(resolveWebWikilinks(body + "\n[[#detail|Detail]]", ctx)).toContain(
            "[[Detail](#detail)]{.secret}",
        );
    });
    it("does not let .show suppress unknown-anchor or identity errors", () => {
        const ctx = web(false, "/truth/");
        resolveWebWikilinks(
            "[[doc-truth#missing|Missing]]{.show} [[doc-missing|Missing]]{.show}",
            ctx,
        );
        expect(ctx.errors.map((e: any) => e.reason)).toEqual(["unknown-anchor", "unresolved"]);
    });
    it("marks Foundry references without changing the target UUID or permission", () => {
        const index = buildWikilinkIndex(
            [
                {
                    type: "doc",
                    shortcode: "truth",
                    id: "aaaaaaaaaaaaaaa1",
                    name: "Truth",
                    gm: true,
                    anchors: new Set(["truth"]),
                    noteAnchors: anchors,
                },
            ],
            "demo",
        );
        const ctx = { index, type: "doc", id: "aaaaaaaaaaaaaaa2" };
        const normal = convertWikilinks("[[doc-truth|Truth]]", ctx).markdown;
        expect(normal).toMatch(/^\[@UUID\[.*\]\{Truth\}\]\{.secret\}$/);
        expect(convertWikilinks("[[doc-truth|Truth]]{.show}", ctx).markdown).toBe(
            normal.slice(1, -10),
        );
        expect(renderFoundryMarkdown("[Joe *Blow*]{.name .secret}")).toContain(
            'class="name secret"',
        );
    });
    it("retains inline spoiler text and name classes in books", () => {
        expect(markdownToTypst("[Joe *Blow*]{.name .secret}")).toContain(
            'classes: ("name", "secret")',
        );
        expect(markdownToTypst("[Joe *Blow*]{.name .secret}")).toContain("Joe #emph[Blow]");
    });
});

describe("shared spoiler audience metadata", () => {
    it("matches and parses the entire trailing attribute block", () => {
        const source = '[[doc-truth|Truth]]{.show data-caption="with } brace"}';
        const match = [...source.matchAll(WIKILINK)][0];
        expect(match[0]).toBe(source);
        expect(parseWikilink(match[1], match[0]).attributes?.classes).toEqual(["show"]);
        expect(parseWikilink(match[1], match[0]).attributes?.values).toEqual({
            "data-caption": "with } brace",
        });
    });
    it("marks exact contained anchors without concealing adjacent text on the same line", () => {
        const source =
            "[Secret [nested]{#inside}]{.secret} and [public]{#outside}.\n\n::: {.outer}\n:::secret\n[hidden]{#block}\n:::\n:::\n";
        const found = collectAnchors(source);
        expect(found.find((anchor) => anchor.slug === "inside")?.secret).toBe(true);
        expect(found.find((anchor) => anchor.slug === "outside")?.secret).toBeUndefined();
        expect(found.find((anchor) => anchor.slug === "block")?.secret).toBe(true);
    });
    it("resolves private records omitted from the site without publishing their content or URL", () => {
        const records = [
            {
                package: "demo",
                type: "being",
                shortcode: "joe",
                tags: ["gm"],
                name: { full: "Joe" },
                address: {
                    canonical: { package: "demo", system: "sohl", type: "being", shortcode: "joe" },
                },
                anchors: [{ slug: "truth", kind: "prose", secret: true }],
            },
            {
                package: "demo",
                type: "doc",
                shortcode: "stub",
                tags: ["gm"],
                name: { full: "Stub" },
                address: null,
            },
        ];
        const site = buildSiteIndex([], { package: "demo", records });
        const errors: any[] = [];
        const ctx = { ...wikiContext(site, { errors }), contentPackage: "demo" };
        expect(
            resolveWebWikilinks(
                "[[being-joe|Joe]] [[demo-note-being-joe#truth|Truth]]{.show}",
                ctx,
            ),
        ).toBe("[Joe]{.secret} Truth");
        expect(errors).toEqual([]);
        expect(site.index.has("doc/stub")).toBe(false);
        resolveWebWikilinks("[[being-joe#missing|Joe]]{.show}", ctx);
        expect(errors.at(-1)?.reason).toBe("unknown-anchor");
    });
    it("keeps default private and section references as static spoilers in book Markdown", () => {
        const ctx = { ...web(), output: "book" };
        const result = resolveWebWikilinks("[[doc-truth|Truth]]", ctx);
        expect(markdownToTypst(result)).toContain('#book-span(classes: ("secret",))[Truth]');
        expect(renderSpans("[[Go](/truth/)]{.secret}").markdown).toContain(
            "hidden>[Go](/truth/)</span>",
        );
    });
});

describe("trailing reference attributes", () => {
    it("preserves safe authored attributes while consuming the visibility override", () => {
        const ctx = web();
        expect(resolveWebWikilinks("[[doc-truth|Visible]]{.show .name data-type=doc}", ctx)).toBe(
            '[Visible]{.name data-type="doc"}',
        );
        expect(resolveWebWikilinks("[[doc-truth|Visible]]{.show onclick=run}", ctx)).not.toContain(
            "onclick",
        );
        expect(ctx.errors).toMatchObject([
            {
                reason: "invalid-attributes",
                problems: ["onclick is an event handler and is not written"],
            },
        ]);
    });
    it("retains navigation when an audience-aware publisher supplies the private URL", () => {
        const ctx = web(true, "/available/");
        expect(resolveWebWikilinks("[[doc-truth|Truth]]", ctx)).toBe(
            "[[Truth](/available/)]{.secret}",
        );
        expect(resolveWebWikilinks("[[doc-truth|Truth]]{.show}", ctx)).toBe("[Truth](/available/)");
    });
    it("does not seed a real private stub into the site index", () => {
        const stub = buildIndexRecord({
            frontmatter: {
                type: "doc",
                shortcode: "stub",
                tags: ["gm"],
                name: { full: "Unwritten" },
            },
            relPath: "Stub.md",
            contentPackage: "demo",
            body: "",
        });
        expect(stub.address).toBeNull();
        const site = buildSiteIndex([], { package: "demo", records: [stub] });
        const errors: any[] = [];
        resolveWebWikilinks("[[doc-stub|Unwritten]]{.show}", {
            ...wikiContext(site, { errors }),
            contentPackage: "demo",
            contentTypes: new Set(["doc"]),
        });
        expect(errors).toMatchObject([{ reason: "unresolved" }]);
    });
});
