/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * One authored pathname, four surfaces.
 *
 * The acceptance this file pins is that a single authored statement resolves on
 * **every** surface, not on whichever two a caller happens to exercise. So each
 * case asserts all four forms at once: a resolver that got three of them right
 * and left the fourth as authored is exactly the failure the rule exists to
 * remove, and it is invisible to a test that reads one form.
 */

import { describe, it, expect } from "vitest";

import {
    ASSETS_SEGMENT,
    PATHNAME_SURFACES,
    packageAddresses,
    pathnameProblem,
    resolvePathname,
} from "../engine/pathnames.mjs";
import { defineConfig } from "../index.mjs";
import { pageFrontmatter } from "../engine/site-build.mjs";
import { renderImageFigures } from "../engine/content-images.mjs";

/** The `thalorna` module, which cites the `sohl` system's files as its own. */
const thalorna = defineConfig({
    rootDir: "/repo",
    contentPackage: "thalorna",
    foundryPackage: "sohl-thalorna",
    packageKind: "modules",
    stats: { lastModifiedBy: "thalornabuild000" },
    packs: [{ name: "items", type: "Item" }],
    relationships: { systems: [{ id: "sohl", type: "system" }] },
    site: { assets: "https://cdn.example.org" },
} as never) as never;

/** The same, with no asset host declared. */
const hostless = defineConfig({
    rootDir: "/repo",
    contentPackage: "thalorna",
    foundryPackage: "sohl-thalorna",
    packageKind: "modules",
    stats: { lastModifiedBy: "thalornabuild000" },
    packs: [{ name: "items", type: "Item" }],
} as never) as never;

describe("one authored pathname, four derived forms", () => {
    it("derives all four from a pathname this package owns", () => {
        expect(resolvePathname("images/map.webp", thalorna)).toMatchObject({
            state: "package",
            package: "thalorna",
            suffix: "images/map.webp",
            own: true,
            foundry: "modules/sohl-thalorna/assets/images/map.webp",
            local: "assets/images/map.webp",
            web: "https://cdn.example.org/thalorna/images/map.webp",
            pdf: "assets/images/map.webp",
        });
    });

    it("derives all four from a pathname another package owns", () => {
        // The web form carries the *content package*, the Foundry form the
        // Foundry id, and the two differ for this package's own files as well
        // as for the system's.
        expect(resolvePathname("sohl/assets/icons/noun/shield.svg", thalorna)).toMatchObject({
            state: "package",
            package: "sohl",
            suffix: "icons/noun/shield.svg",
            own: false,
            foundry: "systems/sohl/assets/icons/noun/shield.svg",
            local: "assets/icons/noun/shield.svg",
            web: "https://cdn.example.org/sohl/icons/noun/shield.svg",
            pdf: "assets/icons/noun/shield.svg",
        });
    });

    it("names the package by its content name, never its Foundry id", () => {
        // Written the other way round, `sohl-thalorna` is a package this build
        // has never heard of — there is no install path to derive, and the web
        // address it would serve is not the one the site publishes.
        const forms = resolvePathname("sohl-thalorna/assets/images/map.webp", thalorna) as never;
        expect(forms).toMatchObject({ package: "sohl-thalorna", foundry: null });
        expect(resolvePathname("thalorna/assets/images/map.webp", thalorna)).toMatchObject({
            foundry: "modules/sohl-thalorna/assets/images/map.webp",
            web: "https://cdn.example.org/thalorna/images/map.webp",
        });
    });

    it("carries every surface, and no more than the surfaces there are", () => {
        const forms = resolvePathname("images/map.webp", thalorna) as Record<string, unknown>;
        for (const surface of PATHNAME_SURFACES) {
            expect(typeof forms[surface]).toBe("string");
        }
    });

    it("passes an address no package owns through on every surface", () => {
        for (const address of [
            "https://example.org/a.png",
            "//cdn.example.org/a.png",
            "/icons/svg/mystery-man.svg",
            "data:image/svg+xml;base64,AAAA",
        ]) {
            const forms = resolvePathname(address, thalorna) as Record<string, unknown>;
            expect(forms.state).toBe("external");
            for (const surface of PATHNAME_SURFACES) expect(forms[surface]).toBe(address);
        }
    });

    it('keeps `null` unset and `""` blank on purpose', () => {
        expect(resolvePathname(null, thalorna)).toBeNull();
        expect(resolvePathname(undefined, thalorna)).toBeNull();
        const blank = resolvePathname("", thalorna) as Record<string, unknown>;
        expect(blank.state).toBe("blank");
        for (const surface of PATHNAME_SURFACES) expect(blank[surface]).toBe("");
    });

    it("has no web form with no asset host configured", () => {
        expect(resolvePathname("images/map.webp", hostless)).toMatchObject({
            foundry: "modules/sohl-thalorna/assets/images/map.webp",
            web: null,
        });
    });

    it("trims the host's trailing slash rather than doubling the join", () => {
        const trailing = defineConfig({
            rootDir: "/repo",
            contentPackage: "thalorna",
            foundryPackage: "sohl-thalorna",
            packageKind: "modules",
            stats: { lastModifiedBy: "thalornabuild000" },
            packs: [{ name: "items", type: "Item" }],
            site: { assets: "https://cdn.example.org/" },
        } as never) as never;
        expect(resolvePathname("images/map.webp", trailing)).toMatchObject({
            web: "https://cdn.example.org/thalorna/images/map.webp",
        });
    });

    it("spells the shipped directory once", () => {
        expect(ASSETS_SEGMENT).toBe("assets");
    });
});

