/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    anchorsOf,
    auditLinks,
    buildLinkIndex,
    walkReachability,
} from "../engine/content-links.mjs";

/** A throwaway content tree, described as `{ relPath: contents }`. */
function tree(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "content-links-"));
    for (const [rel, body] of Object.entries(files)) {
        const abs = path.join(root, ...rel.split("/"));
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, body, "utf8");
    }
    return root;
}

/** A note with frontmatter and a body. */
function note(fm: Record<string, unknown>, body = ""): string {
    const lines = ["---"];
    for (const [k, v] of Object.entries(fm)) {
        if (v && typeof v === "object" && !Array.isArray(v)) {
            lines.push(`${k}:`);
            for (const [k2, v2] of Object.entries(v as object)) {
                lines.push(`  ${k2}: ${v2}`);
            }
        } else if (Array.isArray(v)) {
            lines.push(`${k}:`);
            for (const item of v) lines.push(`  - ${item}`);
        } else {
            lines.push(`${k}: ${v}`);
        }
    }
    lines.push("---", "", body, "");
    return lines.join("\n");
}

/** Build and audit a tree in one step. */
const audit = (files: Record<string, string>) => {
    const index = buildLinkIndex(tree(files), { skipDirectories: [] });
    return { index, ...auditLinks(index) };
};

describe("anchorsOf", () => {
    it("finds an anchor declared on a heading", () => {
        expect([
            ...anchorsOf("# Title\n\n## Crafting {#crafting}\n\ntext"),
        ]).toEqual(["crafting"]);
    });

    it("finds nothing where no heading declares one", () => {
        expect([...anchorsOf("## Crafting\n\ntext")]).toEqual([]);
        expect([...anchorsOf(undefined as never)]).toEqual([]);
    });
});

describe("buildLinkIndex", () => {
    it("loads only notes carrying a type", () => {
        const { index } = audit({
            "Skills/Climbing.md": note({ type: "skill", shortcode: "clmb" }),
            "README.md": "# Not a note\n",
        });
        expect(index.notes).toHaveLength(1);
        expect(index.notes[0].type).toBe("skill");
    });

    it("resolves a qualified address", () => {
        const { index } = audit({
            "Skills/Climbing.md": note({ type: "skill", shortcode: "clmb" }),
            "Rules/Moving.md": note({ type: "doc", shortcode: "moving" }),
        });
        const src = index.notes.find((n) => n.type === "doc");
        expect(index.resolve(src, "skill-clmb")?.fm.shortcode).toBe("clmb");
    });

    // The alias index is scoped to the source's own type, which is why the
    // qualifier has to be read as well.
    it("resolves a bare alias only within the source's own type", () => {
        const { index } = audit({
            "Skills/Climbing.md": note({
                type: "skill",
                shortcode: "clmb",
                name: { full: "Climbing" },
            }),
            "Skills/Jumping.md": note({ type: "skill", shortcode: "jmp" }),
            "Rules/Moving.md": note({ type: "doc", shortcode: "moving" }),
        });
        const sameType = index.notes.find((n) => n.fm.shortcode === "jmp");
        const otherType = index.notes.find((n) => n.type === "doc");
        expect(index.resolve(sameType, "Climbing")?.fm.shortcode).toBe("clmb");
        expect(index.resolve(otherType, "Climbing")).toBeUndefined();
    });

    it("reads a wikilink with the shared syntax", () => {
        const { index } = audit({
            "Rules/A.md": note(
                { type: "doc", shortcode: "a" },
                "See [[skill-clmb|Climbing]] and [[#here]].",
            ),
            "Skills/Climbing.md": note({ type: "skill", shortcode: "clmb" }),
        });
        const src = index.notes.find((n) => n.type === "doc");
        expect(index.linksOf(src).map((l) => [l.target, l.anchor])).toEqual([
            ["skill-clmb", ""],
            ["", "here"],
        ]);
    });

    // The checker used to carry its own, laxer copy of the pattern, so it
    // "checked" links the compilers would never make.
    it("does not read an unclosed bracket as a link", () => {
        const { index } = audit({
            "Rules/A.md": note(
                { type: "doc", shortcode: "a" },
                "Prose with [[ an unclosed bracket\n\nand [[skill-clmb]] after.",
            ),
            "Skills/Climbing.md": note({ type: "skill", shortcode: "clmb" }),
        });
        const src = index.notes.find((n) => n.type === "doc");
        expect(index.linksOf(src).map((l) => l.target)).toEqual(["skill-clmb"]);
    });

    it("does not read a link inside code", () => {
        const { index } = audit({
            "Rules/A.md": note(
                { type: "doc", shortcode: "a" },
                "```js\nconst x = [[1,2]];\n```\n\nAnd `[[skill-nope]]` inline.",
            ),
        });
        expect(index.linksOf(index.notes[0])).toEqual([]);
    });
});

