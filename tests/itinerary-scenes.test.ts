// SPDX-License-Identifier: GPL-3.0-or-later

import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { collectContentIndex } from "../engine/content-index.mjs";
import { authoredFrontmatter } from "../engine/index-records.mjs";
import { buildJournalEntry } from "../engine/journals.mjs";
import { buildItineraryScenes } from "../engine/itinerary-scenes.mjs";
import { rasterizeMapSvg } from "../engine/map-raster.mjs";
import { Scenes } from "../engine/scenes.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "itinerary-scenes-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("generated itinerary Scenes", () => {
    it("rasterizes authored regional SVGs into the staged package", () => {
        const source = path.join(root, "assets", "images", "regional.svg");
        fs.mkdirSync(path.dirname(source), { recursive: true });
        fs.writeFileSync(
            source,
            '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>',
        );
        const foundryPath = rasterizeMapSvg({
            foundryPath: "modules/demo/assets/images/regional.svg",
            width: 400,
            height: 200,
            sceneId: "AAAAAAAAAAAAAAAA",
            config: {
                rootDir: root,
                packageKind: "modules",
                foundryPackage: { id: "demo" },
                packageBuild: { stageDir: "build/stage" },
            },
        });
        expect(foundryPath).toBe("modules/demo/assets/maps/rasterized/AAAAAAAAAAAAAAAA.png");
        const png = fs.readFileSync(
            path.join(root, "build/stage/assets/maps/rasterized/AAAAAAAAAAAAAAAA.png"),
        );
        expect(png.readUInt32BE(16)).toBe(400);
        expect(png.readUInt32BE(20)).toBe(200);
        expect(fs.readFileSync(source, "utf8")).toContain("<svg");
        expect(() =>
            rasterizeMapSvg({
                foundryPath: "modules/demo/assets/images/regional.svg",
                width: 400,
                height: 300,
                sceneId: "BBBBBBBBBBBBBBBB",
                config: {
                    rootDir: root,
                    packageKind: "modules",
                    foundryPackage: { id: "demo" },
                    packageBuild: { stageDir: "build/stage" },
                },
            }),
        ).toThrow(/not 400×300/);
    });
    it("stages raster backgrounds and pins to bundled local journals", async () => {
        const contentBase = path.join(root, "assets", "content");
        const journalDir = path.join(root, "build", "packs-json", "journals");
        fs.mkdirSync(contentBase, { recursive: true });
        fs.mkdirSync(journalDir, { recursive: true });
        for (const [shortcode, bearing, target] of [
            ["alpha", "E", "beta"],
            ["beta", "W", "alpha"],
        ]) {
            fs.writeFileSync(
                path.join(contentBase, `${shortcode}.md`),
                `---\nshortcode: ${shortcode}\nname: { full: ${shortcode} }\ntype: place\nsubType: settlement\ndata:\n  routes:\n    - { to: ${target}, bearing: ${bearing}, mode: land, days: 1 }\n---\n\nA place.\n`,
            );
        }
        const records = collectContentIndex(contentBase, {
            contentPackage: "demo",
            skipDirectories: [],
        });
        for (const record of records.filter((record) => record.type === "place")) {
            const fm = authoredFrontmatter(record);
            expect(fm.id).toMatch(/^[A-Za-z0-9]{16}$/);
            const doc = buildJournalEntry({
                id: fm.id,
                name: fm.name.full,
                markdown: "A place.",
            });
            fs.writeFileSync(
                path.join(journalDir, `${record.shortcode}.json`),
                JSON.stringify(doc),
            );
        }
        const config = {
            rootDir: root,
            contentPackage: "demo",
            packageKind: "modules",
            foundryPackage: { id: "demo" },
            packageBuild: { stageDir: "build/stage" },
            relationships: { systems: [], modules: [] },
            paths: { metadataCache: path.join(root, "build", "metadata-cache") },
        };
        const result = buildItineraryScenes({
            config,
            records,
            contentBase,
            journalSourceDirs: [journalDir],
        });
        expect(result.scenes).toHaveLength(2);
        expect(result.journal).toHaveLength(2);
        expect(result.scenes[0].grid.type).toBe(0);
        expect(result.scenes[0].grid.units).toBe("");
        expect(result.scenes[0].notes).toHaveLength(2);
        const ids = new Set(result.journal.map((doc) => doc._id));
        expect(ids.size).toBe(2);
        for (const scene of result.scenes) {
            expect(scene.levels[0].background.src).toMatch(/generated-itineraries\/from-/);
            expect(scene.notes.every((note) => ids.has(note.entryId))).toBe(true);
            expect(scene.notes.every((note) => note.x >= 0 && note.x < scene.width)).toBe(true);
            expect(scene.notes.every((note) => note.y >= 0 && note.y < scene.height)).toBe(true);
        }
        expect(
            fs.existsSync(
                path.join(root, "build/stage/assets/maps/generated-itineraries/from-alpha.png"),
            ),
        ).toBe(true);

        const foreign = {
            stale: [],
            index: new Map([
                [
                    "other-note-place-gamma",
                    {
                        type: "place",
                        name: "gamma",
                        package: "other",
                        uuid: "Compendium.other.journals.JournalEntry.GGGGGGGGGGGGGGGG",
                        routes: [{ to: "alpha", bearing: "W", mode: "land", days: 1 }],
                    },
                ],
            ]),
        };
        const withForeign = buildItineraryScenes({
            config,
            records,
            contentBase,
            journalSourceDirs: [journalDir],
            foreign,
        });
        expect(withForeign.journal).toHaveLength(3);
        const proxy = withForeign.journal.find((doc) => doc.name === "gamma");
        expect(JSON.stringify(proxy)).toContain("Compendium.other.journals.JournalEntry");
        expect(
            withForeign.scenes.some((scene) => scene.notes.some((note) => note.text === "gamma")),
        ).toBe(true);

        const sceneDir = path.join(root, "build", "packs-json", "scenes");
        const adventureDir = path.join(root, "build", "packs-json", "adventures");
        fs.mkdirSync(sceneDir, { recursive: true });
        fs.mkdirSync(adventureDir, { recursive: true });
        config.packs = [{ name: "scenes", type: "Scene" }];
        const pack = new Scenes({
            contentBase,
            dest: sceneDir,
            assetsBase: path.join(root, "assets"),
            skipDirectories: [],
            companionDests: { adventures: adventureDir },
            bundleSourceDirs: { JournalEntry: [journalDir] },
            config,
            packName: "scenes",
            corpus: {
                records,
                problems: [],
                linkIndex: {},
                contentDocs: [],
                sqlTables: undefined,
            },
        });
        await pack.compile();
        expect(pack.errorCount).toBe(0);
        expect(pack.compiledCount).toBe(2);
        const adventureFiles = fs
            .readdirSync(adventureDir)
            .filter((file) => file.endsWith(".json"));
        expect(adventureFiles).toHaveLength(1);
        const adventure = JSON.parse(
            fs.readFileSync(path.join(adventureDir, adventureFiles[0]), "utf8"),
        );
        expect(adventure.scenes).toHaveLength(2);
        expect(adventure.journal).toHaveLength(2);

        const svg = path.join(root, "assets/images/regional.svg");
        fs.mkdirSync(path.dirname(svg), { recursive: true });
        fs.writeFileSync(
            svg,
            '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>',
        );
        (pack as any).artPathOf = () => "modules/demo/assets/images/regional.svg";
        const authored = pack.compileNote(
            {
                id: "MMMMMMMMMMMMMMMM",
                shortcode: "regional",
                type: "map",
                subType: "regionalmap",
                name: { full: "Regional Map" },
                data: {
                    bgImage: "regional",
                    scale: { distance: 5, unit: "leagues" },
                },
                sohl: { dimensions: [400, 200], pxPerGrid: 100 },
            },
            "",
        ) as any;
        expect(authored.levels[0].background.src).toBe(
            "modules/demo/assets/maps/rasterized/MMMMMMMMMMMMMMMM.png",
        );
        expect(authored.grid.distance).toBe(5);
        expect(authored.grid.units).toBe("leagues");
        expect(
            fs.existsSync(
                path.join(root, "build/stage/assets/maps/rasterized/MMMMMMMMMMMMMMMM.png"),
            ),
        ).toBe(true);
    });
});