describe("a pathname written in Foundry's own spelling", () => {
    it("is refused, naming the replacement", () => {
        expect(pathnameProblem("systems/sohl/assets/ui/logo.webp")).toMatch(
            /write `sohl\/assets\/ui\/logo\.webp`/,
        );
        expect(pathnameProblem("modules/sohl-thalorna/assets/images/map.webp")).toMatch(
            /write `sohl-thalorna\/assets\/images\/map\.webp`/,
        );
    });

    it("gains the `assets/` segment where the package serves from its own root", () => {
        // `hm3` keeps its pictures at `images/`, and `assets/` is where a
        // package's files sit in every form this rule derives.
        expect(pathnameProblem("systems/hm3/images/svg/sword.svg")).toMatch(
            /write `hm3\/assets\/images\/svg\/sword\.svg`/,
        );
    });

    it("says nothing about a pathname the rule accepts", () => {
        expect(pathnameProblem("images/map.webp")).toBe("");
        expect(pathnameProblem("sohl/assets/icons/relic.svg")).toBe("");
        expect(pathnameProblem("worlds/mine/art.webp")).toBe("");
        expect(pathnameProblem("/systems/dnd5e/icons/spell.webp")).toBe("");
        expect(pathnameProblem("https://example.org/a.png")).toBe("");
        expect(pathnameProblem(null)).toBe("");
    });

    it("stops every surface rather than deriving an address from it", () => {
        expect(() => resolvePathname("systems/sohl/assets/ui/logo.webp", thalorna)).toThrow(
            /is a Foundry address/,
        );
    });
});

