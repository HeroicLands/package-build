/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The pipe decides how a link resolves (#131).
 *
 * `[[x]]` is an **alias**; `[[x|…]]` is an **address**. Neither falls back to
 * the other, so a target is read by the punctuation the author wrote rather
 * than by whether its shape happens to look like an address.
 *
 * Before this, both resolvers tried one namespace and fell through to the
 * other, which meant an author could not say which they meant and a note whose
 * *name* looked like an address resolved as one.
 */

import { describe, it, expect, vi } from "vitest";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { auditLinks, buildLinkIndex } from "../engine/content-links.mjs";
import { aliasesOf, indexAliases } from "../engine/alias-index.mjs";
import { parseWikilink, resolvesAsAddress } from "../engine/wikilink-syntax.mjs";
import { buildWikilinkIndex, convertWikilinks } from "../engine/wikilinks.mjs";
import { resolveWebWikilinks } from "../engine/web-wikilinks.mjs";
import { convertNoteWikilinks } from "../engine/helpers.mjs";

/** A throwaway content tree, described as `{ relPath: contents }`. */
function tree(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipe-resolution-"));
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
                if (Array.isArray(v2)) {
                    lines.push(`  ${k2}:`);
                    for (const item of v2) lines.push(`    - ${item}`);
                } else {
                    lines.push(`  ${k2}: ${v2}`);
                }
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

const audit = (files: Record<string, string>) => {
    const index = buildLinkIndex(tree(files), { skipDirectories: [] });
    return { index, ...auditLinks(index) };
};

/**
 * A skill named "Climbing" and a sibling skill citing it. Same type on both
 * sides, since an alias reaches only the source note's own type.
 */
const corpus = (body: string) => ({
    "Skills/Climbing.md": note({
        type: "skill",
        shortcode: "clmb",
        name: { full: "Climbing" },
    }),
    "Skills/Jumping.md": note({ type: "skill", shortcode: "jmp", name: { full: "Jumping" } }, body),
});

describe("resolvesAsAddress — the rule, stated once", () => {
    it("reads a piped link as an address", () => {
        expect(resolvesAsAddress(parseWikilink("skill-clmb|Climbing"))).toBe(true);
    });

    it("reads an empty label as an address too", () => {
        expect(resolvesAsAddress(parseWikilink("skill-clmb|"))).toBe(true);
    });

    it("reads an unpiped link as an alias", () => {
        expect(resolvesAsAddress(parseWikilink("skill-clmb"))).toBe(false);
        expect(resolvesAsAddress(parseWikilink("Climbing"))).toBe(false);
    });
});

describe("the alias index", () => {
    it("carries authored aliases, name.aliases and name.full", () => {
        expect(
            aliasesOf({
                aliases: ["Scrambling"],
                name: { full: "Climbing", aliases: ["Clambering"] },
            }),
        ).toEqual(["Scrambling", "Clambering", "Climbing"]);
    });

    // A filename is a file-system fact, not an address an author wrote. It
    // produced keys nobody could ever cite (` introduction`, from
    // `_Introduction.md`) and collisions that followed from nothing authored.
    it("does not carry the filename", () => {
        const { index } = audit({
            "Skills/Climbing.md": note({ type: "skill", shortcode: "clmb" }),
            "Skills/Jumping.md": note({ type: "skill", shortcode: "jmp" }),
        });
        const src = index.notes.find((n: any) => n.fm.shortcode === "jmp");
        expect(index.resolveAlias(src, "Climbing")).toBeUndefined();
    });

    it("keys an alias by the claiming note's own type", () => {
        const claims = indexAliases([
            { type: "skill", aliases: ["Shock"], value: "skill-note" },
            { type: "trauma", aliases: ["Shock"], value: "trauma-note" },
        ]);
        expect(claims.byKey.get("skill|shock")).toBe("skill-note");
        expect(claims.byKey.get("trauma|shock")).toBe("trauma-note");
        expect(claims.collisions).toEqual([]);
    });

    it("reports a same-type collision, naming every claimant", () => {
        const claims = indexAliases([
            { type: "doc", aliases: ["Gear"], value: "rules" },
            { type: "doc", aliases: ["Gear"], value: "guide" },
            { type: "doc", aliases: ["Gear"], value: "collection" },
        ]);
        expect(claims.collisions).toHaveLength(1);
        expect(claims.collisions[0].alias).toBe("Gear");
        expect(claims.collisions[0].claimants).toEqual(["rules", "guide", "collection"]);
    });

    // Resolving to whichever note was walked first is a silently wrong link.
    it("resolves an ambiguous alias to nothing", () => {
        const claims = indexAliases([
            { type: "doc", aliases: ["Gear"], value: "rules" },
            { type: "doc", aliases: ["Gear"], value: "guide" },
        ]);
        expect(claims.byKey.get("doc|gear")).toBeUndefined();
    });
});

describe("buildLinkIndex — two namespaces, no fallback", () => {
    it("resolves an unpiped target as an alias only", () => {
        const { index } = audit(corpus(""));
        const src = index.notes.find((n: any) => n.fm.shortcode === "jmp");
        expect(index.resolve(src, "Climbing", false)?.fm.shortcode).toBe("clmb");
        // The address, written without a pipe, is an alias nobody claims.
        expect(index.resolve(src, "skill-clmb", false)).toBeUndefined();
    });

    it("resolves a piped target as an address only", () => {
        const { index } = audit(corpus(""));
        const src = index.notes.find((n: any) => n.fm.shortcode === "jmp");
        expect(index.resolve(src, "skill-clmb", true)?.fm.shortcode).toBe("clmb");
        // The name, written with a pipe, is not an address.
        expect(index.resolve(src, "Climbing", true)).toBeUndefined();
    });

    it("reports a same-type alias collision on the index", () => {
        const { index } = audit({
            "Rules/Gear.md": note({ type: "doc", shortcode: "rgear", name: { full: "Gear" } }),
            "Guide/Gear.md": note({ type: "doc", shortcode: "ggear", name: { full: "Gear" } }),
        });
        expect(index.aliasCollisions).toHaveLength(1);
        expect(index.aliasCollisions[0].alias).toBe("Gear");
        expect(index.aliasCollisions[0].claimants.map((n: any) => n.fm.shortcode).sort()).toEqual([
            "ggear",
            "rgear",
        ]);
    });
});

describe("auditLinks — the two failure modes read differently", () => {
    it("reports a piped target that is not an address at all", () => {
        const r = audit(corpus("See [[Climbing|the skill]]."));
        expect(r.deadAliases).toEqual([]);
        expect(r.deadAddresses).toHaveLength(1);
        expect(r.deadAddresses[0]).toMatchObject({
            target: "Climbing",
            reason: "not-an-address",
        });
    });

    it("reports a piped address that resolves nowhere", () => {
        const r = audit(corpus("See [[skill-nosuch|Nothing]]."));
        expect(r.deadAddresses).toHaveLength(1);
        expect(r.deadAddresses[0]).toMatchObject({
            target: "skill-nosuch",
            reason: "unresolved",
        });
    });

    it("reports an unpiped target that no alias claims, as an alias", () => {
        const r = audit(corpus("The [[Sunless Vault]] is not written yet."));
        expect(r.deadAddresses).toEqual([]);
        expect(r.deadAliases).toHaveLength(1);
        expect(r.deadAliases[0]).toMatchObject({ target: "Sunless Vault" });
    });

    // The address form written without a pipe is now an alias miss, not an
    // address hit — which is the whole of the migration this rule asks for.
    it("reports an unpiped address-shaped target as an alias miss", () => {
        const r = audit(corpus("See [[skill-clmb]]."));
        expect(r.deadAddresses).toEqual([]);
        expect(r.deadAliases.map((d: any) => d.target)).toEqual(["skill-clmb"]);
    });

    it("passes a piped address and an unpiped alias", () => {
        const r = audit(corpus("See [[skill-clmb|Climbing]] and [[Climbing]]."));
        expect(r.deadAddresses).toEqual([]);
        expect(r.deadAliases).toEqual([]);
    });

    it("reports an alias two same-type notes claim, naming both", () => {
        const r = audit({
            "Rules/Gear.md": note({ type: "doc", shortcode: "rgear", name: { full: "Gear" } }),
            "Guide/Gear.md": note({ type: "doc", shortcode: "ggear", name: { full: "Gear" } }),
            "Rules/A.md": note({ type: "doc", shortcode: "a" }, "See [[Gear]]."),
        });
        expect(r.aliasCollisions).toHaveLength(1);
        const files = r.aliasCollisions[0].claimants.map((n: any) => n.rel).sort();
        expect(files).toEqual(["Guide/Gear.md", "Rules/Gear.md"]);
        // The citing note is innocent; it is reported only as an alias miss.
        expect(r.aliasCollisions[0].claimants.map((n: any) => n.rel)).not.toContain("Rules/A.md");
    });

    // An anchor is checked against whatever the link resolves to, and what it
    // resolves to now depends on the pipe.
    it("checks an anchor on a piped address", () => {
        const r = audit({
            "Skills/Climbing.md": note({ type: "skill", shortcode: "clmb" }),
            "Rules/A.md": note({ type: "doc", shortcode: "a" }, "See [[skill-clmb#nosuch|C]]."),
        });
        expect(r.deadAnchors).toHaveLength(1);
    });

    it("checks an anchor on an unpiped alias", () => {
        const r = audit({
            "Skills/Climbing.md": note({
                type: "skill",
                shortcode: "clmb",
                name: { full: "Climbing" },
            }),
            "Skills/Jumping.md": note({ type: "skill", shortcode: "jmp" }, "See [[Climbing#no]]."),
        });
        expect(r.deadAnchors).toHaveLength(1);
    });

    // Ruling 4: a bracketed link in *any* frontmatter value is a finding, and
    // it names the note and the field.
    it("reports a bracketed link in a frontmatter value", () => {
        const r = audit({
            "Rules/A.md": note({
                type: "doc",
                shortcode: "a",
                description: "See [[skill-clmb|Climbing]] for more",
            }),
        });
        expect(r.frontmatterLinks).toHaveLength(1);
        expect(r.frontmatterLinks[0].path).toBe("description");
        expect(r.frontmatterLinks[0].note.rel).toBe("Rules/A.md");
    });

    it("reports a bracketed link nested in a frontmatter map or list", () => {
        const r = audit({
            "Rules/A.md": note({
                type: "doc",
                shortcode: "a",
                government: { summary: "Ruled from [[place-tashal|Tashal]]" },
            }),
        });
        expect(r.frontmatterLinks.map((f: any) => f.path)).toEqual(["government.summary"]);
    });
});

describe("the pack resolver splits on the pipe", () => {
    const DOCS = [
        {
            type: "skill",
            id: "aaaaaaaaaaaaaaa1",
            shortcode: "clmb",
            name: "Climbing",
            aliases: ["Climbing"],
        },
        {
            type: "skill",
            id: "aaaaaaaaaaaaaaa2",
            shortcode: "jmp",
            name: "Jumping",
            aliases: ["Jumping"],
        },
    ];
    const index = buildWikilinkIndex(DOCS, "sohl");
    const from = { type: "skill", id: "aaaaaaaaaaaaaaa2", index };

    it("resolves a piped address", () => {
        const { markdown, unresolved } = convertWikilinks("[[skill-clmb|Climbing]]", from);
        expect(unresolved).toEqual([]);
        expect(markdown).toContain("@UUID[");
        expect(markdown).toContain("{Climbing}");
    });

    it("shows the target's current name for an empty label", () => {
        const { markdown } = convertWikilinks("[[skill-clmb|]]", from);
        expect(markdown).toContain("{Climbing}");
    });

    it("resolves an unpiped alias", () => {
        const { markdown, unresolved } = convertWikilinks("[[Climbing]]", from);
        expect(unresolved).toEqual([]);
        expect(markdown).toContain("{Climbing}");
    });

    it("does not resolve an unpiped address", () => {
        const { unresolved } = convertWikilinks("[[skill-clmb]]", from);
        expect(unresolved).toHaveLength(1);
        expect(unresolved[0]).toMatchObject({ target: "skill-clmb", addressed: false });
    });

    it("does not resolve a piped name", () => {
        const { unresolved } = convertWikilinks("[[Climbing|the skill]]", from);
        expect(unresolved).toHaveLength(1);
        expect(unresolved[0]).toMatchObject({
            target: "Climbing",
            reason: "not-an-address",
        });
    });

    it("still resolves a same-page anchor either way", () => {
        expect(convertWikilinks("[[#here]]", from).unresolved).toEqual([]);
        expect(convertWikilinks("[[#here|There]]", from).unresolved).toEqual([]);
    });

    // The pack compile fails on an address defect and warns on an alias miss,
    // which is the same split the link checker reports.
    it("fails the note for a piped name, and warns for an unpiped one", () => {
        const at = { ...from, name: "Jumping", file: "Skills/Jumping.md" };
        expect(() => convertNoteWikilinks("[[Nowhere|somewhere]]", at)).toThrow(
            /written as an address/,
        );
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(() => convertNoteWikilinks("[[Nowhere]]", at)).not.toThrow();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("unresolved wikilink"));
        warn.mockRestore();
    });
});

describe("the web resolver splits on the pipe", () => {
    const climbing = { url: "/kb/skill/climbing/", name: "Climbing" };
    const ctx = () => ({
        index: new Map<string, object>([
            ["skill/clmb", climbing],
            ["kb/climbing", climbing],
        ]),
        typeAlias: new Map<string, object>([["skill|climbing", climbing]]),
        collide: new Set<string>(),
        typeCollide: new Set<string>(),
        sections: new Set<string>(["kb"]),
        contentTypes: new Set<string>(["skill", "doc"]),
        foreign: new Map<string, object>(),
        manifestsComplete: true,
        type: "skill",
        errors: [] as object[],
        src: "Skills/Jumping.md",
    });
    const web = (body: string, c = ctx()) => resolveWebWikilinks(body, c as never);

    it("resolves a piped address", () => {
        expect(web("[[skill-clmb|Climbing]]")).toBe("[Climbing](/kb/skill/climbing/)");
    });

    it("shows the target's current name for an empty label", () => {
        expect(web("[[skill-clmb|]]")).toBe("[Climbing](/kb/skill/climbing/)");
    });

    it("resolves an unpiped alias, keeping the author's prose", () => {
        expect(web("[[Climbing]]")).toBe("[Climbing](/kb/skill/climbing/)");
    });

    it("does not resolve an unpiped address", () => {
        expect(web("[[skill-clmb]]")).toContain("sohl-unresolved-link");
    });

    it("does not resolve a piped name", () => {
        const c = ctx();
        expect(web("[[Climbing|the skill]]", c)).toContain("sohl-unresolved-link");
        expect(c.errors).toHaveLength(1);
        expect(c.errors[0]).toMatchObject({ reason: "not-an-address" });
    });
});
