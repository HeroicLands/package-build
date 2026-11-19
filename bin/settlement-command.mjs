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

/** On-demand settlement placement command. @module */
import fs from "node:fs";
import { loadPackConfig } from "../engine/pack-config.mjs";
import { createContentSession } from "../engine/content-session.mjs";
import { AZGAAR_LIMITS, readAzgaarMap } from "../engine/azgaar-map.mjs";
import { selectSettlementPlacements } from "../engine/settlement-selection.mjs";

/** Read at most limit plus one byte from one open file.
 * @param {string} file - Input path.
 * @param {number} limit - Maximum accepted byte count.
 * @param {object} [io] - File operations.
 * @returns {Buffer} Captured input.
 */
export function boundedRead(file, limit, io = fs) {
    let fd;
    try {
        fd = io.openSync(file, "r");
        const stat = io.fstatSync(fd);
        if (!stat.isFile() || stat.size > limit) throw new Error("input exceeds its file limit");
        const parts = [];
        let total = 0;
        while (total <= limit) {
            const chunk = Buffer.allocUnsafe(Math.min(65536, limit + 1 - total));
            const count = io.readSync(fd, chunk, 0, chunk.length, null);
            if (!count) break;
            total += count;
            if (total > limit) throw new Error("input exceeds its file limit");
            parts.push(chunk.subarray(0, count));
        }
        return Buffer.concat(parts, total);
    } finally {
        if (fd !== undefined) io.closeSync(fd);
    }
}

function parseInputs(file) {
    const raw = boundedRead(file, 4 * 1024 * 1024).toString("utf8");
    try {
        return JSON.parse(raw);
    } catch (error) {
        const offset = Number(/position (\d+)/.exec(error.message)?.[1] ?? 0);
        const before = raw.slice(0, offset).split("\n");
        throw Object.assign(
            new Error(`${file}:${before.length}:${before.at(-1).length + 1}: error: invalid JSON`),
            { located: true },
        );
    }
}

/** Create the settlement command without loading project configuration. */
export function settlementCommand() {
    return {
        command: "settlement",
        describe: "Preview modeled rural settlement placements",
        builder: (yargs) =>
            yargs
                .option("polity", {
                    type: "string",
                    demandOption: true,
                    describe: "Fully qualified local polity Address",
                })
                .option("map", {
                    type: "string",
                    demandOption: true,
                    describe: "Pinned Azgaar saved map",
                })
                .option("json", {
                    type: "string",
                    demandOption: true,
                    describe: "Pinned Azgaar Full JSON export",
                })
                .option("inputs", {
                    type: "string",
                    demandOption: true,
                    describe: "JSON file containing map pin, bindings and placement inputs",
                })
                .option("write", {
                    type: "boolean",
                    default: false,
                    describe: "Request source writing (unavailable without setting name checks)",
                }),
        handler: async (argv) => {
            try {
                const inputs = parseInputs(argv.inputs);
                if (
                    !inputs ||
                    typeof inputs !== "object" ||
                    Array.isArray(inputs) ||
                    Object.keys(inputs).some(
                        (key) =>
                            !["pin", "mapping", "bindings", "settings", "selection"].includes(key),
                    )
                )
                    throw new Error(
                        `${argv.inputs}: error: provide pin, mapping, bindings, settings and selection`,
                    );
                const map = readAzgaarMap({
                    map: boundedRead(argv.map, AZGAAR_LIMITS.mapBytes),
                    json: boundedRead(argv.json, AZGAAR_LIMITS.jsonBytes),
                    mapFile: argv.map,
                    jsonFile: argv.json,
                    pin: inputs.pin,
                    mapping: inputs.mapping,
                });
                const config = loadPackConfig();
                const session = await createContentSession({ config });
                try {
                    const result = selectSettlementPlacements(
                        {
                            session,
                            polityAddress: argv.polity,
                            map,
                            bindings: inputs.bindings,
                            settings: inputs.settings,
                        },
                        inputs.selection,
                    );
                    const missing = [...result.missing];
                    if (argv.write)
                        missing.push({
                            field: "naming.validators",
                            message:
                                "setting name checks are required before writing settlement rows",
                        });
                    console.log(JSON.stringify({ selection: result.selection, missing }, null, 2));
                    for (const item of missing) {
                        const file =
                            item.file && item.file !== "settlement-inputs" ?
                                item.file
                            :   argv.inputs;
                        console.error(
                            `${file}:${item.line ?? 1}:${item.column ?? 1}: error: ${item.field ? `${item.field}: ` : ""}${item.message}`,
                        );
                    }
                    if (missing.length) process.exitCode = 1;
                } finally {
                    session.dispose();
                }
            } catch (error) {
                const raw = String(error?.message ?? error);
                const file = typeof error?.path === "string" ? error.path : argv.inputs;
                const message =
                    error?.located ?
                        raw.replace(/^(.+?): error:/, "$1:1:1: error:")
                    :   `${file}:1:1: error: ${raw}`;
                console.log(JSON.stringify({ missing: [{ file, message: raw }] }, null, 2));
                console.error(message);
                process.exitCode = 1;
            }
        },
    };
}
