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

it("accepts sanitized JPEG public provenance and refuses injected EXIF", async () => {
    const { default: sharp } = await import("sharp");
    const { renderPdfMaster } = await import("../engine/pdf-images.mjs");
    const { inspectPublicDerivative } = await import("../engine/art-public-derivative.mjs");
    const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } })
        .png()
        .toBuffer();
    const record = { address: "sample-none-image-example", creator: ["Artist"], rights: "Terms" };
    const jpeg = await renderPdfMaster(png, record, [{ width: 1, height: 1 }], "screen", false);
    expect(inspectPublicDerivative("example.jpg", jpeg, "sample").metadata.address).toBe(
        record.address,
    );
    const exif = Buffer.from([0xff, 0xe1, 0, 8, 0x45, 0x78, 0x69, 0x66, 0, 0]);
    expect(() =>
        inspectPublicDerivative(
            "example.jpg",
            Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]),
            "sample",
        ),
    ).toThrow();
    expect(() => inspectPublicDerivative("example.webp", jpeg, "sample")).toThrow();
});

it("keeps verified screen bytes unchanged during PDF image preparation", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const { resamplePdfImages } = await import("../engine/pdf-images.mjs");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "screen-pdf-"));
    try {
        const original = Buffer.from("captured bytes");
        await fs.mkdir(path.join(root, "images"));
        const file = path.join(root, "images", "example.jpg");
        await fs.writeFile(file, original);
        const candidates = new Map([
            [
                "example",
                {
                    from: file,
                    to: "images/example.jpg",
                    relative: "images/example.jpg",
                    file,
                    uses: [{ width: 1, height: 1 }],
                    screen: () => original,
                },
            ],
        ]);
        expect(
            await resamplePdfImages(candidates, root, "screen", path.join(root, "cache")),
        ).toEqual([]);
        expect(await fs.readFile(file)).toEqual(original);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

it("indexes and renders one public screen file using actual transparency", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const { collectArtMasters, masterAssetRecords } = await import("../engine/art-masters.mjs");
    const { renderArtMasters } = await import("../engine/art-master-render.mjs");
    const { writeProvenance } = await import("../engine/art-provenance.mjs");
    const { inspectPublicDerivative } = await import("../engine/art-public-derivative.mjs");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "screen-art-"));
    try {
        const mastersDir = path.join(root, "private");
        await fs.mkdir(mastersDir);
        for (const [shortcode, alpha, type] of [
            ["opaque", 255, "icon"],
            ["translucent", 100, "image"],
        ] as const) {
            const png = new PNG({ width: 1, height: 1 });
            png.data.set([120, 60, 30, alpha]);
            const address = `sample-none-${type}-${shortcode}`;
            const master = writeProvenance(PNG.sync.write(png), {
                address,
                creator: ["Artist"],
                rights: "Terms",
                ai: false,
            }).bytes;
            await fs.writeFile(path.join(mastersDir, `${shortcode}.png`), master);
        }
        const collected = collectArtMasters([mastersDir], "sample");
        expect(collected.findings).toEqual([]);
        const records = masterAssetRecords(collected.masters);
        expect(records.map((row) => row.asset.path).sort()).toEqual([
            "icons/opaque.jpg",
            "images/translucent.webp",
        ]);
        const files = await renderArtMasters(
            collected.masters,
            records,
            path.join(root, "out"),
            path.join(root, "cache"),
        );
        expect(files.size).toBe(2);
        for (const row of records) {
            const bytes = await fs.readFile(files.get(row.address.canonical)!);
            expect(inspectPublicDerivative(row.asset.path, bytes, "sample").metadata.address).toBe(
                row.address.canonical,
            );
        }
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
