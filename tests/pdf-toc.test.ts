/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The document tree a PDF is built from (#316).
 *
 * A book is a **selection**, not a rendering of the whole tree, and the three
 * things that follow from that are behaviour rather than oversights: a note no
 * clause selects is absent, a note several clauses select appears several times,
 * and prose from `file:` is in the book while belonging to no content tree.
 * Each is asserted here, because each is the kind of thing a later refactor
 * "fixes" into a gate.
 *
 * The plan is pure data, which is the point of it: order, depth, anchors and
 * every link destination are checked without a renderer or a PDF in sight.
 */

import { describe, it, expect } from "vitest";
import YAML from "yaml";
import * as pdfToc from "../engine/pdf-toc.mjs";

const { parseDocumentTree, planDocument } = pdfToc as any;

/** A record as the content index derives it, reduced to what the planner reads. */
const note = (slug: string, name: string) => ({
    address: { slug, canonical: `sohl-sohl-${slug}` },
    name: { full: name },
    nameAscii: name,
});

const tree = (yaml: string) => {
    const { nodes, findings } = parseDocumentTree(YAML.parse(yaml), { text: yaml });
    return { nodes, findings };
};

describe("parseDocumentTree", () => {
    it("flattens nested sections, keeping document order and depth", () => {
        const { nodes, findings } = tree(`
contents:
  - sectionName: Gear
    contents:
      - sectionName: Armor
        contents:
          - filter: type = 'armorgear'
      - sectionName: Miscellaneous
        contents:
          - sectionName: Cooking
            contents:
              - filter: type = 'miscgear'
  - sectionName: Places
`);
        expect(findings).toEqual([]);
        expect(nodes.map((n: any) => [n.trail.join("/"), n.depth])).toEqual([
            ["Gear", 1],
            ["Gear/Armor", 2],
            ["Gear/Miscellaneous", 2],
            ["Gear/Miscellaneous/Cooking", 3],
            ["Places", 1],
        ]);
    });

    it("keeps a section's prose and filters in the order they were written", () => {
        // `contents` being heterogeneous and ordered is the design: a section
        // that opens with prose and then lists entries says something different
        // from one that does the reverse.
        const { nodes } = tree(`
contents:
  - sectionName: Gear
    contents:
      - file: assets/pdf/Gear.md
      - filter: type = 'armorgear'
      - file: assets/pdf/After.md
`);
        expect(nodes[0].items.map((i: any) => i.kind)).toEqual(["prose", "filter", "prose"]);
    });

    it("inherits presentation down the tree, and lets a child override it", () => {
        const { nodes } = tree(`
contents:
  - sectionName: Gear
    infobox: gear
    header: running
    contents:
      - sectionName: Armor
        contents: []
      - sectionName: Weapons
        infobox: weapon
        contents: []
`);
        const by = Object.fromEntries(nodes.map((n: any) => [n.title, n.presentation]));
        expect(by.Armor).toEqual({ infobox: "gear", header: "running" });
        expect(by.Weapons).toEqual({ infobox: "weapon", header: "running" });
    });

    it("refuses a filter that reaches another package's notes", () => {
        // The build owns `SELECT … FROM notes`, so the only way back out is a
        // subquery — and a book selects from its own project only.
        const { findings } = tree(`
contents:
  - sectionName: Borrowed
    contents:
      - filter: id IN (SELECT id FROM sohl.notes)
`);
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toMatch(/may not name another package/);
        expect(findings[0].line).toBeGreaterThan(0);
    });

    it("reports an unknown key on a section, with its position", () => {
        const { findings } = tree(`
contents:
  - sectionName: Gear
    inbox: gear
    contents: []
`);
        expect(findings[0].message).toMatch(/unknown key `inbox:`/);
        expect(findings[0].line).toBe(4);
    });

    it("reports a document with no `contents:` list", () => {
        const { nodes, findings } = parseDocumentTree({ sections: [] });
        expect(nodes).toEqual([]);
        expect(findings[0].message).toMatch(/`contents:` list/);
    });
});

describe("planDocument", () => {
    const selections = (pairs: Record<string, any[]>) => new Map(Object.entries(pairs));

    it("sorts a section's notes by nameAscii and leaves prose where it was written", () => {
        const { nodes } = tree(`
contents:
  - sectionName: Gear
    contents:
      - file: assets/pdf/Gear.md
      - filter: type = 'armorgear'
`);
        const id = nodes[0].items[1].id;
        const { entries } = planDocument(nodes, {
            selections: selections({
                [id]: [note("a-zed", "Zed"), note("a-ale", "Ale"), note("a-mid", "Mid")],
            }),
        });
        expect(entries.map((e: any) => e.kind)).toEqual([
            "section",
            "prose",
            "note",
            "note",
            "note",
        ]);
        expect(entries.slice(2).map((e: any) => e.record.name.full)).toEqual(["Ale", "Mid", "Zed"]);
    });

    it("sorts a circumflex with its letter rather than after Z", () => {
        // `nameAscii` is the ASCII fold the content index already derives; a raw
        // codepoint sort would file Ârnak after Zoltan.
        const { nodes } = tree(`
contents:
  - sectionName: Beings
    contents:
      - filter: type = 'being'
`);
        const id = nodes[0].items[0].id;
        const { entries } = planDocument(nodes, {
            selections: selections({
                [id]: [
                    { ...note("b-z", "Zoltan"), nameAscii: "Zoltan" },
                    { ...note("b-a", "Ârnak"), nameAscii: "Arnak" },
                ],
            }),
        });
        expect(
            entries.filter((e: any) => e.kind === "note").map((e: any) => e.record.name.full),
        ).toEqual(["Ârnak", "Zoltan"]);
    });

    it("prints a note once per section that selects it, with a distinct anchor each time", () => {
        // Expected, not a defect: a reference work may carry an entry under more
        // than one heading.
        const { nodes } = tree(`
contents:
  - sectionName: Weapons
    contents:
      - filter: type = 'weapongear'
  - sectionName: Favourites
    contents:
      - filter: shortcode = 'dgr'
`);
        const dagger = note("weapongear-dgr", "Dagger");
        const { entries, links, stats } = planDocument(nodes, {
            selections: selections({
                [nodes[0].items[0].id]: [dagger],
                [nodes[1].items[0].id]: [dagger],
            }),
        });
        const notes = entries.filter((e: any) => e.kind === "note");
        expect(notes).toHaveLength(2);
        expect(notes.map((e: any) => e.anchor)).toEqual(["weapongear-dgr", "weapongear-dgr-2"]);
        // An inbound wikilink reaches one page, however often the book prints it.
        expect(links.get("weapongear-dgr")).toBe("weapongear-dgr");
        expect(stats.repeated).toBe(1);
        expect(stats.distinct).toBe(1);
    });

    it("leaves out a note no clause selects, and offers it no link target", () => {
        const { nodes } = tree(`
contents:
  - sectionName: Weapons
    contents:
      - filter: type = 'weapongear'
`);
        const { entries, links } = planDocument(nodes, {
            selections: selections({ [nodes[0].items[0].id]: [note("weapongear-dgr", "Dagger")] }),
        });
        expect(entries.filter((e: any) => e.kind === "note")).toHaveLength(1);
        // Nothing claims to know where an unselected note lives inside the book,
        // so a link to it falls back to the site URL rather than guessing.
        expect(links.has("armorgear-cap")).toBe(false);
    });

    it("skips a section whose contents resolve to nothing", () => {
        const { nodes } = tree(`
contents:
  - sectionName: Affiliations
    contents:
      - filter: type = 'affiliation'
  - sectionName: Weapons
    contents:
      - filter: type = 'weapongear'
`);
        const { entries } = planDocument(nodes, {
            selections: selections({
                [nodes[0].items[0].id]: [],
                [nodes[1].items[0].id]: [note("weapongear-dgr", "Dagger")],
            }),
        });
        expect(entries.filter((e: any) => e.kind === "section").map((e: any) => e.title)).toEqual([
            "Weapons",
        ]);
    });

    it("keeps an empty section when it says so", () => {
        const { nodes } = tree(`
contents:
  - sectionName: Affiliations
    keepEmpty: true
    contents:
      - filter: type = 'affiliation'
`);
        const { entries } = planDocument(nodes, {
            selections: selections({ [nodes[0].items[0].id]: [] }),
        });
        expect(entries.map((e: any) => e.title)).toEqual(["Affiliations"]);
    });

    it("keeps a section that has prose but selected no notes", () => {
        // Dropping authored text is a worse surprise than a short section.
        const { nodes } = tree(`
contents:
  - sectionName: Preface
    contents:
      - file: assets/pdf/Preface.md
      - filter: type = 'affiliation'
`);
        const { entries } = planDocument(nodes, {
            selections: selections({ [nodes[0].items[1].id]: [] }),
        });
        expect(entries.map((e: any) => e.kind)).toEqual(["section", "prose"]);
    });

    it("drops a section whose every descendant resolved to nothing", () => {
        // Emptiness is judged after the children answer, or a section of empty
        // sections prints as a heading with a blank page under it.
        const { nodes } = tree(`
contents:
  - sectionName: Characteristics
    contents:
      - sectionName: Mysteries
        contents:
          - filter: type = 'mystery'
      - sectionName: Attributes
        contents:
          - filter: type = 'attribute'
`);
        const { entries } = planDocument(nodes, {
            selections: selections({
                [nodes[1].items[0].id]: [],
                [nodes[2].items[0].id]: [],
            }),
        });
        expect(entries).toEqual([]);
    });

    it("anchors prose so the table of contents can reach it", () => {
        // It carries no address, so nothing links *to* it — but the outline and
        // the TOC still have to point somewhere.
        const { nodes } = tree(`
contents:
  - sectionName: Preface
    contents:
      - file: assets/pdf/Front/Preface.md
`);
        const { entries } = planDocument(nodes, { selections: new Map() });
        const prose = entries.find((e: any) => e.kind === "prose");
        expect(prose.anchor).toBe("assets-pdf-front-preface");
        expect(prose.file).toBe("assets/pdf/Front/Preface.md");
    });
});
