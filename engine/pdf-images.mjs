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

/** Physical image widths in inches. Auto and full-width use the page's text area. */
export const PDF_IMAGE_INCHES = Object.freeze({
    auto: 7,
    small: 1.6 / 2.54,
    medium: 3.2 / 2.54,
    large: 5.6 / 2.54,
    xlarge: 8 / 2.54,
    "full-width": 7,
});

/**
 * Optimize staged raster images without changing their authored files.
 *
 * @param {Map<string, {from: string, to: string, file: string, widthInches: number}>} candidates
 * @param {object} options - Validated `pdf.images` settings.
 * @param {string} outDir - PDF staging directory.
 * @returns {Promise<object[]>} Image reports with the authored file location.
 */
export async function resamplePdfImages(candidates, options, outDir) {
    const reports = [];
    for (const candidate of candidates.values()) {
        const extension = path.extname(candidate.to).toLowerCase();
        if (![".jpg", ".jpeg", ".png", ".webp", ".avif"].includes(extension)) continue;
        const relative = candidate.relative.replaceAll(path.sep, "/");
        const rule = options.rules.find(({ match }) => path.matchesGlob(relative, match));
        if (rule?.copy) continue;
        const dpi = rule?.dpi ?? options.dpi;
        const quality = rule?.quality ?? options.quality;
        const destination = path.join(outDir, candidate.to);
        const original = await fs.readFile(destination);
        const metadata = await sharp(original).metadata();
        if (!metadata.width || !metadata.height) continue;
        const target = Math.round(candidate.widthInches * dpi);
        if (metadata.width <= target) continue;
        let pipeline = sharp(original).resize({ width: target, withoutEnlargement: true });
        if (extension === ".jpg" || extension === ".jpeg") pipeline = pipeline.jpeg({ quality });
        if (extension === ".webp") pipeline = pipeline.webp({ quality });
        if (extension === ".avif") pipeline = pipeline.avif({ quality });
        if (extension === ".png") pipeline = pipeline.png();
        const output = await pipeline.toBuffer();
        if (output.length >= original.length) continue;
        await fs.writeFile(destination, output);
        reports.push({
            file: candidate.file,
            message: `book image ${relative}: ${metadata.width}×${metadata.height} → ${target} px wide; ${original.length} → ${output.length} bytes`,
        });
    }
    return reports;
}
