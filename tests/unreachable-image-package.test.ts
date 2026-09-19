/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A body image whose package no Foundry install carries.
 *
 * Every other surface resolves such a pathname: the website needs only the
 * package's name and the suffix, and the book needs to know whether the file is
 * one it ships. Foundry needs a directory inside the install, which only a
 * declared relationship supplies — and `packagebuild` can never have one,
 * because package-build is an npm dependency rather than a package Foundry
 * installs. So this is the one surface a correctly written pathname can be dead
 * on, and the renderer that hands a journal its markup has no channel to say
 * so.
 *
 * Three claims are pinned here.
 *
 * **It is refused, not emitted.** A `src` that resolves against nothing looks
 * exactly like an address that worked, which is the failure the pathname rule
 * exists to remove.
 *
 * **One construct, one behaviour.** `![alt](…)` and `![[…]]` are one image
 * path, so the same address refuses identically whichever way it is written.
 *
 * **The passthrough cases still pass through.** A URL, a protocol-relative
 * `//host/…`, a `data:` URI and a `/`-rooted path name no package at all and
 * are what a note writes to reach core Foundry art or a package this build
 * knows nothing of.
 */

import { describe, it, expect } from "vitest";

import { checkImages } from "../engine/content-images.mjs";
import { resolveEmbeds } from "../engine/content-embeds.mjs";
import { convertNoteWikilinks, resolveImg } from "../engine/helpers.mjs";
import { foundryAddressProblem, servesFoundry } from "../engine/pathnames.mjs";
import { ASSET_TYPE_NAMES } from "../engine/asset-types.mjs";
import { defineConfig } from "../index.mjs";

/** A module that declares the `sohl` system and nothing else. */
const thalorna = defineConfig({
    rootDir: "/repo",
    contentPackage: "thalorna",
    foundryPackage: "sohl-thalorna",
    packageKind: "modules",
    stats: { lastModifiedBy: "thalornabuild000" },
    packs: [{ name: "items", type: "Item" }],
    relationships: { systems: [{ id: "sohl", type: "system" }] },
    site: { out: "site/content", assets: "https://cdn.example.org" },
} as never) as never;

/** A package that publishes a site and a book and installs nowhere. */
const docsOnly = defineConfig({
    rootDir: "/repo",
    contentPackage: "handbook",
    packageKind: "documentation",
    publish: { site: "content" },
    site: { out: "site/content", assets: "https://cdn.example.org" },
} as never) as never;

/** The banner package-build ships, as a note addresses it. */
const BANNER = "packagebuild/assets/images/banners/afflictionbnr.webp";

/** An index shaped as every asset resolver reads one. */
const index = {
    contentPackage: "thalorna",
    packages: new Set(["thalorna", "sohl", "packagebuild"]),
    types: new Set([...ASSET_TYPE_NAMES, "being"]),
    assets: new Map([
        [
            "thalorna-none-image-thorn",
            { package: "thalorna", asset: { path: "images/beings/thorn.webp" } },
        ],
    ]),
    foreign: new Map([
        [
            "packagebuild-none-image-afflictionbnr",
            { package: "packagebuild", asset: { path: "images/banners/afflictionbnr.webp" } },
        ],
    ]),
};

/** What one note body's images are reported as, with a configuration to hand. */
const findings = (body: string, config: unknown = thalorna) =>
    checkImages(body, "Beings/Thorn.md", { bodyLine: 7, bodyColumn: 1, config });

/** The body a compiler would render, or the refusal it raised. */
function compile(body: string, config: unknown = thalorna) {
    return convertNoteWikilinks(body, {
        type: "being",
        id: "thornthornthorn",
        pack: "beings",
        docPack: "beingdocs",
        index,
        name: "Thorn",
        file: "Beings/Thorn.md",
        bodyLine: 7,
        bodyColumn: 1,
        config,
    });
}

