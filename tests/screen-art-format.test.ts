/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { screenRasterFormat } from "../engine/art-masters.mjs";

describe("screen raster format", () => {
    it.each([
        [255, "jpeg"],
        [254, "webp"],
        [0, "webp"],
    ])("selects from the actual alpha sample %i", (alpha, expected) => {
        const image = new PNG({ width: 1, height: 1 });
        image.data.set([80, 120, 160, alpha]);
        expect(screenRasterFormat(PNG.sync.write(image))).toBe(expected);
    });
});
