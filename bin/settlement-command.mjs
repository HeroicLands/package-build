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

function boundedRead(file, limit) {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > limit)
        throw new Error(`${file}: error: input exceeds its file limit`);
    const bytes = fs.readFileSync(file);
    if (bytes.length > limit) throw new Error(`${file}: error: input exceeds its file limit`);
    return bytes;
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
                    describe: "Write checked settlement rows when naming checks are available",
                }),
        handler: async (argv) => {
            const inputs = JSON.parse(boundedRead(argv.inputs, 4 * 1024 * 1024).toString("utf8"));
            if (
                !inputs ||
                typeof inputs !== "object" ||
                Array.isArray(inputs) ||
                Object.keys(inputs).some(
                    (key) => !["pin", "mapping", "bindings", "settings", "selection"].includes(key),
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
                        message: "setting name checks are required before writing settlement rows",
                    });
                console.log(JSON.stringify({ selection: result.selection, missing }, null, 2));
                if (missing.length) process.exitCode = 1;
            } finally {
                session.dispose();
            }
        },
    };
}
