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
 * The address index a site build resolves wikilinks against.
 *
 * The rules worth pinning are the ones about *ambiguity*: which keys are unique
 * by construction and therefore always resolve, which are fallbacks that a
 * second claimant destroys rather than shares, and how a foreign package's
 * addresses merge without either shadowing a local page or being shadowed by
 * one.
 */

import { describe, it, expect } from "vitest";

import { buildSiteIndex, wikiContext } from "../engine/site-index.mjs";

/** A content entry, with only what the index reads. */
function entry(over: Record<string, unknown> = {}) {
    const name = (over.name as string) ?? "Climbing";
    const slug = (over.slug as string) ?? "climbing";
    const sec = (over.sec as string) ?? "skill";
    return {
        kind: "content",
        // No `package:` — the field is retired, and the index takes the
        // page's own `pkg` or the configured package instead (#56).
        fm: { type: "skill", ...(over.fm as object) },
        name,
        slug,
        sec,
        base: (over.base as string) ?? `${name.replace(/ /g, "_")}.md`,
        url: (over.url as string) ?? `/kb/${sec}/${slug}/`,
        isReadme: (over.isReadme as boolean) ?? false,
    };
}

describe("keys that are unique by construction", () => {
    it("indexes a page by section/slug and by type/shortcode", () => {
        const { index } = buildSiteIndex([
            entry({
                fm: { type: "skill", shortcode: "clmb" },
            }),
        ]);

        expect(index.get("skill/climbing")?.url).toBe("/kb/skill/climbing/");
        expect(index.get("skill/clmb")?.url).toBe("/kb/skill/climbing/");
    });

    it("sets the canonical package-qualified address alongside the short one", () => {
        // The short form must keep resolving — a bare `[[skill-clmb]]` defaults
        // to the citing note's own package (#1499).
        const { index } = buildSiteIndex([
            entry({
                fm: { type: "skill", shortcode: "clmb" },
            }),
        ]);

        expect(index.get("sohl-skill-clmb")?.url).toBe("/kb/skill/climbing/");
        expect(index.get("skill/clmb")?.url).toBe("/kb/skill/climbing/");
    });

    it("aliases the doc qualifier onto the same page for types that have one", () => {
        // In Foundry an item and its documentation are two documents; here the
        // note renders as one page which *is* its documentation (#1362).
        const { index, contentTypes } = buildSiteIndex([
            entry({
                fm: { type: "skill", shortcode: "clmb" },
            }),
        ]);

        expect(index.get("docskill/clmb")?.url).toBe("/kb/skill/climbing/");
        expect(contentTypes.has("docskill")).toBe(true);
    });
});

describe("a page's name is not an index key (#180)", () => {
    // It was, as one of a set of collision-aware fallbacks the bare `[[Name]]`
    // form looked up — which is what forbade two pages of one type from
    // sharing a display name (#179). The form is retired, so the fallbacks are
    // gone and the constraint with them.
    it("does not index a page by its name", () => {
        const { index } = buildSiteIndex([entry({ fm: { type: "skill", shortcode: "clmb" } })]);

        expect(index.has("climbing")).toBe(false);
        expect(index.get("skill/clmb")?.url).toBe("/kb/skill/climbing/");
    });

    it("does not index a page by its filename or bare slug", () => {
        const { index } = buildSiteIndex([
            entry({ name: "Climbing", base: "Rock_Climbing.md", slug: "climbing" }),
        ]);

        expect(index.has("rock_climbing")).toBe(false);
        expect(index.has("climbing")).toBe(false);
    });

    it("lets two pages of one type share a display name", () => {
        const { index, ambiguous } = buildSiteIndex([
            entry({
                name: "Shock",
                slug: "shock-a",
                url: "/a/",
                fm: { type: "doc", shortcode: "a" },
            }),
            entry({
                name: "Shock",
                slug: "shock-b",
                url: "/b/",
                fm: { type: "doc", shortcode: "b" },
            }),
        ]);

        expect(ambiguous.size).toBe(0);
        expect(index.get("doc/a")?.url).toBe("/a/");
        expect(index.get("doc/b")?.url).toBe("/b/");
    });
});

