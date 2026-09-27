/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { defineConfig } from "../content-config.mjs";
import { PDF_IMAGE_INCHES, resamplePdfImages } from "../engine/pdf-images.mjs";

function config(images?: object) {
    return defineConfig({
        rootDir: "/repo",
        contentPackage: "acme",
        foundryPackage: "acme",
        packageKind: "systems",
        compatibility: { minimum: "14.359" },
        stats: { lastModifiedBy: "acmebuilder0000" },
        packs: [{ name: "items", type: "Item" }],
        pdf: { title: "Book", document: "book.yaml", ...(images ? { images } : {}) },
    });
}

describe("PDF image settings", () => {
    it("keeps image staging unchanged without an images block", () => {
        expect(config().pdf.images).toBeNull();
    });

    it("validates defaults, bounds, rules and unknown keys", () => {
        expect(config({}).pdf.images).toMatchObject({ dpi: 150, quality: 82, rules: [] });
        expect(() => config({ dpi: 0 })).toThrow(/pdf.images.dpi/);
        expect(() => config({ quality: 101 })).toThrow(/pdf.images.quality/);
        expect(() => config({ rules: [{ copy: true }] })).toThrow(/match/);
        expect(() => config({ rules: [{ match: "**", copy: "yes" }] })).toThrow(/copy/);
        expect(() => config({ other: true })).toThrow(/pdf.images.other/);
    });
});

describe("PDF raster staging", () => {
    it("shrinks staged art, keeps sources, and applies the first matching rule", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-images-"));
        try {
            const authored = path.join(root, "source.webp");
            const staged = path.join(root, "image.webp");
            const source = await sharp({
                create: {
                    width: 1200,
                    height: 800,
                    channels: 3,
                    background: "#814252",
                },
            })
                .webp({ quality: 95 })
                .toBuffer();
            await fs.writeFile(authored, source);
            await fs.writeFile(staged, source);
            const candidates = new Map([
                [
                    "image",
                    {
                        from: authored,
                        to: "image.webp",
                        relative: "assets/images/portrait.webp",
                        file: "assets/content/person.md",
                        widthInches: PDF_IMAGE_INCHES.medium,
                    },
                ],
            ]);
            const opts = config({
                rules: [
                    { match: "assets/images/**", dpi: 200 },
                    { match: "assets/images/portrait.webp", copy: true },
                ],
            }).pdf.images;
            const reports = await resamplePdfImages(candidates, opts, root);
            const output = await fs.readFile(staged);
            expect(output.length).toBeLessThan(source.length);
            expect((await sharp(output).metadata()).width).toBe(
                Math.round(PDF_IMAGE_INCHES.medium * 200),
            );
            expect(await fs.readFile(authored)).toEqual(source);
            expect(reports).toHaveLength(1);
            expect(reports[0].file).toBe("assets/content/person.md");

            await fs.writeFile(staged, source);
            const copied = await resamplePdfImages(
                candidates,
                config({ rules: [{ match: "assets/images/**", copy: true }] }).pdf.images,
                root,
            );
            expect(copied).toHaveLength(0);
            expect(await fs.readFile(staged)).toEqual(source);
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });
});
