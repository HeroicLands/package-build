/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Routing one note into **one pack per system**.
 *
 * The scenario is `harn-ensemble`'s, and it is the one the issue exists for:
 * 2,512 notes, each describing one NPC, each compiling into an `actors-sohl`
 * document *and* an `actors-hm3` one. The tree declares a pack per system and
 * no `pack:` on any note — the whole point of the per-system block being that a
 * note says where a document goes only where the two systems differ.
 *
 * The router counted every pack of a type together, so "Actor" had two and
 * therefore no default, and every one of those notes routed nowhere. The build
 * failed naming each in turn, which is 2,519 errors saying the configuration is
 * wrong when it is the question that was.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defineConfig } from "../content-config.mjs";
import { createPackRouter, PackRoutingError } from "../engine/pack-router.mjs";
import { contentPackage } from "../engine/content-package.mjs";
import { compilerFor } from "../engine/generate.mjs";

/** Normalize a bare pack list through `defineConfig`'s validation. */
function routerFor(packs: any[]) {
    // A pack's `system:` must resolve to the version its documents are stamped
    // with, so a complete configuration declares every system its packs name.
    const named = [...new Set(packs.map((p) => p.system).filter(Boolean))] as string[];
    const config = defineConfig({
        compatibility: { minimum: "14.359", verified: "14.359" },
        rootDir: os.tmpdir(),
        contentPackage: contentPackage(),
        foundryPackage: "sohl",
        packageKind: "systems",
        stats: { lastModifiedBy: "sohltestbuild0000" },
        ...(named.length ?
            {
                systems: Object.fromEntries(
                    named.map((id) => [id, { compatibility: { verified: "1.0.0" } }]),
                ),
            }
        :   {}),
        packs,
    } as any);
    return createPackRouter(config.packs);
}

/** `harn-ensemble`'s shape: one Actor pack per system, no default flag. */
const ENSEMBLE = [
    { name: "actors-hm3", type: "Actor", system: "hm3" },
    { name: "actors-sohl", type: "Actor", system: "sohl" },
];

/** A being note as that tree writes one: two blocks, and no `pack:` anywhere. */
const note = (extra: Record<string, unknown> = {}) => ({
    type: "being",
    name: { full: "Dersory of Talkene" },
    sohl: { items: [] },
    hm3: { items: [] },
    ...extra,
});

describe("a pack per system", () => {
    it("needs no `default: true`, because each system has exactly one", () => {
        // The same reason a single-pack type needs none: asked per system, the
        // layout is unambiguous. Asked per type it is not, which is the whole
        // defect.
        const router = routerFor(ENSEMBLE);
        expect(router.resolve(note(), "Actor", "sohl")).toBe("actors-sohl");
        expect(router.resolve(note(), "Actor", "hm3")).toBe("actors-hm3");
    });

    it("still has no package-wide answer, and says so", () => {
        // Nothing changes for a caller naming no system: two Actor packs and no
        // flag is genuinely ambiguous, and guessing is what this refuses to do.
        const router = routerFor(ENSEMBLE);
        expect(() => router.resolve(note(), "Actor")).toThrow(PackRoutingError);
    });

    it("lets a system's own `default: true` win among its several packs", () => {
        const router = routerFor([
            { name: "actors-hm3", type: "Actor", system: "hm3" },
            { name: "actors-sohl", type: "Actor", system: "sohl", default: true },
            { name: "actors-sohl-extra", type: "Actor", system: "sohl" },
        ]);
        expect(router.resolve(note(), "Actor", "sohl")).toBe("actors-sohl");
        expect(router.resolve(note(), "Actor", "hm3")).toBe("actors-hm3");
    });
});

