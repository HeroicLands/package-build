/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `(type, shortcode)` resolves inside **one system's** catalogue (#58).
 *
 * A being names its embedded items by `(type, shortcode)` and never by the pack
 * they ship in, so the Item packs are read as one address space. With two
 * systems in the tree that address space stops being one: `skill:sword` exists
 * under both names, with different data models behind them, and reading them
 * together makes the pair either ambiguous — the actors pass fails on a
 * duplicate address — or, worse, resolved to the wrong system's document.
 *
 * The reference itself is not ambiguous: it sits inside a system block, and
 * position says which system it means. What was missing is the resolver knowing
 * which catalogue it is searching. It does now: an Actor pass reads the Item
 * packs of **its own** system, plus the system-neutral ones, which belong to
 * everybody.
 */

import { describe, it, expect } from "vitest";

import { itemPackJsonDirs } from "../engine/generate.mjs";

const CONFIG = {
    rootDir: "/repo",
    paths: { packJson: "/repo/build/packs-json" },
    packs: [
        { name: "items", type: "Item" },
        { name: "items-hm3", type: "Item", system: "hm3" },
        { name: "items-sohl", type: "Item", system: "sohl" },
        { name: "actors-hm3", type: "Actor", system: "hm3" },
    ],
} as never;

const name = (dir: string) => dir.split("/").pop();

describe("which Item packs an Actor pass reads", () => {
    it("reads every one when it asks for no system — a single-system build", () => {
        expect(itemPackJsonDirs(CONFIG).map(name)).toEqual(["items", "items-hm3", "items-sohl"]);
    });

    it("reads its own system's packs and the system-neutral ones", () => {
        expect(itemPackJsonDirs(CONFIG, "hm3").map(name)).toEqual(["items", "items-hm3"]);
        expect(itemPackJsonDirs(CONFIG, "sohl").map(name)).toEqual(["items", "items-sohl"]);
    });

    it("never reads another system's", () => {
        expect(itemPackJsonDirs(CONFIG, "hm3").map(name)).not.toContain("items-sohl");
    });

    it("reads only the neutral packs for a system nothing declares", () => {
        expect(itemPackJsonDirs(CONFIG, "dnd5e").map(name)).toEqual(["items"]);
    });
});
