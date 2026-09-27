/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

/** Rasterize an authored SVG map into the staged Foundry package. */
export function rasterizeMapSvg({ foundryPath, width, height, sceneId, config }) {
    if (!config) throw new Error("SVG map rasterization requires the package build configuration");
    if (![width, height].every((value) => Number.isInteger(value) && value > 0)) {
        throw new Error("an SVG map needs `sohl.dimensions: [width, height]` in whole pixels");
    }
    const marker = "/assets/";
    const at = foundryPath.indexOf(marker);
    if (at < 0 || !foundryPath.toLowerCase().endsWith(".svg")) {
        throw new Error(`map art path "${foundryPath}" is not an SVG inside assets`);
    }
    const suffix = foundryPath.slice(at + marker.length);
    const source = path.resolve(config.rootDir, "assets", suffix);
    const assetRoot = path.resolve(config.rootDir, "assets");
    if (!source.startsWith(`${assetRoot}${path.sep}`) || !fs.existsSync(source)) {
        throw new Error(`map SVG "${foundryPath}" is not a local asset this package can rasterize`);
    }
    const staged = path.resolve(
        config.rootDir,
        config.packageBuild.stageDir,
        "assets/maps/rasterized",
        `${sceneId}.png`,
    );
    fs.mkdirSync(path.dirname(staged), { recursive: true });
    try {
        const image = new Resvg(fs.readFileSync(source), {
            fitTo: { mode: "width", value: width },
        }).render();
        if (image.height !== height) {
            throw new Error(
                `the SVG is ${width}×${image.height} at the stated width, not ${width}×${height}`,
            );
        }
        fs.writeFileSync(staged, image.asPng());
    } catch (error) {
        throw new Error(`could not rasterize map SVG "${foundryPath}": ${error.message}`, {
            cause: error,
        });
    }
    return `${config.packageKind}/${config.foundryPackage.id}/assets/maps/rasterized/${sceneId}.png`;
}
