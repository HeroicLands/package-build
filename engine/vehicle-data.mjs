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
/** Validation of generic vehicle facts. @module */
import { isStubNote } from "./note-state.mjs";
import { locatedFinding } from "./diagnostics.mjs";
import {
    isAddressTuple,
    parseAddress,
    renderAddress,
    hasAnchor,
    ownDocumentSystem,
} from "./address.mjs";
import { pathLabel, fitsKind } from "./data-keys.mjs";
import {
    VEHICLE_LOCOMOTION,
    VEHICLE_ROLES,
    VEHICLE_MEDIA,
    VEHICLE_OCCUPANT_ROLES,
    VEHICLE_DISTANCE_UNITS,
    VEHICLE_TIME_UNITS,
} from "./vehicle-terms.mjs";

/**
 * Check a vehicle's authored facts at their frontmatter positions.
 * @param {object} note - The indexed note and its source.
 * @param {{index?: any}} [options] - The local and dependency index.
 * @returns {object[]} Located findings.
 */
export function checkVehicleData(note, { index } = {}) {
    const fm = note.fm ?? note;
    if (fm.type !== "vehicle") return [];
    const d = fm.data ?? {};
    const out = [];
    const report = (path, message) =>
        out.push(locatedFinding(note, path, `${pathLabel(path)}: ${message}`));
    const map = (v) =>
        v !== null && typeof v === "object" && !Array.isArray(v) && !isAddressTuple(v);
    const num = (v, min = 0, integer = false, positive = false) =>
        typeof v === "number" &&
        Number.isFinite(v) &&
        (positive ? v > min : v >= min) &&
        (!integer || Number.isSafeInteger(v));
    const nonblank = (v) => typeof v === "string" && !!v.trim();
    const has = (o, k) => Object.hasOwn(o, k);
    const number = (o, k, p, integer = false, positive = false, max = Infinity) => {
        if (
            has(o, k) &&
            (o[k] === null ||
                (fitsKind(o[k], "number") && (!num(o[k], 0, integer, positive) || o[k] > max)))
        )
            report(
                [...p, k],
                `value ${JSON.stringify(o[k])} must be a ${positive ? "positive" : "nonnegative"}${integer ? " integer" : " finite number"}${max < Infinity ? ` no greater than ${max}` : ""}`,
            );
    };
    const list = (v, allowed, p) => {
        if (v === null)
            report(p, `${JSON.stringify(v)} must be a nonempty list of ${allowed.join(", ")}`);
        if (!Array.isArray(v)) return [];
        if (!v.length) {
            report(p, `${JSON.stringify(v)} must be a nonempty list of ${allowed.join(", ")}`);
            return [];
        }
        if (
            v.some((x) => (x === null || typeof x !== "object") && !allowed.includes(x)) ||
            new Set(v).size !== v.length
        )
            report(
                p,
                `${JSON.stringify(v)} must contain distinct values from ${allowed.join(", ")}`,
            );
        return v;
    };
    const ref = (v, type, p, subtype) => {
        if (!index?.addressHit) return;
        const tuple =
            isAddressTuple(v) ? v : (
                parseAddress(
                    v,
                    {
                        package: index.contentPackage,
                        system: "note",
                        type,
                        types: index.types,
                        packages: index.packages,
                    },
                    { declared: true },
                )
            );
        if (!tuple || tuple.reason || tuple.type !== type || hasAnchor(v)) {
            return;
        }
        const hit =
            index.addressHit(renderAddress(tuple)) ??
            (tuple.package !== index.contentPackage && tuple.system === "note" ?
                index.foreign?.references?.get(
                    renderAddress({ ...tuple, system: ownDocumentSystem(tuple.type) }),
                )
            :   undefined);
        if (hit && subtype && (hit.fm ?? hit).subType !== subtype)
            report(p, `${JSON.stringify(renderAddress(tuple))} must resolve to subtype ${subtype}`);
    };
    const p = ["data"];
    // Stub notes may omit the complete vehicle record.
    const body =
        typeof note.body === "string" ? note.body
        : typeof note.raw === "string" && note.raw.startsWith("---\n") ?
            note.raw.slice(note.raw.indexOf("\n---", 4) + 4)
        :   undefined;
    const complete = body === undefined || !isStubNote(fm, body);
    for (const k of ["family", "size", "locomotion", "role", "capacity", "movementProperties"])
        if (complete && !has(d, k)) report([...p, k], "is required");
    if (
        has(d, "family") &&
        (d.family === null || typeof d.family !== "object") &&
        !nonblank(d.family)
    )
        report([...p, "family"], "must be nonblank");
    number(d, "size", p, false, true);
    const modes =
        has(d, "locomotion") ? list(d.locomotion, VEHICLE_LOCOMOTION, [...p, "locomotion"]) : [];
    if (has(d, "role")) list(d.role, VEHICLE_ROLES, [...p, "role"]);
    for (const k of ["length", "width", "height", "hullDepth", "draft"])
        number(d, k, p, false, true);
    for (const k of ["capacity", "cargoCapacity", "buildTime", "cost"]) number(d, k, p);
    for (const k of ["occupantCapacity", "crew", "passengers"]) number(d, k, p, true);
    for (const k of ["hullDepth", "draft"])
        if (has(d, k) && !modes.includes("floating"))
            report([...p, k], "requires floating locomotion");
    if (num(d.draft, 0, false, true) && num(d.hullDepth, 0, false, true) && d.draft > d.hullDepth)
        report([...p, "draft"], `${d.draft} cannot exceed hull depth ${d.hullDepth}`);
    if (has(d, "culture")) ref(d.culture, "lore", [...p, "culture"], "culture");
    if (has(d, "occupants")) {
        const op = [...p, "occupants"];
        if (d.occupants === null) report(op, "must be a list");
        if (Array.isArray(d.occupants))
            d.occupants.forEach((row, i) => {
                const q = [...op, i];
                if (row == null || (Array.isArray(row) && !row.length))
                    report(q, "must be an occupant record");
                if (!map(row)) return;
                if (
                    typeof row.role === "string" &&
                    row.role.trim() &&
                    !VEHICLE_OCCUPANT_ROLES.includes(row.role)
                )
                    report(
                        [...q, "role"],
                        `${JSON.stringify(row.role)} must be one of ${VEHICLE_OCCUPANT_ROLES.join(", ")}`,
                    );
            });
    }
    if (has(d, "construction")) {
        const c = d.construction,
            cp = [...p, "construction"];
        if (c === null || (Array.isArray(c) && !c.length))
            report(cp, "must be a construction record");
        if (map(c)) {
            if (
                Array.isArray(c.methods) &&
                (!c.methods.length ||
                    c.methods.some((v) => !nonblank(v)) ||
                    new Set(c.methods).size !== c.methods.length)
            )
                report([...cp, "methods"], "must be a nonempty list of distinct nonblank methods");
            number(c, "complexity", cp, false, true);
        }
    }
    if (has(d, "movementProperties")) {
        const path = [...p, "movementProperties"];
        if (
            d.movementProperties === null ||
            (Array.isArray(d.movementProperties) && !d.movementProperties.length)
        )
            report(path, "must be a nonempty list");
        else if (Array.isArray(d.movementProperties))
            d.movementProperties.forEach((row, i) => {
                const q = [...path, i];
                if (row == null || (Array.isArray(row) && !row.length))
                    report(q, "must be a movement record");
                if (!map(row)) return;
                if (
                    typeof row.medium === "string" &&
                    row.medium.trim() &&
                    !VEHICLE_MEDIA.includes(row.medium)
                )
                    report(
                        [...q, "medium"],
                        `${JSON.stringify(row.medium)} must be one of ${VEHICLE_MEDIA.join(", ")}`,
                    );
                if (!Array.isArray(row.rates)) return;
                if (!row.rates.length) {
                    report([...q, "rates"], "must be a nonempty list");
                    return;
                }
                let prior = -1,
                    sum = 0,
                    positive = false;
                const units = {};
                row.rates.forEach((rate, j) => {
                    const r = [...q, "rates", j];
                    if (rate == null || (Array.isArray(rate) && !rate.length))
                        report(r, "must be a rate record");
                    if (!map(rate)) return;
                    if (
                        fitsKind(rate.distance, "number") &&
                        (!num(rate.distance) || rate.distance <= prior)
                    )
                        report(
                            [...r, "distance"],
                            `${JSON.stringify(rate.distance)} must be nonnegative and greater than the preceding distance ${prior}`,
                        );
                    prior = rate.distance;
                    if (fitsKind(rate.prob, "number") && (!num(rate.prob) || rate.prob > 1))
                        report(
                            [...r, "prob"],
                            `${JSON.stringify(rate.prob)} must be between zero and one`,
                        );
                    else if (typeof rate.prob === "number") {
                        sum += rate.prob;
                        positive ||= rate.prob > 0;
                    }
                    for (const [key, allowed] of [
                        ["distUnit", VEHICLE_DISTANCE_UNITS],
                        ["timeUnit", VEHICLE_TIME_UNITS],
                    ]) {
                        if (
                            typeof rate[key] === "string" &&
                            rate[key].trim() &&
                            !allowed.includes(rate[key])
                        )
                            report(
                                [...r, key],
                                `${JSON.stringify(rate[key])} must be one of ${allowed.join(", ")}`,
                            );
                        else if (allowed.includes(rate[key])) {
                            if (units[key] === undefined) units[key] = rate[key];
                            else if (units[key] !== rate[key])
                                report(
                                    [...r, key],
                                    `must match ${units[key]} throughout this rates list`,
                                );
                        }
                    }
                });
                if (
                    row.rates.every((rate) => map(rate) && num(rate.prob) && rate.prob <= 1) &&
                    (!positive || Math.abs(sum - 1) > 1e-9)
                )
                    report(
                        [...q, "rates"],
                        `probabilities sum to ${sum}; they must sum to one within 1e-9 and at least one must be positive`,
                    );
            });
    }
    return out;
}
