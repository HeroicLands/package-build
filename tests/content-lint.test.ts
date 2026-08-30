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

import { isValidShortcode, lintContentTree } from "../engine/content-lint.mjs";

/** A throwaway content tree, described as `{ relPath: contents }`. */
function tree(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "content-lint-"));
    for (const [rel, body] of Object.entries(files)) {
        const abs = path.join(root, ...rel.split("/"));
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, body, "utf8");
    }
    return root;
}

/** A well-formed note, with any field overridden. */
function note({
    type = "affliction",
    shortcode = "aconite",
    aliases = ["affliction-aconite"],
    name = "Aconite",
}: Partial<{
    type: string;
    shortcode: string;
    aliases: string[];
    name: string;
}> = {}): string {
    const aliasBlock = aliases.map((a) => `  - ${a}`).join("\n");
    return [
        "---",
        `name:`,
        `  full: ${name}`,
        `type: ${type}`,
        `shortcode: ${shortcode}`,
        "aliases:",
        aliasBlock,
        "---",
        "",
        "Body prose.",
        "",
    ].join("\n");
}

/**
 * The package homepage: a note with a `type` and no `shortcode`, because it is
 * addressed by the package rather than by a slug.
 */
function homepage(title = "Hârn Adventures"): string {
    return [
        "---",
        "type: homepage",
        `title: ${title}`,
        "---",
        "",
        "Prose.",
        "",
    ].join("\n");
}

/** Lint a tree, skipping nothing, and return its findings. */
const lint = (files: Record<string, string>) =>
    lintContentTree(tree(files), { skipDirectories: [] });

describe("isValidShortcode", () => {
    it("accepts ASCII alphanumerics in any case", () => {
        expect(isValidShortcode("aconite")).toBe(true);
        expect(isValidShortcode("BCFl")).toBe(true);
        expect(isValidShortcode("weapon2")).toBe(true);
    });

    // The separator in a `type-shortcode` address must be the only hyphen, so
    // punctuation is what the rule is really about.
    it("rejects punctuation, spaces and emptiness", () => {
        expect(isValidShortcode("self-pro")).toBe(false);
        expect(isValidShortcode("B&CFl")).toBe(false);
        expect(isValidShortcode("two words")).toBe(false);
        expect(isValidShortcode("")).toBe(false);
        expect(isValidShortcode(undefined)).toBe(false);
    });
});

