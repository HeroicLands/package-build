/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Build-time pack compiler (plain ESM, no Foundry). Imported by relative path
// because the pack-build scripts live outside the `@src` alias tree.
import { Scenes } from "../engine/scenes.mjs";

/** Two exported Scenes of one place, with one pin bound to Markdown. */
const GROUND = `---
name:
  full: Test Ground Floor
id: AAAAAAAAAAAAAAAA
shortcode: testground
type: map
subType: battlemap
data:
  place: place-testplace
  scene:
    name: Test Ground Floor
    width: 512
    height: 512
    grid: { type: 1, size: 64, distance: 5, units: ft }
    initialLevel: defaultLevel0000
    levels:
      - { _id: defaultLevel0000, background: { src: maps/parchment.webp } }
    walls:
      - { _id: WWWWWWWWWWWWWWWW, c: [64, 64, 448, 64] }
    notes:
      - { _id: NNNNNNNNNNNNNNNN, text: '#common-room', x: 256, y: 256 }
    regions:
      - _id: RRRRRRRRRRRRRRRR
        name: Stair Foot
        behaviors:
          - _id: CCCCCCCCCCCCCCCC
            type: teleportToken
            system:
              destinations: [Scene.BBBBBBBBBBBBBBBB.Region.SSSSSSSSSSSSSSSS]
---

Prose before the first heading becomes the map's own page.

# Common Room {#common-room}

A room.
`;

const LOFT = `---
name:
  full: Test Loft
id: BBBBBBBBBBBBBBBB
shortcode: testloft
type: map
subType: battlemap
data:
  place: place-testplace
  scene:
    name: Test Loft
    width: 512
    height: 512
    grid: { type: 1, size: 64, distance: 5, units: ft }
    initialLevel: defaultLevel0000
    levels:
      - { _id: defaultLevel0000, background: { src: maps/parchment.webp } }
    regions:
      - { _id: SSSSSSSSSSSSSSSS, name: Stair Head, behaviors: [] }
---

The loft.
`;

let tmp: string;
let sceneDir: string;
let adventureDir: string;

/** Every emitted document in a directory, by name. */
function read(dir: string): Record<string, any> {
    const out: Record<string, any> = {};
    for (const file of fs.readdirSync(dir)) {
        const doc = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
        out[doc.name] = doc;
    }
    return out;
}

beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sohl-scenes-"));
    const content = path.join(tmp, "content");
    fs.mkdirSync(content, { recursive: true });
    fs.writeFileSync(path.join(content, "Ground.md"), GROUND);
    fs.writeFileSync(path.join(content, "Loft.md"), LOFT);

    sceneDir = path.join(tmp, "scenes");
    adventureDir = path.join(tmp, "adventures");
    fs.mkdirSync(sceneDir);
    fs.mkdirSync(adventureDir);

    const pack = new Scenes({
        skipDirectories: [],
        contentBase: content,
        assetsBase: path.join(tmp, "assets"),
        dest: sceneDir,
        companionDests: { adventures: adventureDir },
    });
    await pack.compile();
    expect(pack.errorCount).toBe(0);
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("the scenes pass", () => {
    it("writes one Scene per map note, each embedded document keyed", () => {
        const scenes = read(sceneDir);
        const ground = scenes["Test Ground Floor"];
        expect(ground._key).toBe("!scenes!AAAAAAAAAAAAAAAA");
        expect(ground.levels[0]._key).toBe("!scenes.levels!AAAAAAAAAAAAAAAA.defaultLevel0000");
        // A missing `_key` fails the compendium compile with "Key cannot be
        // null or undefined", so every embedded document carries one.
        for (const collection of ["walls", "notes", "regions"]) {
            for (const doc of ground[collection]) {
                expect(doc._key, `${collection} key`).toMatch(
                    new RegExp(`^!scenes\\.${collection}!AAAAAAAAAAAAAAAA\\.`),
                );
            }
        }
        for (const region of ground.regions) {
            for (const behavior of region.behaviors) {
                expect(behavior._key).toBe(
                    `!scenes.regions.behaviors!AAAAAAAAAAAAAAAA.${region._id}.${behavior._id}`,
                );
            }
        }
    });

    it("stamps a core version the Level survives being read back at", () => {
        // Foundry's `migrateLevels` rewrites any Scene stamped older than
        // 14.353, discarding an authored Level and its map image without a
        // word. The stamp comes from the manifest's supported floor.
        const ground = read(sceneDir)["Test Ground Floor"];
        const [major, build = 0] = ground._stats.coreVersion.split(".").map(Number);
        expect(major).toBe(14);
        expect(build).toBeGreaterThanOrEqual(353);
    });

    it("preserves a cross-map teleport from the exported Scene", () => {
        const scenes = read(sceneDir);
        const loft = scenes["Test Loft"];
        const stairHead = loft.regions.find((r: any) => r.name === "Stair Head");
        const teleport = scenes["Test Ground Floor"].regions
            .find((r: any) => r.name === "Stair Foot")
            .behaviors.find((b: any) => b.type === "teleportToken");
        expect(teleport.system.destinations).toEqual([
            `Scene.BBBBBBBBBBBBBBBB.Region.${stairHead._id}`,
        ]);
    });

    it("bundles the place's scenes and journals into one Adventure, named for its first map", () => {
        const adventures = read(adventureDir);
        const adventure = adventures["Test Ground Floor"];
        expect(adventure._key).toMatch(/^!adventures!/);
        expect(adventure.scenes.map((s: any) => s._id).sort()).toEqual([
            "AAAAAAAAAAAAAAAA",
            "BBBBBBBBBBBBBBBB",
        ]);
        expect(adventure.journal).toHaveLength(2);
        // Inline members are source data in a SetField, not sublevel documents.
        expect(JSON.stringify(adventure.scenes)).not.toContain("_key");
        expect(JSON.stringify(adventure.journal)).not.toContain("_key");
    });

    it("points each pin at a page the bundled journal actually holds", () => {
        const ground = read(sceneDir)["Test Ground Floor"];
        const adventure = read(adventureDir)["Test Ground Floor"];
        const entry = adventure.journal.find((j: any) => j._id === ground.notes[0].entryId);
        const pageIds = entry.pages.map((p: any) => p._id);
        expect(ground.notes).toHaveLength(1);
        expect(pageIds).toContain(ground.notes[0].pageId);
        expect(entry.pages.find((p: any) => p._id === ground.notes[0].pageId).name).toBe(
            "Common Room",
        );
    });
});
