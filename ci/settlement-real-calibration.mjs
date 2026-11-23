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
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createContentSession } from "../engine/content-session.mjs";
import { serializeContentIndex } from "../engine/content-index.mjs";
import { loadPackConfig } from "../engine/pack-config.mjs";
import { readAzgaarMap } from "../engine/azgaar-map.mjs";
import { prepareSettlementInputs } from "../engine/settlement-inputs.mjs";
import { SETTLEMENT_MODEL_DEFAULTS } from "../engine/settlement-model.mjs";
import { proposeSettlements } from "../engine/settlement-generate.mjs";
import { proposeUrbanSupply } from "../engine/settlement-urban.mjs";
import { selectSettlementPlacements } from "../engine/settlement-selection.mjs";
import { digest, fetchPinnedAttachment, inputs, mapping, pin } from "./real-map-adapter-probe.mjs";

/** Pinned Thalorna source commit for the actual-input calibration. */
export const consumerSha = "d1a435b9821008a1f080d0462fe8b88d2dc82204";
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Read explicitly supplied trial inputs without adding defaults. */
export function parseTrial(text) {
    if (!text) return {};
    if (Buffer.byteLength(text) > 1024 * 1024) throw new Error("trial input exceeds byte limit");
    const value = JSON.parse(text);
    if (
        !object(value) ||
        Object.keys(value).some(
            (key) => !["bindings", "settings", "selection", "bands"].includes(key),
        )
    )
        throw new Error("trial input requires bindings, settings, selection or bands");
    for (const key of ["bindings", "settings", "selection", "bands"])
        if (value[key] !== undefined && !object(value[key]))
            throw new Error(`trial ${key} must be an object`);
    return value;
}

/** Retain the verified evidence bytes under their fixed artifact name. */
export async function retainEvidence(output, name, bytes) {
    if (!["manifest", "records", "verification", "boundaries", "diagnosis"].includes(name))
        throw new Error("unknown evidence attachment");
    const file = `${name}.evidence`;
    await fs.writeFile(path.join(output, file), bytes);
    return file;
}

/** Record the captured source bytes without writing to the consumer. */
export async function sourceHashes(session) {
    const hashes = [];
    for (const [file, source] of session.sources) {
        const current = await fs.readFile(file);
        const before = digest(Buffer.from(source.raw));
        hashes.push({
            file: path.relative(session.contentBase, file),
            before,
            after: digest(current),
        });
    }
    return hashes.sort((a, b) => a.file.localeCompare(b.file, "en"));
}

/** Capture actual facts and the numerical preflight without supplying missing facts. */
export function inspectSession(session, map, trial = {}) {
    const args = {
        session,
        polityAddress: mapping.state.address,
        map,
        bindings: trial.bindings,
        settings: trial.settings,
        bands: trial.bands,
    };
    const assembled = prepareSettlementInputs(args);
    const selected =
        trial.selection === undefined ?
            undefined
        :   selectSettlementPlacements(args, trial.selection);
    const located = (items) =>
        items.map((item) => ({
            ...item,
            ...(typeof item.file === "string" && path.isAbsolute(item.file) ?
                { file: path.relative(session.contentBase, item.file) }
            :   {}),
        }));
    const selectionMissing = [];
    for (const field of ["cellIds", "spacingMeters", "candidateLimit", "workLimit"])
        if (trial.selection?.[field] === undefined)
            selectionMissing.push({ field, message: `provide selection ${field}` });
    const sites =
        Array.isArray(trial.selection?.existingSites) ? trial.selection.existingSites : [];
    for (const { fact, file } of assembled.existingFacts)
        if (!sites.some((site) => site?.identity === fact.identity))
            selectionMissing.push({
                field: "existingSites",
                identity: fact.identity,
                file: path.relative(session.contentBase, file),
                message: `provide a position for ${fact.identity}`,
            });
    return {
        polity: { address: mapping.state.address, data: assembled.polity.data },
        cultureSizes: assembled.cultureSizes,
        cultureSizeSources: assembled.cultureSizeSources,
        existing: assembled.existingFacts.map(({ fact, data, file }) => ({
            fact,
            data,
            file: path.relative(session.contentBase, file),
        })),
        subpolities: assembled.subpolities,
        missing: located(assembled.missing),
        calculation: {
            model:
                trial.settings?.model === undefined ?
                    SETTLEMENT_MODEL_DEFAULTS
                :   trial.settings.model,
            modelSource: trial.settings?.model === undefined ? "defaults" : "trial",
            ruralInput: assembled.ruralInput ?? null,
            urbanInput: assembled.urbanInput ?? null,
            ruralResult:
                assembled.ruralInput ?
                    proposeSettlements(assembled.ruralInput, trial.settings?.model)
                :   null,
            urbanResult:
                assembled.urbanInput ?
                    proposeUrbanSupply(assembled.urbanInput, trial.settings?.model)
                :   null,
            urbanTargets: assembled.urbanTargets,
            cellAreaConversions: assembled.cellAreaConversions,
            resolvedPlacements: assembled.resolvedPlacements,
        },
        selection: {
            missing: [...selectionMissing, ...located(selected?.missing ?? [])],
            result: selected?.selection ?? null,
        },
    };
}

