/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fixture, note, write } from "./content-session-fixture.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const indexUrl = pathToFileURL(path.join(root, "engine/content-index.mjs")).href;
const configUrl = pathToFileURL(path.join(root, "engine/pack-config.mjs")).href;

describe("explicit index configuration", () => {
    for (const ambient of [false, true]) {
        it(`decodes bundle document addresses ${ambient ? "with a conflicting ambient config" : "without ambient config"}`, () => {
            const consumer = fixture(0);
            const other = ambient ? fixture(0, "other") : undefined;
            const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "index-context-"));
            try {
                write(
                    path.join(consumer.config.paths.content, "Bundle.md"),
                    note({
                        type: "bundle",
                        shortcode: "example",
                        name: { full: "Example" },
                        data: { contents: ["sessionproof-note-docmap-path"] },
                    }),
                );
                const source = `
                    import fs from 'node:fs';
                    import { readPackConfig, loadPackConfig } from ${JSON.stringify(configUrl)};
                    import { indexRecordsFor } from ${JSON.stringify(indexUrl)};
                    const config = readPackConfig(${JSON.stringify(consumer.configFile)});
                    const problems = [];
                    const records = indexRecordsFor({ config, problems, pinnedArt: false });
                    const bundle = records.find(record => record.shortcode === 'example');
                    let ambientRead = false;
                    if (process.env.PACKAGE_BUILD_CONFIG) {
                        fs.unlinkSync(process.env.PACKAGE_BUILD_CONFIG);
                        try { loadPackConfig(); ambientRead = true; } catch {}
                    }
                    console.log(JSON.stringify({ problems, bundle: Boolean(bundle), contents: bundle?.data?.contents, ambientRead }));
                `;
                const env = { ...process.env };
                if (other) env.PACKAGE_BUILD_CONFIG = other.configFile;
                else delete env.PACKAGE_BUILD_CONFIG;
                const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
                    cwd,
                    env,
                    encoding: "utf8",
                });
                expect(result.status, result.stderr).toBe(0);
                const output = JSON.parse(result.stdout);
                expect(output.problems).toEqual([]);
                expect(output.bundle).toBe(true);
                expect(output.contents).toMatchObject([
                    { package: "sessionproof", system: "note", type: "map", shortcode: "path" },
                ]);
                expect(output.ambientRead).toBe(false);
            } finally {
                fs.rmSync(consumer.root, { recursive: true, force: true });
                if (other) fs.rmSync(other.root, { recursive: true, force: true });
                fs.rmSync(cwd, { recursive: true, force: true });
            }
        });
    }
});
