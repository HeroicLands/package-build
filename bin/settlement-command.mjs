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
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { loadPackConfig } from "../engine/pack-config.mjs";
import { createContentSession } from "../engine/content-session.mjs";
import { AZGAAR_LIMITS, readAzgaarMap } from "../engine/azgaar-map.mjs";
import { selectSettlementPlacements } from "../engine/settlement-selection.mjs";
import {
    prepareNamedSettlements,
    DEFAULT_AUTHORING_WORK_LIMIT,
    preflightNamedSettlements,
} from "../engine/settlement-authoring.mjs";
import { commitSettlementEdit } from "../engine/settlement-source.mjs";
import { formatDiagnostic } from "../engine/diagnostics.mjs";

function locatedError(file, message, line, column) {
    const position =
        line === undefined ? "" : `:${line}${column === undefined ? "" : `:${column}`}`;
    return Object.assign(new Error(`${file}${position}: error: ${message}`), {
        located: true,
        path: file,
    });
}

/** Preserve structured findings and source-editor locations at the command boundary.
 * @param {unknown} error - Thrown error.
 * @param {string} fallback - Input path for unlocated errors.
 * @returns {object[]} Located findings.
 */
export function settlementErrorFindings(error, fallback) {
    if (Array.isArray(error?.findings) && error.findings.length) return error.findings;
    const raw = String(error?.message ?? error);
    const match = /^(.*?)(?::(\d+))?(?::(\d+))?: error: ([\s\S]*)$/.exec(raw);
    if (match)
        return [
            {
                file: match[1],
                ...(match[2] ? { line: Number(match[2]) } : {}),
                ...(match[3] ? { column: Number(match[3]) } : {}),
                severity: "error",
                message: match[4],
            },
        ];
    return [{ file: error?.path ?? error?.file ?? fallback, severity: "error", message: raw }];
}

/** Read at most limit plus one byte from one open file.
 * @param {string} file - Input path.
 * @param {number} limit - Maximum accepted byte count.
 * @param {object} [io] - File operations.
 * @param {boolean} [noFollow] - Refuse a symbolic-link input.
 * @returns {Buffer} Captured input.
 */
export function boundedRead(file, limit, io = fs, noFollow = false) {
    let fd;
    try {
        fd = io.openSync(
            file,
            fs.constants.O_RDONLY |
                fs.constants.O_NONBLOCK |
                (noFollow ? (fs.constants.O_NOFOLLOW ?? 0) : 0),
        );
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
    } catch (error) {
        throw locatedError(file, String(error?.message ?? error));
    } finally {
        if (fd !== undefined) io.closeSync(fd);
    }
}

/** Capture explicit setting resources before handing paths to trusted code.
 * @param {object} options - Root, paths and total byte limit.
 * @returns {object} Snapshot paths and cleanup.
 */
