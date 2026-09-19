/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Build-time pack helper (plain ESM, no Foundry). Imported by relative path
// because the pack-build scripts live outside the `@src` alias tree.
import { resolveImg } from "../engine/helpers.mjs";
import { defineConfig } from "../index.mjs";
import { Items } from "../sohl/items.mjs";
import { Actors } from "../sohl/actors.mjs";
import { loadPackConfig } from "../engine/pack-config.mjs";

/** This package's own root — where its test fixtures live. */
const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

describe("resolveImg (content → Foundry img path translation)", () => {
    it("prefixes a bundled `icons/` path with the system asset root", () => {
        expect(resolveImg("icons/game-icons/lorc/monkey.svg")).toBe(
            "systems/sohl/assets/icons/game-icons/lorc/monkey.svg",
        );
        expect(resolveImg("icons/other/sword.svg")).toBe(
            "systems/sohl/assets/icons/other/sword.svg",
        );
    });

    it("prefixes a bundled `images/` path with the same asset root", () => {
        expect(resolveImg("images/creatures/dragon.webp")).toBe(
            "systems/sohl/assets/images/creatures/dragon.webp",
        );
    });

    it("resolves a package-qualified pathname to that package's install path", () => {
        expect(resolveImg("sohl/assets/icons/game-icons/lorc/monkey.svg")).toBe(
            "systems/sohl/assets/icons/game-icons/lorc/monkey.svg",
        );
    });

    it("refuses a Foundry-spelled pathname, naming the replacement", () => {
        // It resolves for Foundry and for neither of the other two surfaces.
        expect(() => resolveImg("systems/sohl/assets/icons/monkey.svg")).toThrow(
            /write `sohl\/assets\/icons\/monkey\.svg`/,
        );
        expect(() => resolveImg("modules/foo/bar.webp")).toThrow(/write `foo\/assets\/bar\.webp`/);
        // `hm3` serves its pictures from `images/` at its own root, so the
        // replacement gains the `assets/` segment every form is built on.
        expect(() => resolveImg("systems/hm3/images/svg/sword.svg")).toThrow(
            /write `hm3\/assets\/images\/svg\/sword\.svg`/,
        );
    });

    it("passes a URL through unchanged", () => {
        expect(resolveImg("https://example.com/a.png")).toBe("https://example.com/a.png");
    });

    it("tells an unset path from a deliberately blank one", () => {
        // Translation only — each builder applies its own per-type default
        // (actors → being, items → per-type / miscgear) to an *unset* path,
        // with `??`. The two empties are not one case: `null` and an absent
        // key mean "no art named, use the default", `""` means "ship no art".
        // The full rule, and every caller that pairs a default with
        // it, is pinned in `img-unset-vs-blank.test.ts`.
        expect(resolveImg("")).toBe("");
        expect(resolveImg(undefined)).toBeNull();
        expect(resolveImg(null)).toBeNull();
    });
});

