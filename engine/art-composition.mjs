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

import { readCanonicalKey } from "./address.mjs";
import { isAddressSegment } from "./address-charset.mjs";

/**
 * Ordered, private image sources with an optional rendering recipe. All layers use source-over blending on a
 * transparent sRGB canvas; resize stretches to the exact layer dimensions.
 * @typedef {object} ArtComposition
 * @property {"over-v1"} [recipe] Closed rendering algorithm.
 * @property {number} [width] Canvas width in pixels.
 * @property {number} [height] Canvas height in pixels.
 * @property {{address:string,width?:number,height?:number,left?:number,top?:number,kernel?:"nearest"|"cubic"|"mitchell"|"lanczos2"|"lanczos3"}[]} layers Layers, bottom first.
 */

const maxPixels = 16_777_216;
const kernels = new Set(["nearest", "cubic", "mitchell", "lanczos2", "lanczos3"]);

/**
 * Validate and normalize a closed recipe without interpreting source prose.
 * @param {unknown} value Authored recipe.
 * @returns {ArtComposition} A copy with stable property order.
 */
export function validateComposition(value) {
    const fail = (message) => {
        throw new Error(`composition: ${message}`);
    };
    const object = (input, keys, label) => {
        if (!input || typeof input !== "object" || Array.isArray(input))
            fail(`${label} must be an object`);
        for (const key of Object.keys(input))
            if (!keys.includes(key)) fail(`${label}.${key} is unknown`);
        for (const key of keys) if (!Object.hasOwn(input, key)) fail(`${label}.${key} is required`);
        return input;
    };
    const integer = (input, label, minimum) => {
        if (!Number.isSafeInteger(input) || input < minimum)
            fail(`${label} must be a safe integer >= ${minimum}`);
        return input;
    };
    const dimensions = (input, label) => {
        const width = integer(input.width, `${label}.width`, 1);
        const height = integer(input.height, `${label}.height`, 1);
        if (width > maxPixels / height) fail(`${label} exceeds ${maxPixels} pixels`);
        return { width, height };
    };
    const rendering = value !== null && typeof value === "object" && Object.hasOwn(value, "recipe");
    const recipe = object(
        value,
        rendering ? ["recipe", "width", "height", "layers"] : ["layers"],
        "composition",
    );
    if (rendering && recipe.recipe !== "over-v1") fail("recipe must be over-v1");
    const { width, height } =
        rendering ? dimensions(recipe, "canvas") : { width: undefined, height: undefined };
    if (!Array.isArray(recipe.layers) || recipe.layers.length < 1 || recipe.layers.length > 32)
        fail("layers must contain 1 to 32 entries");
    const seen = new Set();
    const layers = recipe.layers.map((input, index) => {
        const label = `layers[${index}]`;
        const layer = object(
            input,
            rendering ? ["address", "width", "height", "left", "top", "kernel"] : ["address"],
            label,
        );
        const address =
            typeof layer.address === "string" ? readCanonicalKey(layer.address) : undefined;
        if (
            !address ||
            !Object.values(address).every(isAddressSegment) ||
            address.system !== "none" ||
            !["image", "icon"].includes(address.type)
        )
            fail(`${label}.address must be a complete image or icon Address`);
        if (seen.has(layer.address)) fail(`duplicate component ${layer.address}`);
        seen.add(layer.address);
        if (!rendering) return { address: layer.address };
        const size = dimensions(layer, label);
        const left = integer(layer.left, `${label}.left`, 0),
            top = integer(layer.top, `${label}.top`, 0);
        if (left > width - size.width || top > height - size.height)
            fail(`${label} lies outside the canvas`);
        if (!kernels.has(layer.kernel)) fail(`${label}.kernel is unknown`);
        return { address: layer.address, ...size, left, top, kernel: layer.kernel };
    });
    return rendering ? { recipe: "over-v1", width, height, layers } : { layers };
}

/**
 * Check addressed recipe sources without publishing component records.
 * @param {Map<string, {file:string,record:import('./art-provenance-core.mjs').ProvenanceRecord}[]>} sources All canonical inputs, including duplicates.
 * @returns {import('./art-provenance-core.mjs').ProvenanceFinding[]} Located findings.
 */
export function checkCompositionSources(sources) {
    const findings = [];
    const add = (file, message) =>
        findings.push({ file, line: 1, column: 1, severity: "error", message });
    for (const [address, entries] of sources)
        for (const { file, record } of entries) {
            if (record.composition === undefined) continue;
            let recipe;
            try {
                recipe = validateComposition(record.composition);
            } catch (error) {
                add(file, error.message);
                continue;
            }
            for (const layer of recipe.layers) {
                if (layer.address === address) {
                    add(file, `composition: component cannot reference itself: ${address}`);
                    continue;
                }
                const matches = sources.get(layer.address);
                if (!matches?.length) add(file, `composition: missing component ${layer.address}`);
                else if (matches.length !== 1)
                    add(file, `composition: duplicate component ${layer.address}`);
                else if (matches[0].record.composition !== undefined)
                    add(
                        file,
                        `composition: component ${layer.address} must be a source image without a recipe`,
                    );
            }
        }
    return findings;
}

/**
 * Render a declared recipe to PNG bytes for comparison with a retained master.
 * This does not write or replace a source. The caller supplies addressed inputs.
 * @param {ArtComposition} input Validated composition.
 * @param {Map<string,{file:string,record:import('./art-provenance-core.mjs').ProvenanceRecord}>} sources Addressed source inputs.
 * @returns {Promise<Buffer>} PNG bytes without provenance.
 */
export async function renderComposition(input, sources) {
    const recipe = validateComposition(input);
    if (recipe.recipe === undefined)
        throw new Error("composition: recipe is required for rendering");
    const [
        { default: sharp },
        { default: fs },
        { readProvenance, readSvgProvenance, sniffFormat },
    ] = await Promise.all([
        import("sharp"),
        import("node:fs"),
        import("./art-provenance-core.mjs"),
    ]);
    const layers = [];
    for (const layer of recipe.layers) {
        const source = sources.get(layer.address);
        if (!source) throw new Error(`composition: missing component ${layer.address}`);
        const bytes = fs.readFileSync(source.file);
        const format = sniffFormat(bytes);
        if (!["png", "svg"].includes(format))
            throw new Error(`composition: component ${layer.address} must be PNG or SVG`);
        const { record } = format === "png" ? readProvenance(bytes) : readSvgProvenance(bytes);
        if (
            record.address !== layer.address ||
            record.identifier !== layer.address ||
            record.derived !== undefined ||
            record.composition !== undefined
        )
            throw new Error(
                `composition: component ${layer.address} must have matching canonical source identity`,
            );
        const rendered = await sharp(bytes, { limitInputPixels: maxPixels })
            .toColourspace("srgb")
            .resize(layer.width, layer.height, { fit: "fill", kernel: layer.kernel })
            .ensureAlpha()
            .png()
            .toBuffer();
        layers.push({ input: rendered, left: layer.left, top: layer.top, blend: "over" });
    }
    return sharp({
        create: {
            width: recipe.width,
            height: recipe.height,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
    })
        .composite(layers)
        .png()
        .toBuffer();
}
