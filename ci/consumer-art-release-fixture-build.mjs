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
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { spawnSync } from "node:child_process";
import { writeSvgProvenance } from "@heroiclands/package-build/engine/art-provenance";

assert.ok(process.env.GITHUB_ACTIONS === "true" || process.env.GITEA_ACTIONS === "true");
const { phase, urls } = JSON.parse(fs.readFileSync(process.env.ART_RELEASE_PROOF_NETWORK, "utf8"));
for (const directory of ["build/.cache/art", "build/cache/note-page"])
    assert.ok(
        !fs.existsSync(path.join(directory, "fixture-sentinel")),
        "generated cache survives a phase reset",
    );
if (process.env.FIXTURE_FAULT === "cold-extra-fetch" && phase === "cold") {
    const response = await fetch(urls[0]);
    await response.arrayBuffer();
}
if (process.env.FIXTURE_FAULT === "warm-fetch" && phase === "warm") await fetch(urls[0]);
for (const args of [["content-index"], ["assets"], ["package", "compile"]]) {
    const result = spawnSync(
        process.execPath,
        ["node_modules/@heroiclands/package-build/bin/package-build.mjs", ...args],
        { stdio: "inherit", env: process.env },
    );
    assert.equal(result.status, 0, "fixture consumer compilation failed");
}
const index = "build/content-index/thalorna-metadata.jsonl";
const rows = fs.readFileSync(index, "utf8").trim().split("\n").map(JSON.parse);
const art = rows.find((row) => row.asset?.ai === false);
const ai = rows.find((row) => row.asset?.ai === true);
assert.ok(art && ai, "fixture requires both original statuses");
const fault = process.env.FIXTURE_FAULT;
if (fault === "missing-index") rows.splice(rows.indexOf(ai), 1);
if (fault === "private-index") art.asset.prompt = "private fixture sentinel";
if (fault === "license") art.asset.license = "CC-BY-SA-4.0";
if (fault === "credits") art.asset.attribution = ["Wrong credit"];
if (fault === "alternative") ai.asset.nonAiAlternative = null;
fs.writeFileSync(index, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
const image = path.join("build/stage", art.asset.path);
if (fault === "rights")
    fs.writeFileSync(
        image,
        writeSvgProvenance(fs.readFileSync(image), { rights: "Wrong terms" }).bytes,
    );
if (fault === "private-derivative")
    fs.writeFileSync(
        image,
        writeSvgProvenance(fs.readFileSync(image), { prompt: "private fixture sentinel" }).bytes,
    );
if (fault === "ai-stage") {
    const target = path.join("build/stage", ai.asset.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(image, target);
}
if (fault === "warm-output" && phase === "warm") {
    const before = fs.readFileSync(image, "utf8");
    const after = before.replace('fill="red"', 'fill="blue"');
    assert.notEqual(before, after, "fixture changes a drawing value");
    fs.writeFileSync(image, after);
}
if (fault === "source") fs.appendFileSync("assets/content/fixture.md", "\nChanged source.\n");
if (fault === "pack") fs.writeFileSync("build/stage/packs/macros/CURRENT", "invalid\n");
if (fault === "reference") {
    const visit = (value) => {
        if (typeof value === "string")
            return value.startsWith("modules/thalorna/") ? "unreferenced" : value;
        if (Array.isArray(value)) return value.map(visit);
        if (value && typeof value === "object")
            return Object.fromEntries(
                Object.entries(value).map(([key, item]) => [key, visit(item)]),
            );
        return value;
    };
    const walk = (directory) => {
        for (const name of fs.readdirSync(directory)) {
            const file = path.join(directory, name);
            if (fs.statSync(file).isDirectory()) walk(file);
            else if (name.endsWith(".json"))
                fs.writeFileSync(
                    file,
                    JSON.stringify(visit(JSON.parse(fs.readFileSync(file, "utf8")))),
                );
        }
    };
    walk("build/packs-json");
}
if (fault === "cached-bytes") {
    const config = YAML.parse(fs.readFileSync(process.env.PACKAGE_BUILD_CONFIG, "utf8"));
    const file = path.join(
        process.env.XDG_CACHE_HOME,
        "heroiclands/downloads",
        config.art.archives[0].sha256,
    );
    const bytes = fs.readFileSync(file);
    bytes[0] ^= 1;
    fs.writeFileSync(file, bytes);
}
if (fault === "cleanup")
    fs.mkdirSync(path.join(process.env.XDG_CACHE_HOME, "heroiclands/downloads/.art-archive-leak"));
for (const directory of ["build/.cache/art", "build/cache/note-page"]) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "fixture-sentinel"), "must be removed");
}
