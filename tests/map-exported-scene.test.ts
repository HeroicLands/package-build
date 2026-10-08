/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { loadContentFormat } from "../engine/content-format.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { buildExportedScene } from "../engine/exported-scene.mjs";
import { MAP_SUBTYPES } from "../engine/ids.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

/** A map note as the link index hands one over, with a real frontmatter fence. */
const mapNote = (fm: Record<string, unknown>) => {
    const body = { type: "map", subType: "regionalmap", ...fm };
    return {
        file: "/tree/map.md",
        type: "map",
        raw: `---\n${Object.keys(body)
            .map((key) => `${key}: ${JSON.stringify((body as any)[key])}`)
            .join("\n")}\n---\n`,
        fm: body,
    };
};

const opts = { schemas: NOTE_SCHEMAS as any, vocabulary: NOTE_VOCABULARY };

const messages = (findings: Array<{ message: string }>) =>
    findings.map((f) => f.message).join("\n");

/** The keys the authored-map experiment declared, none of which a map note takes. */
const UNDECLARED = [
    "bgImage",
    "scale",
    "dimensions",
    "pxPerGrid",
    "navName",
    "levelName",
    "backgroundColor",
    "overlay",
    "walls",
    "doors",
    "lights",
    "tiles",
    "sounds",
    "regions",
    "notes",
];

describe("a map note's data", () => {
    it("declares exactly scene, fixup and place of its own", () => {
        // `dataFields` adds the keys every document-producing type shares.
        expect(NOTE_VOCABULARY.map.data.map((field: any) => field.name)).toEqual([
            "scene",
            "fixup",
            "place",
        ]);
    });

    it("is stated the same way by the format contract", () => {
        const format = loadContentFormat();
        expect([...format.types.get("map")!.dataKeys].sort()).toEqual(["fixup", "place", "scene"]);
    });

    it("keeps all four subtypes", () => {
        expect([...MAP_SUBTYPES].sort()).toEqual(["battlemap", "localmap", "regionalmap", "totm"]);
    });

    for (const key of UNDECLARED) {
        it(`refuses data.${key} as an undeclared key`, () => {
            const findings = lintNote(mapNote({ data: { scene: {}, [key]: 1 } }), opts);
            const found = findings.filter((f: any) =>
                f.message.startsWith(`"${key}" is not a \`data:\` property declared by map`),
            );
            expect(found, messages(findings)).toHaveLength(1);
            expect(found[0].severity).toBe("error");
        });
    }

    it("declares nothing under the system block", () => {
        expect(NOTE_SCHEMAS.map).toEqual([]);
        for (const key of ["walls", "doors", "lights", "tiles", "sounds", "regions", "locations"]) {
            const findings = lintNote(
                mapNote({ data: { scene: {} }, sohl: { [key]: { a: {} } } }),
                opts,
            );
            expect(
                findings.some((f: any) => f.severity === "error" && f.message.includes(key)),
                `${key}: ${messages(findings)}`,
            ).toBe(true);
        }
    });

    it("accepts any object at data.scene, on every subtype", () => {
        for (const subType of MAP_SUBTYPES) {
            for (const scene of [{}, { name: "No canvas" }, { width: "wide", levels: "none" }]) {
                const findings = lintNote(mapNote({ subType, data: { scene } }), opts);
                expect(findings, `${subType}: ${messages(findings)}`).toEqual([]);
            }
        }
    });

    it("refuses a data.scene that is not an object", () => {
        for (const scene of ["scene.json", 3, ["a"]]) {
            const findings = lintNote(mapNote({ data: { scene } }), opts);
            expect(messages(findings)).toContain("`data.scene` should be");
        }
    });
});

describe("compiling an exported Scene", () => {
    const fm = (subType: string, scene: unknown, extra: Record<string, unknown> = {}) => ({
        id: "AAAAAAAAAAAAAAAA",
        subType,
        name: { full: "A Map" },
        data: { scene, ...extra },
    });

    it("passes a Scene through on every subtype, checking nothing inside it", () => {
        for (const subType of MAP_SUBTYPES) {
            const scene = buildExportedScene(
                fm(subType, {
                    name: "Bare",
                    initialLevel: "nowhere",
                    walls: [{ c: [1, 2, 3, 4] }, { c: [1, 2, 3, 4] }],
                }),
                "",
            ) as any;
            expect(scene._id).toBe("AAAAAAAAAAAAAAAA");
            expect(scene.width).toBeUndefined();
            expect(scene.initialLevel).toBe("nowhere");
            expect(scene.walls).toHaveLength(2);
        }
    });

    it("refuses a map note without a Scene object", () => {
        for (const scene of [undefined, "scene.json", ["a"]]) {
            expect(() => buildExportedScene(fm("totm", scene), "")).toThrow(
                /needs a Foundry Scene object at `data.scene`/,
            );
        }
    });

    it("still refuses a fixup path the Scene does not have", () => {
        expect(() =>
            buildExportedScene(
                fm(
                    "regionalmap",
                    { levels: [] },
                    {
                        fixup: [{ path: ".levels[0].background.src", type: "address", value: "x" }],
                    },
                ),
                "",
                { resolveAddress: () => "assets/x.webp" },
            ),
        ).toThrow(/no array index 0/);
    });
});

describe("no code path constructs a Scene", () => {
    it("ships no authored-geometry or itinerary Scene module", () => {
        for (const file of ["map-notes.mjs", "itinerary-scenes.mjs", "map-raster.mjs"]) {
            expect(fs.existsSync(path.join(root, "engine", file)), file).toBe(false);
        }
        const engine = fs
            .readdirSync(path.join(root, "engine"))
            .filter((file) => file.endsWith(".mjs"))
            .map((file) => fs.readFileSync(path.join(root, "engine", file), "utf8"))
            .join("\n");
        for (const name of ["buildScene", "buildWalls", "buildLights", "buildItineraryScenes"]) {
            expect(engine, name).not.toMatch(new RegExp(`\\b${name}\\b`));
        }
    });
});
