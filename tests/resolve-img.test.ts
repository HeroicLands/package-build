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

describe("resolveImg (content → Foundry img path translation, #890)", () => {
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

    it("leaves an already system-rooted path unchanged", () => {
        const p = "systems/sohl/assets/icons/game-icons/lorc/monkey.svg";
        expect(resolveImg(p)).toBe(p);
    });

    it("passes through any other rooted path unchanged (module, URL)", () => {
        expect(resolveImg("modules/foo/bar.webp")).toBe("modules/foo/bar.webp");
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
    // from behaviour until #331: `sohl-thalorna` authoring `icons/…` and
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

    it("passes a `systems/`-rooted path through untouched", () => {
        // Every default this toolchain ships is one of these, which is why the
        // default-art path in a compiled `sohl-thalorna` document reads
        // `systems/sohl/…` rather than being rewritten under the module.
        const p = "systems/sohl/assets/icons/noun/shield.svg";
        expect(resolveImg(p)).toBe(p);
        // Another system entirely — nothing here knows or cares which.
        expect(resolveImg("systems/dnd5e/icons/spell.webp")).toBe("systems/dnd5e/icons/spell.webp");
    });

    it("passes a `modules/`-rooted path through untouched", () => {
        const p = "modules/sohl-thalorna/assets/icons/takheperu/pantheon/ra.svg";
        expect(resolveImg(p)).toBe(p);
        expect(resolveImg("modules/foo/bar.webp")).toBe("modules/foo/bar.webp");
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

    it("still leaves an already-rooted path alone", () => {
        const p = "modules/sohl-thalorna/assets/icons/other/sword.svg";
        expect(resolveImg(p, moduleConfig)).toBe(p);
        expect(resolveImg("", moduleConfig)).toBe("");
    });

    it("obeys the same three-way ownership rule, only under a different root", () => {
        // The rule is one rule; the asset root it prefixes with is the only
        // thing configuration changes. A module citing the system's art gets
        // it verbatim — which is what makes the system's default art usable
        // from a module at all.
        expect(resolveImg("artwork/deity.webp", moduleConfig)).toBe(
            "modules/sohl-thalorna/assets/artwork/deity.webp",
        );
        expect(resolveImg("systems/sohl/assets/icons/noun/shield.svg", moduleConfig)).toBe(
            "systems/sohl/assets/icons/noun/shield.svg",
        );
        expect(resolveImg("modules/other-module/art.webp", moduleConfig)).toBe(
            "modules/other-module/art.webp",
        );
    });
});

/* -------------------------------------------------------------------- */
/*  The rule as a compiled document sees it                       */
/* -------------------------------------------------------------------- */

/**
 * The unit assertions above pin the translator. These pin the *compilers* that
 * call it, because the acceptance the rule is really about is what lands in
 * `build/packs-json` — which was, until #331, the only place the rule could be
 * observed at all. One item type and one actor type, since those are the two
 * shapes: an Item carries a single `img`, an Actor carries `img` and
 * `portrait` independently.
 */

/** The Item compiler, against this repository's own configuration. */
function items() {
    const config = loadPackConfig();
    return new Items({
        skipDirectories: [],
        contentBase: path.join(PKG_ROOT, "tests/fixtures"),
        dest: config.paths.packJson,
    });
}

/** The Actor compiler. Nothing here walks a tree or reads a pack. */
function actors() {
    const config = loadPackConfig();
    return new Actors({
        skipDirectories: [],
        contentBase: path.join(PKG_ROOT, "tests/fixtures"),
        dest: config.paths.packJson,
    });
}

/** A `skill` note, with whatever art a case needs. */
const skillNote = (fm: Record<string, unknown>) => ({
    id: "DDDDDDDDDDDDDDDD",
    type: "skill",
    shortcode: "awar",
    name: { full: "Awareness" },
    sohl: { subType: "physical", archetype: null },
    ...fm,
});

/** A `being` note, likewise. `img` is token art, `portrait` the sheet's. */
const beingNote = (sohl: Record<string, unknown>) => ({
    id: "EEEEEEEEEEEEEEEE",
    type: "being",
    shortcode: "folk",
    name: { full: "Basic Folk" },
    sohl: { archetype: null, ...sohl },
});

describe("an item note's art obeys the ownership rule", () => {
    it("prefixes a bare relative path with this package's asset root", () => {
        expect(items().buildEntry(skillNote({ img: "artwork/awareness.webp" }), "").img).toBe(
            "systems/sohl/assets/artwork/awareness.webp",
        );
        expect(items().buildEntry(skillNote({ img: "icons/other/head-gear.svg" }), "").img).toBe(
            "systems/sohl/assets/icons/other/head-gear.svg",
        );
    });

    it("leaves a `systems/`- or `modules/`-rooted path exactly as authored", () => {
        expect(
            items().buildEntry(skillNote({ img: "systems/sohl/assets/icons/custom.svg" }), "").img,
        ).toBe("systems/sohl/assets/icons/custom.svg");
        expect(
            items().buildEntry(skillNote({ img: "modules/other/icons/custom.svg" }), "").img,
        ).toBe("modules/other/icons/custom.svg");
    });
});

describe("an actor note's art obeys the ownership rule, on both fields", () => {
    it("prefixes bare relative `img` and `portrait` alike", () => {
        // Both go through the translator, so both follow the rule — a check
        // keyed on `img` alone would miss the eleven `sohl-kethira-basic`
        // beings that author only `portrait`.
        const doc = actors().buildBeing(
            new Map(),
            beingNote({ img: "artwork/folk-token.webp", portrait: "artwork/folk.webp" }),
            "",
        );

        expect(doc.img).toBe("systems/sohl/assets/artwork/folk-token.webp");
        expect(doc.system.portrait).toBe("systems/sohl/assets/artwork/folk.webp");
    });

    it("leaves a `systems/`- or `modules/`-rooted path exactly as authored", () => {
        const doc = actors().buildBeing(
            new Map(),
            beingNote({
                img: "systems/sohl/assets/icons/game-icons/delapouite/person.svg",
                portrait: "modules/sohl-thalorna/assets/images/folk.webp",
            }),
            "",
        );

        expect(doc.img).toBe("systems/sohl/assets/icons/game-icons/delapouite/person.svg");
        expect(doc.system.portrait).toBe("modules/sohl-thalorna/assets/images/folk.webp");
    });
});