describe("foreign packages", () => {
    const foreignIndex = () =>
        new Map([
            [
                "thalorna-polity-tanvur",
                {
                    url: "/thalorna/polity/tanvur/",
                    package: "thalorna",
                    type: "polity",
                },
            ],
        ]);

    it("merges a foreign address and seeds its type", () => {
        // Without the type, the resolver reads `polity-tanvur` as prose and the
        // link silently loses its href.
        const { index, contentTypes } = buildSiteIndex([entry()], {
            foreignIndex: foreignIndex(),
        });

        expect(index.get("thalorna-polity-tanvur")?.url).toBe("/thalorna/polity/tanvur/");
        expect(contentTypes.has("polity")).toBe(true);
    });

    it("also merges the short form, so a bare link resolves", () => {
        const { index } = buildSiteIndex([entry()], {
            foreignIndex: foreignIndex(),
        });

        expect(index.get("polity/tanvur")?.url).toBe("/thalorna/polity/tanvur/");
    });

    it("drops the short form when two packages claim it", () => {
        const both = new Map([
            ["a-polity-x", { url: "/a/", package: "a", type: "polity" }],
            ["b-polity-x", { url: "/b/", package: "b", type: "polity" }],
        ]);
        const { index } = buildSiteIndex([entry()], { foreignIndex: both });

        expect(index.has("polity/x")).toBe(false);
        // The qualified addresses still resolve.
        expect(index.get("a-polity-x")?.url).toBe("/a/");
        expect(index.get("b-polity-x")?.url).toBe("/b/");
    });

    it("lets the local tree win a short key it already claims", () => {
        // A live build is authoritative; a vendored manifest can only be staler.
        const { index } = buildSiteIndex(
            [
                entry({
                    fm: { type: "polity", shortcode: "tanvur" },
                }),
            ],
            { foreignIndex: foreignIndex() },
        );

        expect(index.get("polity/tanvur")?.url).toBe("/kb/skill/climbing/");
    });

    it("reports a foreign address that collides with a local key", () => {
        // The keys present when the merge runs are the addressing ones —
        // section/slug and the bare fallbacks. A manifest claiming one of those
        // is two packages claiming one address, which the caller fails on.
        const clash = new Map([["skill/climbing", { url: "/elsewhere/", package: "thalorna" }]]);
        const { conflicts, index } = buildSiteIndex([entry()], {
            foreignIndex: clash,
        });

        expect(conflicts).toEqual([{ key: "skill/climbing", package: "thalorna" }]);
        // The local page keeps the address; the caller decides to fail.
        expect(index.get("skill/climbing")?.url).toBe("/kb/skill/climbing/");
    });

    it("cannot be shadowed by a manifest claiming a local canonical address", () => {
        // Load-bearing ordering: foreign entries merge *before* local canonical
        // addresses are set, so a local page always ends up owning its own
        // `package-type-shortcode`. In practice `loadForeignManifests` already
        // excludes the local packages, so this is a second line rather than the
        // first — but it is the line that does not depend on that filtering
        // being right.
        const impostor = new Map([
            ["sohl-skill-clmb", { url: "/elsewhere/", package: "thalorna" }],
        ]);
        const { index } = buildSiteIndex(
            [
                entry({
                    fm: { type: "skill", shortcode: "clmb" },
                }),
            ],
            { foreignIndex: impostor },
        );

        expect(index.get("sohl-skill-clmb")?.url).toBe("/kb/skill/climbing/");
    });
});

describe("pages that carry no type", () => {
    it("indexes a developer doc by address but not by type", () => {
        const { index, contentTypes } = buildSiteIndex([
            {
                kind: "doc",
                fm: {},
                name: "Architecture",
                slug: "architecture",
                sec: "dev-docs",
                base: "architecture.md",
                url: "/kb/dev-docs/architecture/",
                isReadme: false,
            },
        ]);

        expect(index.get("dev-docs/architecture")?.url).toBe("/kb/dev-docs/architecture/");
        // Its bare name is not a key either — `section/slug` is the address.
        expect(index.has("architecture")).toBe(false);
        expect(contentTypes.size).toBe(0);
    });
});

describe("the resolver context", () => {
    it("carries the index through without the caller restating it", () => {
        const built = buildSiteIndex([entry()]);
        const errors: object[] = [];
        const ctx = wikiContext(built, {
            src: "Skills/Climbing.md",
            type: "skill",
            errors,
        });

        expect(ctx.index).toBe(built.index);
        expect(ctx.collide).toBe(built.ambiguous);
        expect(ctx.sections).toBe(built.sections);
        expect(ctx.src).toBe("Skills/Climbing.md");
        expect(ctx.type).toBe("skill");
        expect(ctx.errors).toBe(errors);
        // Defaults: no cross-package links, nothing missing.
        expect(ctx.manifestsComplete).toBe(true);
        expect(ctx.foreign.size).toBe(0);
    });
});

describe("sections and the reference index", () => {
    it("collects every section, lowercased", () => {
        const { sections } = buildSiteIndex([
            entry({ sec: "Skill" }),
            entry({ sec: "Rules", slug: "shock", name: "Shock" }),
        ]);

        expect([...sections].sort()).toEqual(["rules", "skill"]);
    });

    it("keys the reference index by the authored type, not the lowercased one", () => {
        // Callers resolving an embedded item look it up by the type as written.
        const { refIndex } = buildSiteIndex([
            entry({
                fm: { type: "weaponGear", shortcode: "swd" },
            }),
        ]);

        expect(refIndex.get("weaponGear:swd")).toEqual({
            name: "Climbing",
            url: "/kb/skill/climbing/",
        });
    });
});