describe("lintContentTree", () => {
    it("reports nothing for a clean tree, and says what it inspected", () => {
        const r = lintContentTree(
            tree({
                "homepage.md": homepage(),
                "Afflictions/Aconite.md": note(),
                "Afflictions/Belladonna.md": note({
                    shortcode: "bella",
                    name: "Belladonna",
                    aliases: ["affliction-bella"],
                }),
            }),
            { skipDirectories: [] },
        );
        expect(r.findings).toEqual([]);
        // Three notes, two keys: the homepage is a note and carries no
        // shortcode, because it is addressed by the package (#52).
        expect(r.notes).toBe(3);
        expect(r.keys).toBe(2);
    });

    it("ignores files with no frontmatter type", () => {
        const r = lint({
            "homepage.md": homepage(),
            "Afflictions/Aconite.md": note(),
            "README.md": "# Just a readme\n",
            "CLAUDE.md": "---\nfoo: bar\n---\n\nScaffolding.\n",
        });
        expect(r.findings).toEqual([]);
        expect(r.notes).toBe(2);
    });

    it("reports a malformed shortcode at its own line", () => {
        const r = lint({
            "Afflictions/Aconite.md": note({
                shortcode: "self-pro",
                aliases: ["affliction-self-pro"],
            }),
        });
        const shape = r.findings.filter((f) =>
            f.message.includes("alphanumeric"),
        );
        expect(shape).toHaveLength(1);
        expect(shape[0].file).toContain("Aconite.md");
        expect(shape[0].line).toBe(5);
    });

    // Each note is a place an author has to go and edit, so both are named.
    it("reports a duplicate address once per offending note", () => {
        const r = lint({
            "A/One.md": note(),
            "B/Two.md": note({ name: "Aconite Copy" }),
        });
        const dupes = r.findings.filter((f) =>
            f.message.includes("duplicate address"),
        );
        expect(dupes).toHaveLength(2);
        expect(dupes[0].message).toContain("affliction:aconite");
        // Each finding names the *other* file, so neither is a dead end.
        expect(dupes[0].message).toContain("Two.md");
        expect(dupes[1].message).toContain("One.md");
    });

    // #1678: a note may declare `pack:`, so two same-address notes can be
    // routed to different packs — which does not make them distinct, because a
    // document is addressed across every pack of its document type.
    it("still reports a duplicate when the two notes route to different packs", () => {
        const withPack = (pack: string, name: string) =>
            note({ name }).replace(
                "type: affliction",
                `pack: ${pack}\ntype: affliction`,
            );
        const r = lint({
            "A/One.md": withPack("items", "One"),
            "B/Two.md": withPack("relics", "Two"),
        });
        expect(
            r.findings.filter((f) => f.message.includes("duplicate address")),
        ).toHaveLength(2);
    });

    // The rule requiring every note to repeat its own `type-shortcode` in
    // `aliases:` is retired (#79). It served Obsidian and nothing else — no
    // build ever read it — and the project no longer authors in Obsidian. A
    // note carrying only ordinary aliases, or none at all, is now correct.
    it("does not require a note to repeat its own address in aliases", () => {
        expect(
            lint({
                "homepage.md": homepage(),
                "Afflictions/Aconite.md": note({ aliases: ["Wolfsbane"] }),
            }).findings,
        ).toEqual([]);
        expect(
            lint({
                "homepage.md": homepage(),
                "Afflictions/Aconite.md": note({ aliases: [] }),
            }).findings,
        ).toEqual([]);
    });

    // "Every one of nothing is unique" is a vacuous pass, and it is what a tree
    // that failed to check out produces — the one state the lint most needs to
    // catch.
    it("fails an empty tree rather than passing it vacuously", () => {
        const r = lint({});
        expect(r.findings).toHaveLength(1);
        expect(r.findings[0].message).toContain("vacuous");
        expect(r.keys).toBe(0);
        expect(r.notes).toBe(0);
    });

    it("fails a tree of untyped scaffolding for the same reason", () => {
        const r = lint({ "README.md": "# Nothing addressable\n" });
        expect(r.findings).toHaveLength(1);
        expect(r.findings[0].message).toContain("vacuous");
        expect(r.notes).toBe(0);
    });

    // Not a tree at all: the path names nothing, which is what a mistyped root
    // or a missing checkout looks like from here.
    it("fails a path that is not a content tree", () => {
        const r = lintContentTree(path.join(tree({}), "does", "not", "exist"), {
            skipDirectories: [],
        });
        expect(r.findings).toHaveLength(1);
        expect(r.findings[0].message).toContain("vacuous");
        expect(r.notes).toBe(0);
    });

    // #77: a package in `publish.site: homepage` mode may hold exactly one
    // note, and a homepage carries no `shortcode` by design — it is addressed
    // by the package, not by a slug. That is a populated tree with nothing to
    // key, not an absent one, so the vacuous guard must not fire.
    it("passes a tree whose only note is the package homepage", () => {
        const r = lint({ "homepage.md": homepage() });
        expect(r.findings).toEqual([]);
        expect(r.notes).toBe(1);
        expect(r.keys).toBe(0);
    });

    it("still lints a homepage alongside keyed notes", () => {
        const r = lint({
            "homepage.md": homepage(),
            "Afflictions/Aconite.md": note(),
            "Afflictions/Belladonna.md": note({
                shortcode: "bella",
                name: "Belladonna",
            }),
        });
        expect(r.findings).toEqual([]);
        expect(r.notes).toBe(3);
        expect(r.keys).toBe(2);

        // The keyed notes are still held to both rules with a homepage present.
        const dupes = lint({
            "homepage.md": homepage(),
            "A/One.md": note(),
            "B/Two.md": note({ name: "Aconite Copy" }),
        });
        expect(
            dupes.findings.filter((f) =>
                f.message.includes("duplicate address"),
            ),
        ).toHaveLength(2);
    });

    it("honours the skip list", () => {
        const r = lintContentTree(
            tree({
                "homepage.md": homepage(),
                "Afflictions/Aconite.md": note(),
                "Templates/Affliction.md": note({
                    shortcode: "aconite",
                    name: "Template",
                }),
            }),
            { skipDirectories: ["Templates"] },
        );
        // Without the skip, the template would duplicate the real note.
        expect(r.findings).toEqual([]);
        expect(r.notes).toBe(2);
    });
});
