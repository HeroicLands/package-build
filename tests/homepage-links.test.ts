/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The links a package homepage carries, and the ones that land nowhere (#54).
 *
 * The page a reader arrives at is the one nothing was checking. SoHL's
 * hand-built landing pointed at `kb/creature/` and `kb/character/` from the day
 * those two types merged into `being` — two 404s on the front page, surviving
 * every build, because a landing's links went through no checker at all.
 *
 * **Frontmatter is in scope, and that is the whole point.** Four of the six
 * homepages authored today carry every link in the body as ordinary markdown;
 * the other two carry them in `landing:` — and SoHL's, the page whose dead links
 * motivated this, has an *empty body*. A body-only check would find nothing on
 * the one page it was written for.
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
    it("reads the address off every card link", () => {
        const found = homepageAddresses(
            {
                landing: {
                    cards: {
                        items: [
                            {
                                title: "At the table",
                                links: [
                                    { title: "Rules", url: "kb/rules/" },
                                    { title: "API", url: "api/" },
                                ],
                            },
                        ],
                    },
                },
            },
            "",
        );
        expect(found.map((a) => [a.field, a.url, a.kind])).toEqual([
            ["landing.cards.items[0].links[0].url", "kb/rules/", "url"],
            ["landing.cards.items[0].links[1].url", "api/", "url"],
        ]);
    });

    it("distinguishes href from url", () => {
        const found = homepageAddresses(
            { landing: { cards: { items: [{ href: "/thalorna/lore/" }] } } },
            "",
        );
        expect(found).toEqual([
            {
                field: "landing.cards.items[0].href",
                url: "/thalorna/lore/",
                kind: "href",
            },
        ]);
    });

    it("reads markdown links out of a prose field", () => {
        const found = homepageAddresses(
            {
                landing: {
                    closing:
                        "Browsable from the [knowledgebase](kb/), built from " +
                        "[one repository](https://github.com/x/y).",
                },
            },
            "",
        );
        expect(found.map((a) => [a.field, a.url])).toEqual([
            ["landing.closing", "kb/"],
            ["landing.closing", "https://github.com/x/y"],
        ]);
    });

    it("reads markdown links out of the body, leaving code alone", () => {
        const found = homepageAddresses(
            {},
            "See [the rules](kb/rules/).\n\n```text\n[not a link](kb/nope/)\n```\n",
        );
        expect(found.map((a) => [a.field, a.url, a.kind])).toEqual([
            ["body", "kb/rules/", "body"],
        ]);
    });

    it("finds nothing on a note that carries no landing and no body links", () => {
        expect(
            homepageAddresses({ title: "Kethira" }, "Plain prose.\n"),
        ).toEqual([]);
    });
});

describe("auditLinks — the homepage", () => {
    it("passes a homepage whose addresses are package-relative or external", () => {
        expect(
            messages({
                "homepage.md": homepage(
                    [
                        "landing:",
                        "  install:",
                        "    url: https://github.com/HeroicLands/x/releases/latest/download/system.json",
                        "  cards:",
                        "    items:",
                        "      - title: At the table",
                        "        links:",
                        "          - { title: Rules, url: kb/rules/ }",
                        "          - { title: API, url: api/ }",
                        "  closing: Browsable from the [knowledgebase](kb/).",
                        "",
                    ].join("\n"),
                    "Ask on [Discord](https://discord.gg/EwMfkNd3az).\n",
                ),
            }),
        ).toEqual([]);
    });

    it("reports an address naming a retired content type", () => {
        const found = messages({
            "homepage.md": homepage(
                [
                    "landing:",
                    "  cards:",
                    "    items:",
                    "      - title: What it ships with",
                    "        links:",
                    "          - { title: Creatures, url: kb/creature/ }",
                    "          - { title: Characters, url: kb/character/ }",
                    "",
                ].join("\n"),
            ),
        });
        expect(found).toHaveLength(2);
        expect(found[0]).toContain(
            'content type "creature", retired in favour of "being"',
        );
        expect(found[0]).toContain('mechanical: "kb/being/"');
        expect(found[1]).toContain(
            'content type "character", retired in favour of "being"',
        );
    });

    it("reports a retired type in a body link too", () => {
        expect(
            messages({
                "homepage.md": homepage(
                    "",
                    "Every [creature](kb/creature/).\n",
                ),
            })[0],
        ).toContain('content type "creature", retired in favour of "being"');
    });

    it("reports an absolute URL into this package's own address", () => {
        const found = messages({
            "homepage.md": homepage(
                [
                    "landing:",
                    "  closing: See the [rules](https://www.heroiclands.org/sohl/kb/rules/).",
                    "",
                ].join("\n"),
            ),
        });
        expect(found).toHaveLength(1);
        expect(found[0]).toContain("kb/rules/");
        expect(found[0]).toContain("package-relative");
    });

    it("leaves a bare package root alone — there is no better form to write", () => {
        expect(
            messages({
                "homepage.md": homepage(
                    "",
                    "A module for [SoHL](https://www.heroiclands.org/sohl/).\n",
                ),
            }),
        ).toEqual([]);
    });

    it("reports a root-relative url:, which the theme would prefix twice", () => {
        const found = messages({
            "homepage.md": homepage(
                [
                    "landing:",
                    "  cards:",
                    "    items:",
                    "      - { title: Rules, url: /sohl/kb/rules/ }",
                    "",
                ].join("\n"),
            ),
        });
        expect(found).toHaveLength(1);
        expect(found[0]).toContain("resolved against the site");
    });

    it("leaves a root-relative href alone — href is used verbatim", () => {
        expect(
            messages({
                "homepage.md": homepage(
                    [
                        "landing:",
                        "  cards:",
                        "    items:",
                        "      - { title: Rules, href: /sohl/kb/rules/ }",
                        "",
                    ].join("\n"),
                ),
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
            "homepage.md": homepage(
                [
                    "landing:",
                    "  cards:",
                    "    items:",
                    "      - { title: Creatures, url: kb/creature/ }",
                    "",
                ].join("\n"),
            ),
        });
        const f = homepageLinks[0];
        expect(positionOfLiteral(f.note.raw, f.text, f.occurrence)).toEqual({
            line: 6,
            column: 34,
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
