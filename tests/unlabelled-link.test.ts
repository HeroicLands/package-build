/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Every wikilink is an address, and an unlabelled one is a finding (#180).
 *
 * #131 gave the pipe two jobs: it chose between the address namespace and the
 * alias one. The alias namespace turned out to be empty — across 8,305
 * wikilinks in three content trees, not one bare `[[Alias]]` resolved to a note
 * — while the collision rule that kept it honest dictated what a note could be
 * named (#179). So the alias half is gone, the pipe no longer selects anything,
 * and a link written without one cannot resolve at all.
 *
 * The correction is always the same, so the message always says it: write
 * `[[type-shortcode|Text]]`.
 */

import { describe, it, expect, vi } from "vitest";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { auditLinks, buildLinkIndex } from "../engine/content-links.mjs";
import { unlabelledLinkMessage } from "../engine/wikilink-syntax.mjs";
import { buildWikilinkIndex, convertWikilinks } from "../engine/wikilinks.mjs";
import { resolveWebWikilinks } from "../engine/web-wikilinks.mjs";
import { convertNoteWikilinks } from "../engine/helpers.mjs";

/** A throwaway content tree, described as `{ relPath: contents }`. */
function tree(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "unlabelled-link-"));
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

/** A skill named "Climbing" and a sibling skill citing it. */
const corpus = (body: string) => ({
    "Skills/Climbing.md": note({
        type: "skill",
        shortcode: "clmb",
        name: { full: "Climbing" },
    }),
    "Skills/Jumping.md": note({ type: "skill", shortcode: "jmp", name: { full: "Jumping" } }, body),
});

describe("the message, stated once", () => {
    it("names the target and the form to write", () => {
        const message = unlabelledLinkMessage("Climbing");
        expect(message).toContain("Climbing");
        expect(message).toContain("[[type-shortcode|Text]]");
    });
});

describe("buildLinkIndex resolves addresses and nothing else", () => {
    it("resolves an address by its target alone", () => {
        const { index } = audit(corpus(""));
        expect(index.resolve("skill-clmb")?.fm.shortcode).toBe("clmb");
    });

    it("does not resolve a note's name", () => {
        const { index } = audit(corpus(""));
        expect(index.resolve("Climbing")).toBeUndefined();
    });

    it("no longer exposes an alias resolver", () => {
        const { index } = audit(corpus(""));
        expect((index as any).resolveAlias).toBeUndefined();
        expect((index as any).aliasCollisions).toBeUndefined();
        expect((index as any).aliasClaims).toBeUndefined();
    });
});

describe("auditLinks reports an unlabelled link", () => {
    it("reports a bare name", () => {
        const r = audit(corpus("The [[Sunless Vault]] is not written yet."));
        expect(r.deadAddresses).toEqual([]);
        expect(r.unlabelledLinks).toHaveLength(1);
        expect(r.unlabelledLinks[0]).toMatchObject({ target: "Sunless Vault" });
        expect(r.unlabelledLinks[0].note.rel).toBe("Skills/Jumping.md");
    });

    // An address written without a pipe is still unlabelled, and is reported as
    // such rather than resolving: the pipe is what a label needs, and a bare
    // shortcode has no prose to show.
    it("reports an address written without a pipe", () => {
        const r = audit(corpus("See [[skill-clmb]]."));
        expect(r.deadAddresses).toEqual([]);
        expect(r.unlabelledLinks.map((d: any) => d.target)).toEqual(["skill-clmb"]);
    });

    // The link part may be an anchor — but it still needs a label.
    it("reports a pipe-less same-page anchor", () => {
        const r = audit(corpus("See [[#somewhere]]."));
        expect(r.unlabelledLinks).toHaveLength(1);
    });

    it("passes a labelled address and a labelled anchor", () => {
        const r = audit({
            "Skills/Climbing.md": note({ type: "skill", shortcode: "clmb" }),
            "Skills/Jumping.md": note(
                { type: "skill", shortcode: "jmp" },
                "See [[skill-clmb|Climbing]] and [[#here|here]].\n\n## Here {#here}\n",
            ),
        });
        expect(r.unlabelledLinks).toEqual([]);
        expect(r.deadAddresses).toEqual([]);
        expect(r.deadAnchors).toEqual([]);
    });

    it("passes an empty label, which is still a label", () => {
        const r = audit(corpus("See [[skill-clmb|]]."));
        expect(r.unlabelledLinks).toEqual([]);
        expect(r.deadAddresses).toEqual([]);
    });

    it("still reports a labelled target that is not an address", () => {
        const r = audit(corpus("See [[Climbing|the skill]]."));
        expect(r.unlabelledLinks).toEqual([]);
        expect(r.deadAddresses).toHaveLength(1);
        expect(r.deadAddresses[0]).toMatchObject({ reason: "not-an-address" });
    });

    it("still reports a labelled address that resolves nowhere", () => {
        const r = audit(corpus("See [[skill-nosuch|Nothing]]."));
        expect(r.deadAddresses).toHaveLength(1);
        expect(r.deadAddresses[0]).toMatchObject({ reason: "unresolved" });
    });

    it("no longer reports dead aliases or alias collisions", () => {
        const r = audit({
            "Rules/Gear.md": note({ type: "doc", shortcode: "rgear", name: { full: "Gear" } }),
            "Guide/Gear.md": note({ type: "doc", shortcode: "ggear", name: { full: "Gear" } }),
        });
        expect((r as any).deadAliases).toBeUndefined();
        expect((r as any).aliasCollisions).toBeUndefined();
    });

    // #179: five `doc` notes shared a `name.full` and every fix moved a URL.
    it("passes two same-type notes sharing a display name (#179)", () => {
        const r = audit({
            "Rules/Gear.md": note({ type: "doc", shortcode: "rgear", name: { full: "Gear" } }),
            "Guide/Gear.md": note({ type: "doc", shortcode: "ggear", name: { full: "Gear" } }),
            "Rules/A.md": note({ type: "doc", shortcode: "a" }, "See [[doc-rgear|Gear]]."),
        });
        expect(r.deadAddresses).toEqual([]);
        expect(r.unlabelledLinks).toEqual([]);
    });

    // An anchor is checked against whatever the link resolves to, and an
    // unlabelled link resolves to nothing — so it is reported once, not twice.
    it("checks an anchor on a labelled address", () => {
        const r = audit({
            "Skills/Climbing.md": note({ type: "skill", shortcode: "clmb" }),
            "Rules/A.md": note({ type: "doc", shortcode: "a" }, "See [[skill-clmb#nosuch|C]]."),
        });
        expect(r.deadAnchors).toHaveLength(1);
    });
});

describe("the pack resolver requires a label", () => {
    const DOCS = [
        { type: "skill", id: "aaaaaaaaaaaaaaa1", shortcode: "clmb", name: "Climbing" },
        { type: "skill", id: "aaaaaaaaaaaaaaa2", shortcode: "jmp", name: "Jumping" },
    ];
    const index = buildWikilinkIndex(DOCS, "sohl");
    const from = { type: "skill", id: "aaaaaaaaaaaaaaa2", index };

    it("resolves a labelled address", () => {
        const { markdown, unresolved } = convertWikilinks("[[skill-clmb|Climbing]]", from);
        expect(unresolved).toEqual([]);
        expect(markdown).toContain("@UUID[");
        expect(markdown).toContain("{Climbing}");
    });

    it("shows the target's current name for an empty label", () => {
        const { markdown } = convertWikilinks("[[skill-clmb|]]", from);
        expect(markdown).toContain("{Climbing}");
    });

    it("reports an unlabelled address", () => {
        const { unresolved, markdown } = convertWikilinks("[[skill-clmb]]", from);
        expect(unresolved).toHaveLength(1);
        expect(unresolved[0]).toMatchObject({ target: "skill-clmb", reason: "unlabelled" });
        expect(markdown).toContain("sohl-unresolved-link");
    });

    it("reports an unlabelled name", () => {
        const { unresolved } = convertWikilinks("[[Climbing]]", from);
        expect(unresolved).toHaveLength(1);
        expect(unresolved[0]).toMatchObject({ reason: "unlabelled" });
    });

    it("resolves a labelled same-page anchor, and reports an unlabelled one", () => {
        expect(convertWikilinks("[[#here|There]]", from).unresolved).toEqual([]);
        const bare = convertWikilinks("[[#here]]", from);
        expect(bare.unresolved).toHaveLength(1);
        expect(bare.unresolved[0]).toMatchObject({ reason: "unlabelled" });
    });

    it("fails the note, so one authored link gets one verdict", () => {
        const at = { ...from, name: "Jumping", file: "Skills/Jumping.md" };
        expect(() => convertNoteWikilinks("[[Nowhere]]", at)).toThrow(
            /\[\[type-shortcode\|Text\]\]/,
        );
    });

    it("still fails a labelled target that is not an address", () => {
        const at = { ...from, name: "Jumping", file: "Skills/Jumping.md" };
        expect(() => convertNoteWikilinks("[[Nowhere|somewhere]]", at)).toThrow(
            /"Nowhere" is not an address/,
        );
    });

    it("no longer builds an alias index", () => {
        expect((index as any).byAlias).toBeUndefined();
        expect((index as any).aliasClaims).toBeUndefined();
    });
});

describe("the web resolver requires a label", () => {
    const climbing = { url: "/kb/skill/climbing/", name: "Climbing" };
    const ctx = () => ({
        index: new Map<string, object>([["skill/clmb", climbing]]),
        sections: new Set<string>(["kb"]),
        contentTypes: new Set<string>(["skill", "doc"]),
        foreign: new Map<string, object>(),
        type: "skill",
        errors: [] as object[],
        src: "Skills/Jumping.md",
    });
    const web = (body: string, c = ctx()) => resolveWebWikilinks(body, c as never);

    it("resolves a labelled address", () => {
        expect(web("[[skill-clmb|Climbing]]")).toBe("[Climbing](/kb/skill/climbing/)");
    });

    it("shows the target's current name for an empty label", () => {
        expect(web("[[skill-clmb|]]")).toBe("[Climbing](/kb/skill/climbing/)");
    });

    it("reports an unlabelled link and marks it in the output", () => {
        const c = ctx();
        expect(web("[[Climbing]]", c)).toContain("sohl-unresolved-link");
        expect(c.errors).toHaveLength(1);
        expect(c.errors[0]).toMatchObject({ reason: "unlabelled", target: "Climbing" });
    });

    it("reports an unlabelled address", () => {
        const c = ctx();
        expect(web("[[skill-clmb]]", c)).toContain("sohl-unresolved-link");
        expect(c.errors[0]).toMatchObject({ reason: "unlabelled" });
    });

    it("resolves a labelled same-page anchor, and reports an unlabelled one", () => {
        expect(web("[[#the-heading|There]]")).toBe("[There](#the-heading)");
        const c = ctx();
        web("[[#the-heading]]", c);
        expect(c.errors[0]).toMatchObject({ reason: "unlabelled" });
    });
});

describe("the compile warning path is gone", () => {
    // Every unresolved link now fails the note, so nothing reaches the warning
    // that used to carry an unresolved alias through.
    it("does not warn for an unlabelled link", () => {
        const index = buildWikilinkIndex(
            [{ type: "skill", id: "aaaaaaaaaaaaaaa1", shortcode: "clmb", name: "Climbing" }],
            "sohl",
        );
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(() =>
            convertNoteWikilinks("[[Nowhere]]", {
                type: "skill",
                id: "aaaaaaaaaaaaaaa1",
                index,
                name: "Climbing",
                file: "Skills/Climbing.md",
            }),
        ).toThrow();
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});
