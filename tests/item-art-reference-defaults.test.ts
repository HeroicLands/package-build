/* SPDX-License-Identifier: GPL-3.0-or-later */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeAddresses } from "../engine/address-values.mjs";
import { assetAddressIndex, readAssetAddress } from "../engine/art-fields.mjs";
import {
    collectContentIndex,
    indexRecordsFor,
    serializeContentIndex,
} from "../engine/content-index.mjs";
import {
    loadForeignIndexes,
    markComplete,
    metadataCacheDir,
    metadataFileName,
} from "../engine/metadata-index.mjs";
import { isNoteRecord } from "../engine/index-records.mjs";
import { configFromData } from "../engine/pack-config.mjs";

let root: string;
let config: ReturnType<typeof configFromData>;
const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
};
const note = (data: object) => `---\n${YAML.stringify(data)}---\n\nA note.\n`;
const model = (shortcode: string, img: string) => ({
    type: "miscgear",
    shortcode,
    name: { full: shortcode },
    data: { kind: "miscgear", img },
});
const subject = (items: object[]) => ({
    type: "being",
    subType: "creature",
    shortcode: "subject",
    name: { full: "Subject" },
    data: { items },
});
function assets(base: string) {
    write(path.join(base, "images", "cart.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    write(
        path.join(base, "images", "provenance.yaml"),
        "attribution: Test\nlicense: CC-BY-4.0\nai: false\n",
    );
}
beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "item-art-defaults-"));
    write(path.join(root, "package.json"), '{"name":"demo","version":"1.0.0"}');
    config = configFromData(
        {
            contentPackage: "demo",
            packageKind: "modules",
            compatibility: { minimum: "14", verified: "14.367" },
            stats: { lastModifiedBy: "itemart000000000" },
            packs: [{ name: "journals", type: "JournalEntry", default: true }],
            relationships: {
                requires: [
                    {
                        id: "foreign",
                        type: "module",
                        manifest: "https://example.invalid/module.json",
                    },
                ],
            },
        },
        path.join(root, "package-build.config.yaml"),
    );
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("item image reference defaults", () => {
    it("resolves local and cached model images and inline images to real assets", () => {
        const foreignTree = path.join(root, "foreign-content");
        const foreignAssets = path.join(root, "foreign-assets");
        assets(foreignAssets);
        write(path.join(foreignTree, "model.md"), note(model("cart", "image-cart")));
        write(
            path.join(foreignTree, "qualified.md"),
            note(model("qualified", "foreign-none-image-cart")),
        );
        const published = collectContentIndex(foreignTree, {
            contentPackage: "foreign",
            skipDirectories: [],
            assetsBase: foreignAssets,
        });
        const cache = metadataCacheDir(config, "foreign", "1.0.0");
        write(path.join(cache, metadataFileName("foreign")), serializeContentIndex(published));
        markComplete(cache);
        const foreign = loadForeignIndexes(config, new Set(["demo"]));
        const content = path.join(root, "content");
        const localAssets = path.join(root, "assets");
        assets(localAssets);
        write(path.join(content, "short.md"), note(model("short", "image-cart")));
        write(path.join(content, "qualified.md"), note(model("qualified", "demo-none-image-cart")));
        write(
            path.join(content, "subject.md"),
            note(
                subject([
                    { key: "short", model: "miscgear-short" },
                    { key: "qualified", model: "miscgear-qualified" },
                    { key: "foreign", model: "foreign-note-miscgear-cart" },
                    { key: "foreignqualified", model: "foreign-note-miscgear-qualified" },
                    { key: "inline", name: "Inline", kind: "miscgear", img: "image-cart" },
                ]),
            ),
        );
        const records = indexRecordsFor({
            contentBase: content,
            assetsBase: localAssets,
            config,
            foreignIndex: foreign.index,
        });
        const entry = records.find(
            (record: any) => isNoteRecord(record) && record.type === "being",
        ) as any;
        const images = encodeAddresses(entry.data.items.map((item: any) => item.img));
        expect(images).toEqual([
            "demo-none-image-cart",
            "demo-none-image-cart",
            "foreign-none-image-cart",
            "foreign-none-image-cart",
            "demo-none-image-cart",
        ]);
        const art = assetAddressIndex(records, { config, foreign });
        for (const image of images)
            expect(readAssetAddress(art, image, "icon", ["icon", "image"]).record).not.toBeNull();
    });
    it("retains explicit systems and reports invalid references", () => {
        const content = path.join(root, "invalid-content");
        const localAssets = path.join(root, "invalid-assets");
        assets(localAssets);
        write(
            path.join(content, "wrong-system.md"),
            note(model("wrongsystem", "demo-note-image-cart")),
        );
        write(path.join(content, "missing.md"), note(model("missing", "image-missing")));
        write(path.join(content, "wrong-kind.md"), note(model("wrongkind", "audio-cart")));
        const problems: any[] = [];
        const records = indexRecordsFor({
            contentBase: content,
            assetsBase: localAssets,
            config,
            problems,
        });
        const art = assetAddressIndex(records, { config });
        const image = (code: string) =>
            encodeAddresses(
                (records.find((r: any) => isNoteRecord(r) && r.shortcode === code) as any).data.img,
            );
        expect(image("wrongsystem")).toBe("demo-note-image-cart");
        expect(readAssetAddress(art, image("wrongsystem"), "icon", ["icon", "image"]).reason).toBe(
            "unresolved",
        );
        expect(readAssetAddress(art, image("missing"), "icon", ["icon", "image"]).reason).toBe(
            "unresolved",
        );
        expect(problems).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    file: path.join(content, "wrong-kind.md"),
                    line: expect.any(Number),
                    column: expect.any(Number),
                    severity: "error",
                    message: expect.stringMatching(/icon or image.*audio/),
                }),
            ]),
        );
    });
});
