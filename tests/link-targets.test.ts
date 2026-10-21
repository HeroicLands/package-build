/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * **One resolver, a form per target.** A wikilink resolves once, against the
 * index its build reads, into a neutral resolution that names the note by its
 * canonical address; each target writes that resolution in its own form. A
 * Foundry journal gets an `@UUID` content link, a web page a relative URL, the
 * book a link its renderer sets as a cross-reference.
 */

import { describe, expect, it } from "vitest";

import { expandContent } from "../engine/content-expand.mjs";
import { buildSiteIndex, wikiContext } from "../engine/site-index.mjs";
import {
    LINK_WRITERS,
    buildWikilinkIndex,
    convertWikilinks,
    packLinkView,
    resolveWikilinks,
    siteLinkView,
} from "../engine/wikilinks.mjs";

const PACKAGE = "demo";
const HARBOR = { type: "place", id: "a1b2c3d4e5f6a7b8", shortcode: "harbor", name: "Harbor" };
const DRAFT = {
    type: "place",
    id: "b1b2c3d4e5f6a7b8",
    shortcode: "quay",
    name: "The Quay",
    draft: true,
};
const SELF = { type: "lore", id: "1111222233334444", shortcode: "corpus", name: "The Corpus" };

const packIndex = () => buildWikilinkIndex([HARBOR, DRAFT, SELF], PACKAGE, new Map(), PACKAGE);

const siteIndex = () =>
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
                fm: { type: "place", shortcode: "quay", tags: ["draft"] },
                body: "",
                name: "The Quay",
                url: "/demo/place-quay/",
                pkg: PACKAGE,
            },
        ],
        { package: PACKAGE },
    );

const siteContext = () =>
    Object.assign(
        wikiContext(siteIndex(), { src: "Lore/x.md", file: "/x/Lore/x.md", errors: [] }),
        { anchors: new Set(["tides"]), eventAnchors: new Set(["founding"]) },
    );

const BODY = "See [[place-harbor|the harbor]], [[place-quay|]] and [[place-nowhere|a lost place]].";

describe("a link resolves to one neutral form", () => {
    it("names the same note by the same address whichever index it is read against", () => {
        const pack = resolveWikilinks(BODY, {
            view: packLinkView(packIndex(), { type: "lore", id: SELF.id }),
            write: LINK_WRITERS.foundry,
        });
        const site = resolveWikilinks(BODY, {
            view: siteLinkView(siteContext(), BODY),
            write: LINK_WRITERS.web,
        });
        const identity = (links: any[]) =>
            links.map(({ kind, text, address, draft }) => ({ kind, text, address, draft }));
        expect(identity(pack.links)).toEqual(identity(site.links));
        expect(identity(pack.links)).toEqual([
            { kind: "link", text: "the harbor", address: "demo-note-place-harbor", draft: false },
            { kind: "link", text: "The Quay", address: "demo-note-place-quay", draft: true },
            {
                kind: "unresolved",
                text: "a lost place",
                address: "demo-note-place-nowhere",
                draft: false,
            },
        ]);
        expect(pack.findings.map((f: any) => f.reason)).toEqual(["unresolved"]);
        expect(site.findings.map((f: any) => f.reason)).toEqual(["unresolved"]);
    });

    it("keeps each finding's offset and occurrence", () => {
        const body = "[[place-nowhere|x]] and [[place-nowhere|x]]";
        const { findings } = resolveWikilinks(body, {
            view: siteLinkView(siteContext(), body),
            write: LINK_WRITERS.web,
        });
        expect(findings.map((f: any) => [f.offset, f.occurrence])).toEqual([
            [0, 1],
            [24, 2],
        ]);
    });
});

describe("each target writes the resolution in its own form", () => {
    const site = () =>
        resolveWikilinks(BODY, { view: siteLinkView(siteContext(), BODY), write: () => "" }).links;

    it("writes a Foundry content link, marked when the note is a draft", () => {
        const { markdown } = convertWikilinks(BODY, {
            type: "lore",
            id: SELF.id,
            index: packIndex(),
        });
        expect(markdown).toMatch(/^See @UUID\[Compendium\.demo\.[^\]]+\]\{the harbor\}, /);
        expect(markdown).toContain(
            '<span class="sohl-draft-link" title="Draft — not yet written">@UUID[',
        );
        expect(markdown).toContain(
            '<span class="sohl-unresolved-link" title="Unresolved link: place-nowhere">a lost place</span>',
        );
    });

    it("writes a relative URL for the web, marked when the note is a draft", () => {
        expect(site().map(LINK_WRITERS.web)).toEqual([
            "[the harbor](/demo/place-harbor/)",
            '<span class="sohl-draft-link" title="Draft — not yet written">[The Quay](/demo/place-quay/)</span>',
            '<span class="sohl-unresolved-link" title="Unresolved link: place-nowhere">a lost place</span>',
        ]);
    });

    it("writes the URL the book sets as a cross-reference, and says so in words", () => {
        expect(site().map(LINK_WRITERS.book)).toEqual([
            "[the harbor](/demo/place-harbor/)",
            "[The Quay](/demo/place-quay/) (draft)",
            "a lost place (unresolved link)",
        ]);
    });

    it("does not mark a link to a section of a draft note's own page", () => {
        const index = packIndex();
        const { markdown } = convertWikilinks("[[#onset|Onset]]", {
            type: "place",
            id: DRAFT.id,
            index,
        });
        expect(markdown).toMatch(/^@UUID\[[^\]]+\]\{Onset\}$/);
    });
});

describe("the book expands through the same step", () => {
    const note = {
        fm: { type: "lore", shortcode: "corpus", name: { full: "The Corpus" } },
        file: "/x/Lore/lore-corpus.md",
        source: "Lore/lore-corpus.md",
        bodyLine: 9,
    };

    it("writes resolved and unresolved links in the book's form, with a finding", () => {
        const expanded = expandContent(BODY, { target: "book", index: siteIndex(), note });
        expect(expanded.markdown).toBe(
            "See [the harbor](/demo/place-harbor/), [The Quay](/demo/place-quay/) (draft) and a lost place (unresolved link).",
        );
        expect(expanded.findings.links.map((f: any) => [f.reason, f.occurrence])).toEqual([
            ["unresolved", 1],
        ]);
    });

    it("refuses a link to one of the note's own events, as the website does", () => {
        const fm = { ...note.fm, events: [{ id: "founding", date: "720" }] };
        const body = "[[#founding|the founding]]";
        const book = expandContent(body, {
            target: "book",
            index: siteIndex(),
            note: { ...note, fm },
        });
        const web = expandContent(body, {
            target: "web",
            index: siteIndex(),
            note: { ...note, fm },
        });
        expect(book.findings.links.map((f: any) => f.reason)).toEqual(
            web.findings.links.map((f: any) => f.reason),
        );
    });
});

describe("a finding names the link as it was written", () => {
    it("names an unlabelled link with its anchor, on every target", () => {
        const pack = convertWikilinks("[[place-harbor#tides]]", {
            type: "lore",
            id: SELF.id,
            index: packIndex(),
        });
        const site = resolveWikilinks("[[place-harbor#tides]]", {
            view: siteLinkView(siteContext(), ""),
            write: LINK_WRITERS.web,
        });
        expect(pack.unresolved.map((u: any) => [u.reason, u.target])).toEqual([
            ["unlabelled", "place-harbor#tides"],
        ]);
        expect(site.findings.map((u: any) => [u.reason, u.target])).toEqual([
            ["unlabelled", "place-harbor#tides"],
        ]);
    });
});
