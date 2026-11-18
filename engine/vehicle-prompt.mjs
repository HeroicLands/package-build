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

/** Vehicle picture prompt composition and validation. @module */
import { readAssetAddress } from "./art-fields.mjs";
import { locatedFinding } from "./diagnostics.mjs";
import { isPlainMap, pathLabel } from "./data-keys.mjs";
import { vehicleDirectionError, STYLES, STYLE_KEYS } from "./portrait-compose.mjs";
import { resolvePortraitItems } from "./portrait-prompt.mjs";
import { stream } from "./seeded-draw.mjs";

const validSeed = (seed) =>
    (typeof seed === "string" && !!seed.trim()) ||
    (typeof seed === "number" && Number.isFinite(seed));
const fail = (message, keyPath) => Object.assign(new Error(message), { keyPath });
/** Build the prompt channels from declared vehicle facts and resolved items.
 * @param {any} data - Vehicle data with prompt settings.
 * @param {any[]} [items] - Resolved item entries.
 * @param {any[]} [sources] - Authored item entries.
 * @param {any} [index] - Link index for item artwork.
 * @returns {{positive: string, negative?: string}} Prompt channels.
 */
export function vehiclePromptFromData(data, items = [], sources = data.items ?? [], index) {
    const settings = data.portraitSettings;
    if (!isPlainMap(settings))
        throw fail("portrait settings require model and seed", ["data", "portraitSettings"]);
    for (const key of Object.keys(settings))
        if (!["model", "seed", "extras", "view"].includes(key))
            throw fail("unknown portrait setting", ["data", "portraitSettings", key]);
    if (!STYLE_KEYS.includes(settings.model))
        throw fail(`${JSON.stringify(settings.model)} must be one of ${STYLE_KEYS.join(", ")}`, [
            "data",
            "portraitSettings",
            "model",
        ]);
    const style = STYLES[settings.model];
    if (!validSeed(settings.seed))
        throw fail("seed must be nonblank or finite", ["data", "portraitSettings", "seed"]);
    if (settings.view !== undefined && !["side", "three-quarter"].includes(settings.view))
        throw fail("view must be side or three-quarter", ["data", "portraitSettings", "view"]);
    if (
        settings.extras !== undefined &&
        (!Array.isArray(settings.extras) ||
            settings.extras.some((v) => typeof v !== "string" || !v.trim()))
    )
        throw fail("extras must be nonblank strings", ["data", "portraitSettings", "extras"]);
    const check = (value, path) => {
        const error = vehicleDirectionError(value, path);
        if (error) throw error;
    };
    if (
        data.appearance?.extra_features !== undefined &&
        !Array.isArray(data.appearance.extra_features)
    )
        throw fail("extra features must be a list", ["data", "appearance", "extra_features"]);
    (data.appearance?.extra_features ?? []).forEach((value, i) =>
        check(value, ["data", "appearance", "extra_features", i]),
    );
    (settings.extras ?? []).forEach((value, i) =>
        check(value, ["data", "portraitSettings", "extras", i]),
    );
    items.forEach((item, i) =>
        check(item?.name, ["data", "items", i, sources[i]?.name ? "name" : "model"]),
    );
    if (index)
        items.forEach((item, i) => {
            const source = sources[i] ?? {};
            const value = source.img ?? item?.img;
            if (value == null) return;
            const path = ["data", "items", i, source.img != null ? "img" : "model"];
            if (!readAssetAddress(index.assetIndex, value, "icon", ["icon", "image"]).record)
                throw fail("item artwork must resolve to an icon or image", path);
        });
    const view =
        settings.view ??
        (stream(String(settings.seed), "data.portraitSettings.view")() < 0.5 ?
            "side"
        :   "three-quarter");
    const words = (value) => String(value).replaceAll("_", " ");
    const look = data.appearance ?? {};
    if (!isPlainMap(look)) throw fail("invalid appearance", ["data", "appearance"]);
    const clauses = [
        `${style.vehicle}, ${view} view`,
        data.family,
        ...["form", "material"]
            .filter((k) => look[k] != null)
            .map((k) => `${words(k)}: ${words(look[k])}`),
        ...(look.extra_features ?? []),
        ...(typeof data.cargoCapacity === "number" ?
            [`cargo capacity: ${data.cargoCapacity} seams`]
        :   []),
        ...[
            ["size", "size designation", ""],
            ["length", "length", "feet"],
            ["width", "width", "feet"],
            ["height", "height", "feet"],
            ["hullDepth", "hull depth", "feet"],
            ["draft", "waterline draft", "feet"],
            ["capacity", "capacity", "seams"],
        ]
            .filter(([key]) => typeof data[key] === "number")
            .map(([key, label, unit]) => `${label} ${data[key]}${unit ? ` ${unit}` : ""}`),
        ...items
            .filter((entry) => entry?.name)
            .map(
                (entry) =>
                    `vehicle item: ${entry.name}${typeof entry.system?.quantity === "number" ? `, quantity ${entry.system.quantity}` : ""}`,
            ),
        ...(settings.extras ?? []),
    ].filter(Boolean);
    return {
        positive: clauses.join(", "),
        ...(style.vehicleNegative ? { negative: style.vehicleNegative } : {}),
    };
}
/** Validate a vehicle picture record and compare its stored channels. @param {any} note - Indexed note. @param {{index?: any}} [context] - Link index. @returns {object[]} Findings. */
export function checkVehiclePortrait(note, { index } = {}) {
    const data = note.fm?.data ?? {},
        portrait = data.portrait,
        settings = data.portraitSettings;
    if (portrait === undefined && settings === undefined) return [];
    const findings = [],
        add = (path, message, severity = "error") => {
            findings.push(locatedFinding(note, path, `${pathLabel(path)}: ${message}`, severity));
        };
    if (!isPlainMap(portrait)) add(["data", "portrait"], "portrait record is required");
    if (!isPlainMap(settings)) add(["data", "portraitSettings"], "portrait settings are required");
    if (!data.icon) add(["data", "icon"], "portrait requires declared profile artwork");
    else if (
        index &&
        !readAssetAddress(index.assetIndex, data.icon, "icon", ["icon", "image"]).record
    )
        add(["data", "icon"], "portrait artwork must resolve to an icon or image");
    if (!isPlainMap(portrait) || !isPlainMap(settings)) return findings;
    if (typeof portrait.prompt !== "string" || !portrait.prompt.trim())
        add(["data", "portrait", "prompt"], "portrait prompt must be nonblank");
    if (
        portrait.negativePrompt !== undefined &&
        (typeof portrait.negativePrompt !== "string" || !portrait.negativePrompt.trim())
    )
        add(["data", "portrait", "negativePrompt"], "negative prompt must be nonblank");
    if (findings.length) return findings;
    // The shared field check reports unknown settings before prompt composition.
    if (Object.keys(settings).some((key) => !["model", "seed", "extras", "view"].includes(key)))
        return findings;
    try {
        const items = resolvePortraitItems(data, index, note.authoredItems),
            generated = vehiclePromptFromData(data, items, note.authoredItems ?? data.items, index);
        if ((generated.negative === undefined) !== (portrait.negativePrompt === undefined)) {
            add(
                ["data", "portrait", "negativePrompt"],
                "negative channel does not match model style",
            );
            return findings;
        }
        const changed = [
            portrait.prompt !== generated.positive && "positive",
            portrait.negativePrompt !== generated.negative && "negative",
        ].filter(Boolean);
        if (changed.length)
            add(
                ["data", "portrait", "prompt"],
                `portrait prompt is stale: ${changed.join(" and ")} channel differs from the declared data`,
                "warning",
            );
    } catch (error) {
        add(
            error?.keyPath ?? ["data", "portraitSettings"],
            error instanceof Error ? error.message : "invalid portrait settings",
        );
    }
    return findings;
}