export function snapshotSettingInputs({
    root,
    indexFile,
    guideFile,
    englishWordsFile,
    englishSourcesFile,
    wordlistDirs = [],
    maxBytes,
    maxEntries = 100000,
}) {
    if (
        [indexFile, guideFile, englishWordsFile, englishSourcesFile].some(
            (file) => typeof file !== "string" || !file,
        ) ||
        !Number.isSafeInteger(maxBytes) ||
        maxBytes < 1 ||
        !Number.isSafeInteger(maxEntries) ||
        maxEntries < 1
    )
        throw new Error(
            "provide the setting index, guide, English word list and sources, and positive resource limits",
        );
    const rootPath = path.resolve(root);
    const exact = (file) => {
        const resolved = path.resolve(file);
        if (fs.realpathSync(resolved) !== resolved)
            throw locatedError(resolved, "symbolic links are not accepted for setting resources");
        return resolved;
    };
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "settlement-checks-"));
    let remaining = maxBytes;
    let entries = 0;
    const evidence = [];
    const capture = (source, target) => {
        const file = exact(source);
        const bytes = boundedRead(file, remaining, fs, true);
        remaining -= bytes.length;
        fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
        evidence.push({
            file,
            sha256: createHash("sha256").update(bytes).digest("hex"),
            bytes: bytes.length,
        });
    };
    try {
        const originalIndex = path.resolve(rootPath, indexFile);
        const capturedIndex = path.join(temporary, "index.jsonl");
        capture(originalIndex, capturedIndex);
        const originals = {
            guideFile: path.resolve(rootPath, guideFile),
            englishWordsFile: path.resolve(rootPath, englishWordsFile),
            englishSourcesFile: path.resolve(rootPath, englishSourcesFile),
        };
        const files = {};
        for (const [key, original] of Object.entries(originals)) {
            files[key] = path.join(temporary, key);
            capture(original, files[key]);
        }
        const directories = [];
        for (const [i, dir] of wordlistDirs.entries()) {
            const source = exact(path.resolve(dir));
            const target = path.join(temporary, `words-${i}`);
            fs.mkdirSync(target, { mode: 0o700 });
            const stream = fs.opendirSync(source);
            try {
                for (let entry = stream.readSync(); entry; entry = stream.readSync()) {
                    if (++entries > maxEntries)
                        throw new Error("setting resources exceed the entry limit");
                    if (entry.isSymbolicLink())
                        throw locatedError(
                            path.join(source, entry.name),
                            "symbolic links are not accepted for setting resources",
                        );
                    if (!entry.name.endsWith(".txt") && !entry.name.endsWith(".tsv")) continue;
                    if (!entry.isFile())
                        throw locatedError(
                            path.join(source, entry.name),
                            "word-list entry must be a regular file",
                        );
                    capture(path.join(source, entry.name), path.join(target, entry.name));
                }
            } finally {
                stream.closeSync();
            }
            directories.push(target);
        }
        return {
            indexFile: capturedIndex,
            ...files,
            originals,
            evidence,
            wordlistDirs: directories,
            originalIndex,
            originalDirs: [...wordlistDirs],
            cleanup: () => fs.rmSync(temporary, { recursive: true, force: true }),
        };
    } catch (error) {
        fs.rmSync(temporary, { recursive: true, force: true });
        throw error;
    }
}

function parseInputs(file) {
    const raw = boundedRead(file, 4 * 1024 * 1024).toString("utf8");
    try {
        return JSON.parse(raw);
    } catch (error) {
        const match = /position (\d+)/.exec(error.message);
        if (!match) throw locatedError(file, "invalid JSON");
        const before = raw.slice(0, Number(match[1])).split("\n");
        throw locatedError(file, "invalid JSON", before.length, before.at(-1).length + 1);
    }
}

