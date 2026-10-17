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

/** Opt-in date configuration for preview hosts; no content or dependency reads. @module */
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { findConfigFile } from "./pack-config.mjs";
import { formatDiagnostic, positionOfYamlPath } from "./diagnostics.mjs";
import { normalizeCurrentDate } from "./current-date.mjs";

/**
 * Read only currentDate from the nearest package configuration.
 * YAML does not load the full build configuration. An MJS configuration executes
 * its own module, as any caller opting into a code configuration expects.
 * @param {string} root - Directory at which configuration discovery starts.
 * @returns {Promise<string>} Validated neutral current date.
 */
export async function readPreviewCurrentDate(root) {
    const file = findConfigFile(root);
    if (!file) return normalizeCurrentDate();
    let source = "";
    try {
        let input;
        if (file.endsWith(".mjs")) {
            const version = (await fs.stat(file)).mtimeMs;
            const module = await import(`${pathToFileURL(file).href}?previewDate=${version}`);
            input = module.default ?? module;
        } else {
            source = await fs.readFile(file, "utf8");
            const document = YAML.parseDocument(source);
            if (document.errors.length) throw document.errors[0];
            input = document.toJS();
        }
        if (!input || typeof input !== "object" || Array.isArray(input)) {
            throw new TypeError("package configuration must be a mapping");
        }
        return normalizeCurrentDate(input.currentDate);
    } catch (error) {
        throw new Error(
            formatDiagnostic({
                file,
                ...(source ? positionOfYamlPath(source, ["currentDate"]) : {}),
                severity: "error",
                message: error.message,
            }),
            { cause: error },
        );
    }
}
