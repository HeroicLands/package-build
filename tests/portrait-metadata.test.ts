/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { spawnSync } from "node:child_process";
import { SUBPROCESS_TEST_TIMEOUT, subprocessTimeout } from "./subprocess-timeout.js";
import {
    collectContentIndex,
    indexRecordsFor,
    serializeContentIndex,
} from "../engine/content-index.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { configFromData } from "../engine/pack-config.mjs";
import {
    loadForeignIndexes,
    markComplete,
    metadataCacheDir,
    metadataFileName,
} from "../engine/metadata-index.mjs";
import {
    checkPortraitPrompt,
    portraitFromData,
    resolvePortraitItems,
} from "../engine/portrait-prompt.mjs";

const text = (fm: object) =>
    `---\n${YAML.stringify(fm)}---\n\nA complete note with enough words to describe its subject.\n`;

describe("portrait dependency metadata", () => {
    it(
        "recomputes a published being's prompt after an item model changes",
        () => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "portrait-metadata-"));
            try {
                fs.writeFileSync(
                    path.join(root, "package.json"),
                    JSON.stringify({ name: "demo", version: "1.0.0" }),
                );
                const configData = {
                    contentPackage: "demo",
                    packageKind: "modules",
                    compatibility: { minimum: "14", verified: "14.367" },
                    stats: { lastModifiedBy: "portraittest0000" },
                    packs: [{ name: "journals", type: "JournalEntry", default: true }],
                    relationships: {
                        requires: [
                            {
                                id: "gear",
                                manifest: "https://example.invalid/system.json",
                                type: "module",
                                compatibility: { verified: "1.0.0" },
                            },
                            {
                                id: "cast",
                                manifest: "https://example.invalid/system.json",
                                type: "module",
                                compatibility: { verified: "1.0.0" },
                            },
                        ],
                    },
                };
                const configPath = path.join(root, "package-build.config.yaml");
                fs.writeFileSync(configPath, YAML.stringify(configData));
                const config = configFromData(configData, configPath);
                const publish = (pkg: string, fm: object, options: object = {}) => {
                    const tree = path.join(root, pkg);
                    fs.mkdirSync(tree, { recursive: true });
                    fs.writeFileSync(path.join(tree, "note.md"), text(fm));
                    const records = collectContentIndex(tree, {
                        contentPackage: pkg,
                        skipDirectories: [],
                        ...options,
                    });
                    const dest = metadataCacheDir(config, pkg, "1.0.0");
                    fs.mkdirSync(dest, { recursive: true });
                    fs.writeFileSync(
                        path.join(dest, metadataFileName(pkg)),
                        serializeContentIndex(records),
                    );
                    markComplete(dest);
                    return records;
                };
                const gear = (name: string) => ({
                    type: "miscgear",
                    shortcode: "lantern",
                    name: { full: "Lantern" },
                    data: { kind: "miscgear", name },
                });
                publish("gear", gear("lamp"));
                publish("cast", {
                    type: "being",
                    shortcode: "person",
                    name: { full: "Person" },
                    data: {},
                });
                const oldGear = loadForeignIndexes(config, ["demo"]).index;
                expect([...oldGear.keys()].filter((key) => key.includes("lantern"))).toContain(
                    "gear-sohl-miscgear-lantern",
                );
                const being: any = {
                    type: "being",
                    subType: "npc",
                    shortcode: "person",
                    name: { full: "Person" },
                    data: {
                        gender: "female",
                        appearance: { skin_color: "brown", complexion: ["freckled"] },
                        portraitSettings: { model: "sdxl", seed: "sample", ageBand: "adult" },
                        items: [{ model: "gear-note-miscgear-lantern" }],
                    },
                };
                const oldIndex = {
                    contentPackage: "cast",
                    types: new Set(["miscgear"]),
                    packages: new Set(["gear", "cast"]),
                    addressHit: (address: string) => oldGear.get(address),
                    foreign: { index: oldGear },
                };
                const frozen = portraitFromData(
                    being.data,
                    resolvePortraitItems(being.data, oldIndex),
                );
                being.data.portrait = { prompt: frozen.positive, negativePrompt: frozen.negative };
                const castRecords = publish("cast", being, {
                    requiredModules: ["gear"],
                    foreignRecord: (key: string) =>
                        (oldGear.get(key) ?? oldGear.get(key.replace("-note-", "-sohl-")))
                            ?.itemRecord,
                });
                expect(
                    castRecords.find((record: any) => record.type === "being").data.items[0].name,
                ).toBe("lamp");
                publish("gear", gear("changed lantern"));
                const content = path.join(root, "assets", "content");
                fs.mkdirSync(content, { recursive: true });
                const records = indexRecordsFor({ contentBase: content, config });
                const index = buildLinkIndex(content, { config, records });
                const hit: any = index.foreign.index.get("cast-sohl-being-person");
                expect(hit.data.portraitSettings.model).toBe("sdxl");
                expect(hit.authoredItems).toHaveLength(1);
                const items = resolvePortraitItems(hit.data, index, hit.authoredItems);
                expect(items[0].name).toBe("changed lantern");
                const findings = checkPortraitPrompt(
                    { fm: { data: hit.data }, authoredItems: hit.authoredItems },
                    { index },
                );
                expect(findings[0].message).toContain("stale");
                const cli = path.resolve(__dirname, "../bin/package-build.mjs");
                const result = spawnSync(
                    process.execPath,
                    [cli, "npc", "prompt", "cast-note-being-person"],
                    {
                        cwd: root,
                        env: { ...process.env, PACKAGE_BUILD_CONFIG: configPath },
                        encoding: "utf8",
                        timeout: SUBPROCESS_TEST_TIMEOUT,
                    },
                );
                expect(result.status, result.stderr).toBe(0);
                expect(JSON.parse(result.stdout).positive).toContain("carrying changed lantern");
                delete being.data.portraitSettings.seed;
                publish("cast", being, {
                    requiredModules: ["gear"],
                    foreignRecord: (key: string) =>
                        (oldGear.get(key) ?? oldGear.get(key.replace("-note-", "-sohl-")))
                            ?.itemRecord,
                });
                const missing = spawnSync(
                    process.execPath,
                    [cli, "npc", "prompt", "cast-note-being-person"],
                    {
                        cwd: root,
                        env: { ...process.env, PACKAGE_BUILD_CONFIG: configPath },
                        encoding: "utf8",
                        timeout: SUBPROCESS_TEST_TIMEOUT,
                    },
                );
                expect(missing.status).not.toBe(0);
                expect(missing.stderr).toMatch(
                    /package-build\.config\.yaml: error: .*portraitSettings/,
                );
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
        subprocessTimeout(2),
    );
});
