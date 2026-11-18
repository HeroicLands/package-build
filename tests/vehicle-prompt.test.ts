/* SPDX-License-Identifier: GPL-3.0-or-later */
import { expect, it } from "vitest";
import { dataFields } from "../engine/note-vocabulary.mjs";
import { vehiclePromptFromData, checkVehiclePortrait } from "../engine/vehicle-prompt.mjs";
const data = {
    family: "Cart",
    size: 1,
    locomotion: ["wheeled"],
    appearance: { form: "open_body", material: "wood" },
};
it("declares vehicle items and picture inputs", () => {
    const fields = dataFields("vehicle").map((field: any) => field.name);
    for (const name of [
        "items",
        "portrait.prompt",
        "portrait.negativePrompt",
        "portraitSettings.model",
        "portraitSettings.seed",
        "portraitSettings.extras",
        "portraitSettings.view",
    ])
        expect(fields).toContain(name);
    expect(fields).not.toContain("portraitSettings.ageBand");
});
it("composes full vehicle channels without mutation or human framing", () => {
    const input = { ...data, portraitSettings: { model: "sdxl", seed: "seed", view: "side" } };
    const before = structuredClone(input);
    const result = vehiclePromptFromData(input, [
        { name: "Rope", kind: "miscgear", system: { quantity: 2 } },
    ]);
    expect(result.positive).toMatch(/full.vehicle/i);
    expect(result.positive).toMatch(/Cart/);
    expect(result.positive).toMatch(/Rope/);
    expect(result.positive).toContain("quantity 2");
    expect(result.positive).not.toMatch(/head.and.shoulders|chest.up|face|hair/i);
    expect(result.negative).toBeDefined();
    expect(result.negative).not.toMatch(/full.body/i);
    expect(input).toEqual(before);
});
it("requires a picture and complete stored record together", () => {
    expect(checkVehiclePortrait({ fm: { type: "vehicle", data } })).toEqual([]);
    expect(
        checkVehiclePortrait({
            fm: {
                type: "vehicle",
                data: { ...data, portraitSettings: { model: "sdxl", seed: "seed" } },
            },
        }).length,
    ).toBeGreaterThan(0);
});

it("enforces the picture and channel lifecycle", () => {
    const settings = { model: "sdxl", seed: "seed", view: "side" };
    const baseline = { ...data, icon: "image-cart", portraitSettings: settings };
    const channels = vehiclePromptFromData(baseline);
    const check = (d: any) => checkVehiclePortrait({ fm: { type: "vehicle", data: d } });
    expect(
        check({
            ...baseline,
            portrait: { prompt: channels.positive, negativePrompt: channels.negative },
        }),
    ).toEqual([]);
    expect(
        check({ ...data, portrait: { prompt: "x" } }).some((x: any) => x.severity === "error"),
    ).toBe(true);
    expect(
        check({
            ...baseline,
            icon: undefined,
            tokenIcon: "image-token",
            portrait: { prompt: channels.positive, negativePrompt: channels.negative },
        }).some((x: any) => x.severity === "error"),
    ).toBe(true);
    expect(
        check({ ...baseline, portrait: { prompt: " ", negativePrompt: channels.negative } }).some(
            (x: any) => x.severity === "error",
        ),
    ).toBe(true);
    expect(
        check({ ...baseline, portrait: { prompt: channels.positive } }).some(
            (x: any) => x.severity === "error",
        ),
    ).toBe(true);
    expect(
        check({ ...baseline, portrait: { prompt: "old", negativePrompt: channels.negative } }).some(
            (x: any) => x.severity === "warning" && x.message.includes("positive"),
        ),
    ).toBe(true);
    expect(
        check({ ...baseline, portrait: { prompt: channels.positive, negativePrompt: "old" } }).some(
            (x: any) => x.severity === "warning" && x.message.includes("negative"),
        ),
    ).toBe(true);
});
it("requires supported styles and view, and selects deterministic transient views", () => {
    for (const model of ["flux-dev", "flux2-pro", "sdxl"]) {
        const value = { ...data, portraitSettings: { model, seed: "seed" } };
        const one = vehiclePromptFromData(value);
        expect(vehiclePromptFromData(value)).toEqual(one);
        expect(Boolean(one.negative)).toBe(model === "sdxl");
    }
    for (const settings of [
        { model: "bad", seed: "seed" },
        { model: "sdxl", seed: "" },
        { model: "sdxl", seed: "seed", view: "above" },
    ])
        expect(() => vehiclePromptFromData({ ...data, portraitSettings: settings })).toThrow();
    expect(() =>
        vehiclePromptFromData({
            ...data,
            portraitSettings: { model: "sdxl", seed: "seed", extras: ["cartoon"] },
        }),
    ).toThrow();
});

