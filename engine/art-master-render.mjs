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

/** Render public derivatives of private image masters. */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { readCanonicalKey, renderAddress } from "./address.mjs";
import { writeDerivativeProvenance } from "./art-provenance.mjs";
import { isNoteRecord } from "./index-records.mjs";
import { isGmNote } from "./note-vocabulary.mjs";
import { assertPrivateArtRoots, masterAssetRecords } from "./art-masters.mjs";
import { deriveRecord } from "./art-provenance-core.mjs";
import { artRendererIdentity, cachedArtRender } from "./art-render-cache.mjs";

/**
 * Render private masters under the build directory.
 * @param {ReturnType<import("./art-masters.mjs").collectArtMasters>["masters"]} masters Parsed masters.
 * @param {readonly Record<string, any>[]} records Indexed records.
 * @param {string} outDir Build output directory.
 * @param {string} cacheDir Absolute disposable build cache directory.
 * @returns {Promise<Map<string, string>>} Rendered paths by Address.
 */
export async function renderArtMasters(masters, records, outDir, cacheDir) {
    if (typeof cacheDir !== "string" || !path.isAbsolute(cacheDir))
        throw new Error("an absolute cache directory is required");
    assertPrivateArtRoots(
        [...masters.values()].map((master) => master.file),
        [outDir, cacheDir],
    );
    const notes = new Map();
    for (const record of records) {
        if (!isNoteRecord(record) || isGmNote(record)) continue;
        const tuple = readCanonicalKey(record.address?.canonical);
        if (tuple) notes.set(renderAddress(tuple), record);
    }
    const files = new Map();
    for (const [address, master] of masters) {
        const bytes = fs.readFileSync(master.file);
        const note = notes.get(master.record.primaryNote);
        const publicMaster = { ...master.record, derivedFrom: address };
        if (note) {
            publicMaster.name = note.name?.full;
            publicMaster.primaryNote = master.record.primaryNote;
        }
        const repeat = ["derivedFrom", ...(note ? ["name", "primaryNote"] : [])];
        const options = { repeat, notePublic: Boolean(note) };
        const rendered = await cachedArtRender(
            bytes,
            {
                renderer: artRendererIdentity(import.meta.url),
                codec: sharp.versions,
                format: path.extname(master.file).toLowerCase() === ".png" ? "webp" : "svg",
                metadata: deriveRecord(publicMaster, options),
            },
            cacheDir,
            async () => {
                const input =
                    path.extname(master.file).toLowerCase() === ".png" ?
                        await sharp(bytes).webp().toBuffer()
                    :   bytes;
                return writeDerivativeProvenance(input, publicMaster, options).bytes;
            },
        );
        const target = masterAssetRecords(new Map([[address, master]]))[0].asset.path;
        const file = path.join(outDir, ...target.split("/"));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, rendered);
        files.set(address, file);
    }
    return files;
}
