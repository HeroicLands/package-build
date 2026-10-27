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
/** Build the browser's JSON inputs from the same context that renders native runs. */
import fs from "node:fs";
import path from "node:path";
import { runContext } from "./content-scripts.mjs";
import { languageRecordsByName, serializeLexicon } from "./encoding-lexicon.mjs";
import { indexRecordsFor } from "./content-index.mjs";
import { validateData } from "../convert.mjs";

/** Return only the published definitions and lexical inputs the converter reads. */
export function buildConverterData(config, records) {
    const context = runContext(config, records);
    if (context.encodingFindings?.length)
        throw new Error(context.encodingFindings.map((finding) => finding.message).join("\n"));
    const languageNotes = languageRecordsByName(records, config);
    const data = { format: 2, contentPackage: config.contentPackage, encodings: {}, languages: {} };
    for (const [name, definition] of context.encodingDefinitions ?? [])
        data.encodings[name] = definition;
    for (const language of Object.keys(config.languages ?? {})) {
        const note = languageNotes.get(language);
        const name = note?.name;
        data.languages[language] = {
            name: typeof name === "string" ? name : (name?.full ?? language),
            ...(context.lexicons?.has(language) ?
                { lexicon: serializeLexicon(context.lexicons.get(language)) }
            :   {}),
        };
    }
    return validateData(data);
}

/** Write opted-in converter inputs during the package's manifest build. */
export function writeConverterData({ config, packageBuild, records }) {
    if (!packageBuild.converterData) return undefined;
    const stage = path.resolve(config.rootDir, packageBuild.stageDir);
    const out = path.resolve(stage, packageBuild.converterData);
    const relative = path.relative(stage, out);
    if (
        !relative ||
        relative.startsWith(`..${path.sep}`) ||
        relative === ".." ||
        path.isAbsolute(relative)
    )
        throw new Error("converterData must be a file within the build stage");
    const problems = [];
    const inputs =
        records ??
        indexRecordsFor({
            config,
            contentBase: config.paths.content,
            skipDirectories: config.skipDirectories,
            problems,
        });
    if (problems.length) throw new Error(problems.map((finding) => finding.message).join("\n"));
    const data = buildConverterData(config, inputs);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(data, null, 4) + "\n", "utf8");
    return { path: out, data };
}
