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
/** Vehicle note declarations. @module */
/** The declared vehicle locomotion modes. */
export const VEHICLE_LOCOMOTION = Object.freeze([
    "floating",
    "wheeled",
    "dragged",
    "sled",
    "carried",
]);
/** The declared purposes a vehicle serves. */
export const VEHICLE_ROLES = Object.freeze(["merchant", "military", "passenger", "utility"]);
/** Movement media for probability distributions. */
export const VEHICLE_MEDIA = Object.freeze([
    "terrestrial",
    "aquatic",
    "floating",
    "aerial",
    "burrowing",
    "astral",
]);
/** Roles assigned to a vehicle occupant. */
export const VEHICLE_OCCUPANT_ROLES = Object.freeze(["crew", "passenger", "draft_animal"]);
/** Units of distance in a movement distribution. */
export const VEHICLE_DISTANCE_UNITS = Object.freeze(["feet", "leagues"]);
/** Units of time in a movement distribution. */
export const VEHICLE_TIME_UNITS = Object.freeze(["minute", "hour", "watch", "day"]);
const words = (values) => values.map((value) => `\`${value}\``).join(", ");
const field = (name, kind, shape, extra = {}) =>
    Object.freeze({ name, kind, shape, describe: shape, ...extra });
const scalar = (name, kind, shape, required = false, describe = shape) =>
    field(name, kind, shape, { required, describe });
const record = (name, fields, describe) => field(name, "map", "A record.", { fields, describe });
const rows = (name, fields, required = false, describe = "A list of records.") =>
    field(name, "list", "A list of records.", {
        entries: { kind: "map", shape: "A record.", fields },
        required,
        describe,
    });
/** Generic vehicle facts and their units. */
export const VEHICLE_FIELDS = Object.freeze([
    field("family", "string", "A nonblank family name.", {
        describe: "Required on a non-stub vehicle; an open, nonblank family name.",
    }),
    field("size", "number", "A positive size designation.", {
        describe:
            "Required on a non-stub vehicle; a finite positive size designation. No dimension is inferred.",
    }),
    field("locomotion", "list", "A nonempty list of locomotion modes.", {
        entryKind: "string",
        describe:
            "Required on a non-stub vehicle; a nonempty unique list of `floating`, `wheeled`, `dragged`, `sled`, or `carried`.",
    }),
    field("role", "list", "A nonempty list of vehicle roles.", {
        entryKind: "string",
        describe:
            "Required on a non-stub vehicle; a nonempty unique list of `merchant`, `military`, `passenger`, or `utility`. The first role is primary.",
    }),
    ...["length", "width", "height", "hullDepth", "draft"].map((name) =>
        field(name, "number", "A positive dimension in feet.", {
            describe: {
                length: "Finite positive length in feet.",
                width: "Finite positive overall width in feet, including the gap between hulls and outriggers.",
                height: "Finite positive height in feet.",
                hullDepth: "Finite positive keel-to-main-deck depth in feet; floating only.",
                draft: "Finite positive waterline draft in feet; floating only. It cannot exceed hullDepth when both are present.",
            }[name],
        }),
    ),
    field("capacity", "number", "Capacity in seams, including fractional seams.", {
        describe:
            "Required on a non-stub vehicle; finite nonnegative seams, including fractions. One seam is 20 stone, 280 pounds, or 5 cubic feet; eight seams are one tun. These are game capacity conventions, not a cargo density rule.",
    }),
    field("cargoCapacity", "number", "Usable cargo capacity in seams.", {
        describe: "Finite nonnegative usable cargo capacity in seams, including fractions.",
    }),
    ...["occupantCapacity", "crew", "passengers"].map((name) =>
        field(name, "number", "A nonnegative whole count of people.", {
            describe: {
                occupantCapacity:
                    "The nonnegative whole maximum onboard person count; never inferred by summing crew or passengers.",
                crew: "The nonnegative whole minimum operating crew.",
                passengers:
                    "The nonnegative whole number of designated passenger places; not automatically added to occupancy.",
            }[name],
        }),
    ),
    rows(
        "occupants",
        [
            field("address", "address", "A being Address.", {
                required: true,
                ref: "being",
                accepts: ["being"],
                describe: "Required Address resolving to a being note.",
            }),
            scalar(
                "role",
                "string",
                "An occupant role.",
                true,
                `Required: ${words(VEHICLE_OCCUPANT_ROLES)}.`,
            ),
        ],
        false,
        "Optional occupants, each with an Address and role.",
    ),
    rows(
        "movementProperties",
        [
            scalar(
                "medium",
                "string",
                "A movement medium.",
                true,
                `One of ${words(VEHICLE_MEDIA)}. Aquatic is underwater; floating is on the water surface.`,
            ),
            rows(
                "rates",
                [
                    scalar(
                        "prob",
                        "number",
                        "A probability.",
                        true,
                        "A finite probability from zero to one.",
                    ),
                    scalar(
                        "distance",
                        "number",
                        "A distance.",
                        true,
                        "A finite nonnegative distance, strictly ascending within the rates.",
                    ),
                    scalar(
                        "distUnit",
                        "string",
                        "A distance unit.",
                        true,
                        `${words(VEHICLE_DISTANCE_UNITS)}.`,
                    ),
                    scalar(
                        "timeUnit",
                        "string",
                        "A time unit.",
                        true,
                        `${words(VEHICLE_TIME_UNITS)}. A watch is four hours.`,
                    ),
                ],
                true,
                "A nonempty list of rates sharing one distance unit and one time unit; each probability describes travel of its distance in that time. Probabilities sum to one within 1e-9.",
            ),
        ],
        false,
        "Required on a non-stub vehicle; a nonempty list of movement distributions.",
    ),
    record(
        "construction",
        [
            field("methods", "list", "Distinct nonblank methods.", {
                entryKind: "string",
                required: true,
                describe:
                    "A required nonempty list of distinct nonblank craft terms; the vocabulary is open.",
            }),
            scalar(
                "complexity",
                "number",
                "A positive complexity.",
                false,
                "A finite positive construction complexity.",
            ),
        ],
        "Optional construction record with required methods and optional complexity.",
    ),
    field("buildTime", "number", "Labor in person-days.", {
        describe: "Finite nonnegative labor in person-days; fractional values are allowed.",
    }),
    field("cost", "number", "Cost in pence.", {
        describe: "Finite nonnegative cost in pence; fractional values are allowed.",
    }),
    field("rules", "address", "A lore Address for the rules.", {
        ref: "lore",
        accepts: ["lore"],
        describe: "An optional Address resolving to a lore note explaining the rules.",
    }),
    field("culture", "address", "A culture lore Address.", {
        ref: "lore",
        accepts: ["lore"],
        describe: "An optional Address resolving to a lore note of subtype `culture`.",
    }),
]);