/** Format an inspection failure using paths relative to known working roots. */
export function formatFailure(error, roots) {
    let message = String(error.message).replace(/\s*\n\s*/g, " ");
    for (const [root, label] of roots
        .filter(([root]) => root)
        .sort((a, b) => b[0].length - a[0].length))
        message = message.split(root).join(label);
    return `ci/settlement-real-calibration.mjs:1:1: error: ${message}`;
}

/** Write both forms of the preflight receipt. */
export async function writeReceipt(output, report) {
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, "receipt.json"), JSON.stringify(report, null, 2) + "\n");
    await fs.writeFile(
        path.join(output, "receipt.md"),
        `# Settlement preflight: ${report.status}\n\nThis receipt records a preflight, not a calibrated or completed operation.\n\nCandidate: ${report.candidate ?? "unavailable"}\n\nConsumer: ${report.consumer}\n\n${Object.entries(
            {
                "Input hashes": report.inputs,
                "Retained map evidence": report.evidence,
                "Map identities": report.map,
                "Trial assumptions": report.assumptions,
                "Authored facts and numerical preflight": report.preflight,
                "Source hashes": report.sources,
                Findings: report.findings,
            },
        )
            .map(
                ([title, data]) =>
                    `## ${title}\n\n\`\`\`json\n${JSON.stringify(data ?? null, null, 2)}\n\`\`\`\n`,
            )
            .join("\n")}`,
    );
}

async function main() {
    const root = process.env.SETTLEMENT_CONSUMER;
    const output = path.join(process.env.RUNNER_TEMP, "settlement-real-calibration");
    await fs.mkdir(output, { recursive: true });
    const report = {
        status: "incomplete",
        candidate: process.env.CANDIDATE_SHA,
        consumer: consumerSha,
        mapping,
        pin,
        inputs: {},
        evidence: [],
        assumptions: {},
        findings: [],
    };
    try {
        const head = (cwd) =>
            execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
        if (
            !/^[a-f0-9]{40}$/.test(report.candidate ?? "") ||
            head(process.cwd()) !== report.candidate
        )
            throw new Error("candidate SHA rejected");
        if (!root || head(root) !== consumerSha) throw new Error("consumer SHA rejected");
        const bytes = {};
        for (const [name, spec] of Object.entries(inputs)) {
            bytes[name] = await fetchPinnedAttachment(
                process.env[`PROBE_${name.toUpperCase()}_URL`],
                spec,
                process.env.PROBE_FORGE_TOKEN,
            );
            report.inputs[name] = { sha256: digest(bytes[name]), bytes: bytes[name].length };
            if (name !== "map" && name !== "json") {
                report.evidence.push(await retainEvidence(output, name, bytes[name]));
            }
        }
        const map = readAzgaarMap({
            map: bytes.map,
            json: bytes.json,
            mapFile: "saved-map",
            jsonFile: "full-json",
            pin,
            mapping,
        });
        report.map = {
            state: map.state.i,
            cells: map.cells.map((cell) => ({
                id: cell.id,
                gridId: cell.gridId,
                culture: cell.culture?.i ?? null,
                burg: cell.burg?.i ?? null,
                burgName: cell.burg?.name ?? null,
            })),
        };
        if (digest(bytes.map) !== inputs.map.sha256 || digest(bytes.json) !== inputs.json.sha256)
            throw new Error("map input changed during inspection");
        report.assumptions = parseTrial(process.env.SETTLEMENT_TRIAL_JSON);
        process.chdir(root);
        const session = await createContentSession({
            config: loadPackConfig(),
            trackChanges: true,
        });
        try {
            report.indexSha256 = digest(Buffer.from(serializeContentIndex(session.records)));
            report.preflight = inspectSession(session, map, report.assumptions);
            session.assertUnchanged();
            report.sources = await sourceHashes(session);
            if (report.sources.some((entry) => entry.before !== entry.after))
                throw new Error("captured sources changed");
        } finally {
            await session.dispose();
        }
    } catch (error) {
        report.status = "refused";
        const finding = formatFailure(error, [
            [root, ".setting-checkout"],
            [process.env.GITHUB_WORKSPACE, "."],
            [process.env.RUNNER_TEMP, ".runner-temp"],
        ]);
        report.findings.push(finding);
        console.error(finding);
        process.exitCode = 1;
    } finally {
        await writeReceipt(output, report);
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
    await main();
