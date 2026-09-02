/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Which pack a note's document lands in, once a pack may declare a **system**
 * (#58).
 *
 * Two things follow from a note carrying a block per system:
 *
 * - **`pack:` gains a per-system form for free.** It already exists at the top
 *   level and is read by `pack-router.mjs`; the block-override rule makes
 *   `<system>.pack` the value for that system's document and leaves the shared
 *   one for the rest.
 * - **A pack that declares a system takes only notes carrying that system's
 *   block.** A note that says nothing about a system has no system data, so
 *   compiling it into that system's pack produces a hollow document — a
 *   subtype, and none of the fields the subtype exists for. The build says so,
 *   naming the note and the pack.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createPackRouter, PackRoutingError } from "../engine/pack-router.mjs";
import { BasePackCompiler } from "../engine/base-compiler.mjs";

const PACKS = [
    { name: "items", type: "Item", companions: [] },
    { name: "items-hm3", type: "Item", system: "hm3", companions: [] },
    { name: "actors", type: "Actor", default: true, companions: [] },
];

describe("a system block overrides the shared `pack:`", () => {
    const router = createPackRouter(PACKS);
    const note = { type: "skill", pack: "items", hm3: { pack: "items-hm3" } };

    it("routes a system's document by that system's declaration", () => {
        expect(router.resolve(note, "Item", "hm3")).toBe("items-hm3");
    });

    it("routes every other system by the shared one", () => {
        expect(router.resolve(note, "Item", "sohl")).toBe("items");
        expect(router.resolve(note, "Item")).toBe("items");
    });

    it("still refuses a block declaration no pack answers to, naming the note", () => {
        const bad = { type: "skill", shortcode: "sword", hm3: { pack: "nope" } };
        expect(() => router.resolve(bad, "Item", "hm3")).toThrow(PackRoutingError);
        expect(() => router.resolve(bad, "Item", "hm3")).toThrow(/sword[\s\S]*nope/);
    });
});

/* --------------------------------------------------------------------- */
/*  A pack that declares a system                                         */
/* --------------------------------------------------------------------- */

/** A content tree holding nothing — the walk is not what is under test. */
function emptyTree(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "cb-elig-"));
}

class SystemPass extends BasePackCompiler {
    static override requiresSystemBlock = true;
    override selects() {
        return true;
    }
    override buildEntry() {
        return {};
    }
}

class NeutralPass extends BasePackCompiler {
    override selects() {
        return true;
    }
    override buildEntry() {
        return {};
    }
}

function pass(Cls: typeof SystemPass | typeof NeutralPass, packSystem: string | null) {
    const contentBase = emptyTree();
    return new Cls({
        contentBase,
        dest: path.join(contentBase, "out"),
        packName: "actors-hm3",
        packSystem,
        docType: "Actor",
    });
}

describe("pack eligibility", () => {
    it("compiles a note carrying the pack's system block", () => {
        expect(pass(SystemPass, "hm3").eligibleFor({ hm3: { type: "character" } })).toBe(true);
    });

    it("refuses a note that says nothing about the pack's system", () => {
        const compiler = pass(SystemPass, "hm3");
        expect(() => compiler.eligibleFor({ shortcode: "kaldor", sohl: {} })).toThrow(
            /kaldor[\s\S]*actors-hm3[\s\S]*hm3/,
        );
    });

    it("refuses a block authored as something other than a mapping", () => {
        const compiler = pass(SystemPass, "hm3");
        expect(() => compiler.eligibleFor({ shortcode: "kaldor", hm3: "yes" })).toThrow(/hm3/);
    });

    it("constrains nothing when the pack declares no system", () => {
        expect(pass(SystemPass, null).eligibleFor({})).toBe(true);
    });

    it("constrains nothing on a pass whose document is not system data", () => {
        // A journal is not a system's document, so a system-declaring journal
        // pack does not make every prose note into system content.
        expect(pass(NeutralPass, "hm3").eligibleFor({})).toBe(true);
    });
});