/** Create the settlement command without loading project configuration. */
export function settlementCommand() {
    return {
        command: "settlement",
        describe: "Propose checked settlement names and rows; save them with --write",
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
                    describe: "Pinned Azgaar saved map, relative to the current directory",
                })
                .option("json", {
                    type: "string",
                    demandOption: true,
                    describe: "Pinned Azgaar Full JSON export, relative to the current directory",
                })
                .option("inputs", {
                    type: "string",
                    demandOption: true,
                    describe: "JSON operation inputs, relative to the current directory",
                })
                .option("checks-module", {
                    type: "string",
                    describe: "Trusted setting-check module, relative to the current directory",
                })
                .option("checks-root", {
                    type: "string",
                    describe:
                        "Setting-resource root, relative to the current directory (default: .)",
                })
                .option("checks-guide", {
                    type: "string",
                    describe: "Setting pronunciation guide, relative to the checks root",
                })
                .option("checks-english-words", {
                    type: "string",
                    describe: "English word-list JSON, relative to the checks root",
                })
                .option("checks-english-sources", {
                    type: "string",
                    describe: "English word-list source manifest, relative to the checks root",
                })
                .option("checks-index", {
                    type: "string",
                    describe: "Setting content index path relative to the checks root",
                })
                .option("wordlist-dir", {
                    type: "array",
                    string: true,
                    describe:
                        "Model-language word-list directory, relative to the current directory; repeatable",
                })
                .option("checks-byte-limit", {
                    type: "number",
                    default: 268435456,
                    describe:
                        "Maximum combined bytes of index, guide, English resources and word lists",
                })
                .option("checks-entry-limit", {
                    type: "number",
                    default: 100000,
                    describe: "Maximum setting word-list directory entries",
                })
                .option("checks-work-limit", {
                    type: "number",
                    default: DEFAULT_AUTHORING_WORK_LIMIT,
                    describe:
                        "Finite authoring work budget; sizing examples: docs/reference/settlement-placement.md",
                })
                .option("seed", { type: "string", describe: "Deterministic name selection seed" })
                .option("name-limit", {
                    type: "number",
                    describe: "Maximum candidate names examined per settlement",
                })
                .option("write", {
                    type: "boolean",
                    default: false,
                    describe: "Write the checked rows to the selected polity",
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
                            ![
                                "pin",
                                "mapping",
                                "bindings",
                                "settings",
                                "selection",
                                "bands",
                            ].includes(key),
                    )
                )
                    throw locatedError(
                        argv.inputs,
                        "provide pin, mapping, bindings, settings and selection",
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
                const session = await createContentSession({ config, trackChanges: true });
                try {
                    const result = selectSettlementPlacements(
                        {
                            session,
                            polityAddress: argv.polity,
                            map,
                            bindings: inputs.bindings,
                            settings: inputs.settings,
                            bands: inputs.bands,
                        },
                        inputs.selection,
                    );
                    let authoring, resourceInputs;
                    const selectionMissing = result.missing.filter(
                        (item) => item.field !== "naming",
                    );
                    if (selectionMissing.length) {
                        authoring = { missing: selectionMissing };
                    } else if (!argv.checksModule) {
                        authoring = {
                            missing: [
                                ...result.missing.filter((item) => item.field !== "naming"),
                                {
                                    field: "naming.validators",
                                    message: "provide a trusted local setting-check module",
                                },
                            ],
                        };
                    } else {
                        const modulePath = path.resolve(argv.checksModule);
                        try {
                            preflightNamedSettlements({
                                session,
                                selection: result,
                                maxCandidates: argv.nameLimit,
                                maxWork: argv.checksWorkLimit,
                            });
                        } catch (error) {
                            throw locatedError(argv.inputs, error.message);
                        }
                        let module;
                        try {
                            module = await import(pathToFileURL(modulePath).href);
                        } catch (error) {
                            throw locatedError(
                                modulePath,
                                `cannot load setting checks: ${error.message}`,
                            );
                        }
                        if (
                            typeof module.loadSettingCheckResources !== "function" ||
                            typeof module.createSettingChecks !== "function"
                        )
                            throw locatedError(
                                modulePath,
                                "setting module must export loadSettingCheckResources and createSettingChecks",
                            );
                        const snapshot = snapshotSettingInputs({
                            root: argv.checksRoot ?? process.cwd(),
                            indexFile: argv.checksIndex,
                            guideFile: argv.checksGuide,
                            englishWordsFile: argv.checksEnglishWords,
                            englishSourcesFile: argv.checksEnglishSources,
                            wordlistDirs: argv.wordlistDir ?? [],
                            maxBytes: argv.checksByteLimit,
                            maxEntries: argv.checksEntryLimit,
                        });
                        let loaded, loaderProblems;
                        resourceInputs = snapshot.evidence;
                        try {
                            loaded = await module.loadSettingCheckResources({
                                root: argv.checksRoot ?? process.cwd(),
                                indexFile: snapshot.indexFile,
                                guideFile: snapshot.guideFile,
                                englishWordsFile: snapshot.englishWordsFile,
                                englishSourcesFile: snapshot.englishSourcesFile,
                                ...(argv.wordlistDir ?
                                    { wordlistDirs: snapshot.wordlistDirs }
                                :   {}),
                            });
                            const paths = [
                                [snapshot.indexFile, snapshot.originalIndex],
                                ...Object.entries(snapshot.originals).map(([key, original]) => [
                                    snapshot[key],
                                    original,
                                ]),
                                ...snapshot.wordlistDirs.map((dir, i) => [
                                    dir,
                                    path.resolve(snapshot.originalDirs[i]),
                                ]),
                            ].sort(([a], [b]) => b.length - a.length);
                            const restorePath = (value) =>
                                paths.reduce(
                                    (text, [captured, original]) =>
                                        text.split(captured).join(original),
                                    String(value),
                                );
                            loaderProblems = (loaded?.problems ?? []).map((problem) => {
                                const raw =
                                    typeof problem === "string" ? problem : String(problem.message);
                                const source = paths.find(([captured]) =>
                                    raw.includes(captured),
                                )?.[1];
                                const field = /^([A-Za-z]+):/.exec(raw)?.[1];
                                const origin = {
                                    guide: snapshot.originals.guideFile,
                                    index: snapshot.originalIndex,
                                    englishWords: snapshot.originals.englishWordsFile,
                                }[field];
                                return {
                                    ...(typeof problem === "object" ? problem : {}),
                                    file: restorePath(
                                        problem?.file ?? source ?? origin ?? modulePath,
                                    ),
                                    severity: problem?.severity ?? "error",
                                    message: restorePath(raw),
                                };
                            });
                            if (loaded?.resources?.guide?.id)
                                loaded.resources.guide.id.source = snapshot.originals.guideFile;
                            if (loaded?.resources?.englishWords?.id)
                                loaded.resources.englishWords.id.source =
                                    snapshot.originals.englishWordsFile;
                            if (loaded?.resources?.index?.id)
                                loaded.resources.index.id.source = snapshot.originalIndex;
                            if (loaded?.resources?.earthWordLists?.id)
                                loaded.resources.earthWordLists.id.source =
                                    snapshot.originalDirs.join(path.delimiter);
                        } finally {
                            snapshot.cleanup();
                        }
                        authoring =
                            loaderProblems.length ?
                                { missing: loaderProblems }
                            :   prepareNamedSettlements({
                                    session,
                                    polityAddress: argv.polity,
                                    selection: result,
                                    factory: module.createSettingChecks,
                                    resources: loaded?.resources,
                                    seed: argv.seed,
                                    maxCandidates: argv.nameLimit,
                                    maxWork: argv.checksWorkLimit,
                                    bands: inputs.bands,
                                });
                    }
                    const missing = authoring.missing;
                    let write;
                    if (argv.write && !missing.length) {
                        session.assertUnchanged();
                        write = commitSettlementEdit(authoring.edit);
                    }
                    console.log(
                        JSON.stringify(
                            {
                                selection: result.selection,
                                resourceInputs,
                                rows: authoring.rows,
                                names: authoring.names,
                                edit: authoring.edit,
                                write,
                                missing,
                            },
                            null,
                            2,
                        ),
                    );
                    for (const item of missing) {
                        const file =
                            item.file && item.file !== "settlement-inputs" ?
                                item.file
                            :   argv.inputs;
                        console.error(
                            locatedError(
                                file,
                                `${item.field ? `${item.field}: ` : ""}${item.message}`,
                                item.line,
                                item.column,
                            ).message,
                        );
                    }
                    if (write?.cleanupErrors?.length) {
                        for (const message of write.cleanupErrors)
                            console.error(locatedError(authoring.edit.sourcePath, message).message);
                        process.exitCode = 1;
                    }
                    if (missing.length) process.exitCode = 1;
                } finally {
                    session.dispose();
                }
            } catch (error) {
                const findings = settlementErrorFindings(error, argv.inputs);
                console.log(JSON.stringify({ missing: findings }, null, 2));
                for (const finding of findings)
                    console.error(
                        formatDiagnostic({ ...finding, severity: finding.severity ?? "error" }),
                    );
                process.exitCode = 1;
            }
        },
    };
}
