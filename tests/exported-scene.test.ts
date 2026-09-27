// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildExportedScene } from "../engine/exported-scene.mjs";
import { journalPageId, splitPages } from "../engine/journals.mjs";
import { Scenes } from "../engine/scenes.mjs";

const SCENE_ID = "AAAAAAAAAAAAAAAA";
const ENTRY_ID = "JJJJJJJJJJJJJJJJ";

function mapNote() {
    return {
        id: SCENE_ID,
        subType: "battlemap",
        name: { full: "The Wolf's Den" },
        data: {
            scene: {
                _id: "OLDOLDOLDOLDOLD1",
                name: "Wolf Den Scene",
                width: 1900,
                height: 2600,
                grid: { type: 1, size: 100, distance: 5, units: "ft" },
                environment: { cycle: true, darknessLevel: 0.3 },
                flags: { tagger: { tags: ["den"] } },
                initialLevel: "defaultLevel0000",
                levels: [{ _id: "defaultLevel0000", background: { src: "other/maps/den.webp" } }],
                walls: [{ _id: "WWWWWWWWWWWWWWWW", c: [1, 2, 3, 4], flags: { module: true } }],
                tiles: [{ _id: "TTTTTTTTTTTTTTTT", x: 50, flags: { animation: true } }],
                regions: [
                    {
                        _id: "RRRRRRRRRRRRRRRR",
                        behaviors: [{ _id: "BBBBBBBBBBBBBBBB", type: "teleportToken" }],
                    },
                ],
                notes: [
                    {
                        _id: "NNNNNNNNNNNNNNNN",
                        text: "#myanchor1",
                        entryId: "old-entry",
                        pageId: "old-page",
                        x: 950,
                        y: 2350,
                        texture: { src: "icons/svg/book.svg" },
                    },
                    { _id: "LLLLLLLLLLLLLLLL", text: "Watch for wolves", x: 100, y: 200 },
                ],
            },
        },
    };
}

describe("exported Foundry Scene", () => {
    it("preserves exported fields and binds marked pins to generated journal pages", () => {
        const fm = mapNote();
        const markdown = "# Big Bad Wolf {#myanchor1}\n\nThe wolf waits here.";
        const scene = buildExportedScene(fm, markdown, {
            journalEntryId: ENTRY_ID,
            stats: { coreVersion: "14.364" },
        }) as any;
        const page = splitPages(markdown, fm.name.full)[0];
        expect(scene._id).toBe(SCENE_ID);
        expect(scene._key).toBe(`!scenes!${SCENE_ID}`);
        expect(scene.name).toBe("Wolf Den Scene");
        expect(scene.grid).toEqual(fm.data.scene.grid);
        expect(scene.environment).toEqual(fm.data.scene.environment);
        expect(scene.flags).toEqual(fm.data.scene.flags);
        expect(scene.levels[0].background.src).toBe("other/maps/den.webp");
        expect(scene.walls[0].c).toEqual([1, 2, 3, 4]);
        expect(scene.tiles[0].flags.animation).toBe(true);
        expect(scene.regions[0].behaviors[0]._key).toBe(
            `!scenes.regions.behaviors!${SCENE_ID}.RRRRRRRRRRRRRRRR.BBBBBBBBBBBBBBBB`,
        );
        expect(scene.notes[0]).toMatchObject({
            _id: "NNNNNNNNNNNNNNNN",
            x: 950,
            y: 2350,
            text: "Big Bad Wolf",
            entryId: ENTRY_ID,
            pageId: journalPageId(ENTRY_ID, page),
            texture: { src: "icons/svg/book.svg" },
        });
        expect(scene.notes[1].text).toBe("Watch for wolves");
        expect(fm.data.scene.notes[0].text).toBe("#myanchor1");
        for (const collection of ["levels", "walls", "tiles", "regions", "notes"]) {
            expect(scene[collection][0]._key).toMatch(new RegExp(`^!scenes\\.${collection}!`));
        }
    });

    it("refuses an anchor that has no heading", () => {
        expect(() =>
            buildExportedScene(mapNote(), "# Another heading", {
                journalEntryId: ENTRY_ID,
            }),
        ).toThrow(/#myanchor1.*no heading anchor/);
    });

    it("refuses missing embedded IDs and invalid level references", () => {
        const fm = mapNote() as any;
        delete fm.data.scene.walls[0]._id;
        expect(() => buildExportedScene(fm, "", {})).toThrow(/walls needs a 16-character _id/);
        fm.data.scene.walls = [];
        fm.data.scene.initialLevel = "missing";
        expect(() => buildExportedScene(fm, "", {})).toThrow(/names no Level/);
    });

    it("limits exported Scenes to battle and local maps", () => {
        const fm = { ...mapNote(), subType: "regionalmap" };
        expect(() => buildExportedScene(fm, "", {})).toThrow(/battlemap and localmap/);
    });

    it("compiles an exported Scene from a map note without rewriting its canvas", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "exported-scene-"));
        try {
            const contentBase = path.join(root, "content");
            const sceneDir = path.join(root, "scenes");
            const adventureDir = path.join(root, "adventures");
            fs.mkdirSync(contentBase);
            fs.mkdirSync(sceneDir);
            fs.mkdirSync(adventureDir);
            fs.writeFileSync(
                path.join(contentBase, "Wolf.md"),
                `---
shortcode: wolfden
name: { full: The Wolf's Den }
type: map
subType: battlemap
data:
  scene:
    name: Wolf Den Scene
    width: 1900
    height: 2600
    grid: { type: 1, size: 100, distance: 5, units: ft }
    initialLevel: defaultLevel0000
    levels:
      - { _id: defaultLevel0000, background: { src: other/maps/den.webp } }
    walls:
      - { _id: WWWWWWWWWWWWWWWW, c: [1, 2, 3, 4] }
    notes:
      - { _id: NNNNNNNNNNNNNNNN, text: '#myanchor1', x: 950, y: 2350 }
---

# Big Bad Wolf {#myanchor1}

The wolf waits here.
`,
            );
            const pack = new Scenes({
                skipDirectories: [],
                contentBase,
                assetsBase: path.join(root, "assets"),
                dest: sceneDir,
                companionDests: { adventures: adventureDir },
            });
            await pack.compile();
            expect(pack.errorCount).toBe(0);
            const files = fs.readdirSync(sceneDir).filter((file) => file.endsWith(".json"));
            expect(files).toHaveLength(1);
            const scene = JSON.parse(fs.readFileSync(path.join(sceneDir, files[0]), "utf8"));
            expect(scene.name).toBe("Wolf Den Scene");
            expect(scene.grid).toEqual({ type: 1, size: 100, distance: 5, units: "ft" });
            expect(scene.notes[0].text).toBe("Big Bad Wolf");
            expect(scene.notes[0].entryId).toMatch(/^[A-Za-z0-9]{16}$/);
            expect(scene.notes[0].pageId).toMatch(/^[A-Za-z0-9]{16}$/);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
