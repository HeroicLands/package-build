/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { collectAnchors } from "../engine/anchors.mjs";
import { anchorsOf } from "../engine/foundry-entries.mjs";
import { splitPages, journalPageId } from "../engine/journals.mjs";
import { compendiumUuid, pageUuid } from "../engine/ids.mjs";
import { itemDocEntryId } from "../engine/item-docs.mjs";
import { buildWikilinkIndex, convertWikilinks } from "../engine/wikilinks.mjs";
import { linkFindingMessage } from "../engine/wikilink-syntax.mjs";
const id = "abcdefghijklmnop";
const body = [
    "# First {#first}",
    "",
    "A [marked span]{#word} in prose.",
    "",
    "::: {#box}",
    "A div.",
    "> [!WARNING] {#closure title=Closure}",
    "> Watch out.",
    ">",
    "> > [!TIP] {#inner-tip title=Advice}",
    "> > Take care.",
    ":::",
    "",
    "```poetry {#verse}",
    "A poem.",
    "```",
    "",
    ":@ A caption. {#caption}",
    "",
    "Captioned prose.",
    "",
    "## Second {#second}",
    "",
    "[Another]{#other}.",
].join("\n");
describe("Foundry containing-page anchors", () => {
    it("maps div, span, and poetry identifiers to their containing emitted page", () => {
        const uuid = compendiumUuid("demo", "doc", id);
        const pages = splitPages(body);
        const anchors = anchorsOf(uuid, id, body, "Example");
        expect(pages).toHaveLength(3);
        const first = pageUuid(uuid, journalPageId(id, pages[0]));
        for (const slug of ["first", "word", "box", "verse", "closure", "inner-tip"])
            expect(anchors[slug]).toBe(first);
        expect(anchors.caption).toBe(pageUuid(uuid, journalPageId(id, pages[1])));
        expect(anchors.other).toBe(anchors.second);
        const emitted = new Set(pages.map((p) => pageUuid(uuid, journalPageId(id, p))));
        for (const target of Object.values(anchors)) expect(emitted.has(target)).toBe(true);
    });
    it("uses containing pages for local links and self links", () => {
        const uuid = compendiumUuid("demo", "doc", id);
        const anchorUuids = anchorsOf(uuid, id, body, "Example");
        const doc = {
            type: "doc",
            id,
            shortcode: "example",
            name: "Example",
            anchorUuids,
            anchors: new Set(collectAnchors(body).map((a) => a.slug)),
        };
        const index = buildWikilinkIndex([doc], "demo");
        for (const slug of ["word", "box", "verse", "closure", "inner-tip", "caption", "other"]) {
            for (const address of [`doc-example#${slug}`, `#${slug}`]) {
                const result = convertWikilinks(`[[${address}|Read]]`, { type: "doc", id, index });
                expect(result.unresolved).toEqual([]);
                expect(result.markdown).toBe(`@UUID[${anchorUuids[slug]}]{Read}`);
            }
        }
    });
    it("uses the documentation journal's page map for an item's readable note", () => {
        const entryId = itemDocEntryId(id);
        const uuid = compendiumUuid("demo", "doc", entryId);
        const docAnchorUuids = anchorsOf(uuid, entryId, body, "Example");
        const doc = {
            type: "skill",
            id,
            shortcode: "example",
            name: "Example",
            docAnchorUuids,
            anchors: new Set(collectAnchors(body).map((a) => a.slug)),
        };
        const index = buildWikilinkIndex([doc], "demo");
        const result = convertWikilinks("[[docskill-example#word|Read]]", {
            type: "doc",
            id: "other",
            index,
        });
        expect(result.unresolved).toEqual([]);
        expect(result.markdown).toBe(`@UUID[${docAnchorUuids.word}]{Read}`);
    });
    it("retains the historical hash fallback for indexes with no page map", () => {
        const index = buildWikilinkIndex([{ type: "doc", id, shortcode: "example" }], "demo");
        expect(
            convertWikilinks("[[doc-example#part|Read]]", { type: "doc", id, index }).markdown,
        ).toContain("JournalEntryPage.");
    });
    it("refuses a wikilink naming an event anchor, before any surface renders it", () => {
        const uuid = compendiumUuid("demo", "doc", id);
        const doc = {
            type: "doc",
            id,
            shortcode: "example",
            name: "Example",
            anchorUuids: anchorsOf(uuid, id, body, "Example"),
            anchors: new Set([...collectAnchors(body).map((a) => a.slug), "sack"]),
            eventAnchors: new Set(["sack"]),
        };
        const index = buildWikilinkIndex([doc], "demo");
        const result = convertWikilinks("[[doc-example#sack|Read]]", {
            type: "doc",
            id: "x",
            index,
        });
        expect(result.unresolved.map((u: any) => u.reason)).toEqual(["event-anchor"]);
        expect(result.markdown).not.toContain(uuid);
        expect(
            linkFindingMessage({ reason: "event-anchor", target: "doc-example", anchor: "sack" }),
        ).toContain("prose links to the note, not to an event");
    });
});