describe("auditLinks", () => {
    it("reports nothing for a clean tree", () => {
        const r = audit({
            "Skills/Climbing.md": note(
                { type: "skill", shortcode: "clmb" },
                "## Crafting {#crafting}\n",
            ),
            "Rules/A.md": note(
                { type: "doc", shortcode: "a" },
                "See [[skill-clmb#crafting]].",
            ),
        });
        expect(r.deadAnchors).toEqual([]);
        expect(r.deadAddresses).toEqual([]);
        expect(r.frontmatterLinks).toEqual([]);
    });

    it("reports an anchor no heading declares", () => {
        const r = audit({
            "Skills/Climbing.md": note({ type: "skill", shortcode: "clmb" }),
            "Rules/A.md": note(
                { type: "doc", shortcode: "a" },
                "See [[skill-clmb#nosuch]].",
            ),
        });
        expect(r.deadAnchors).toHaveLength(1);
        expect(r.deadAnchors[0].link).toBe("skill-clmb#nosuch");
    });

    it("reports a same-page anchor no heading declares", () => {
        const r = audit({
            "Rules/A.md": note(
                { type: "doc", shortcode: "a" },
                "See [[#gone]].",
            ),
        });
        expect(r.deadAnchors).toHaveLength(1);
    });

    it("reports a qualified address that resolves to nothing", () => {
        const r = audit({
            "Skills/Climbing.md": note({ type: "skill", shortcode: "clmb" }),
            "Rules/A.md": note(
                { type: "doc", shortcode: "a" },
                "See [[skill-nosuch]].",
            ),
        });
        expect(r.deadAddresses).toHaveLength(1);
        expect(r.deadAddresses[0].target).toBe("skill-nosuch");
    });

    // A bare name that finds nothing is a worldbuilding placeholder, not a typo.
    it("leaves an unresolved bare name alone", () => {
        const r = audit({
            "Rules/A.md": note(
                { type: "doc", shortcode: "a" },
                "The [[Sunless Vault]] is not written yet.",
            ),
        });
        expect(r.deadAddresses).toEqual([]);
    });

    // Both builds copy frontmatter through verbatim, so a link there publishes
    // as literal `[[…]]` text.
    it("reports a wikilink authored in frontmatter", () => {
        const r = audit({
            "Rules/A.md": note({
                type: "doc",
                shortcode: "a",
                description: "See [[skill-clmb]] for more",
            }),
        });
        expect(r.frontmatterLinks).toHaveLength(1);
    });

    // Two identical links must be tellable apart, or both report at the first.
    it("numbers repeated links so each can be located", () => {
        const r = audit({
            "Skills/Climbing.md": note({ type: "skill", shortcode: "clmb" }),
            "Rules/A.md": note(
                { type: "doc", shortcode: "a" },
                "One [[skill-clmb#nope]] and another [[skill-clmb#nope]].",
            ),
        });
        expect(r.deadAnchors.map((d) => d.occurrence)).toEqual([1, 2]);
    });

    it("resolves an item's documentation address to the same note", () => {
        const r = audit({
            "Skills/Climbing.md": note(
                { type: "skill", shortcode: "clmb" },
                "## Crafting {#crafting}\n",
            ),
            "Rules/A.md": note(
                { type: "doc", shortcode: "a" },
                "See [[docskill-clmb#crafting]].",
            ),
        });
        expect(r.deadAnchors).toEqual([]);
        expect(r.deadAddresses).toEqual([]);
    });
});

