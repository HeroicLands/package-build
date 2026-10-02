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

/**
 * The **base stylesheet** every package ships, and where it lands.
 *
 * Compiled content relies on a handful of rules to be legible — a definition
 * list is the whole of it today — and five packages need them. Four of those
 * have no stylesheet at all, so writing the rules by hand means one edit and
 * four new files, each with a configuration entry, each free to diverge from
 * the first time one of them is touched. This repository already ships
 * configuration to consumers and already generates the manifest that declares
 * a package's `styles`, so it can ship the sheet the same way: one file,
 * staged into every package, corrected in one place.
 *
 * A package keeps its own stylesheet for its own needs. The base sheet carries
 * only what all of them share.
 *
 * Everything here is pure but for {@link baseStylesheetSource}, which resolves
 * a path against this module's own location.
 *
 * @module
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the shipped sheet lands inside the staged package.
 *
 * Under `styles/` beside a package's own sheet, and named for the toolchain so
 * nothing a repository writes can collide with it. The path is relative to the
 * staged package root, which is what both the stage entry and the manifest's
 * `styles` are addressed in.
 *
 * @type {string}
 */
export const BASE_STYLESHEET_DEST = "styles/package-build-base.css";

/**
 * The cascade layer the sheet loads into, per package kind.
 *
 * Foundry declares its layer order in `css/foundry2.css`, ending
 * `… layouts, system, modules, exceptions` — the eighth and ninth being, by its
 * own comments, default game system styles and default module styles. That is
 * what this sheet is, so it takes the layer its kind is given and is therefore
 * the weakest thing a package can load:
 *
 * - **An unlayered package sheet beats it**, because an unlayered rule beats
 *   every layered one whatever its specificity.
 * - **A package sheet naming any other layer beats it too**, because a layer
 *   Foundry's order does not mention is appended after the ones it does.
 *
 * So a package overrides the base sheet from its own, whichever way it declares
 * one, and the override needs no `!important` and no specificity contest.
 *
 * @param {"system"|"module"} artifact - Which artifact is shipped.
 * @returns {string} The layer name.
 */
export function baseStyleLayer(artifact) {
    return artifact === "system" ? "system" : "modules";
}

/**
 * The manifest `styles` entry for the base sheet.
 *
 * Foundry's `styles` is an array of `{layer?, src}`, and a bare string is
 * migrated into that shape on read, so the object form is written directly.
 *
 * @param {"system"|"module"} artifact - Which artifact is shipped.
 * @returns {{src: string, layer: string}} The entry.
 */
export function baseStyleEntry(artifact) {
    return { src: BASE_STYLESHEET_DEST, layer: baseStyleLayer(artifact) };
}

/**
 * The absolute path of the sheet as installed, so the stage can copy it.
 *
 * Resolved against this module rather than against the consumer's working
 * directory, because the file belongs to this package and arrives through
 * `node_modules`.
 *
 * @returns {string} Absolute path of the shipped stylesheet.
 */
export function baseStylesheetSource() {
    return path.resolve(
        fileURLToPath(new URL("../assets/styles", import.meta.url)),
        "content-base.css",
    );
}

/**
 * The `[source, destination]` pair that stages the sheet.
 *
 * The destination is relative, in the same spelling the repository's own asset
 * table uses, so the caller resolves both against the repository root exactly
 * as it resolves every other entry.
 *
 * @param {string} stageDir - The configured stage directory, relative to the
 *   repository root.
 * @returns {[string, string]} The pair, for `stageAssets`.
 */
export function baseStyleStageEntry(stageDir) {
    return [baseStylesheetSource(), path.join(stageDir, BASE_STYLESHEET_DEST)];
}

/**
 * The manifest's `styles`, with the base sheet named first.
 *
 * **First rather than last**, because `styles` is load order: a package's own
 * sheet has to be read after the base one for an override written at equal
 * specificity in an equal layer to take. The cascade layer makes the override
 * work anyway, and the order makes it work for the right reason.
 *
 * A declared entry addressing the same file is not duplicated — a repository
 * that named the staged path itself gets one entry, keeping whatever layer it
 * chose, so declaring it is a way of placing it rather than an error.
 *
 * @param {object} options
 * @param {unknown} [options.declared] - The declared `styles`, whatever shape
 *   it was written in; anything that is not a list is returned untouched.
 * @param {"system"|"module"} options.artifact - Which artifact is shipped.
 * @param {boolean} [options.enabled] - Whether the package takes the base
 *   sheet. `false` returns the declared list unchanged.
 * @returns {unknown} The `styles` to emit, or `undefined` when there is
 *   nothing to emit at all.
 */
export function withBaseStyle({ declared, artifact, enabled = true }) {
    if (!enabled) return declared;
    const list =
        Array.isArray(declared) ? declared
        : declared === undefined ? []
        : declared;
    if (!Array.isArray(list)) return list;
    const names = (entry) => (typeof entry === "string" ? entry : entry?.src);
    if (list.some((entry) => names(entry) === BASE_STYLESHEET_DEST)) return list;
    return [baseStyleEntry(artifact), ...list];
}
