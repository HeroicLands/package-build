/* SPDX-License-Identifier: GPL-3.0-or-later */

import { expect, it } from "vitest";
import sharp from "sharp";
import { renderPdfMaster } from "../engine/pdf-images.mjs";
import {
    checkProvenance,
    readJpegProvenance,
    writeProvenance,
    writeSvgProvenance,
} from "../engine/art-provenance.mjs";

it("renders master-derived editions with public trace and a white matte", async () => {
    const raw = await sharp({
        create: { width: 600, height: 400, channels: 4, background: "#00000000" },
    })
        .png()
        .toBuffer();
    const record = {
        address: "sample-note-image-portrait",
        creator: "Artist",
        rights: "Rights",
        prompt: "private prompt",
        generator: '{"model":"private"}',
        primaryNote: "sample-note-being-subject",
        name: "Private name",
    };
    const master = writeProvenance(raw, record).bytes;
    const screen = await renderPdfMaster(
        master,
        record,
        [{ width: 2, height: 4 }],
        "screen",
        false,
    );
    const print = await renderPdfMaster(master, record, [{ width: 2, height: 4 }], "print", false);
    expect((await sharp(screen).metadata()).width).toBe(300);
    expect((await sharp(print).metadata()).width).toBe(600);
    expect((await sharp(screen).removeAlpha().raw().toBuffer())[0]).toBeGreaterThan(250);
    const metadata = readJpegProvenance(screen).record;
    expect(metadata).toMatchObject({
        address: record.address,
        derived: "true",
        derivedFrom: record.address,
        creator: "Artist",
        rights: "Rights",
    });
    expect(metadata).not.toHaveProperty("prompt");
    expect(metadata).not.toHaveProperty("generator");
    expect(metadata).not.toHaveProperty("primaryNote");
    expect(metadata).not.toHaveProperty("name");
    expect(
        checkProvenance([
            { file: "master.png", bytes: master },
            { file: "screen.jpg", bytes: screen },
        ]),
    ).toEqual([]);
    expect(
        await renderPdfMaster(master, record, [{ width: 2, height: 4 }], "screen", false),
    ).toEqual(screen);
    const exif = Buffer.from([0xff, 0xe1, 0, 8, 0x45, 0x78, 0x69, 0x66, 0, 0]);
    const contaminated = Buffer.concat([screen.subarray(0, 2), exif, screen.subarray(2)]);
    expect(
        checkProvenance([
            { file: "master.png", bytes: master },
            { file: "screen.jpg", bytes: contaminated },
        ]).map((finding) => finding.message),
    ).toContain("JPEG carries foreign metadata");
});

it("renders an SVG master and keeps public note identity only when authorized", async () => {
    const record = {
        address: "sample-none-image-mark",
        primaryNote: "sample-note-being-subject",
        name: "Subject",
        license: "CC-BY-SA-4.0",
        prompt: "private",
    };
    const svg = writeSvgProvenance(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>',
        record,
    ).bytes;
    const jpeg = await renderPdfMaster(svg, record, [{ width: 3, height: 3 }], "screen", true);
    expect((await sharp(jpeg).metadata()).width).toBe(100);
    expect(readJpegProvenance(jpeg).record).toMatchObject({
        name: "Subject",
        primaryNote: record.primaryNote,
        license: record.license,
    });
    expect(readJpegProvenance(jpeg).record).not.toHaveProperty("prompt");
    expect(
        checkProvenance([
            { file: "master.svg", bytes: svg },
            { file: "edition.jpg", bytes: jpeg },
        ]),
    ).toEqual([]);
});

it("rejects a JPEG without its master trace", async () => {
    const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } })
        .jpeg()
        .toBuffer();
    expect(
        checkProvenance([{ file: "edition.jpg", bytes }]).map((finding) => finding.message),
    ).toContain("JPEG hl:derivedfrom must name its master address");
});
