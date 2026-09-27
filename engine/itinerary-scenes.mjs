/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Gridless Foundry Scenes drawn from place relations. */

import fs from "node:fs";
import path from "node:path";
import { resolvePackageBuildConfig } from "../config.mjs";

import { buildMaps, relatedPlaces } from "./map-build.mjs";
import { renderDot } from "./map-graphviz.mjs";
import { mapWorld } from "./map-places.mjs";
import { loadForeignIndexes } from "./metadata-index.mjs";
import { authoredFrontmatter, isNoteRecord } from "./index-records.mjs";
import { buildScene } from "./map-notes.mjs";
import { buildJournalEntry } from "./journals.mjs";
import { makeId } from "./ids.mjs";
import { stripAdventureKeys } from "./bundle-notes.mjs";

/** The PNG's dimensions, from its fixed header. */
function pngDimensions(file) {
    const bytes = fs.readFileSync(file);
    if (bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a") {
        throw new Error(`${file} is not a PNG`);
    }
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

/** GraphViz's plain coordinates, converted to pixel positions on its PNG. */
export function pinPositions(plain, width, height) {
    const graph = /^graph\s+\S+\s+(\S+)\s+(\S+)/m.exec(plain);
    if (!graph) throw new Error("GraphViz emitted no graph size for itinerary pins");
    const graphWidth = Number(graph[1]);
    const graphHeight = Number(graph[2]);
    if (!(graphWidth > 0 && graphHeight > 0)) {
        throw new Error("GraphViz emitted an invalid graph size for itinerary pins");
    }
    const positions = new Map();
    for (const line of plain.split("\n")) {
        const match = /^node\s+(?:"(p_[^"]+)"|(p_\S+))\s+(\S+)\s+(\S+)/.exec(line);
        if (!match) continue;
        const shortcode = (match[1] ?? match[2]).slice(2);
        positions.set(shortcode, {
            x: Math.round((Number(match[3]) / graphWidth) * width),
            y: Math.round((1 - Number(match[4]) / graphHeight) * height),
        });
    }
    return positions;
}

/** The compiled local journals a generated Adventure can import with its Scenes. */
function localJournals(dirs) {
    const byId = new Map();
    for (const dir of dirs) {
        if (!fs.existsSync(dir)) continue;
        for (const file of fs.readdirSync(dir)) {
            if (!file.endsWith(".json")) continue;
            const doc = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
            if (String(doc._key ?? "").startsWith("!journal!")) byId.set(doc._id, doc);
        }
    }
    return byId;
}

/**
 * Emit backgrounds into the staged package and return Scenes and the journals
 * their pins need. The caller writes them into its Scene and Adventure packs.
 */
export function buildItineraryScenes({
    config,
    records,
    contentBase,
    journalSourceDirs = [],
    stats,
    foreign = loadForeignIndexes(config, [config.contentPackage]),
}) {
    const buildConfig = resolvePackageBuildConfig(config);
    const world = mapWorld({ records, foreignIndex: foreign.index, contentBase, config });
    const centres = relatedPlaces(world.places).filter((sc) => world.places.get(sc)?.local);
    const findings = foreign.stale.map((stale) => ({
        file: contentBase,
        severity: "warning",
        message: `the ${stale.package} content index is unavailable, so itinerary maps omit its places: ${stale.reason}`,
    }));
    const assetDir = path.resolve(
        config.rootDir,
        buildConfig.stageDir,
        "assets/maps/generated-itineraries",
    );
    fs.rmSync(assetDir, { recursive: true, force: true });
    if (!centres.length) return { scenes: [], journal: [], findings };

    const outDir = path.resolve(config.rootDir, "build/map/foundry");
    fs.rmSync(outDir, { recursive: true, force: true });
    const drawn = buildMaps({ world, outDir, from: centres });
    findings.push(...drawn.findings);
    fs.mkdirSync(assetDir, { recursive: true });

    const localRecords = new Map();
    for (const record of records) {
        if (!isNoteRecord(record) || record.type !== "place") continue;
        localRecords.set(String(record.shortcode).toLowerCase(), authoredFrontmatter(record));
    }
    const compiledJournals = localJournals(journalSourceDirs);
    const imported = new Map();
    const scenes = [];
    for (const centre of centres) {
        const dot = path.join(outDir, `from-${centre}.dot`);
        const png = path.join(assetDir, `from-${centre}.png`);
        const plain = path.join(outDir, `from-${centre}.plain`);
        renderDot(dot, png, { engine: "neato", format: "png", nop: 2, dpi: 150 });
        renderDot(dot, plain, { engine: "neato", format: "plain", nop: 2 });
        const [width, height] = pngDimensions(png);
        const positions = pinPositions(fs.readFileSync(plain, "utf8"), width, height);
        const sceneId = makeId("itinerary-scene", `${config.contentPackage}:${centre}`);
        const src = `${buildConfig.packageKind}/${buildConfig.packageId}/assets/maps/generated-itineraries/from-${centre}.png`;
        const scene = buildScene(
            {
                id: sceneId,
                name: { full: `From ${world.places.get(centre).name}` },
                subType: "regionalmap",
                sohl: { dimensions: [width, height], pxPerGrid: 100 },
                data: { bgImage: src },
            },
            { art: () => src, stats },
        );
        scene.grid.distance = 1;
        scene.grid.units = "";
        for (const [shortcode, at] of positions) {
            const place = world.places.get(shortcode);
            if (!place) continue;
            let journal;
            if (place.local) {
                journal = compiledJournals.get(localRecords.get(shortcode)?.id);
            } else {
                const ref = foreign.index.get(place.address);
                if (ref?.uuid && /\.JournalEntry\./.test(ref.uuid)) {
                    const id = makeId("itinerary-foreign-journal", place.address);
                    journal = buildJournalEntry({
                        id,
                        name: place.name,
                        markdown: `@UUID[${ref.uuid}]{Open ${place.name}}`,
                        stats,
                    });
                }
            }
            if (!journal) {
                findings.push({
                    file: place.file ? path.join(contentBase, place.file) : contentBase,
                    severity: "warning",
                    message: `place "${shortcode}" has no addressable JournalEntry, so its itinerary label has no Foundry pin`,
                });
                continue;
            }
            imported.set(journal._id, stripAdventureKeys(journal));
            const id = makeId("itinerary-note", `${sceneId}:${shortcode}`);
            scene.notes.push({
                _id: id,
                entryId: journal._id,
                pageId: null,
                x: at.x,
                y: at.y,
                text: place.name,
                iconSize: 32,
                _key: `!scenes.notes!${sceneId}.${id}`,
            });
        }
        scenes.push(scene);
    }
    return { scenes, journal: [...imported.values()], findings };
}