it("uses item addresses and accepts chance for vehicles, beings and cultures", async () => {
    const { checkItems } = await import("../engine/item-entries.mjs");
    const { decodeNoteAddresses } = await import("../engine/note-addresses.mjs");
    const fm = {
        type: "vehicle",
        data: { items: [{ model: "miscgear-rope", img: "image-rope", chance: 10 }] },
    };
    const decoded = decodeNoteAddresses(fm, { package: "demo", system: "note" });
    expect(decoded.data.items[0].model).toMatchObject({ type: "miscgear" });
    expect(decoded.data.items[0].img).toMatchObject({ type: "image" });
    for (const type of ["vehicle", "being"])
        expect(
            checkItems({ fm: { ...fm, type } }).some((finding: any) =>
                finding.message.includes("chance"),
            ),
        ).toBe(false);
    expect(
        checkItems({ fm: { ...fm, type: "lore", subType: "culture" } }).some((finding: any) =>
            finding.message.includes("chance"),
        ),
    ).toBe(false);
});
it("resolves equal item prompts from actual local and cached dependency indexes", async () => {
    const { default: fs } = await import("node:fs");
    const { default: os } = await import("node:os");
    const { default: path } = await import("node:path");
    const { default: YAML } = await import("yaml");
    const { collectContentIndex, serializeContentIndex } =
        await import("../engine/content-index.mjs");
    const { buildLinkIndex } = await import("../engine/content-links.mjs");
    const { loadForeignIndexes, metadataFileName } = await import("../engine/metadata-index.mjs");
    const { loadPackConfig } = await import("../engine/pack-config.mjs");
    const { resolvePortraitItems } = await import("../engine/portrait-prompt.mjs");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vehicle-index-"));
    try {
        const local = path.join(root, "local"),
            dep = path.join(root, "dep"),
            cache = path.join(root, "cache"),
            cacheDir = path.join(cache, "remote@1.0.0");
        fs.mkdirSync(local);
        fs.mkdirSync(dep);
        fs.mkdirSync(cacheDir, { recursive: true });
        const assets = path.join(root, "assets");
        fs.mkdirSync(path.join(assets, "images"), { recursive: true });
        fs.writeFileSync(path.join(assets, "images", "cart.png"), "image");
        fs.writeFileSync(
            path.join(assets, "images", "provenance.yaml"),
            "attribution: Someone\nlicense: CC-BY-4.0\nai: false\n",
        );
        const remoteAssets = path.join(root, "remote-assets");
        fs.mkdirSync(path.join(remoteAssets, "images"), { recursive: true });
        fs.writeFileSync(path.join(remoteAssets, "images", "cart.png"), "image");
        fs.writeFileSync(
            path.join(remoteAssets, "images", "provenance.yaml"),
            "attribution: Someone\nlicense: CC-BY-4.0\nai: false\n",
        );
        const item = {
            type: "miscgear",
            shortcode: "rope",
            name: { full: "Rope" },
            data: { kind: "miscgear", name: "Rope", img: "local-none-image-cart" },
        };
        const text = (fm: any) => `---\n${YAML.stringify(fm)}---\nBody.\n`;
        fs.writeFileSync(path.join(local, "rope.md"), text(item));
        fs.writeFileSync(
            path.join(dep, "rope.md"),
            text({ ...item, data: { ...item.data, img: "remote-none-image-cart" } }),
        );
        fs.writeFileSync(
            path.join(cacheDir, metadataFileName("remote")),
            serializeContentIndex(
                collectContentIndex(dep, {
                    contentPackage: "remote",
                    skipDirectories: [],
                    assetsBase: remoteAssets,
                }),
            ),
        );
        fs.writeFileSync(path.join(cacheDir, ".complete"), "");
        const config = {
            ...loadPackConfig(),
            contentPackage: "local",
            paths: { ...loadPackConfig().paths, assets, metadataCache: cache },
            relationships: {
                requires: [
                    {
                        id: "remote",
                        manifest: "https://example.invalid/module.json",
                        type: "module",
                    },
                ],
            },
        };
        const index = buildLinkIndex(local, {
            config: config as any,
            skipDirectories: [],
            foreign: loadForeignIndexes(config as any, ["local"]),
        });
        const settings = { model: "sdxl", seed: "same", view: "side" };
        const generate = (model: string) => {
            const d = { ...data, portraitSettings: settings, items: [{ model }] };
            const resolved = resolvePortraitItems(d, index);
            return vehiclePromptFromData(d, resolved, d.items, index);
        };
        const vehicle = {
            type: "vehicle",
            shortcode: "cart",
            name: { full: "Cart" },
            data: {
                ...data,
                role: ["merchant"],
                capacity: 1,
                items: [{ model: "miscgear-rope" }],
            },
        };
        fs.writeFileSync(path.join(dep, "cart.md"), text(vehicle));
        const published = collectContentIndex(dep, {
            contentPackage: "remote",
            skipDirectories: [],
            assetsBase: remoteAssets,
        });
        const vehicleRecord = published.find((record: any) => record.type === "vehicle") as any;
        expect(vehicleRecord.data.items[0].name).toBe("Rope");
        expect(vehicleRecord.authoredItems).toHaveLength(1);
        fs.writeFileSync(
            path.join(cacheDir, metadataFileName("remote")),
            serializeContentIndex(published),
        );
        const vehicleIndex = loadForeignIndexes(config as any, ["local"]).index;
        const projected = [...vehicleIndex.values()].find(
            (record: any) => record.type === "vehicle",
        ) as any;
        expect(projected.data.items[0].name).toBe("Rope");
        expect(projected.authoredItems).toHaveLength(1);
        expect(generate("local-note-miscgear-rope")).toEqual(generate("remote-note-miscgear-rope"));
        expect(generate("remote-note-miscgear-rope").positive).toContain("Rope");
        const remotePicture = {
            ...data,
            icon: "remote-none-image-cart",
            portraitSettings: settings,
        };
        const remotePrompt = vehiclePromptFromData(remotePicture);
        const remoteStored = {
            ...remotePicture,
            portrait: { prompt: remotePrompt.positive, negativePrompt: remotePrompt.negative },
        };
        expect(
            checkVehiclePortrait({ fm: { type: "vehicle", data: remoteStored } }, { index }),
        ).toEqual([]);
        const source = [{ model: "remote-note-miscgear-rope", img: "remote-none-image-missing" }];
        const bad = { ...data, portraitSettings: settings, items: source };
        expect(() =>
            vehiclePromptFromData(bad, resolvePortraitItems(bad, index), source, index),
        ).toThrow(/artwork/);
        const modelSource = [{ model: "remote-note-miscgear-rope" }];
        const defaultedBad = [{ kind: "miscgear", name: "Rope", img: "remote-none-image-missing" }];
        try {
            vehiclePromptFromData(
                { ...data, portraitSettings: settings },
                defaultedBad,
                modelSource,
                index,
            );
            throw new Error("expected failure");
        } catch (error: any) {
            expect(error.keyPath).toEqual(["data", "items", 0, "model"]);
        }

        expect(() => generate("remote-note-miscgear-missing")).toThrow();
        fs.writeFileSync(
            path.join(dep, "rope.md"),
            text({ ...item, data: { ...item.data, img: "remote-none-image-missing" } }),
        );
        fs.writeFileSync(
            path.join(cacheDir, metadataFileName("remote")),
            serializeContentIndex(
                collectContentIndex(dep, {
                    contentPackage: "remote",
                    skipDirectories: [],
                    assetsBase: remoteAssets,
                }),
            ),
        );
        const badIndex = buildLinkIndex(local, {
            config: config as any,
            skipDirectories: [],
            foreign: loadForeignIndexes(config as any, ["local"]),
        });
        const fromBadModel = {
            ...data,
            portraitSettings: settings,
            items: [{ model: "remote-note-miscgear-rope" }],
        };
        try {
            vehiclePromptFromData(
                fromBadModel,
                resolvePortraitItems(fromBadModel, badIndex),
                fromBadModel.items,
                badIndex,
            );
            throw new Error("expected failure");
        } catch (error: any) {
            expect(error.keyPath).toEqual(["data", "items", 0, "model"]);
        }

        const written = {
            ...data,
            icon: "image-cart",
            portraitSettings: settings,
            items: [{ model: "local-note-miscgear-rope" }],
        };
        const old = vehiclePromptFromData(written, resolvePortraitItems(written, index));
        const frozen = {
            ...written,
            portrait: { prompt: old.positive, negativePrompt: old.negative },
        };
        expect(checkVehiclePortrait({ fm: { type: "vehicle", data: frozen } }, { index })).toEqual(
            [],
        );
        fs.writeFileSync(
            path.join(local, "rope.md"),
            text({ ...item, data: { ...item.data, name: "Changed rope" } }),
        );
        const updated = buildLinkIndex(local, {
            config: config as any,
            skipDirectories: [],
            foreign: loadForeignIndexes(config as any, ["local"]),
        });
        expect(
            checkVehiclePortrait(
                { fm: { type: "vehicle", data: frozen } },
                { index: updated },
            ).some(
                (finding: any) =>
                    finding.severity === "warning" && finding.message.includes("positive"),
            ),
        ).toBe(true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

it("locates malformed picture inputs and unknown nested fields through full lint", async () => {
    const { lintNote } = await import("../engine/frontmatter-lint.mjs");
    const { NOTE_SCHEMAS } = await import("../sohl/note-schemas.mjs");
    const { NOTE_VOCABULARY } = await import("../engine/note-vocabulary.mjs");
    const YAML = (await import("yaml")).default;
    const fm = {
        type: "vehicle",
        shortcode: "cart",
        name: { full: "Cart" },
        data: {
            ...data,
            role: ["merchant"],
            capacity: 1,
            portraitSettings: { model: "sdxl", seed: "", ageBand: "adult" },
            portrait: { prompt: " ", extra: true },
        },
    };
    const raw = `---\n${YAML.stringify(fm)}---\nBody.\n`;
    const findings = lintNote(
        { file: "cart.md", fm, raw },
        { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY },
    );
    for (const part of ["ageBand", "extra", "prompt"])
        expect(
            findings.some((finding: any) => finding.message.includes(part) && finding.line > 0),
        ).toBe(true);
});

it("includes cargo capacity in freshness", () => {
    const d = {
        ...data,
        locomotion: ["floating"],
        width: 30,
        cargoCapacity: 3,
        icon: "image-boat",
        portraitSettings: { model: "sdxl", seed: "test", view: "side" },
    };
    const original = vehiclePromptFromData(d);
    expect(original.positive).toContain("cargo capacity: 3 seams");
    for (const changed of [{ cargoCapacity: 8 }]) {
        const next = {
            ...d,
            ...changed,
            portrait: { prompt: original.positive, negativePrompt: original.negative },
        };
        expect(vehiclePromptFromData(next).positive).not.toBe(original.positive);
        expect(
            checkVehiclePortrait({ fm: { type: "vehicle", data: next } }).some(
                (f: any) => f.severity === "warning",
            ),
        ).toBe(true);
    }
});

it("shares model keys and negatives while wording vehicle facts with their units", async () => {
    const { STYLES, STYLE_KEYS } = await import("../engine/portrait-compose.mjs");
    const positives = STYLE_KEYS.map((model) => {
        const result = vehiclePromptFromData({
            ...data,
            length: 40,
            hullDepth: 5,
            capacity: 176,
            portraitSettings: { model, seed: "example", view: "side" },
        });
        expect(result.positive).toContain("length 40 feet");
        expect(result.positive).toContain("hull depth 5 feet");
        expect(result.positive).toContain("capacity 176 seams");
        expect(result.positive).toContain("size designation 1,");
        expect(result.positive).not.toContain("hullDepth");
        expect(result.negative).toBe((STYLES as any)[model].vehicleNegative);
        return result.positive;
    });
    expect(new Set(positives).size).toBe(STYLE_KEYS.length);
    expect(STYLES.sdxl.negative).toContain(STYLES.sdxl.vehicleNegative);
});
