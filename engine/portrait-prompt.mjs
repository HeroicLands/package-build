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
 * The text a being's portrait was generated from.
 *
 * `data.portrait.prompt` holds that text exactly as it was given to the image
 * model, so the picture is a record of what the note said. A note with no
 * `data.portrait` block has no portrait yet, and nothing is reported for it.
 * The block exists only once a portrait does. Settings declare the reproducible
 * inputs that check the stored text.
 *
 * @module
 */

import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { isPlainMap } from "./data-keys.mjs";
import { composePortrait, portraitDirectionError } from "./portrait-compose.mjs";
import {
    canonicalKey,
    isAddressTuple,
    ownDocumentSystem,
    parseAddress,
    renderAddress,
} from "./address.mjs";
import { resolveItemDefaults } from "./system-item-entries.mjs";
import { ITEM_NOTE_TYPES } from "./item-entries.mjs";

/**
 * Resolve item-note defaults from the content index, retaining entry overrides.
 * @param {object} data - The being's data.
 * @param {object} [index] - The local and dependency link index.
 * @param {object[]} [authoredItems] - The index's authored item entries.
 * @returns {object[]} Resolved item entries.
 */
export function resolvePortraitItems(data, index, authoredItems) {
    return (authoredItems ?? data?.items ?? []).map((entry, at) => {
        if (!entry?.model) return entry;
        const fail = (message) =>
            Object.assign(new Error(message), { keyPath: ["data", "items", at, "model"] });
        if (!index?.addressHit)
            throw fail("`data.items` needs the content index to resolve item models");
        const tuple =
            isAddressTuple(entry.model) ?
                entry.model
            :   parseAddress(entry.model, {
                    package: index.contentPackage,
                    system: "note",
                    types: index.types,
                    packages: index.packages,
                    config: index.config,
                });
        if (!isAddressTuple(tuple)) throw fail("`data.items` has an invalid item model Address");
        if (!ITEM_NOTE_TYPES.includes(tuple.type))
            throw fail(`item model must name an item note; ${tuple.type} is not an item note`);
        const address = renderAddress(tuple);
        const hit =
            index.addressHit(address) ??
            index.foreign?.index?.get(
                canonicalKey(
                    tuple.package,
                    ownDocumentSystem(tuple.type),
                    tuple.type,
                    tuple.shortcode,
                ),
            );
        if (!hit) throw fail(`item model ${address} is not in the content index`);
        const record = hit.itemRecord ?? hit.fm ?? hit;
        const resolved = resolveItemDefaults(entry, record);
        return resolved.name || !record.name?.full ?
                resolved
            :   { ...resolved, name: record.name.full };
    });
}

/** A seed is a nonblank string or a finite number. */
const validSeed = (value) =>
    (typeof value === "string" && value.trim().length > 0) ||
    (typeof value === "number" && Number.isFinite(value));

/** The position of a value, or its nearest declared parent. */
function located(note, keyPath) {
    for (let length = keyPath.length; length > 0; length--) {
        const position = positionOfFrontmatterPath(note.raw ?? "", keyPath.slice(0, length), {
            key: length !== keyPath.length,
        });
        if (position.line !== undefined) return position;
    }
    return {};
}

/**
 * Validate declared portrait inputs, even before a portrait exists.
 * @param {object} note - The note with parsed frontmatter and source location.
 * @param {{index?: any}} [context] - The local and dependency link index.
 * @returns {object[]} Located findings.
 */
export function checkPortraitSettings(note, { index } = {}) {
    const data = note?.fm?.data;
    const written = data?.portraitSettings;
    const settings = Array.isArray(written) && written.length === 0 ? {} : written;
    if (!isPlainMap(settings)) return [];
    const findings = [];
    const add = (keyPath, message) =>
        findings.push({
            ...(note.file ? { file: note.file } : {}),
            ...located(note, keyPath),
            severity: "error",
            message,
        });
    for (const key of ["model", "seed", "ageBand"]) {
        const value = settings[key];
        const valid =
            key === "seed" ?
                validSeed(value)
            :   typeof value === "string" && value.trim().length > 0;
        const shapeFinding = key === "seed" && value !== null && typeof value === "object";
        if (!valid && !shapeFinding)
            add(
                ["data", "portraitSettings", key],
                key === "seed" ?
                    "`data.portraitSettings.seed` needs a nonblank string or finite number"
                :   `\`data.portraitSettings.${key}\` needs a nonblank string`,
            );
    }
    const check = (value, path) => {
        const error = portraitDirectionError(value, path);
        if (error) add(path, error.message);
    };
    if (Array.isArray(settings.extras))
        settings.extras.forEach((value, at) =>
            check(value, ["data", "portraitSettings", "extras", at]),
        );
    if (Array.isArray(data.appearance?.extra_features))
        data.appearance.extra_features.forEach((value, at) =>
            check(value, ["data", "appearance", "extra_features", at]),
        );
    const sources = note.authoredItems ?? data.items ?? [];
    if (Array.isArray(sources)) {
        let items = sources;
        if (index) {
            try {
                items = resolvePortraitItems(data, index, sources);
            } catch {
                /* The item check reports unresolved models. */
            }
        }
        items.forEach((item, at) => {
            if (["clothing", "armor", "weapon", "container", "miscgear"].includes(item?.kind))
                check(item.name, ["data", "items", at, sources[at]?.name ? "name" : "model"]);
        });
    }
    return findings;
}

