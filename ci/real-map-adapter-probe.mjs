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
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readAzgaarMap } from "../engine/azgaar-map.mjs";

export const inputs = Object.freeze({
    map: {
        sha256: "57755489c848f01bcb2d3921f04794dd59aa59cf7c7632324607b3dd1ef1d50a",
        max: 64 * 1024 * 1024,
    },
    json: {
        sha256: "ea5d0315084e50c585ecbae35ab5afffed4e6c8f0fb2d1eb4648e193c74d0f5a",
        max: 256 * 1024 * 1024,
    },
    manifest: {
        sha256: "8209d29ade16220a70f1ecd0c729622d8838ab6e801845076dc9d5d77cf6315e",
        max: 65536,
    },
    records: {
        sha256: "42aa45ec0a2161207e0419969fd14183d2cba6f27c211a92f0c0b839e614949d",
        max: 65536,
    },
    verification: {
        sha256: "a4a55b17a2f312fb0149d691438a8e19de24c0cb21526097daff0ad12ddc5938",
        max: 65536,
    },
    boundaries: {
        sha256: "7aad2dbefb2a8b1099b29c869adaf3a8536419d1e02c7e27f91c9ce2222572c8",
        max: 65536,
    },
    diagnosis: {
        sha256: "4a67274c0ba23155bf36ecde8ecd9a794b97bd6abfee0f84a69b8c357b7309d7",
        max: 65536,
    },
});
export const mapping = Object.freeze({
    state: { id: 3, address: "thalorna-note-affiliation-kngdmmrdd" },
    cultures: { 6: "thalorna-note-lore-dunhariclt" },
});
export const pin = Object.freeze({
    mapHash: inputs.map.sha256,
    jsonHash: inputs.json.sha256,
    mapId: "1791340990638",
    seed: "665300226",
    version: "1.156.0",
    width: 2560,
    height: 1197,
    units: {
        distanceUnit: "mi",
        distanceScale: 1.43,
        areaUnit: "square",
        heightUnit: "ft",
        heightExponent: 2,
        temperatureScale: "°F",
        populationRate: 286.19,
        urbanization: 1,
    },
});
export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Fetch exactly one bounded, pinned attachment without redirects. */
export async function fetchPinnedAttachment(input, spec, token, fetchImpl = fetch) {
    let url;
    try {
        url = new URL(input);
    } catch {
        throw new Error("invalid attachment URL");
    }
    if (
        url.protocol !== "https:" ||
        url.hostname !== "git.pupluppy.org" ||
        url.port ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !/^\/attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
            url.pathname,
        )
    )
        throw new Error("attachment URL rejected");
    if (typeof token !== "string" || !token.trim()) throw new Error("forge token required");
    let response;
    try {
        response = await fetchImpl(url.href, {
            redirect: "error",
            credentials: "omit",
            headers: { Authorization: `token ${token}` },
            signal: AbortSignal.timeout(120000),
        });
    } catch {
        throw new Error("attachment request failed");
    }
    if (response.status !== 200 || response.redirected || !response.body)
        throw new Error("attachment response rejected");
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > spec.max))
        throw new Error("attachment exceeds byte limit");
    const parts = [];
    let count = 0;
    try {
        for await (const part of response.body) {
            count += part.length;
            if (count > spec.max) throw new Error("attachment exceeds byte limit");
            parts.push(part);
        }
    } catch {
        throw new Error("attachment stream failed or exceeds byte limit");
    }
    if (length !== null && count !== Number(length)) throw new Error("attachment length mismatch");
    const bytes = Buffer.concat(parts, count);
    if (digest(bytes) !== spec.sha256) throw new Error("attachment checksum mismatch");
    return bytes;
}

/** Capture adapter output without altering input bytes or interpreting map notices. */
export function inspectMap(map, json, adapter = readAzgaarMap) {
    const before = { map: digest(map), json: digest(json) };
    let result, failure;
    try {
        result = adapter({
            map,
            json,
            mapFile: "western-ankaris.map",
            jsonFile: "full-v1.156.0.json",
            pin,
            mapping,
        });
    } catch (error) {
        failure = String(error.message);
    }
    const after = { map: digest(map), json: digest(json) };
    return {
        before,
        after,
        unchanged: before.map === after.map && before.json === after.json,
        findings: failure ? [failure] : [],
        selected:
            result ?
                {
                    stateId: result.state.i,
                    cells: result.cells.map((c) => ({
                        id: c.id,
                        gridId: c.gridId,
                        stateId: c.state.i,
                        cultureId: c.culture?.i ?? null,
                        cultureAddress: c.cultureAddress,
                        burgId: c.burg?.i ?? null,
                        burgCultureId: c.burgCultureId,
                        burgCultureAddress: c.burgCultureAddress,
                    })),
                }
            :   null,
    };
}

async function main() {
    const output = path.join(process.env.RUNNER_TEMP, "real-map-adapter-probe");
    await fs.mkdir(output, { recursive: true });
    const report = {
        candidate: process.env.CANDIDATE_SHA,
        status: "failed",
        mapping,
        pin,
        inputs: {},
        findings: [],
        retainedNotice: [
            "[Data integrity] 5 repaired, 3 rules broken:",
            "State 5 has multiple capitals (258, 466). Keeping the first as capital",
            "State 17 has multiple capitals (79, 450). Keeping the first as capital",
            "State 30 has multiple capitals (246, 552). Keeping the first as capital",
            "State 32 has multiple capitals (349, 715). Keeping the first as capital",
            "State 34 has multiple capitals (395, 714). Keeping the first as capital",
            "state-centers: 3 (14, 18, 22)",
            "state-capitals: 3 (14, 18, 22)",
            "state-provinces: 9 (2, 3, 5, 9, 11)",
            "Rectangle-bound checks: 512 packed polygons and 841 grid polygons outside the rectangle.",
        ],
    };
    try {
        const candidate = process.env.CANDIDATE_SHA;
        if (
            !/^[a-f0-9]{40}$/.test(candidate ?? "") ||
            execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== candidate
        )
            throw new Error("candidate SHA rejected");
        const token = process.env.PROBE_FORGE_TOKEN;
        if (!token?.trim()) throw new Error("forge token required");
        const bytes = {};
        for (const [name, spec] of Object.entries(inputs)) {
            report.inFlight = name;
            bytes[name] = await fetchPinnedAttachment(
                process.env[`PROBE_${name.toUpperCase()}_URL`],
                spec,
                token,
            );
            report.inputs[name] = { sha256: digest(bytes[name]), bytes: bytes[name].length };
            if (!["map", "json"].includes(name))
                await fs.writeFile(path.join(output, `${name}.evidence`), bytes[name]);
        }
        delete report.inFlight;
        const observation = inspectMap(bytes.map, bytes.json);
        Object.assign(report, observation);
        if (!observation.unchanged || observation.findings.length)
            throw new Error("adapter refused input or input bytes changed");
        report.status = "accepted";
    } catch (error) {
        report.findings.push(String(error.message));
        process.exitCode = 1;
    } finally {
        await fs.writeFile(
            path.join(output, "report.json"),
            JSON.stringify(report, null, 2) + "\n",
        );
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
    await main();
