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

import { buildSiteIndex, resolveInfoboxRef, wikiContext } from "../engine/site-index.mjs";

/** A content entry, with only what the index reads. */
function entry(over: Record<string, unknown> = {}) {
    const name = (over.name as string) ?? "Climbing";
    const slug = (over.slug as string) ?? "climbing";
    return {
        kind: "content",
        // No `package:` — the field is retired, and the index takes the
        // page's own `pkg` or the configured package instead.
        fm: { type: "skill", ...(over.fm as object) },
        name,
        slug,
        base: (over.base as string) ?? `${name.replace(/ /g, "_")}.md`,
        url: (over.url as string) ?? `/kb/skill/${slug}/`,
    };
}

describe("keys that are unique by construction", () => {
    it("indexes a page by type/shortcode, and by nothing else", () => {
        const { index } = buildSiteIndex([
            entry({
                fm: { type: "skill", shortcode: "clmb" },
            }),
        ]);

        expect(index.get("skill/clmb")?.url).toBe("/kb/skill/climbing/");
        // Not by its slug: a page's address is its `(type, shortcode)`.
        expect(index.has("skill/climbing")).toBe(false);
    });

    it("sets the canonical package-qualified address alongside the short one", () => {
        // The short form must keep resolving — a bare `[[skill-clmb]]` defaults
        // to the citing note's own package.
        const { index } = buildSiteIndex([
            entry({
                fm: { type: "skill", shortcode: "clmb" },
            }),
        ]);

        expect(index.get("sohl-sohl-skill-clmb")?.url).toBe("/kb/skill/climbing/");
        expect(index.get("skill/clmb")?.url).toBe("/kb/skill/climbing/");
    });

    it("aliases the doc qualifier onto the same page for types that have one", () => {
        // In Foundry an item and its documentation are two documents; here the
        // note renders as one page which *is* its documentation.
        const { index, contentTypes } = buildSiteIndex([
            entry({
                fm: { type: "skill", shortcode: "clmb" },
            }),
        ]);

        expect(index.get("docskill/clmb")?.url).toBe("/kb/skill/climbing/");
        expect(contentTypes.has("docskill")).toBe(true);
    });
});

describe("a page's name is not an index key", () => {
    // It was, as one of a set of collision-aware fallbacks the bare `[[Name]]`
    // form looked up — which is what forbade two pages of one type from
    // sharing a display name. The form is retired, so the fallbacks are
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
                "thalorna-none-polity-tanvur",
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

        expect(index.get("thalorna-none-polity-tanvur")?.url).toBe("/thalorna/polity/tanvur/");
        expect(contentTypes.has("polity")).toBe(true);
    });

    it("also merges the short form, so a bare link resolves", () => {
        const { index } = buildSiteIndex([entry()], {
            foreignIndex: foreignIndex(),
        });

        expect(index.get("polity/tanvur")?.url).toBe("/thalorna/polity/tanvur/");
    });

    it("drops the short form when two packages claim it", () => {
        // The short form is `<type>/<shortcode>` and takes no system segment,
        // so the scheme does not disambiguate this case: two packages publishing a
        // `polity/x` still collide on the bare key however each one's document
        // is keyed. Only the qualified addresses tell them apart.
        const both = new Map([
            ["a-none-polity-x", { url: "/a/", package: "a", type: "polity" }],
            ["b-none-polity-x", { url: "/b/", package: "b", type: "polity" }],
        ]);
        const { index } = buildSiteIndex([entry()], { foreignIndex: both });

        expect(index.has("polity/x")).toBe(false);
        // The qualified addresses still resolve.
        expect(index.get("a-none-polity-x")?.url).toBe("/a/");
        expect(index.get("b-none-polity-x")?.url).toBe("/b/");
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

    it("cannot be shadowed by a manifest claiming a local canonical address", () => {
        // Load-bearing ordering: foreign entries merge *before* local canonical
        // addresses are set, so a local page always ends up owning its own
        // `package-type-shortcode`. In practice `loadForeignManifests` already
        // excludes the local packages, so this is a second line rather than the
        // first — but it is the line that does not depend on that filtering
        // being right.
        const impostor = new Map([
            ["sohl-sohl-skill-clmb", { url: "/elsewhere/", package: "thalorna" }],
        ]);
        const { index } = buildSiteIndex(
            [
                entry({
                    fm: { type: "skill", shortcode: "clmb" },
                }),
            ],
            { foreignIndex: impostor },
        );

        expect(index.get("sohl-sohl-skill-clmb")?.url).toBe("/kb/skill/climbing/");
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
        expect(ctx.src).toBe("Skills/Climbing.md");
        expect(ctx.type).toBe("skill");
        expect(ctx.errors).toBe(errors);
        // Default: no cross-package links.
        expect(ctx.foreign.size).toBe(0);
        // No `manifestsComplete`: an unresolved address fails unconditionally
        // now, so there is no flag left for a caller to soften it with.
        expect("manifestsComplete" in ctx).toBe(false);
    });

    it("defaults `noIndexPackages` to empty, and carries a declared set through", () => {
        const bare = buildSiteIndex([entry()]);
        expect(wikiContext(bare, { src: "x", errors: [] }).noIndexPackages).toEqual(new Set());

        // thalornaaltart `requires` thalorna so Foundry installs the base
        // module, and its content tree links nowhere — there is no fetched
        // index for the site build to resolve a wikilink into it against.
        const built = buildSiteIndex([entry()], { noIndexPackages: new Set(["thalorna"]) });
        const ctx = wikiContext(built, { src: "x", errors: [] });
        expect(ctx.noIndexPackages).toBe(built.noIndexPackages);
        expect(ctx.noIndexPackages).toEqual(new Set(["thalorna"]));
    });
});

