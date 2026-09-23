/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Which pack a note's document lands in, and whether it produces one at all.
 *
 * Two things follow from a note carrying a block per system:
 *
 * - **`pack:` gains a per-system form for free.** It already exists at the top
 *   level and is read by `pack-router.mjs`; the block-override rule makes
 *   `<system>.pack` the value for that system's document and leaves the shared
 *   one for the rest.
 * - **A system block is what makes a game document.** A pass whose document
 *   *is* a system's data compiles a note only where the note carries the block
 *   that pass reads — its own, never the pack's, because a pack need not
 *   declare one and the pass behind it reads one block regardless. A note
 *   saying nothing about any system produces no Actor and no Item anywhere; its
 *   prose still becomes a page, a PDF leaf and a JournalEntry.
 *
 * The cases below are derived from the shipped registries rather than written
 * out, so a third system is covered by registering it.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createPackRouter, PackRoutingError } from "../engine/pack-router.mjs";
import { BasePackCompiler } from "../engine/base-compiler.mjs";
import { compilerFor, systemCompilers } from "../engine/generate.mjs";
import {
    KNOWN_DOCUMENT_SUBTYPE_MAPS,
    SHIPPED_SYSTEMS,
    SYSTEM_DOCUMENT_CLASSES,
} from "../engine/subtype-registry.mjs";

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

/** A pass whose document is a system's data, reading the block it names. */
class SystemPass extends BasePackCompiler {
    static override requiresSystemBlock = true;
    /** The block this pass reads, as every shipped system pass declares one. */
    override get system() {
        return "hm3";
    }
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
        skipDirectories: [],
        contentBase,
        dest: path.join(contentBase, "out"),
        packName: "actors-hm3",
        packSystem,
        docType: "Actor",
    });
}

describe("pack eligibility", () => {
    it("compiles a note carrying the block this pass reads", () => {
        expect(pass(SystemPass, "hm3").eligibleFor({ hm3: { type: "character" } })).toBe(true);
    });

    it("skips a note that says nothing about this pass's system", () => {
        expect(pass(SystemPass, "hm3").eligibleFor({ shortcode: "kaldor", sohl: {} })).toBe(false);
    });

    it("skips a note carrying no system block at all", () => {
        expect(pass(SystemPass, "hm3").eligibleFor({ shortcode: "kaldor" })).toBe(false);
    });

    it("reads a block authored as something other than a mapping as absent", () => {
        expect(pass(SystemPass, "hm3").eligibleFor({ shortcode: "kaldor", hm3: "yes" })).toBe(
            false,
        );
    });

    it("asks the same question where the pack declares no system", () => {
        // The pack says nothing; the pass behind it still reads one block, so
        // a note carrying none has nothing for it to compile.
        expect(pass(SystemPass, null).eligibleFor({})).toBe(false);
        expect(pass(SystemPass, null).eligibleFor({ hm3: {} })).toBe(true);
    });

    it("constrains nothing on a pass whose document is not system data", () => {
        // A journal is not a system's document, so a system-declaring journal
        // pack does not make every prose note into system content.
        expect(pass(NeutralPass, "hm3").eligibleFor({})).toBe(true);
    });
});

/* --------------------------------------------------------------------- */
/*  Every shipped pass, derived from the registries                       */
/* --------------------------------------------------------------------- */

/** One pass of a shipped system, built as `generatePack` builds it. */
function shippedPass(docType: string, packSystem: string | null) {
    const contentBase = emptyTree();
    const Cls = compilerFor(docType, packSystem) as typeof BasePackCompiler;
    return new (Cls as any)({
        skipDirectories: [],
        contentBase,
        dest: path.join(contentBase, "out"),
        packName: "pack",
        packSystem,
        docType,
    });
}

describe("a note with no system block compiles into no game document", () => {
    const classes = [...SYSTEM_DOCUMENT_CLASSES];

    it("has system-bearing document classes to ask about", () => {
        expect(classes.length).toBeGreaterThan(0);
        expect(SHIPPED_SYSTEMS.length).toBeGreaterThan(0);
    });

    for (const docType of SYSTEM_DOCUMENT_CLASSES) {
        for (const map of KNOWN_DOCUMENT_SUBTYPE_MAPS) {
            const system = (map as { system: string }).system;

            it(`is refused by the ${system} ${docType} pass of a pack declaring ${system}`, () => {
                expect(shippedPass(docType, system).eligibleFor({ shortcode: "x" })).toBe(false);
            });

            it(`is refused by the ${system} ${docType} pass where a block is another system's`, () => {
                const other = SHIPPED_SYSTEMS.find((id) => id !== system);
                if (!other) return;
                expect(shippedPass(docType, system).eligibleFor({ [other]: {} })).toBe(false);
            });
        }

        it(`is refused by the ${docType} pass of a pack declaring no system`, () => {
            expect(shippedPass(docType, null).eligibleFor({ shortcode: "x" })).toBe(false);
        });

        it(`is compiled by the ${docType} pass of a pack declaring no system once it carries that block`, () => {
            const fallback = shippedPass(docType, null) as { system: string; eligibleFor: any };
            expect(fallback.eligibleFor({ [fallback.system]: {} })).toBe(true);
        });
    }
});

/* --------------------------------------------------------------------- */
/*  The compiler table, derived from the passes                           */
/* --------------------------------------------------------------------- */

describe("which pass compiles a pack", () => {
    it("gives every shipped system a pass of every system-bearing class", () => {
        for (const system of SHIPPED_SYSTEMS) {
            for (const docType of SYSTEM_DOCUMENT_CLASSES) {
                const Cls = compilerFor(docType, system) as {
                    documentSubtypes?: { system?: string };
                };
                expect(Cls?.documentSubtypes?.system, `${system} ${docType}`).toBe(system);
            }
        }
    });

    it("refuses a system it ships no pass for, rather than compiling it as another's", () => {
        for (const docType of SYSTEM_DOCUMENT_CLASSES) {
            expect(() => compilerFor(docType, "dnd5e")).toThrow(/dnd5e/);
            expect(() => compilerFor(docType, "dnd5e")).toThrow(
                new RegExp(SHIPPED_SYSTEMS.join("|")),
            );
        }
    });

    it("leaves a system-neutral class alone, whatever a pack declares", () => {
        // A JournalEntry is Foundry's document, so one implementation answers
        // for every system a pack might name.
        expect(compilerFor("JournalEntry", "dnd5e")).toBe(compilerFor("JournalEntry", null));
    });

    it("tables a system registered after the fact with no edit of its own", () => {
        // The table is read off each pass's own declarations, so a third
        // system reaches it by registering its passes and nothing else.
        class Dnd5eItems {
            static documentSubtypes = { system: "dnd5e", block: "dnd5e" };
            static documentClass = "Item";
        }
        const table = systemCompilers([Dnd5eItems]);
        expect(table).toEqual({ dnd5e: { Item: Dnd5eItems } });
    });

    it("refuses to table a pass that declares neither half", () => {
        class Nameless {}
        expect(() => systemCompilers([Nameless])).toThrow(/Nameless/);
    });
});
