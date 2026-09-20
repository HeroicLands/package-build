/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The links a package homepage carries, and the ones that land nowhere.
 *
 * The page a reader arrives at is the one no wikilink resolver reaches: a
 * homepage is published verbatim in every publishing mode, so its links are
 * ordinary markdown in its body, and this is the check that reads them.
 */

import { describe, it, expect } from "vitest";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { auditLinks, buildLinkIndex } from "../engine/content-links.mjs";
import { positionOfLiteral } from "../engine/diagnostics.mjs";
import { homepageAddresses } from "../engine/homepage.mjs";

/** A throwaway content tree, described as `{ relPath: contents }`. */
function tree(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "homepage-links-"));
    for (const [rel, body] of Object.entries(files)) {
        const abs = path.join(root, ...rel.split("/"));
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, body, "utf8");
    }
    return root;
}

/** Build and audit a tree in one step. */
const audit = (files: Record<string, string>) => {
    const index = buildLinkIndex(tree(files), { skipDirectories: [] });
    return { index, ...auditLinks(index) };
};

/** The messages a homepage audit produced, in order. */
const messages = (files: Record<string, string>) =>
    audit(files).homepageLinks.map((f: { message: string }) => f.message);

/** A `type: homepage` note, frontmatter written verbatim. */
const homepage = (frontmatter: string, body = "") =>
    `---\ntype: homepage\n${frontmatter}---\n\n${body}`;

describe("homepageAddresses", () => {
    it("reads markdown links out of the body, leaving code alone", () => {
        const found = homepageAddresses(
            "See [the rules](kb/rules/).\n\n```text\n[not a link](kb/nope/)\n```\n",
        );
        expect(found.map((a) => [a.field, a.url, a.kind])).toEqual([["body", "kb/rules/", "body"]]);
    });

    it("reads every link in body order, external ones included", () => {
        const found = homepageAddresses(
            "Browsable from the [knowledgebase](kb/), built from " +
                "[one repository](https://github.com/x/y).\n",
        );
        expect(found.map((a) => a.url)).toEqual(["kb/", "https://github.com/x/y"]);
    });

    it("finds nothing on a body with no links", () => {
        expect(homepageAddresses("Plain prose.\n")).toEqual([]);
        expect(homepageAddresses()).toEqual([]);
    });
});

describe("auditLinks — the homepage", () => {
    it("passes a homepage whose addresses are package-relative or external", () => {
        expect(
            messages({
                "homepage.md": homepage(
                    "",
                    [
                        "[Install](https://github.com/HeroicLands/x/releases/latest/download/system.json)",
                        "it, read the [rules](kb/rules/) and the [API](api/), and browse the",
                        "[knowledgebase](kb/). Ask on [Discord](https://discord.gg/EwMfkNd3az).",
                        "",
                    ].join("\n"),
                ),
            }),
        ).toEqual([]);
    });

    it("reports an address naming a retired content type", () => {
        const found = messages({
            "homepage.md": homepage(
                "",
                "Every [creature](kb/creature/) and every [character](kb/character/).\n",
            ),
        });
        expect(found).toHaveLength(2);
        expect(found[0]).toContain('content type "creature", retired in favour of "being"');
        expect(found[0]).toContain('mechanical: "kb/being/"');
        expect(found[1]).toContain('content type "character", retired in favour of "being"');
    });

    it("reports an absolute URL into this package's own address", () => {
        const found = messages({
            "homepage.md": homepage(
                "",
                "See the [rules](https://www.heroiclands.org/sohl/kb/rules/).\n",
            ),
        });
        expect(found).toHaveLength(1);
        expect(found[0]).toContain("kb/rules/");
        expect(found[0]).toContain("package-relative");
    });

    it("reports a hardcoded absolute URL to this package's own landing", () => {
        const found = messages({
            "homepage.md": homepage(
                "",
                "A module for [SoHL](https://www.heroiclands.org/sohl/).\n",
            ),
        });
        expect(found).toHaveLength(1);
        expect(found[0]).toContain("this package's own landing");
        expect(found[0]).toContain('write "/sohl/"');
    });

    // The case the issue was filed for, and the one the fence makes hard:
    // `sohl-kethira-basic` links to SoHL's landing and vendors **no manifest**,
    // because homepage-only mode never walks a content tree. The roster is what
    // makes the address reachable anyway — no `manifestDir` is passed here, and
    // the finding still names the package and its base.
    it("reports a foreign package's landing with no manifest vendored", () => {
        const found = messages({
            "homepage.md": homepage("", "See [Thalorna](https://www.heroiclands.org/thalorna/).\n"),
        });
        expect(found).toHaveLength(1);
        expect(found[0]).toContain(`package "thalorna"'s landing`);
        expect(found[0]).toContain('write "/thalorna/"');
    });

    // A package the roster does not list and no manifest names is not a package
    // as far as this build is concerned, so its path is left alone rather than
    // guessed at — several surfaces a landing routes to are built by other
    // tools entirely.
    it("leaves an in-site path that names no known package alone", () => {
        expect(
            messages({
                "homepage.md": homepage("", "See [the blog](https://www.heroiclands.org/news/).\n"),
            }),
        ).toEqual([]);
    });

    // The form the finding above names. It is host-free and is emitted
    // verbatim — no index resolves it — which is what lets it hold in
    // homepage-only mode, where the content tree is never walked.
    it("accepts the root-relative form it directs an author to", () => {
        expect(
            messages({
                "homepage.md": homepage("", "A module for [SoHL](/sohl/).\n"),
            }),
        ).toEqual([]);
    });

    // A root-relative body link is emitted verbatim and resolved by the
    // browser, so it means exactly what it says and is left alone.
    it("leaves a root-relative body link alone", () => {
        expect(
            messages({
                "homepage.md": homepage("", "Read the [rules](/sohl/kb/rules/).\n"),
            }),
        ).toEqual([]);
    });

    it("reports a wikilink in a homepage body", () => {
        const found = messages({
            "homepage.md": homepage("", "See [[skill-clmb]] for climbing.\n"),
        });
        expect(found).toHaveLength(1);
        expect(found[0]).toContain("published verbatim");
    });

    it("locates a finding at the line the address is written on", () => {
        const { homepageLinks } = audit({
            "homepage.md": homepage("", "Prose first.\n\nThen [creatures](kb/creature/).\n"),
        });
        const f = homepageLinks[0];
        expect(positionOfLiteral(f.note.raw, f.text, f.occurrence)).toEqual({
            line: 7,
            column: 18,
        });
    });

    it("audits only homepages — an ordinary note's markdown links are prose", () => {
        expect(
            messages({
                "Skills/Climbing.md": [
                    "---",
                    "type: skill",
                    "shortcode: clmb",
                    "---",
                    "",
                    "See [creatures](kb/creature/).",
                    "",
                ].join("\n"),
            }),
        ).toEqual([]);
    });
});
