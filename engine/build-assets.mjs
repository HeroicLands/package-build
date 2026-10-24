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

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadPackageBuildConfig } from "../config.mjs";
import { loadPackConfig, packConfigPath } from "./pack-config.mjs";
import { checkForeignAssetBindings } from "./asset-bindings.mjs";
import { formatDiagnostic, positionOfYamlPath } from "./diagnostics.mjs";
import { stageAssets } from "../stage.mjs";
import { rowsStagingPictureRoots, stagePackageAssets } from "./asset-shipping.mjs";
import { baseStyleStageEntry } from "./base-styles.mjs";
import { checkScriptFonts, copyScriptFonts, STAGED_FONTS_DIR } from "./script-font-delivery.mjs";

/**
 * A finding for each `packageBuild.assets` row that would stage a picture root
 * itself, located at the row's `from` when the configuration is YAML.
 *
 * @param {readonly {from: string, to: string}[]} rows - The configured rows.
 * @param {{rootDir: string, assetsBase: string}} opts - Where they resolve.
 * @returns {object[]} The findings.
 */
function pictureRootRowFindings(rows, { rootDir, assetsBase }) {
    const offending = rowsStagingPictureRoots(rows, { rootDir, assetsBase });
    if (!offending.length) return [];
    const file = packConfigPath();
    const text =
        file.endsWith(".yaml") || file.endsWith(".yml") ? fs.readFileSync(file, "utf8") : "";
    return offending.map(({ index, from, root }) => ({
        file,
        ...(text ? positionOfYamlPath(text, ["packageBuild", "assets", index, "from"]) : {}),
        severity: "error",
        message:
            `\`packageBuild.assets[${index}]\` copies \`${from}\`, which reaches ${root}/ — ` +
            "the stage copies the icon and image roots itself, flat and filtered by " +
            "each file's provenance, so a row copying them would ship every file " +
            "unfiltered. Remove the row",
    }));
}

/**
 * The repository's `packageBuild.assetTransform`, loaded.
 *
 * One loader for every command that writes a picture, so the stage and the CDN
 * hold the same bytes for the same file.
 *
 * @param {object} config - The resolved package-build configuration.
 * @returns {Promise<((sourcePath: string) => string|null|undefined)|undefined>}
 *   The transform, or `undefined` when the repository names none.
 */
export async function loadAssetTransform(config) {
    if (!config.assetTransform) return undefined;
    const module = await import(pathToFileURL(config.assetTransform).href).catch((err) => {
        throw new Error(
            `cannot load \`packageBuild.assetTransform\` (${config.assetTransform}): ${err.message}`,
        );
    });
    const transform = module.transform;
    if (typeof transform !== "function") {
        throw new Error(
            `\`packageBuild.assetTransform\` ` +
                `(${config.assetTransform}) exports no \`transform\` ` +
                `function. It must export ` +
                `\`transform(sourcePath) -> string | null\`.`,
        );
    }
    return transform;
}

/**
 * Stage static files, provenance-filtered pictures, base styles and fonts.
 * @param {object} [options]
 * @param {ReturnType<typeof loadPackageBuildConfig>} [options.config]
 * @param {import("../content-config.mjs").ContentBuildConfig} [options.packConfig]
 * @param {import("./content-session.mjs").ContentSession} [options.session]
 */
export async function stagePackageBuildAssets({
    config = loadPackageBuildConfig(),
    packConfig = loadPackConfig(),
    session,
} = {}) {
    const assetsBase = packConfig.paths.assets;
    const findings = [
        ...pictureRootRowFindings(config.assets, {
            rootDir: config.rootDir,
            assetsBase,
        }),
        ...checkForeignAssetBindings(packConfig, { assets: config.assets }),
    ];
    if (findings.length) {
        const error = new Error(findings.map(formatDiagnostic).join("\n"));
        error.located = true;
        throw error;
    }

    const transform = await loadAssetTransform(config);

    // `to:` is relative to the staged package root, so a
    // repository's table reads `lang`, not `build/stage/lang`.
    const entries = config.assets.map(({ from, to }) => [from, path.join(config.stageDir, to)]);
    let { entries: count, files } = stageAssets(entries, {
        cwd: config.rootDir,
        transform,
    });

    // The picture roots, staged by the toolchain rather than by a row:
    // flat, filtered by each file's provenance, and listed in the
    // package's asset set.
    const pictures = stagePackageAssets({
        assetsBase,
        contentPackage: packConfig.contentPackage,
        stageDir: path.resolve(config.rootDir, config.stageDir),
        // The manifest's title names the set; a package with none is
        // named by its content package.
        title:
            typeof config.manifest?.title === "string" && config.manifest.title.trim() ?
                config.manifest.title
            :   packConfig.contentPackage,
        transform,
        shippingLicenses: config.shippingLicenses,
    });
    if (pictures.findings.length) {
        const error = new Error(pictures.findings.map(formatDiagnostic).join("\n"));
        error.located = true;
        throw error;
    }
    files += pictures.staged.length;
    if (pictures.staged.length || pictures.excluded.length) {
        console.log(
            `Pictures: ${pictures.staged.length} staged, ` +
                `${pictures.excluded.length} left out by provenance.`,
        );
    }

    // Staged in its own pass, without the repository's transform: the
    // sheet is this toolchain's file rather than one of the
    // repository's assets, and a `transform` written to retheme a
    // package's own SVGs has no business being handed it.
    if (config.baseStyles) {
        const staged = stageAssets([baseStyleStageEntry(config.stageDir)], {
            cwd: config.rootDir,
        });
        count += staged.entries;
        files += staged.files;
    }

    // The installed fonts, when the package has installed the fonts
    // package and a note sets text in one of its faces: the
    // stylesheet, the WOFF2 files and the licence, which the
    // manifest's `styles` names.
    const fontFindings = checkScriptFonts(packConfig, session);
    if (fontFindings.length) {
        const error = new Error(fontFindings.map(formatDiagnostic).join("\n"));
        error.located = true;
        throw error;
    }
    const fonts = copyScriptFonts(
        packConfig,
        path.resolve(config.rootDir, config.stageDir, STAGED_FONTS_DIR),
        ["woff2"],
        session,
    );
    if (fonts) {
        count += 1;
        files += fonts;
    }
    console.log(`✅ Static assets staged (${count} entries, ${files} files).`);
}