describe("an asset path's first segment says which package owns it", () => {
    // The rule the `img:`/`portrait:` field documentation states, asserted in
    // both directions so neither can regress into the other. It was inferred
    // from behaviour: `sohl-thalorna` authoring `icons/…` and
    // getting `modules/sohl-thalorna/assets/icons/…` was the only evidence it
    // held, and a regression either way would have surfaced as a 404 in
    // Foundry rather than as a failing test.

    it("prefixes a bare relative path with this package's asset root", () => {
        // Not just `icons/` and `images/`. The rule is about ownership, so a
        // directory this toolchain has never heard of is still this package's:
        // `sohl-kethira-basic` keeps art under `assets/artwork/`, and the old
        // two-directory allowlist would have shipped this unprefixed.
        expect(resolveImg("artwork/deity.webp")).toBe("systems/sohl/assets/artwork/deity.webp");
        expect(resolveImg("silhouette/human.webp")).toBe(
            "systems/sohl/assets/silhouette/human.webp",
        );
        expect(resolveImg("ui/frame.svg")).toBe("systems/sohl/assets/ui/frame.svg");
        // A single segment, with no directory at all, is owned the same way.
        expect(resolveImg("relic.svg")).toBe("systems/sohl/assets/relic.svg");
    });

    it("reads `<package>/assets/…` as that package's, whoever is compiling", () => {
        // Every default this toolchain ships is one of these, which is why the
        // default-art path in a compiled `sohl-thalorna` document reads
        // `systems/sohl/…` rather than being rewritten under the module.
        expect(resolveImg("sohl/assets/icons/noun/shield.svg")).toBe(
            "systems/sohl/assets/icons/noun/shield.svg",
        );
    });

    it("refuses a pathname written in Foundry's own spelling", () => {
        expect(() => resolveImg("systems/sohl/assets/icons/noun/shield.svg")).toThrow(
            /is a Foundry address/,
        );
        expect(() =>
            resolveImg("modules/sohl-thalorna/assets/icons/takheperu/pantheon/ra.svg"),
        ).toThrow(/is a Foundry address/);
    });

    it("has no Foundry address for a package it declares no relationship with", () => {
        // The website and the book need only the name and the suffix; the
        // install path needs the package's kind and its Foundry id, which only
        // a relationship carries. Refused rather than guessed — and a
        // `/`-rooted path addresses such a package directly.
        expect(() => resolveImg("dnd5e/assets/icons/spell.webp")).toThrow(
            /declares no relationship/,
        );
        expect(resolveImg("/systems/dnd5e/icons/spell.webp")).toBe(
            "/systems/dnd5e/icons/spell.webp",
        );
    });

    it("passes an address that names no package at all through untouched", () => {
        // Not a fourth rule — a URL, a `data:` URI and a `/`-rooted path each
        // name something no package owns, so prefixing any of them would break
        // an address that was already correct.
        expect(resolveImg("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
        expect(resolveImg("//cdn.example.com/a.png")).toBe("//cdn.example.com/a.png");
        expect(resolveImg("data:image/svg+xml;base64,AAAA")).toBe("data:image/svg+xml;base64,AAAA");
        expect(resolveImg("/icons/svg/mystery-man.svg")).toBe("/icons/svg/mystery-man.svg");
    });

    it("does not exempt `worlds/`, which a package may not ship art out of", () => {
        // Deliberately absent from the foreign-root list: a world path in a
        // note is an authoring mistake, and a plainly broken emitted path says
        // so where a plausible pass-through would not.
        expect(resolveImg("worlds/my-world/art.webp")).toBe(
            "systems/sohl/assets/worlds/my-world/art.webp",
        );
    });
});

describe("resolveImg for a non-`sohl` consumer", () => {
    /** A module repository's configuration — the case the hoist exists for. */
    const moduleConfig = defineConfig({
        rootDir: "/tmp/sohl-thalorna",
        contentPackage: "thalorna",
        foundryPackage: "sohl-thalorna",
        packageKind: "modules",
        stats: {
            lastModifiedBy: "thalornabuild000",
        },
        packs: [{ name: "items", type: "Item" }],
        // What makes `sohl/assets/…` resolvable from here: a relationship is
        // where a package learns another package's kind and Foundry id.
        relationships: { systems: [{ id: "sohl", type: "system" }] },
    });

    it("emits `modules/<id>/assets/…` for a module package", () => {
        // Foundry installs a module under `modules/`, so the same content path
        // has to resolve to a different served root. Nothing but configuration
        // decides which.
        expect(resolveImg("icons/game-icons/lorc/monkey.svg", moduleConfig)).toBe(
            "modules/sohl-thalorna/assets/icons/game-icons/lorc/monkey.svg",
        );
        expect(resolveImg("images/maps/keep.webp", moduleConfig)).toBe(
            "modules/sohl-thalorna/assets/images/maps/keep.webp",
        );
    });

    it("resolves its own package by the name a note writes, not its Foundry id", () => {
        // `thalorna` is what the content is called; `sohl-thalorna` is what
        // Foundry installs. A note writes the first and never the second.
        expect(resolveImg("thalorna/assets/icons/other/sword.svg", moduleConfig)).toBe(
            "modules/sohl-thalorna/assets/icons/other/sword.svg",
        );
        expect(resolveImg("", moduleConfig)).toBe("");
    });

    it("obeys the same ownership rule, only under a different root", () => {
        // The rule is one rule; the package the pathname names is the only
        // thing that decides where it lands. A module citing the system's art
        // gets the system's install path — which is what makes the system's
        // default art usable from a module at all.
        expect(resolveImg("artwork/deity.webp", moduleConfig)).toBe(
            "modules/sohl-thalorna/assets/artwork/deity.webp",
        );
        expect(resolveImg("sohl/assets/icons/noun/shield.svg", moduleConfig)).toBe(
            "systems/sohl/assets/icons/noun/shield.svg",
        );
    });
});

/* -------------------------------------------------------------------- */
/*  The rule as a compiled document sees it                       */
/* -------------------------------------------------------------------- */

/**
 * The unit assertions above pin the translator. These pin the *compilers* that
 * call it, because the acceptance the rule is really about is what lands in
 * `build/packs-json` — the only place the rule could otherwise be observed at
 * all. One item type and one actor type, since those are the two shapes: an
 * Item carries one piece of art, an Actor carries its profile art and its token
 * art independently.
 *
 * **The art is named by address**, and an address is answered by the compile's
 * index — so each case supplies a tree holding the file it names. What the
 * assertions pin is the rest of the journey: the record's path is joined onto
 * the owning package's root by the same rule a body image follows.
 */

/** A compile index holding the files these cases name. */
function artIndex(): any {
    const files: Record<string, [string, string]> = {
        awareness: ["icon", "icons/awareness.webp"],
        headgear: ["icon", "icons/other/head-gear.svg"],
        custom: ["icon", "icons/custom.svg"],
        folktoken: ["icon", "icons/folk-token.webp"],
        person: ["icon", "icons/game-icons/delapouite/person.svg"],
    };
    return {
        types: new Set(["icon", "image", "audio"]),
        packages: new Set(["sohl"]),
        contentPackage: "sohl",
        assets: new Map(
            Object.entries(files).map(([shortcode, [type, assetPath]]) => [
                `sohl-none-${type}-${shortcode}`,
                { package: "sohl", asset: { path: assetPath } },
            ]),
        ),
        foreign: new Map(),
    };
}

/** The Item compiler, against this repository's own configuration. */
function items() {
    const config = loadPackConfig();
    const pack = new Items({
        skipDirectories: [],
        contentBase: path.join(PKG_ROOT, "tests/fixtures"),
        dest: config.paths.packJson,
    });
    pack.linkIndex = artIndex();
    return pack;
}

/** The Actor compiler. Nothing here walks a tree or reads a pack. */
function actors() {
    const config = loadPackConfig();
    const pack = new Actors({
        skipDirectories: [],
        contentBase: path.join(PKG_ROOT, "tests/fixtures"),
        dest: config.paths.packJson,
    });
    pack.linkIndex = artIndex();
    return pack;
}

/** A `skill` note, with whatever art a case needs. */
const skillNote = (data: Record<string, unknown>) => ({
    id: "DDDDDDDDDDDDDDDD",
    type: "skill",
    shortcode: "awar",
    name: { full: "Awareness" },
    sohl: { subType: "physical", archetype: null },
    data,
});

/** A `being` note, likewise. `icon` is profile art, `portrait` the sheet's. */
const beingNote = (data: Record<string, unknown>) => ({
    id: "EEEEEEEEEEEEEEEE",
    type: "being",
    shortcode: "folk",
    name: { full: "Basic Folk" },
    tags: ["character"],
    sohl: { archetype: null },
    data,
});

describe("an item note's art obeys the ownership rule", () => {
    it("joins the record's path onto this package's asset root", () => {
        expect(items().buildEntry(skillNote({ icon: "awareness" }), "").img).toBe(
            "systems/sohl/assets/icons/awareness.webp",
        );
        expect(items().buildEntry(skillNote({ icon: "headgear" }), "").img).toBe(
            "systems/sohl/assets/icons/other/head-gear.svg",
        );
    });

    it("reads a qualified address as the same file a bare one names", () => {
        expect(items().buildEntry(skillNote({ icon: "sohl-none-icon-custom" }), "").img).toBe(
            "systems/sohl/assets/icons/custom.svg",
        );
    });
});

describe("an actor note's art obeys the ownership rule, on every slot", () => {
    it("resolves profile art and token art alike", () => {
        const doc = actors().buildBeing(
            new Map(),
            beingNote({ icon: "person", tokenIcon: "folktoken" }),
            "",
        );

        expect(doc.img).toBe("systems/sohl/assets/icons/game-icons/delapouite/person.svg");
        expect(doc.prototypeToken.texture.src).toBe("systems/sohl/assets/icons/folk-token.webp");
    });

    it("writes no `system.portrait` — a being's portrait is an image in its prose", () => {
        const doc = actors().buildBeing(new Map(), beingNote({ icon: "person" }), "");
        expect(doc.system).not.toHaveProperty("portrait");
    });

    it("lets a token follow the profile art where the note names only one", () => {
        const doc = actors().buildBeing(new Map(), beingNote({ icon: "person" }), "");
        expect(doc.prototypeToken.texture.src).toBe(doc.img);
    });
});
