// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildExportedScene } from "../engine/exported-scene.mjs";
import { Scenes } from "../engine/scenes.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
import { loadContentFormat } from "../engine/content-format.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const SCENE_ID = "AAAAAAAAAAAAAAAA";

/** A map's frontmatter as the compiler receives it. */
const mapFm = (data: Record<string, unknown>) => ({
    id: SCENE_ID,
    subType: "regionalmap",
    name: { full: "The Vale" },
    data: {
        scene: {
            name: "Vale",
            thumb: "worlds/demo/scenes/vale-thumb.webp",
            levels: [{ _id: "defaultLevel0000", background: { src: "other/maps/vale.webp" } }],
        },
        ...data,
    },
});

const resolveAddress = (address: string) => `modules/demo/assets/${address}.webp`;

/** A note as the link index hands one over, with a real frontmatter fence. */
const lintable = (type: string, data: Record<string, unknown>) => {
    const fm = { type, shortcode: "vale", name: { full: "The Vale" }, data };
    return {
        file: "/tree/vale.md",
        type,
        raw: `---\ntype: ${type}\nshortcode: vale\nname: { full: The Vale }\ndata:\n${Object.entries(
            data,
        )
            .map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`)
            .join("\n")}\n---\n`,
        fm,
    };
};

const lintOpts = {
    schemas: NOTE_SCHEMAS as any,
    vocabulary: NOTE_VOCABULARY,
    addressContext: { package: "demo" },
};

describe("a map's thumbnail", () => {
    it("is an image Address declared on a map, and nowhere else", () => {
        const field: any = dataFields("map")!.find((f: any) => f.name === "thumbnail");
        expect(field).toBeDefined();
        expect(field.kind).toBe("address");
        expect(field.ref).toBe("image");
        expect(field.accepts).toEqual(["image"]);
        for (const type of Object.keys(NOTE_VOCABULARY).filter((t) => t !== "map")) {
            expect(
                (dataFields(type) ?? []).some((f: any) => f.name === "thumbnail"),
                type,
            ).toBe(false);
        }
        expect(loadContentFormat().types.get("map")!.dataKeys.has("thumbnail")).toBe(true);
    });

    it("declares the Scene property it is written into", () => {
        const field: any = dataFields("map")!.find((f: any) => f.name === "thumbnail");
        expect(field.sceneProperty).toBe(".thumb");
    });

    it("lints clean on a map and is refused at its key elsewhere", () => {
        expect(lintNote(lintable("map", { scene: {}, thumbnail: "valethumb" }), lintOpts)).toEqual(
            [],
        );
        const refused = lintNote(lintable("place", { thumbnail: "valethumb" }), lintOpts).filter(
            (f: any) => f.message.startsWith('"thumbnail" is not a `data:` property declared by'),
        );
        expect(refused).toHaveLength(1);
        expect(refused[0].severity).toBe("error");
        expect(refused[0].line).toBe(6);
        expect(refused[0].column).toBe(5);
    });

    it("refuses a thumbnail naming something other than an image", () => {
        const findings = lintNote(
            lintable("map", { scene: {}, thumbnail: "icon-vale" }),
            lintOpts,
        ).filter((f: any) => f.severity === "error");
        expect(findings.map((f: any) => f.message).join("\n")).toMatch(
            /`data\.thumbnail` accepts image, not icon/,
        );
    });

    it("resolves into the compiled Scene's thumb, leaving the background alone", () => {
        const scene = buildExportedScene(mapFm({ thumbnail: "valethumb" }), "", {
            resolveAddress,
        }) as any;
        expect(scene.thumb).toBe("modules/demo/assets/valethumb.webp");
        expect(scene.levels[0].background.src).toBe("other/maps/vale.webp");
    });

    it("leaves the exported thumb in place when no thumbnail is named", () => {
        const scene = buildExportedScene(mapFm({}), "", { resolveAddress }) as any;
        expect(scene.thumb).toBe("worlds/demo/scenes/vale-thumb.webp");
    });

    it("travels the fixup path, so a Scene without the property is refused", () => {
        const fm = mapFm({ thumbnail: "valethumb" });
        delete (fm.data.scene as any).thumb;
        expect(() => buildExportedScene(fm, "", { resolveAddress })).toThrow(
            /`data\.thumbnail`.*Scene fixup path "\.thumb" must end at an existing property/,
        );
    });

    it("is refused beside a data.fixup that writes the same property", () => {
        const fm = mapFm({
            thumbnail: "valethumb",
            fixup: [{ path: ".thumb", type: "address", value: "other-thumb" }],
        });
        expect(() => buildExportedScene(fm, "", { resolveAddress })).toThrow(
            /`data\.thumbnail` and `data\.fixup\[0\]` both write `\.thumb`/,
        );
    });

    it("applies beside an authored fixup that writes another property", () => {
        const scene = buildExportedScene(
            mapFm({
                thumbnail: "valethumb",
                fixup: [{ path: ".levels[0].background.src", type: "address", value: "vale" }],
            }),
            "",
            { resolveAddress },
        ) as any;
        expect(scene.thumb).toBe("modules/demo/assets/valethumb.webp");
        expect(scene.levels[0].background.src).toBe("modules/demo/assets/vale.webp");
    });

    it("compiles from a map note to the Scene the scenes pack writes", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "map-thumbnail-"));
        try {
            const contentBase = path.join(root, "content");
            const assetsBase = path.join(root, "assets");
            const sceneDir = path.join(root, "scenes");
            const adventureDir = path.join(root, "adventures");
            fs.mkdirSync(contentBase);
            fs.mkdirSync(path.join(assetsBase, "images"), { recursive: true });
            fs.writeFileSync(path.join(assetsBase, "images", "valethumb.webp"), "webp");
            fs.writeFileSync(
                path.join(assetsBase, "images", "provenance.yaml"),
                "attribution: A\nlicense: CC0-1.0\nai: false\n",
            );
            fs.mkdirSync(sceneDir);
            fs.mkdirSync(adventureDir);
            fs.writeFileSync(
                path.join(contentBase, "Vale.md"),
                `---
shortcode: vale
name: { full: The Vale }
type: map
subType: regionalmap
data:
  thumbnail: valethumb
  scene:
    name: Vale
    thumb: null
    levels:
      - { _id: defaultLevel0000, background: { src: other/maps/vale.webp } }
---
`,
            );
            const pack = new Scenes({
                skipDirectories: [],
                contentBase,
                assetsBase,
                dest: sceneDir,
                companionDests: { adventures: adventureDir },
            });
            await pack.compile();
            expect(pack.errorCount).toBe(0);
            const files = fs.readdirSync(sceneDir).filter((file) => file.endsWith(".json"));
            expect(files).toHaveLength(1);
            const scene = JSON.parse(fs.readFileSync(path.join(sceneDir, files[0]), "utf8"));
            expect(scene.thumb).toMatch(/(^|\/)images\/valethumb\.webp$/);
            expect(scene.levels[0].background.src).toBe("other/maps/vale.webp");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe("a map's thumbnail in the infobox", () => {
    it("is withheld, as every image is", async () => {
        const { NOTE_FIELD_PRESENTATION } = await import("../engine/infobox.mjs");
        expect((NOTE_FIELD_PRESENTATION as any)["map.thumbnail"].withheld).toMatch(/image/);
    });
});