describe("the packages a build can resolve against", () => {
    it("is its own, its systems, and the packages it declares", () => {
        expect([...packageAddresses(thalorna).keys()].sort()).toEqual(["sohl", "thalorna"]);
        expect(packageAddresses(thalorna).get("thalorna")).toEqual({
            root: "modules",
            id: "sohl-thalorna",
            own: true,
        });
    });

    it("reads a system off a pack that gates on one, declared nowhere else", () => {
        // `harn-ensemble` ships an HM3 pack and a SoHL pack and declares
        // neither relationship, because naming one would stop Foundry loading
        // the module in the other's world.
        const twoSystems = defineConfig({
            rootDir: "/repo",
            contentPackage: "harnensemble",
            foundryPackage: "harn-ensemble",
            packageKind: "modules",
            stats: { lastModifiedBy: "harnensbuild0000" },
            systems: {
                hm3: { compatibility: { verified: "12.0.0" } },
                sohl: { compatibility: { verified: "0.8.5" } },
            },
            packs: [
                { name: "actors-hm3", type: "Actor", system: "hm3" },
                { name: "actors-sohl", type: "Actor", system: "sohl" },
            ],
        } as never) as never;
        expect([...packageAddresses(twoSystems).keys()].sort()).toEqual([
            "harnensemble",
            "hm3",
            "sohl",
        ]);
        expect(resolvePathname("hm3/assets/images/svg/sword.svg", twoSystems)).toMatchObject({
            foundry: "systems/hm3/assets/images/svg/sword.svg",
            own: false,
        });
    });

    it("takes a package's content name from the relationship that declares it", () => {
        const dependent = defineConfig({
            rootDir: "/repo",
            contentPackage: "kethira",
            foundryPackage: "sohl-kethira-basic",
            packageKind: "modules",
            stats: { lastModifiedBy: "kethirabuild0000" },
            packs: [{ name: "items", type: "Item" }],
            relationships: {
                requires: [{ id: "sohl-thalorna", contentPackage: "thalorna", type: "module" }],
            },
            site: { assets: "https://cdn.example.org" },
        } as never) as never;
        expect(resolvePathname("thalorna/assets/images/map.webp", dependent)).toMatchObject({
            foundry: "modules/sohl-thalorna/assets/images/map.webp",
            web: "https://cdn.example.org/thalorna/images/map.webp",
        });
    });
});

describe("the website gets the same statement as the other three", () => {
    /** The resolver a page's body and its art fields both go through. */
    const webSrc = (src: string) =>
        (resolvePathname(src, thalorna) as { web: string } | null)?.web ?? src;

    it("publishes a body image at the address the asset host serves", () => {
        expect(renderImageFigures("![A map](images/map.webp)\n", webSrc)).toContain(
            'src="https://cdn.example.org/thalorna/images/map.webp"',
        );
    });

    /** The art resolver: an address to the pathname `webSrc` takes. */
    const artSrc = (value: unknown, type: string) =>
        value === "banner" && type === "image" ? "thalorna/assets/images/sections/lore.webp"
        : value === "thorn" && type === "icon" ? "thalorna/assets/icons/thorn.svg"
        : null;

    it("publishes an art slot at the address the asset host serves", () => {
        const data = pageFrontmatter(
            {
                kind: "content",
                name: "Athlwv Thrnd",
                slug: "being-athlwvthrnd",
                fm: { data: { icon: "thorn", banner: "banner" } },
            } as never,
            { webSrc, artSrc } as never,
        ) as Record<string, never>;

        const art = data.data as Record<string, string>;
        expect(art.icon).toBe("https://cdn.example.org/thalorna/icons/thorn.svg");
        expect(art.banner).toBe("https://cdn.example.org/thalorna/images/sections/lore.webp");
    });

    it("drops an address nothing answers rather than publishing it as written", () => {
        // The theme renders nothing where a value is absent; a raw address left
        // in place would reach the reader as a broken image source.
        const data = pageFrontmatter(
            {
                kind: "content",
                name: "Nobody",
                slug: "being-nobody",
                fm: { data: { icon: "nosuchthing" } },
            } as never,
            { webSrc, artSrc } as never,
        ) as Record<string, never>;

        expect((data.data as Record<string, unknown>).icon).toBeUndefined();
    });

    it("leaves the two empties alone", () => {
        const data = pageFrontmatter(
            {
                kind: "content",
                name: "Nobody",
                slug: "being-nobody",
                fm: { data: { icon: "", banner: null } },
            } as never,
            { webSrc, artSrc } as never,
        ) as Record<string, never>;

        const art = data.data as Record<string, unknown>;
        expect(art.icon).toBe("");
        expect(art.banner).toBeNull();
    });
});