describe("the pathname a Foundry install cannot serve", () => {
    it("names package-build and says why it can never be declared", () => {
        const problem = foundryAddressProblem(BANNER, thalorna);
        expect(problem).toContain(BANNER);
        expect(problem).toContain("packagebuild");
        expect(problem).toContain("npm dependency");
        // The advice a declarable package gets would be a dead end here.
        expect(problem).not.toContain("relationships");
    });

    it("tells a declarable package to declare itself", () => {
        const problem = foundryAddressProblem("dnd5e/assets/icons/spell.webp", thalorna);
        expect(problem).toContain("dnd5e");
        expect(problem).toContain("relationships");
    });

    it("says nothing about a package the build declares", () => {
        expect(foundryAddressProblem("sohl/assets/icons/anvil.svg", thalorna)).toBe("");
        expect(foundryAddressProblem("images/beings/thorn.webp", thalorna)).toBe("");
    });

    it("leaves a Foundry-spelled pathname to the check that owns it", () => {
        // `pathnameProblem` names the replacement; a second finding about the
        // same characters would send the author to one mistake twice.
        expect(foundryAddressProblem("systems/sohl/assets/icons/anvil.svg", thalorna)).toBe("");
    });

    it("is the sentence `resolveImg` refuses with", () => {
        expect(() => resolveImg(BANNER, thalorna)).toThrow(
            `package-build: ${foundryAddressProblem(BANNER, thalorna)}.`,
        );
    });
});

describe("the addresses that name no package pass through", () => {
    const passthrough = [
        "https://cdn.example.org/thalorna/images/map.webp",
        "http://example.org/a.png",
        "//cdn.example.org/thalorna/images/map.webp",
        "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
        "/icons/svg/mystery-man.svg",
        "/systems/dnd5e/icons/spell.webp",
    ];

    it("reports none of them", () => {
        for (const src of passthrough) {
            expect(foundryAddressProblem(src, thalorna)).toBe("");
        }
    });

    it("emits each of them to a journal exactly as authored", () => {
        for (const src of passthrough) {
            expect(compile(`![A picture](${src})\n`).markdown).toContain(`(${src})`);
        }
    });

    it("keeps the two empties apart", () => {
        expect(foundryAddressProblem(null, thalorna)).toBe("");
        expect(foundryAddressProblem(undefined, thalorna)).toBe("");
        expect(foundryAddressProblem("", thalorna)).toBe("");
    });
});

describe("a build with no Foundry surface is not asked", () => {
    it("knows which kind has one", () => {
        expect(servesFoundry(thalorna)).toBe(true);
        expect(servesFoundry(docsOnly)).toBe(false);
    });

    it("reports nothing against a documentation package's own images", () => {
        expect(findings("![A map](images/map.webp)\n", docsOnly)).toEqual([]);
    });
});

describe("the lint locates the finding", () => {
    it("reports an unreachable package with a file, a line and a column", () => {
        const found = findings(`A being.\n\n![A banner](${BANNER})\n`);
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({
            file: "Beings/Thorn.md",
            line: 9,
            column: 1,
            severity: "error",
        });
        expect(found[0].message).toContain("packagebuild");
    });

    it("reports nothing for an address this build can serve", () => {
        expect(findings("![A portrait](images/beings/thorn.webp)\n")).toEqual([]);
    });

    it("asks only when a configuration is supplied", () => {
        // A caller with no repository to resolve against still reads a body,
        // and gets the config-free findings alone.
        expect(checkImages(`![A banner](${BANNER})\n`, "Beings/Thorn.md")).toEqual([]);
    });
});

describe("one construct, one behaviour", () => {
    it("resolves an embed to the pathname the rule then refuses", () => {
        const { images } = resolveEmbeds("![[packagebuild-none-image-afflictionbnr|A banner]]\n", {
            index,
        });
        expect(images).toHaveLength(1);
        expect(images[0].pathname).toBe(BANNER);
        expect(foundryAddressProblem(images[0].pathname, thalorna)).toContain("packagebuild");
    });

    it("refuses both spellings of one address with one message", () => {
        const written = () => compile(`![A banner](${BANNER})\n`);
        const embedded = () => compile("![[packagebuild-none-image-afflictionbnr|A banner]]\n");
        const message = foundryAddressProblem(BANNER, thalorna);
        expect(written).toThrow(message);
        expect(embedded).toThrow(message);
    });

    it("carries the note's own position on the refusal", () => {
        let err: any;
        try {
            compile(`A being.\n\n![A banner](${BANNER})\n`);
        } catch (e) {
            err = e;
        }
        expect(err.file).toBe("Beings/Thorn.md");
        expect(err.position).toMatchObject({ line: 9, column: 1 });
    });
});
