/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A link to a note tagged `draft` renders marked, on both surfaces (#183).
 *
 * A draft note is a note that exists so a link is not dead, and nothing else.
 * Left unmarked, a reader follows a promising link into an empty page and an
 * author cannot see which of their links still owe content.
 *
 * **The note stays in the graph.** This marks at presentation only: the link
 * still resolves to the same address, the note still compiles into the same
 * packs, and the checker still sees the same tree. That is what distinguishes
 * it from the retired `draft:` field, whose whole effect was to move a note
 * from published to unresolvable without saying so.
 */

import { describe, it, expect } from "vitest";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildWikilinkIndex, convertWikilinks } from "../engine/wikilinks.mjs";
import { resolveWebWikilinks } from "../engine/web-wikilinks.mjs";
import { buildSiteIndex, wikiContext } from "../engine/site-index.mjs";
import { collectContentPages } from "../engine/site-build.mjs";
import { DRAFT_TAG, isDraftNote } from "../engine/note-vocabulary.mjs";

const ENGINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "engine");

/**
 * The markup a marked draft link renders as, written out here rather than
 * imported.
 *
 * A literal is the point: it is what makes a change of class name or title
 * wording show up as a failing test in this file, instead of as two builds
 * quietly agreeing on something no stylesheet matches.
 */
const draft = (inner: string) =>
    `<span class="sohl-draft-link" title="Draft — not yet written">${inner}</span>`;

/** A tree with one finished note and one draft note, both of type `doc`. */
const DOCS = [
    {
        type: "doc",
        id: "aaaaaaaaaaaaaaa1",
        shortcode: "shock",
        name: "Shock",
        aliases: ["Shock"],
    },
    {
        type: "doc",
        id: "aaaaaaaaaaaaaaa2",
        shortcode: "coma",
        name: "Coma",
        aliases: ["Coma"],
        draft: true,
    },
];

const index = () => buildWikilinkIndex(DOCS, "sohl");

const source = (rel: string) => fs.readFileSync(path.join(ENGINE, rel), "utf8");

/**
 * The text of one function, from its `function` keyword to the closing brace in
 * column 1. Both copies are written at module scope, so the terminator is
 * unambiguous.
 */
function functionSource(code: string, name: string): string {
    const start = code.indexOf(`function ${name}(`);
    expect(start, `${name} is not defined at module scope`).toBeGreaterThan(-1);
    const end = code.indexOf("\n}\n", start);
    expect(end, `${name} has no closing brace in column 1`).toBeGreaterThan(start);
    return code.slice(start, end + 3);
}

describe("the `draft` tag is read from where it is declared", () => {
    // The tag vocabulary (#172) is the single declaration. Spelling "draft" a
    // second time here is how the two come apart: rename the declared tag and
    // a private copy keeps matching the old spelling, silently.
    it("is the tag the vocabulary declares", () => {
        expect(DRAFT_TAG).toBe("draft");
    });

    it("reads a note's tags, however Obsidian wrote them", () => {
        expect(isDraftNote({ tags: ["draft"] })).toBe(true);
        // Obsidian writes a tag with a leading `#` in some contexts, and a
        // single tag as a scalar rather than a list.
        expect(isDraftNote({ tags: "#draft" })).toBe(true);
        expect(isDraftNote({ tags: [" Draft "] })).toBe(true);
        expect(isDraftNote({ tag: ["draft"] })).toBe(true);
    });

    it("is false for a note with no tags, other tags, or no frontmatter", () => {
        expect(isDraftNote({})).toBe(false);
        expect(isDraftNote({ tags: ["village", "coastal"] })).toBe(false);
        expect(isDraftNote(null)).toBe(false);
        // A near miss is not a draft. The frontmatter lint reports it; nothing
        // here guesses.
        expect(isDraftNote({ tags: ["drafts"] })).toBe(false);
    });

    // The retired `draft:` field is not a source. Reinstating it here is
    // exactly the mistake `retired-fields.mjs` exists to prevent.
    it("does not read the retired `draft:` field", () => {
        expect(isDraftNote({ draft: true })).toBe(false);
    });
});

