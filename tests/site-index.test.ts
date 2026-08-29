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

describe("fallback keys are collision-aware", () => {
    it("resolves a bare name when only one page claims it", () => {
        const { index } = buildSiteIndex([entry()]);

        expect(index.get("climbing")?.url).toBe("/kb/skill/climbing/");
    });

    it("drops a key two different pages claim, rather than picking one", () => {
        // Resolving to whichever note was walked first is a silently wrong
        // link. A dropped key fails the build instead.
        const { index, ambiguous } = buildSiteIndex([
            entry({
                name: "Shock",
                slug: "shock",
                sec: "rules",
                url: "/kb/rules/shock/",
            }),
            entry({
                name: "Shock",
                slug: "shock",
                sec: "trauma",
                url: "/kb/trauma/shock/",
                fm: { type: "trauma" },
            }),
        ]);

        expect(index.has("shock")).toBe(false);
        expect(ambiguous.has("shock")).toBe(true);
        // The unique keys still resolve — only the bare form is ambiguous.
        expect(index.get("rules/shock")?.url).toBe("/kb/rules/shock/");
        expect(index.get("trauma/shock")?.url).toBe("/kb/trauma/shock/");
    });

    it("keeps a key two entries claim when both mean the same page", () => {
        const same = { name: "Climbing", url: "/kb/skill/climbing/" };
        const { index, ambiguous } = buildSiteIndex([
            entry(same),
            entry({ ...same, slug: "climbing", base: "Climbing_Alt.md" }),
        ]);

        expect(index.get("climbing")?.url).toBe("/kb/skill/climbing/");
        expect(ambiguous.has("climbing")).toBe(false);
    });

    it("does not index a section landing by its filename", () => {
        // Every section's landing is README.md; indexing that would make one
        // key collide across every section at once.
        const { index } = buildSiteIndex([
            entry({
                name: "Skills",
                slug: "skills",
                base: "README.md",
                isReadme: true,
            }),
        ]);

        expect(index.has("readme")).toBe(false);
        expect(index.get("skill/skills")?.url).toBe("/kb/skill/skills/");
    });
});

describe("aliases are scoped to their type", () => {
    it("keeps two same-named notes of different types apart", () => {
        const { typeAlias, typeCollide } = buildSiteIndex([
            entry({ name: "Shock", slug: "shock", sec: "rules", url: "/r/" }),
            entry({
                name: "Shock",
                slug: "shock",
                sec: "trauma",
                url: "/t/",
                fm: { type: "trauma" },
            }),
        ]);

        expect(typeAlias.get("skill|shock")?.url).toBe("/r/");
        expect(typeAlias.get("trauma|shock")?.url).toBe("/t/");
        expect(typeCollide.size).toBe(0);
    });

    it("poisons an alias two notes of the SAME type share", () => {
        const { typeAlias, typeCollide } = buildSiteIndex([
            entry({ name: "Shock", slug: "shock-a", url: "/a/" }),
            entry({ name: "Shock", slug: "shock-b", url: "/b/" }),
        ]);

        expect(typeAlias.has("skill|shock")).toBe(false);
        expect(typeCollide.has("skill|shock")).toBe(true);
    });

    it("indexes authored aliases from both spellings, and the filename", () => {
        const { typeAlias } = buildSiteIndex([
            entry({
                name: "Climbing",
                base: "Rock_Climbing.md",
                fm: {
                    type: "skill",
                    aliases: ["Scrambling"],
                    name: { aliases: ["Clambering"] },
                },
            }),
        ]);

        expect(typeAlias.get("skill|scrambling")?.url).toBe(
            "/kb/skill/climbing/",
        );
        expect(typeAlias.get("skill|clambering")?.url).toBe(
            "/kb/skill/climbing/",
        );
        // Underscores in a filename stand for spaces.
        expect(typeAlias.get("skill|rock climbing")?.url).toBe(
            "/kb/skill/climbing/",
        );
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

        expect(index.get("thalorna-polity-tanvur")?.url).toBe(
            "/thalorna/polity/tanvur/",
        );
        expect(contentTypes.has("polity")).toBe(true);
    });

    it("also merges the short form, so a bare link resolves", () => {
        const { index } = buildSiteIndex([entry()], {
            foreignIndex: foreignIndex(),
        });

        expect(index.get("polity/tanvur")?.url).toBe(
            "/thalorna/polity/tanvur/",
        );
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
        const clash = new Map([
            ["skill/climbing", { url: "/elsewhere/", package: "thalorna" }],
        ]);
        const { conflicts, index } = buildSiteIndex([entry()], {
            foreignIndex: clash,
        });

        expect(conflicts).toEqual([
            { key: "skill/climbing", package: "thalorna" },
        ]);
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
        const { index, typeAlias, contentTypes } = buildSiteIndex([
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

        expect(index.get("dev-docs/architecture")?.url).toBe(
            "/kb/dev-docs/architecture/",
        );
        expect(index.get("architecture")?.url).toBe(
            "/kb/dev-docs/architecture/",
        );
        expect(typeAlias.size).toBe(0);
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
        expect(ctx.typeAlias).toBe(built.typeAlias);
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
