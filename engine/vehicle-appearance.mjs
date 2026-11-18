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
/** Vehicle look vocabulary, validation and explicit seeded draws. @module */
import { locatedFinding } from "./diagnostics.mjs";
import { featurePunctuation } from "./appearance-features.mjs";
import { vehicleDirectionError } from "./portrait-compose.mjs";
import { VEHICLE_LOOK_VOCABULARY } from "./vehicle-appearance-terms.mjs";
export { VEHICLE_LOOK_VOCABULARY } from "./vehicle-appearance-terms.mjs";
import { stream, weighted } from "./seeded-draw.mjs";
import { pathLabel } from "./data-keys.mjs";

const modes = {
    floating: ["narrow_hull", "round_hull", "flat_bottomed_hull"],
    wheeled: ["open_body", "flatbed", "covered_body", "chariot"],
    dragged: ["travois", "drag_sledge"],
    sled: ["runner_sleigh", "flatbed"],
    carried: ["litter", "carrying_frame"],
};
const required = ["form", "material"];
const allowed = (key, word, mode) =>
    Object.hasOwn(modes, mode) &&
    VEHICLE_LOOK_VOCABULARY[key]?.some((entry) => entry.value === word) &&
    (key !== "form" || modes[mode]?.includes(word));
const applicableWords = (key, selectedModes) =>
    VEHICLE_LOOK_VOCABULARY[key]
        .map((entry) => entry.value)
        .filter((word) => selectedModes.some((mode) => allowed(key, word, mode)));
const applicableMessage = (key, selectedModes) => {
    const words = applicableWords(key, selectedModes);
    return words.length ?
            `must be one of ${words.join(", ")} for the declared locomotion`
        :   "no look words apply to the declared locomotion";
};
const map = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const has = (o, k) => Object.hasOwn(o, k);
const reporter = (note) => {
    const findings = [];
    return {
        findings,
        add(path, message) {
            findings.push(locatedFinding(note, path, `${pathLabel(path)}: ${message}`));
        },
    };
};
/** @param {any} note - Indexed vehicle note. @returns {object[]} Located findings. */
export function checkVehicleAppearance(note) {
    const data = (note.fm ?? note).data ?? {},
        look = data.appearance;
    if (look === undefined) return [];
    const { findings, add } = reporter(note),
        base = ["data", "appearance"];
    if (!map(look) || !Object.keys(look).length) {
        add(base, "must be a nonempty appearance record");
        return findings;
    }
    for (const [key, value] of Object.entries(look)) {
        const p = [...base, key];
        if (key === "extra_features") {
            if (!Array.isArray(value)) add(p, "must be a list of short physical descriptions");
            else
                value.forEach((entry, i) => {
                    const q = [...p, i];
                    if (typeof entry !== "string" || !entry.trim()) {
                        add(q, "must be nonblank");
                        return;
                    }
                    if (featurePunctuation(entry).length)
                        add(q, "must use only a hyphen or apostrophe inside a word");
                    const direction = vehicleDirectionError(entry, q);
                    if (direction) add(q, direction.message);
                });
            continue;
        }
        if (!has(VEHICLE_LOOK_VOCABULARY, key)) continue;
        if (!VEHICLE_LOOK_VOCABULARY[key].some((entry) => entry.value === value))
            add(
                p,
                `must be one of ${VEHICLE_LOOK_VOCABULARY[key].map((entry) => entry.value).join(", ")}`,
            );
        else if (
            Array.isArray(data.locomotion) &&
            !data.locomotion.some((mode) => allowed(key, value, mode))
        )
            add(p, applicableMessage(key, data.locomotion));
    }
    return findings;
}
/** @param {any} note - Culture note. @returns {object[]} Located findings. */
export function checkVehicleAppearanceProfile(note) {
    const fm = note.fm ?? note,
        profile = fm.data?.vehicleAppearanceProfile;
    if (profile === undefined) return [];
    const { findings, add } = reporter(note),
        base = ["data", "vehicleAppearanceProfile"];
    if (fm.type !== "lore" || fm.subType !== "culture")
        add(base, "is allowed only on culture lore");
    if (!Array.isArray(profile) || !profile.length) {
        add(base, "must be a nonempty list");
        return findings;
    }
    const seen = new Set();
    profile.forEach((row, i) => {
        const p = [...base, i];
        if (!map(row)) {
            add(p, "must be a profile record");
            return;
        }
        if (!has(modes, row.locomotion))
            add([...p, "locomotion"], `must be one of ${Object.keys(modes).join(", ")}`);
        if (has(row, "family") && (typeof row.family !== "string" || !row.family.trim()))
            add([...p, "family"], "must be nonblank");
        const selector = JSON.stringify([row.locomotion, row.family ?? null]);
        if (seen.has(selector)) add(p, "duplicate selector");
        seen.add(selector);
        if (!map(row.fields)) {
            add([...p, "fields"], "must be a field map");
            return;
        }
        for (const key of required)
            if (!has(row.fields, key)) add([...p, "fields", key], "is required");
        for (const [key, weights] of Object.entries(row.fields)) {
            const q = [...p, "fields", key];
            if (!has(VEHICLE_LOOK_VOCABULARY, key)) continue;
            if (!map(weights) || !Object.keys(weights).length) {
                add(q, "must be a nonempty weight map");
                continue;
            }
            if (
                !Number.isFinite(
                    Object.values(weights).reduce(
                        (sum, weight) => sum + (typeof weight === "number" ? weight : 0),
                        0,
                    ),
                )
            )
                add(q, "total weight must be finite");
            for (const [word, weight] of Object.entries(weights)) {
                if (!allowed(key, word, row.locomotion))
                    add([...q, word], applicableMessage(key, [row.locomotion]));
                if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0)
                    add([...q, word], "weight must be finite and positive");
            }
        }
    });
    return findings;
}
/**
 * Draw missing look fields using an explicitly selected locomotion.
 * @param {any} data - Authored vehicle data.
 * @param {any[]} profile - Culture profile rows.
 * @param {string} seed - Draw seed.
 * @param {string} locomotion - Selected declared mode.
 * @returns {object} A new appearance record.
 */
export function drawVehicleAppearance(data, profile, seed, locomotion) {
    if (!data.locomotion?.includes(locomotion)) throw new Error("select a declared locomotion");
    const matches = profile.filter(
        (row) =>
            row.locomotion === locomotion &&
            (row.family === undefined || row.family === data.family),
    );
    const exact = matches.filter((row) => row.family === data.family),
        selected = exact.length ? exact : matches.filter((row) => row.family === undefined);
    if (selected.length !== 1)
        throw new Error("appearance profile selection is missing or ambiguous");
    const appearance = structuredClone(data.appearance ?? {});
    for (const [key, weights] of Object.entries(selected[0].fields)) {
        if (has(appearance, key)) continue;
        appearance[key] = weighted(weights, stream(String(seed), `data.appearance.${key}`));
    }
    return appearance;
}
