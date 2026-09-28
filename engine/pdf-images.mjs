/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE.md file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/** Print geometry in inches; Typst's default column gutter is 4% of the text width. */
export const PDF_PAGE = Object.freeze({
    width: 8.5,
    height: 11,
    margin: 1.9 / 2.54,
    dpi: 300,
    quality: 82,
});

/** Named image widths in inches, matching the book renderer's Typst sizes. */
export const PDF_IMAGE_INCHES = Object.freeze({
    small: 1.6 / 2.54,
    medium: 3.2 / 2.54,
    large: 5.6 / 2.54,
    xlarge: 8 / 2.54,
});

/** Usable width of a portrait page in inches. */
export const pdfTextWidth = PDF_PAGE.width - 2 * PDF_PAGE.margin;
/** Usable height of a portrait page in inches. */
export const pdfTextHeight = PDF_PAGE.height - 2 * PDF_PAGE.margin;
/** Width of a portrait page's text column in inches. */
export const pdfColumnWidth = (columns = 2) =>
    (pdfTextWidth * (1 - 0.04 * (columns - 1))) / columns;

/**
 * Optimize staged raster images without changing their authored files.
 *
 * @param {Map<string, {from: string, to: string, relative: string, file: string,
 *   uses: Array<{width: number, height: number}>}>} candidates
 * @param {string} outDir - PDF staging directory.
 * @returns {Promise<object[]>} Image reports with the authored file location.
 */
export async function resamplePdfImages(candidates, outDir) {
    const reports = [];
    for (const candidate of candidates.values()) {
        const extension = path.extname(candidate.to).toLowerCase();
        if (![".jpg", ".jpeg", ".png", ".webp", ".avif"].includes(extension)) continue;
        const relative = candidate.relative.replaceAll(path.sep, "/");
        const destination = path.join(outDir, candidate.to);
        const original = await fs.readFile(destination);
        const metadata = await sharp(original).metadata();
        if (!metadata.width || !metadata.height) continue;
        const ratio = metadata.width / metadata.height;
        const target = Math.round(
            Math.max(
                ...candidate.uses.map(({ width, height }) => Math.min(width, height * ratio)),
            ) * PDF_PAGE.dpi,
        );
        if (metadata.width <= target) continue;
        let pipeline = sharp(original).resize({ width: target, withoutEnlargement: true });
        if (extension === ".jpg" || extension === ".jpeg")
            pipeline = pipeline.jpeg({ quality: PDF_PAGE.quality });
        if (extension === ".webp") pipeline = pipeline.webp({ quality: PDF_PAGE.quality });
        if (extension === ".avif") pipeline = pipeline.avif({ quality: PDF_PAGE.quality });
        if (extension === ".png") pipeline = pipeline.png();
        const output = await pipeline.toBuffer();
        await fs.writeFile(destination, output);
        reports.push({
            file: candidate.file,
            message: `book image ${relative}: ${metadata.width}×${metadata.height} → ${target} px wide; ${original.length} → ${output.length} bytes`,
        });
    }
    return reports;
}
