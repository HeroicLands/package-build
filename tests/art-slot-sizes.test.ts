/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * The size an art slot is cut to.
 *
 * A hero image fills one fixed strip wherever it is drawn, so the `banner`
 * slot states one size and a picture of another size is refused against it.
 * Every other slot states none: an icon is drawn at a nominal size whatever
 * its file holds, a map's background sets its own scene's dimensions, and a
 * picture written in prose is fitted to the room it has.
 *
 * The size is read from {@link module:engine/art-slots.ART_SLOTS}, so a slot
 * gaining one is checked here with no second edit.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { ART_SLOTS } from "../engine/art-slots.mjs";
import { checkArtSlotSizes } from "../engine/art-fields.mjs";
import { PROVENANCE_FILE, collectAssetRecords } from "../engine/asset-index.mjs";

/** The size the `banner` slot states, read rather than restated here. */
const BANNER = ART_SLOTS.find((slot) => slot.key === "banner").size;

/** A minimal PNG whose header states the given pixel size, nothing else. */
function pngBytes(width: number, height: number): Buffer {
    const signature = Buffer.from("89504e470d0a1a0a", "hex");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(13, 0);
    const w = Buffer.alloc(4);
    w.writeUInt32BE(width, 0);
    const h = Buffer.alloc(4);
    h.writeUInt32BE(height, 0);
    return Buffer.concat([signature, length, Buffer.from("IHDR", "ascii"), w, h]);
}

/** An asset tree holding one picture at the size given, and its provenance. */
function treeWith(shortcode: string, width: number, height: number): string {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "cb-art-slot-size-"));
    fs.mkdirSync(path.join(base, "images"), { recursive: true });
    fs.writeFileSync(
        path.join(base, "images", PROVENANCE_FILE),
        "attribution: Tom Rodriguez\nlicense: CC-BY-SA-4.0\n",
    );
    fs.writeFileSync(path.join(base, "images", `${shortcode}.png`), pngBytes(width, height));
    return base;
}

/** A note record as the index carries one, naming a picture at a slot. */
function noteNaming(slot: string, value: string) {
    return { type: "place", data: { [slot]: value } };
}

/** Every record the check reads: one note and one package's assets. */
function corpus(base: string, note: object) {
    return [note, ...collectAssetRecords(base, { contentPackage: "sohl" })];
}

describe("the size a hero image is cut to", () => {
    it("states one size on the banner slot and none on any other", () => {
        expect(BANNER).toEqual({ width: 1792, height: 768 });
        const sized = ART_SLOTS.filter((slot) => slot.size).map((slot) => slot.key);
        expect(sized).toEqual(["banner"]);
    });

    it("refuses a hero image that is not that size, naming both", () => {
        const base = treeWith("dawn", 1024, 1024);
        const findings = checkArtSlotSizes(corpus(base, noteNaming("banner", "image-dawn")), {
            config: { contentPackage: "sohl" },
        });

        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].file).toMatch(/dawn\.png$/);
        expect(findings[0].message).toMatch(/1024×1024/);
        expect(findings[0].message).toMatch(/1792×768/);
        expect(findings[0].message).toMatch(/banner/);
    });

    it("accepts a hero image at that size", () => {
        const base = treeWith("dawn", BANNER.width, BANNER.height);
        expect(
            checkArtSlotSizes(corpus(base, noteNaming("banner", "image-dawn")), {
                config: { contentPackage: "sohl" },
            }),
        ).toEqual([]);
    });

    it("asks nothing of a picture named at a slot that states no size", () => {
        const base = treeWith("hearthmoor", 3000, 1800);
        expect(
            checkArtSlotSizes(corpus(base, noteNaming("bgImage", "image-hearthmoor")), {
                config: { contentPackage: "sohl" },
            }),
        ).toEqual([]);
    });

    it("asks nothing of a note naming no art at all", () => {
        const base = treeWith("dawn", 1024, 1024);
        expect(
            checkArtSlotSizes(corpus(base, { type: "place", data: {} }), {
                config: { contentPackage: "sohl" },
            }),
        ).toEqual([]);
    });

    it("measures no vector, which carries no pixel size to compare", () => {
        const base = fs.mkdtempSync(path.join(os.tmpdir(), "cb-art-slot-svg-"));
        fs.mkdirSync(path.join(base, "images"), { recursive: true });
        fs.writeFileSync(
            path.join(base, "images", PROVENANCE_FILE),
            "attribution: Tom Rodriguez\nlicense: CC-BY-SA-4.0\n",
        );
        fs.writeFileSync(path.join(base, "images", "dawn.svg"), '<svg viewBox="0 0 10 10"></svg>');
        expect(
            checkArtSlotSizes(corpus(base, noteNaming("banner", "image-dawn")), {
                config: { contentPackage: "sohl" },
            }),
        ).toEqual([]);
    });
});