describe("a system never receives another system's pack", () => {
    it("ignores a type-wide default belonging to the other system", () => {
        // `CONTENT.md`'s documented two-system layout marks `actors-sohl` as the
        // default. Returned to the HM3 pass, that pack name is not its own, so
        // it passed over every note in the tree and compiled zero entries —
        // silently, which is worse than the loud failure above.
        const router = routerFor([
            { name: "actors-sohl", type: "Actor", system: "sohl", default: true },
            { name: "actors-hm3", type: "Actor", system: "hm3" },
        ]);
        expect(router.resolve(note(), "Actor", "hm3")).toBe("actors-hm3");
    });

    it("refuses a block `pack:` naming another system's pack, by name", () => {
        // A contradiction: `hm3.pack` says where the *HM3* document goes.
        const router = routerFor(ENSEMBLE);
        expect(() =>
            router.resolve(note({ hm3: { pack: "actors-sohl" } }), "Actor", "hm3"),
        ).toThrow(/declares `hm3\.pack: actors-sohl`.*declares `system: sohl`/s);
    });

    it("reads past a shared `pack:` that names a system-specific pack", () => {
        // No contradiction — the top level is the value a note states once for
        // every system, and a system-specific pack cannot be that value. So it
        // does not answer for HM3, which falls through to its own default. This
        // is what lets a note pin its SoHL pack and still compile its HM3
        // document, instead of losing it without a word.
        const router = routerFor(ENSEMBLE);
        const pinned = note({ pack: "actors-sohl" });
        expect(router.resolve(pinned, "Actor", "sohl")).toBe("actors-sohl");
        expect(router.resolve(pinned, "Actor", "hm3")).toBe("actors-hm3");
    });

    it("names the system when no pack of the type declares it", () => {
        const router = routerFor([{ name: "actors-sohl", type: "Actor", system: "sohl" }]);
        expect(() => router.resolve(note(), "Actor", "hm3")).toThrow(
            /no pack of that type declares `system: hm3`/,
        );
    });
});

describe("a system-neutral pack still answers every system", () => {
    it("routes a system's document into the one pack of its type", () => {
        // A pack declaring no system belongs to all of them, so the type-wide
        // default is this system's too. Every single-system tree is this case.
        const router = routerFor([{ name: "actors", type: "Actor" }]);
        expect(router.resolve(note(), "Actor", "sohl")).toBe("actors");
        expect(router.resolve(note(), "Actor")).toBe("actors");
    });
});

/* ---------------------------------------------------------------------- */
/*  How many documents a note produces, and where each lands               */
/* ---------------------------------------------------------------------- */

/**
 * The packs that compile a document for one note, under one pack list.
 *
 * Two questions per pack, asked of the real pass: does it read a block this
 * note carries (`eligibleFor`), and does the note route to this pack for that
 * pass's system (`resolve`). Both are the compile's own, so the count here is
 * the count a build writes.
 */
function documentsFor(packs: any[], fm: object): string[] {
    const router = routerFor(packs);
    const contentBase = fs.mkdtempSync(path.join(os.tmpdir(), "cb-count-"));
    const landed: string[] = [];
    for (const pack of packs) {
        const Cls = compilerFor(pack.type, pack.system ?? null) as any;
        const pass = new Cls({
            skipDirectories: [],
            contentBase,
            dest: path.join(contentBase, "out"),
            packName: pack.name,
            packSystem: pack.system ?? null,
            docType: pack.type,
            router,
        });
        if (!pass.eligibleFor(fm)) continue;
        if (router.resolve(fm, pack.type, pass.system) === pack.name) landed.push(pack.name);
    }
    return landed;
}

describe("a system block is what makes a game document", () => {
    it("gives a note carrying both blocks one document in each system's pack", () => {
        expect(documentsFor(ENSEMBLE, note()).sort()).toEqual(["actors-hm3", "actors-sohl"]);
    });

    it("gives a note carrying one block exactly one document, in that system's pack", () => {
        expect(documentsFor(ENSEMBLE, note({ hm3: undefined }))).toEqual(["actors-sohl"]);
        expect(documentsFor(ENSEMBLE, note({ sohl: undefined }))).toEqual(["actors-hm3"]);
    });

    it("gives a note carrying no block no document at all", () => {
        expect(documentsFor(ENSEMBLE, note({ sohl: undefined, hm3: undefined }))).toEqual([]);
    });

    it("says the same of a tree whose one pack declares no system", () => {
        const packs = [{ name: "actors", type: "Actor" }];
        expect(documentsFor(packs, note({ hm3: undefined }))).toEqual(["actors"]);
        expect(documentsFor(packs, note({ sohl: undefined, hm3: undefined }))).toEqual([]);
    });

    it("sends a system's document to the pack that system's block names", () => {
        const packs = [
            { name: "actors-hm3", type: "Actor", system: "hm3" },
            { name: "actors-sohl", type: "Actor", system: "sohl" },
            { name: "extras-sohl", type: "Actor", system: "sohl", default: false },
        ];
        expect(
            documentsFor(packs, note({ sohl: { items: [], pack: "extras-sohl" } })).sort(),
        ).toEqual(["actors-hm3", "extras-sohl"]);
    });
});