/**
 * Build both prompt channels from a being's declared data and resolved items.
 * @param {object} data - The being's data.
 * @param {object[]} [items] - Its resolved neutral item entries.
 * @param {object[]} [itemSources] - The authored item entries.
 * @returns {{positive: string, negative?: string}} The prompt channels.
 */
export function portraitFromData(data, items = [], itemSources = data?.items) {
    const settings = data?.portraitSettings;
    if (
        !isPlainMap(settings) ||
        ![settings.model, settings.ageBand].every(
            (value) => typeof value === "string" && value.trim(),
        ) ||
        !validSeed(settings.seed)
    ) {
        const missing =
            isPlainMap(settings) ?
                ["model", "seed", "ageBand"].find((key) =>
                    key === "seed" ?
                        !validSeed(settings[key])
                    :   typeof settings[key] !== "string" || !settings[key].trim(),
                )
            :   undefined;
        throw Object.assign(
            new Error("`data.portraitSettings` needs model, seed, and ageBand to build the prompt"),
            { keyPath: ["data", "portraitSettings", ...(missing ? [missing] : [])] },
        );
    }
    if (
        settings.extras !== undefined &&
        (!Array.isArray(settings.extras) ||
            settings.extras.some((value) => typeof value !== "string"))
    ) {
        throw Object.assign(new Error("`data.portraitSettings.extras` must be a list of strings"), {
            keyPath: ["data", "portraitSettings", "extras"],
        });
    }
    return composePortrait({
        style: settings.model,
        seed: settings.seed,
        ageBand: settings.ageBand,
        gender: data.gender,
        frame: data.frame,
        look: data.appearance,
        items,
        extra: settings.extras,
        itemSources,
    });
}

/**
 * Check stored portrait channels against the settings and current note data.
 * @param {object} note - The note, with parsed frontmatter.
 * @param {object} [context] - Resolved item context.
 * @param {object} [context.index] - The local and dependency link index.
 * @returns {object[]} Findings located at the portrait.
 */
export function checkPortraitPrompt(note, { index } = {}) {
    const data = note?.fm?.data;
    const written = data?.portrait;
    const portrait = Array.isArray(written) && written.length === 0 ? {} : written;
    if (!isPlainMap(portrait)) return [];
    const prompt = portrait.prompt;
    const finding = (message, severity = "warning", key = "prompt") => ({
        ...(note.file ? { file: note.file } : {}),
        ...located(note, ["data", "portrait", key]),
        severity,
        message,
    });
    if (prompt === undefined || prompt === null)
        return [
            finding("`data.portrait.prompt` is required when a portrait block is present", "error"),
        ];
    if (typeof prompt !== "string") return [];
    if (!prompt.trim())
        return [
            finding(
                "`data.portrait.prompt` is blank; it holds the portrait's exact prompt",
                "error",
            ),
        ];
    if (
        !isPlainMap(data.portraitSettings) ||
        ![data.portraitSettings.model, data.portraitSettings.ageBand].every(
            (value) => typeof value === "string" && value.trim(),
        ) ||
        !validSeed(data.portraitSettings.seed)
    ) {
        return [
            finding(
                "portrait freshness cannot be checked without `data.portraitSettings` model, seed, and ageBand",
            ),
        ];
    }
    if (checkPortraitSettings(note, { index }).length) return [];
    let items;
    try {
        items = resolvePortraitItems(data, index, note.authoredItems);
    } catch (error) {
        return [
            finding(
                `portrait freshness cannot be checked: ${error instanceof Error ? error.message : "item resolution failed"}`,
            ),
        ];
    }
    let generated;
    try {
        generated = portraitFromData(data, items, note.authoredItems ?? data.items);
    } catch (error) {
        return [
            finding(
                error instanceof Error ? error.message : "portrait settings are invalid",
                "error",
            ),
        ];
    }
    const changed = [
        portrait.prompt !== generated.positive && "positive",
        portrait.negativePrompt !== generated.negative && "negative",
    ].filter(Boolean);
    if (changed.length)
        return [
            finding(
                `portrait prompt is stale: ${changed.join(" and ")} channel differs from the declared data`,
            ),
        ];
    return [];
}
