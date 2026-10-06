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
import {
    BOOK_ICON_WIDTH_IN,
    BOOK_ROLE_SLOTS,
    PDF_IMAGE_INCHES,
    PDF_PAGE,
    bookImageWidthIn,
    pdfColumnWidth,
    pdfTextWidth,
    resamplePdfImages,
} from "../engine/pdf-images.mjs";
import { BOOK_IMAGE_WIDTHS, bookTypstPreamble } from "../engine/pdf-render.mjs";

describe("PDF raster staging", () => {
    it("uses the same named widths and page geometry as Typst", () => {
        for (const [name, inches] of Object.entries(PDF_IMAGE_INCHES)) {
            expect(parseFloat(BOOK_IMAGE_WIDTHS[name]) / 2.54).toBeCloseTo(inches);
        }
        const preamble = bookTypstPreamble();
        expect(Number(preamble.match(/#let book-margin = ([\d.]+)cm/)?.[1]) / 2.54).toBeCloseTo(
            PDF_PAGE.margin,
        );
        expect(preamble).toContain(`#let book-page-width = ${PDF_PAGE.width}in`);
        expect(preamble).toContain(`#let book-page-height = ${PDF_PAGE.height}in`);
    });

    it("uses the printed width at 300 dpi, preserving authored art", async () => {
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
            const candidate = {
                from: authored,
                to: "image.webp",
                relative: "assets/images/portrait.webp",
                file: "assets/content/person.md",
                uses: [{ width: PDF_IMAGE_INCHES.medium, height: 8 }],
            };
            const reports = await resamplePdfImages(new Map([["image", candidate]]), root);
            const output = await fs.readFile(staged);
            expect(output.length).toBeLessThan(source.length);
            expect((await sharp(output).metadata()).width).toBe(
                Math.round(PDF_IMAGE_INCHES.medium * PDF_PAGE.dpi),
            );
            expect(await fs.readFile(authored)).toEqual(source);
            expect(reports).toHaveLength(1);
            expect(reports[0].file).toBe("assets/content/person.md");
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    it("keeps a small image and uses the largest placement of a repeated image", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-images-"));
        try {
            const file = path.join(root, "image.webp");
            const source = await sharp({
                create: {
                    width: 500,
                    height: 300,
                    channels: 3,
                    background: "#724638",
                },
            })
                .webp()
                .toBuffer();
            await fs.writeFile(file, source);
            const candidate = {
                from: file,
                to: "image.webp",
                relative: "images/image.webp",
                file,
                uses: [
                    { width: PDF_IMAGE_INCHES.small, height: 8 },
                    { width: pdfColumnWidth(2), height: 8 },
                ],
            };
            expect(await resamplePdfImages(new Map([["image", candidate]]), root)).toHaveLength(0);
            expect(await fs.readFile(file)).toEqual(source);
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });
});

describe("a picture's role sets the book's maximum, never its target", () => {
    it("draws a role-bearing picture whose pixels fill its slot at the slot", () => {
        for (const [role, fraction] of Object.entries(BOOK_ROLE_SLOTS)) {
            const slot = fraction * pdfTextWidth;
            const pixels = Math.ceil(slot * PDF_PAGE.dpi) + 400;
            expect(bookImageWidthIn({ type: "image", role, width: pixels })).toBeCloseTo(slot);
        }
    });

    it("draws a role-bearing picture whose pixels fall short at what its pixels support", () => {
        const fraction = BOOK_ROLE_SLOTS.portrait;
        const slot = fraction * pdfTextWidth;
        const shortPixels = Math.round(slot * PDF_PAGE.dpi * 0.5);
        expect(
            bookImageWidthIn({ type: "image", role: "portrait", width: shortPixels }),
        ).toBeCloseTo(shortPixels / PDF_PAGE.dpi);
    });

    it("draws a vector at its role's slot, having no pixel count to limit it", () => {
        for (const [role, fraction] of Object.entries(BOOK_ROLE_SLOTS)) {
            expect(bookImageWidthIn({ type: "image", role, width: "" })).toBeCloseTo(
                fraction * pdfTextWidth,
            );
        }
    });

    it("draws an icon-type picture at the medium's nominal icon width, not a role's slot", () => {
        expect(bookImageWidthIn({ type: "icon", role: "portrait", width: 4000 })).toBe(
            BOOK_ICON_WIDTH_IN,
        );
        expect(bookImageWidthIn({ type: "icon", width: "" })).toBe(BOOK_ICON_WIDTH_IN);
    });

    it("leaves a picture declaring no role to the medium's ordinary size", () => {
        expect(bookImageWidthIn({ type: "image", width: 4000 })).toBeUndefined();
        expect(bookImageWidthIn()).toBeUndefined();
    });
});