describe("the pack build marks a link to a draft note", () => {
    it("wraps the UUID enricher, which still enriches", () => {
        const { markdown, unresolved } = convertWikilinks("See [[doc-coma|Coma]].", {
            type: "doc",
            id: "aaaaaaaaaaaaaaa1",
            index: index(),
        });
        expect(unresolved).toEqual([]);
        // Foundry enriches inside HTML, so the link is still live: the span
        // carries the cue and nothing else.
        expect(markdown).toBe(
            `See ${draft("@UUID[Compendium.sohl.journals.JournalEntry.aaaaaaaaaaaaaaa2]{Coma}")}.`,
        );
    });

    it("leaves a link to a finished note exactly as it was", () => {
        const { markdown } = convertWikilinks("See [[doc-shock|Shock]].", {
            type: "doc",
            id: "aaaaaaaaaaaaaaa2",
            index: index(),
        });
        expect(markdown).toBe(
            "See @UUID[Compendium.sohl.journals.JournalEntry.aaaaaaaaaaaaaaa1]{Shock}.",
        );
        expect(markdown).not.toContain("sohl-draft-link");
    });

    it("changes nothing about resolution — the address is unmoved", () => {
        // The marked and unmarked forms address the same document. A draft note
        // is in the packs, in the index and reachable; only the citing link
        // looks different.
        const marked = convertWikilinks("[[doc-coma|Coma]]", {
            type: "doc",
            id: "aaaaaaaaaaaaaaa1",
            index: index(),
        }).markdown;
        expect(marked).toContain("@UUID[Compendium.sohl.journals.JournalEntry.aaaaaaaaaaaaaaa2]");
    });

    it("marks an anchored link too, which addresses a page of the same note", () => {
        const { markdown } = convertWikilinks("[[doc-coma#onset|Onset]]", {
            type: "doc",
            id: "aaaaaaaaaaaaaaa1",
            index: index(),
        });
        expect(markdown.startsWith('<span class="sohl-draft-link"')).toBe(true);
        expect(markdown).toContain("JournalEntryPage");
    });

    // An unresolved link is a different fact and keeps its own marking: the
    // target does not exist, rather than existing and being unwritten.
    it("does not mark an unresolved link as a draft", () => {
        const { markdown } = convertWikilinks("[[doc-nope|Nope]]", {
            type: "doc",
            id: "aaaaaaaaaaaaaaa1",
            index: index(),
        });
        expect(markdown).toContain("sohl-unresolved-link");
        expect(markdown).not.toContain("sohl-draft-link");
    });
});

describe("the site build marks a link to a draft note", () => {
    const ctx = () => ({
        index: new Map<string, object>([
            ["doc/shock", { url: "/rules/shock/", name: "Shock" }],
            ["doc/coma", { url: "/rules/coma/", name: "Coma", draft: true }],
        ]),
        typeAlias: new Map<string, object>(),
        collide: new Set<string>(),
        typeCollide: new Set<string>(),
        sections: new Set<string>(["rules"]),
        contentTypes: new Set<string>(["doc"]),
        packages: new Set<string>(["sohl"]),
        type: "doc",
        errors: [] as object[],
        src: "Rules/Bleeding.md",
    });

    it("wraps the markdown link, which is still a link", () => {
        const c = ctx();
        expect(resolveWebWikilinks("See [[doc-coma|Coma]].", c)).toBe(
            `See ${draft("[Coma](/rules/coma/)")}.`,
        );
        expect(c.errors).toEqual([]);
    });

    it("leaves a link to a finished note exactly as it was", () => {
        const c = ctx();
        expect(resolveWebWikilinks("See [[doc-shock|Shock]].", c)).toBe(
            "See [Shock](/rules/shock/).",
        );
    });

    it("marks an anchored link, keeping the fragment inside the href", () => {
        const c = ctx();
        expect(resolveWebWikilinks("[[doc-coma#onset|Onset]]", c)).toBe(
            draft("[Onset](/rules/coma/#onset)"),
        );
    });
});