describe("the reference index", () => {
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

describe("resolveInfoboxRef", () => {
    /**
     * An index with a `skill` and a `place` sharing the shortcode `north`.
     *
     * `place` carries no `doc<type>` entry ({@link hasDocEntry}) and `skill`
     * does, so a naive alphabetical sweep that did not know the difference
     * would land on `docskill/north` before `place/north` — the fixture uses
     * `place` and `scenario` for the sweep case below precisely to avoid that
     * confound, since neither carries a documentation journal of its own.
     */
    const shared = () =>
        buildSiteIndex([
            entry({
                fm: { type: "skill", shortcode: "north" },
                name: "Northern Style",
                url: "/kb/skill/north/",
            }),
            entry({
                fm: { type: "place", shortcode: "north" },
                name: "The North",
                url: "/kb/place/north/",
            }),
        ]);

    it("takes a bare shortcode against the hinted type", () => {
        const built = shared();
        expect(resolveInfoboxRef(built, "north", { type: "place" })).toMatchObject({
            name: "The North",
            address: "place-north",
        });
    });

    it("sweeps every known type in sorted order when there is no hint", () => {
        // Neither `place` nor `scenario` carries a `doc<type>` entry, so the
        // sweep order is exactly the two types themselves — `place` sorts
        // before `scenario`, a stable wrong answer rather than an unstable one.
        const built = buildSiteIndex([
            entry({ fm: { type: "place", shortcode: "north" }, name: "The North" }),
            entry({ fm: { type: "scenario", shortcode: "north" }, name: "The Northern Raid" }),
        ]);
        expect(resolveInfoboxRef(built, "north")).toMatchObject({ name: "The North" });
    });

    it("reads a short address, which names its own type before any sweep", () => {
        const built = shared();
        expect(resolveInfoboxRef(built, "skill-north")).toMatchObject({
            name: "Northern Style",
            address: "skill-north",
        });
    });

    it("reads the canonical address, package and system both stated", () => {
        const built = shared();
        // The suite's ambient content package is `sohl`, and a `skill`'s system
        // is `sohl` too — see `alpha.address` in the map tests.
        expect(resolveInfoboxRef(built, "sohl-sohl-skill-north")).toMatchObject({
            name: "Northern Style",
        });
    });

    it("is case-insensitive on every form", () => {
        const built = shared();
        expect(resolveInfoboxRef(built, "Skill-North")).toMatchObject({ name: "Northern Style" });
    });

    it("finds nothing for a shortcode no page declares", () => {
        const built = shared();
        expect(resolveInfoboxRef(built, "nowhere")).toBeUndefined();
    });

    it("finds nothing for a type-qualified reference no page declares", () => {
        const built = shared();
        expect(resolveInfoboxRef(built, "skill-nowhere")).toBeUndefined();
    });

    it("does not read a hyphenated name as a type it does not declare", () => {
        // `jean` names no type, so this is prose rather than a badly written
        // address — and the sweep tries the whole hyphenated string, not just
        // its tail, so it does not accidentally answer for a place named `paul`.
        const built = shared();
        expect(resolveInfoboxRef(built, "jean-paul")).toBeUndefined();
    });

    it("refuses a qualified address naming a package this build does not know", () => {
        // The literal string is not a key the index holds — no page is filed
        // under a bogus package — and a `type/shortcode` degraded to ignoring
        // the stated package would let a mistyped package still resolve, which
        // is exactly the silent wrong answer the grammar refuses everywhere else.
        const built = shared();
        expect(resolveInfoboxRef(built, "bogus-none-skill-north")).toBeUndefined();
    });

    it("returns undefined for a blank or non-string reference", () => {
        const built = shared();
        expect(resolveInfoboxRef(built, "")).toBeUndefined();
        expect(resolveInfoboxRef(built, null)).toBeUndefined();
        expect(resolveInfoboxRef(built, undefined)).toBeUndefined();
    });
});
