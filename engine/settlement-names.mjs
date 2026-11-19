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

/** Bounded place-name candidates from indexed declarations. @module */
import { createHash } from "node:crypto";
import { canonicalKey } from "./address.mjs";
import { normalizeName } from "./name-forms.mjs";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const checks = Object.freeze(["spelling", "language", "earthWords", "earthNames", "indexedNames"]);
const plain = (value) => typeof value === "string" && /^\p{L}[\p{L}\p{M}]*$/u.test(value);
const missing = (field, message) => ({ status: "missing", field, message });
const addressOf = (record) => canonicalKey(record.package, "note", record.type, record.shortcode);
const order = (seed, identity, side, index) =>
    createHash("sha256")
        .update(JSON.stringify([seed, identity, side, index]))
        .digest("hex");

/**
 * Propose one checked place-name candidate without writing content.
 * @param {object} options - Indexed records, stable identity and validation dependencies.
 * @param {object} options.culture - Indexed culture record with resolved `lang`.
 * @param {object} options.language - Indexed language record with `languageCode` and place declarations.
 * @param {string} options.identity - Stable settlement identity.
 * @param {string} options.seed - Deterministic selection seed.
 * @param {string[]} options.exclusions - Existing and already selected name labels.
 * @param {Record<string, Function>} options.validators - Required synchronous validation callbacks.
 * @param {number} options.maxCandidates - Maximum candidate pairs examined.
 * @param {{identity: string, name: string}} [options.authored] - Explicitly bound authored name.
 * @returns {object} Authored or accepted candidate, or a distinct incomplete outcome.
 */
export function proposeSettlementName({
    culture,
    language,
    identity,
    seed,
    exclusions,
    validators,
    maxCandidates,
    authored,
}) {
    if (!text(identity)) return missing("identity", "provide a stable settlement identity");
    if (authored !== undefined) {
        if (!object(authored) || authored.identity !== identity || !text(authored.name))
            return missing(
                "authored",
                "bind the authored name to the selected settlement identity",
            );
        return { status: "authored", identity, name: authored.name };
    }
    if (
        !object(culture) ||
        culture.type !== "lore" ||
        culture.subType !== "culture" ||
        !text(culture.package) ||
        !text(culture.shortcode) ||
        !text(culture.lang)
    )
        return missing("culture", "provide an indexed culture with a resolved language");
    if (
        !object(language) ||
        language.type !== "skill" ||
        language.subType !== "language" ||
        !text(language.package) ||
        !text(language.shortcode) ||
        !text(language.languageCode) ||
        language.languageCode !== culture.lang
    )
        return missing("language", "bind the culture's indexed language record");
    if (!text(seed)) return missing("seed", "provide a deterministic selection seed");
    if (!Array.isArray(exclusions) || exclusions.some((name) => !text(name)))
        return missing("exclusions", "provide existing and selected names as a list");
    if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1)
        return missing("maxCandidates", "provide a positive candidate budget");
    if (!object(validators))
        return missing("validators", "provide all required validation callbacks");
    for (const name of checks)
        if (typeof validators[name] !== "function")
            return missing(`validators.${name}`, `provide the ${name} validation callback`);
    const data = language.data;
    if (
        !object(data) ||
        !Array.isArray(data.elements) ||
        !object(data.naming) ||
        !Array.isArray(data.naming.draws)
    )
        return missing("language.data", "provide indexed place elements and naming draws");
    if (
        data.naming.heldFrom !== undefined &&
        (!Array.isArray(data.naming.heldFrom) || data.naming.heldFrom.length)
    )
        return missing(
            "language.data.naming.heldFrom",
            "held-from composition requires an explicit supported source",
        );
    const draws = data.naming.draws.filter((draw) => object(draw) && draw.kind === "place");
    if (
        draws.length !== 1 ||
        !Array.isArray(draws[0].elements) ||
        !draws[0].elements.includes("place") ||
        draws[0].elements.some((kind) => !["place", "given", "byname"].includes(kind))
    )
        return missing(
            "language.data.naming.draws",
            "provide one place draw permitting place elements",
        );
    const candidates = data.elements
        .map((element, index) => ({ element, index }))
        .filter(
            ({ element }) =>
                object(element) &&
                (element.kind === undefined || element.kind === "place") &&
                ["opening", "closing", "either"].includes(element.position) &&
                plain(element.form) &&
                text(element.sense) &&
                element.joining === undefined,
        );
    const ranked = (side, positions) =>
        candidates
            .filter(({ element }) => positions.includes(element.position))
            .map((entry) => ({ ...entry, rank: order(seed, identity, side, entry.index) }))
            .sort((a, b) =>
                a.rank < b.rank ? -1
                : a.rank > b.rank ? 1
                : a.index - b.index,
            );
    const openings = ranked("opening", ["opening", "either"]);
    const closings = ranked("closing", ["closing", "either"]);
    if (!openings.length || !closings.length)
        return missing(
            "language.data.elements",
            "provide plain place-compatible opening and closing elements",
        );
    const totalPairs = openings.length * closings.length;
    if (!Number.isSafeInteger(totalPairs))
        return missing(
            "language.data.elements",
            "the candidate pool is too large to enumerate safely",
        );
    const excluded = new Set(exclusions.map(normalizeName));
    const languageAddress = addressOf(language),
        cultureAddress = addressOf(culture);
    let examined = 0;
    for (const opening of openings) {
        for (const closing of closings) {
            if (examined === maxCandidates)
                return { status: "budget", identity, examined, totalPairs };
            examined++;
            const name = (opening.element.form + closing.element.form).normalize("NFC");
            const key = normalizeName(name);
            if (excluded.has(key)) continue;
            const elements = [opening, closing].map(({ element, index }) => ({
                index,
                form: element.form,
                kind: element.kind ?? null,
                position: element.position,
                sense: element.sense,
            }));
            const context = {
                identity,
                seed,
                cultureAddress,
                languageAddress,
                culture,
                language,
                elements,
            };
            const outcomes = {};
            let rejected = false;
            for (const check of checks) {
                let outcome;
                try {
                    outcome = validators[check](name, context);
                } catch (error) {
                    return {
                        status: "validation-error",
                        field: `validators.${check}`,
                        message: String(error?.message ?? error),
                        examined,
                    };
                }
                if (outcome instanceof Promise) {
                    outcome.catch(() => {});
                    return {
                        status: "validation-error",
                        field: `validators.${check}`,
                        message: "validation must return a synchronous result",
                        examined,
                    };
                }
                if (object(outcome) && typeof outcome.then === "function")
                    return {
                        status: "validation-error",
                        field: `validators.${check}`,
                        message: "validation must return a synchronous result",
                        examined,
                    };
                if (!object(outcome) || typeof outcome.available !== "boolean")
                    return {
                        status: "validation-error",
                        field: `validators.${check}`,
                        message: "validation must report availability and validity",
                        examined,
                    };
                if (!outcome.available)
                    return {
                        status: "missing",
                        field: `validators.${check}`,
                        message: "required validation data is unavailable",
                        examined,
                    };
                if (typeof outcome.valid !== "boolean")
                    return {
                        status: "validation-error",
                        field: `validators.${check}`,
                        message: "validation must report availability and validity",
                        examined,
                    };
                outcomes[check] = { ...outcome };
                if (!outcome.valid) {
                    rejected = true;
                    break;
                }
            }
            if (!rejected)
                return {
                    status: "accepted",
                    identity,
                    name,
                    cultureAddress,
                    languageAddress,
                    elements,
                    checks: outcomes,
                    examined,
                };
        }
    }
    return { status: "exhausted", identity, examined, totalPairs };
}
