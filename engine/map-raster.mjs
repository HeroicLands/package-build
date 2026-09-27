/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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
    const args = ["--width", String(width), "--height", String(height), "--output", staged, source];
    const result = spawnSync("rsvg-convert", args, { encoding: "utf8" });
    if (result.error?.code === "ENOENT") {
        throw new Error(
            "SVG Scene backgrounds need `rsvg-convert` (install `librsvg` with Homebrew or the system package manager)",
        );
    }
    if (result.error || result.status !== 0) {
        throw new Error(
            `could not rasterize map SVG "${foundryPath}": ${result.error?.message ?? String(result.stderr).trim()}`,
        );
    }
    return `${config.packageKind}/${config.foundryPackage.id}/assets/maps/rasterized/${sceneId}.png`;
}