describe("walkReachability", () => {
    /** A corpus of `doc` notes under `Guide/`, linked as described. */
    const guide = (files: Record<string, string>) =>
        buildLinkIndex(tree(files), { skipDirectories: [] });

    const scope = (n: any) => n.rel.startsWith("Guide/");

    it("reaches every page linked from the root, transitively", () => {
        const index = guide({
            "Guide/README.md": note(
                { type: "doc", shortcode: "root" },
                "See [[doc-one]].",
            ),
            "Guide/One.md": note(
                { type: "doc", shortcode: "one" },
                "Then [[doc-two]].",
            ),
            "Guide/Two.md": note({ type: "doc", shortcode: "two" }),
        });
        const r = walkReachability(index, { root: "Guide/README.md", scope });
        expect(r.orphans).toEqual([]);
        expect(r.reached.size).toBe(3);
    });

    // The defect this exists to catch: a page that compiles and publishes but
    // cannot be arrived at by reading.
    it("reports a page nothing links to", () => {
        const index = guide({
            "Guide/README.md": note(
                { type: "doc", shortcode: "root" },
                "See [[doc-one]].",
            ),
            "Guide/One.md": note({ type: "doc", shortcode: "one" }),
            "Guide/Orphan.md": note({ type: "doc", shortcode: "orphan" }),
        });
        const r = walkReachability(index, { root: "Guide/README.md", scope });
        expect(r.orphans.map((o: any) => o.rel)).toEqual(["Guide/Orphan.md"]);
    });

    // A link out of the corpus is a real link; it is simply not a page of it.
    it("does not follow a link out of the corpus", () => {
        const index = guide({
            "Guide/README.md": note(
                { type: "doc", shortcode: "root" },
                "See [[skill-clmb]].",
            ),
            "Skills/Climbing.md": note({ type: "skill", shortcode: "clmb" }),
        });
        const r = walkReachability(index, { root: "Guide/README.md", scope });
        expect(r.orphans).toEqual([]);
        expect(r.reached.size).toBe(1);
    });

    // An index links to nearly everything, so walking through one would make
    // the check vacuous.
    it("walks to a stopAt page but not through it", () => {
        const index = guide({
            "Guide/README.md": note(
                { type: "doc", shortcode: "root" },
                "See [[doc-glossary]].",
            ),
            "Guide/Glossary.md": note(
                { type: "doc", shortcode: "glossary" },
                "Everything: [[doc-buried]].",
            ),
            "Guide/Buried.md": note({ type: "doc", shortcode: "buried" }),
        });
        const r = walkReachability(index, {
            root: "Guide/README.md",
            scope,
            stopAt: (n: any) => n.fm.shortcode === "glossary",
        });
        // The glossary itself is reached; what only it links to is not.
        expect(r.orphans.map((o: any) => o.rel)).toEqual(["Guide/Buried.md"]);
    });

    it("survives a cycle", () => {
        const index = guide({
            "Guide/README.md": note(
                { type: "doc", shortcode: "root" },
                "See [[doc-one]].",
            ),
            "Guide/One.md": note(
                { type: "doc", shortcode: "one" },
                "Back to [[doc-root]].",
            ),
        });
        const r = walkReachability(index, { root: "Guide/README.md", scope });
        expect(r.orphans).toEqual([]);
    });

    // Reporting every page as an orphan would bury the actual mistake.
    it("refuses a corpus with no page one", () => {
        const index = guide({
            "Guide/One.md": note({ type: "doc", shortcode: "one" }),
        });
        expect(() =>
            walkReachability(index, { root: "Guide/README.md", scope }),
        ).toThrow(/no note at Guide\/README\.md/);
    });
});