describe("the site index carries a page's draft state", () => {
    /** A content entry, with only what the index reads. */
    const entry = (over: Record<string, unknown> = {}) => ({
        kind: "content",
        fm: { type: "doc", ...(over.fm as object) },
        name: (over.name as string) ?? "Coma",
        slug: (over.slug as string) ?? "coma",
        sec: "rules",
        base: `${((over.name as string) ?? "Coma").replace(/ /g, "_")}.md`,
        url: (over.url as string) ?? "/kb/rules/coma/",
        isReadme: false,
    });

    it("marks every key a draft page is addressable by", () => {
        const { index } = buildSiteIndex([
            entry({ fm: { type: "doc", shortcode: "coma", tags: ["draft"] } }),
        ]);
        // The address, and the `section/slug` key the first pass writes.
        expect(index.get("doc/coma")?.draft).toBe(true);
        expect(index.get("rules/coma")?.draft).toBe(true);
    });

    it("leaves a finished page unmarked", () => {
        const { index } = buildSiteIndex([
            entry({ name: "Shock", slug: "shock", fm: { type: "doc", shortcode: "shock" } }),
        ]);
        expect(index.get("doc/shock")?.draft).toBe(false);
        expect(index.get("rules/shock")?.draft).toBe(false);
    });
});

describe("end to end, from a note's `tags:` to the emitted markup", () => {
    // The unit cases above hand the resolvers a `draft` flag. This one starts
    // where an author does — a tag in frontmatter — and walks the real site
    // pipeline to the rendered link, so nothing between the two can quietly
    // drop the field.
    it("marks a link into a note the tree tags `draft`", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "draft-link-"));
        try {
            const note = (rel: string, fm: string, body = "Prose.\n") => {
                const file = path.join(root, "assets/content", rel);
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(file, `---\n${fm.trim()}\n---\n\n${body}`);
            };
            note(
                "Rules/Coma.md",
                `type: doc
subType: rules
shortcode: coma
tags:
  - draft
name:
    full: Coma`,
            );
            note(
                "Rules/Shock.md",
                `type: doc
subType: rules
shortcode: shock
name:
    full: Shock`,
                "Worse than [[doc-coma|Coma]], better than [[doc-shock|Shock]].\n",
            );

            const { pages } = collectContentPages(path.join(root, "assets/content"), {
                packages: new Set(["demo"]),
                contentPackage: "demo",
                skipDirectories: [],
                mount: "/demo/kb/",
                scheme: { prefix: "kb/", landing: "readme" },
            });
            const built = buildSiteIndex(pages);
            const citing = pages.find((p: any) => p.fm.shortcode === "shock");
            const errors: object[] = [];
            const out = resolveWebWikilinks(
                citing.body,
                wikiContext(built, { src: citing.rel, type: "doc", errors }),
            );

            expect(errors).toEqual([]);
            // The draft target is marked; the finished one, cited in the same
            // sentence, is not.
            expect(out.trim()).toBe(
                `Worse than ${draft("[Coma](/demo/kb/rules/coma/)")}, ` +
                    "better than [Shock](/demo/kb/rules/shock/).",
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe("the two builds emit the same markup", () => {
    // One authored link renders on two surfaces, and the two builds have
    // drifted before over exactly this kind of detail (#1409). The wrapper is
    // duplicated rather than imported — the pack resolver is not reachable from
    // the site resolver — so identity is asserted rather than assumed.
    it("wraps a draft link identically in both resolvers", () => {
        const packed = convertWikilinks("[[doc-coma|Coma]]", {
            type: "doc",
            id: "aaaaaaaaaaaaaaa1",
            index: index(),
        }).markdown;
        const web = resolveWebWikilinks("[[doc-coma|Coma]]", {
            index: new Map<string, object>([
                ["doc/coma", { url: "/rules/coma/", name: "Coma", draft: true }],
            ]),
            typeAlias: new Map<string, object>(),
            collide: new Set<string>(),
            typeCollide: new Set<string>(),
            sections: new Set<string>(["rules"]),
            contentTypes: new Set<string>(["doc"]),
            packages: new Set<string>(["sohl"]),
            type: "doc",
            errors: [],
            src: "Rules/Bleeding.md",
        });

        const wrapper = (html: string) => {
            const at = html.indexOf(">");
            return { open: html.slice(0, at + 1), close: html.slice(-7) };
        };
        expect(wrapper(packed)).toEqual(wrapper(web));
        expect(wrapper(packed).open).toBe(
            '<span class="sohl-draft-link" title="Draft — not yet written">',
        );
        expect(wrapper(packed).close).toBe("</span>");
    });

    it("defines `draftLink` byte-identically in both engine modules", () => {
        const pack = functionSource(source("wikilinks.mjs"), "draftLink");
        const web = functionSource(source("web-wikilinks.mjs"), "draftLink");
        expect(pack).toBe(web);
    });
});
