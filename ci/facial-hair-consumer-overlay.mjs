/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { flattenPublishedAddresses } from "@heroiclands/package-build/engine/address-values";
import { profileProblems } from "@heroiclands/package-build/engine/appearance-profile";
import { BEING_LOOK_VOCABULARY } from "@heroiclands/package-build/engine/note-vocabulary";
import { generateNpc } from "@heroiclands/package-build/engine/npc-generate";

const genders = ["female", "male", "nonbinary", "none", "other"];
const selected = [
    "thalorna-note-lore-khelathiclt",
    "thalorna-note-lore-khazariclt",
    "thalorna-note-lore-senaliclt",
];
const proof = path.join(process.env.RUNNER_TEMP ?? ".", "consumer-proof");
const evidence = path.join(proof, "facial-hair-evidence");
const hash = (data) => createHash("sha256").update(data).digest("hex");
const files = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(dir, entry.name);
        return (
            entry.isDirectory() ? files(file)
            : entry.isFile() && file.endsWith(".md") ? [file]
            : []
        );
    });
const source = () => {
    const profiles = {};
    for (const file of files("assets/content")) {
        const text = fs.readFileSync(file, "utf8");
        const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
        if (!match) continue;
        const fm = YAML.parse(match[1]);
        if (fm?.type !== "lore" || fm.subType !== "culture" || !fm.data?.appearanceProfile)
            continue;
        const profile = fm.data.appearanceProfile;
        const problems = profileProblems(profile, BEING_LOOK_VOCABULARY);
        assert.deepEqual(problems, [], `${file}: ${JSON.stringify(problems)}`);
        if (profile.facial_hair == null) continue;
        const address = `thalorna-note-lore-${fm.shortcode}`;
        assert.ok(!profiles[address], `${address}: duplicate`);
        profiles[address] = profile;
    }
    for (const address of selected)
        assert.ok(profiles[address], `${address}: missing weighted profile`);
    assert.deepEqual(profiles[selected[0]].facial_hair_genders, ["male"]);
    assert.deepEqual(profiles[selected[1]].facial_hair_genders, genders);
    assert.deepEqual(profiles[selected[2]].facial_hair_genders, []);
    return Object.fromEntries(Object.entries(profiles).sort(([a], [b]) => a.localeCompare(b)));
};
export function verifyIndexedProfiles(profiles, rows) {
    const indexed = {};
    for (const address of Object.keys(profiles)) {
        const matches = rows.filter(
            (row) => flattenPublishedAddresses(row.address?.canonical) === address,
        );
        assert.equal(matches.length, 1, address);
        const profile = matches[0].data?.appearanceProfile;
        assert.deepEqual(profile, profiles[address], `${address}: indexed profile`);
        indexed[address] = profile.facial_hair_genders;
    }
    return indexed;
}
const sourcePath = path.join(evidence, "source-profiles.json");
if (process.argv[2] === "prepare") {
    const input = JSON.stringify(source(), null, 2) + "\n";
    fs.writeFileSync(sourcePath, input);
    fs.writeFileSync(
        path.join(evidence, "input.json"),
        JSON.stringify(
            {
                candidateSha: process.env.CANDIDATE_SHA,
                consumerSha: process.env.CONSUMER_SHA,
                archiveSha256: hash(fs.readFileSync(path.join(proof, "candidate.tgz"))),
                consumerArchiveSha256: hash(
                    fs.readFileSync(path.join(proof, "consumer-source.tar")),
                ),
                sourceProfilesSha256: hash(input),
                selected,
            },
            null,
            2,
        ) + "\n",
    );
} else if (process.argv[2] === "verify") {
    const original = fs.readFileSync(sourcePath, "utf8");
    assert.equal(JSON.stringify(source(), null, 2) + "\n", original, "source changed during build");
    const profiles = JSON.parse(original);
    const rows = fs
        .readFileSync("build/content-index/thalorna-metadata.jsonl", "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse);
    const indexed = verifyIndexedProfiles(profiles, rows);
    const names = {
        pattern: "{given} {kin}",
        given: Object.fromEntries(genders.map((g) => [g, ["Person"]])),
        kin: ["Example"],
    };
    const counts = {};
    for (const address of selected) {
        const profile = profiles[address];
        counts[address] = {};
        for (const gender of genders) {
            const totals = { omitted: 0, none: 0, beard: 0 };
            for (let i = 0; i < 64; i++) {
                const spec = { data: { culture: address, gender } };
                const context = { profile, names, seed: String(i) };
                const appearance = generateNpc(spec, context).frontmatter.data.appearance;
                const value = appearance.facial_hair;
                if (value === undefined) totals.omitted++;
                else if (value === "none") totals.none++;
                else totals.beard++;
                if (!profile.facial_hair_genders.includes(gender)) assert.equal(value, undefined);
                else assert.ok(Object.hasOwn(profile.facial_hair, value));
                const authored = generateNpc(
                    { data: { ...spec.data, appearance: { facial_hair: "none" } } },
                    context,
                ).frontmatter.data.appearance;
                assert.equal(authored.facial_hair, "none");
            }
            counts[address][gender] = totals;
        }
    }
    assert.ok(counts[selected[0]].male.beard > 0);
    for (const gender of genders) {
        assert.equal(counts[selected[1]][gender].beard, 64);
        assert.equal(counts[selected[2]][gender].omitted, 64);
    }
    const profile = profiles[selected[0]];
    const spec = { data: { culture: selected[0], gender: "male" } };
    const context = { profile, names, seed: "stable" };
    const eligible = generateNpc(spec, context).frontmatter;
    const excluded = generateNpc(spec, {
        ...context,
        profile: { ...profile, facial_hair_genders: [] },
    }).frontmatter;
    assert.ok(Object.hasOwn(eligible.data.appearance, "facial_hair"));
    assert.ok(!Object.hasOwn(excluded.data.appearance, "facial_hair"));
    const comparable = structuredClone(eligible);
    delete comparable.data.appearance.facial_hair;
    assert.deepEqual(comparable, excluded);
    const cli = {};
    for (const gender of ["female", "male"]) {
        const output = path.join(evidence, `khelathi-${gender}.md`);
        const spec = JSON.stringify({ data: { culture: selected[0], gender } });
        const result = spawnSync(
            process.execPath,
            [
                "node_modules/@heroiclands/package-build/bin/package-build.mjs",
                "npc",
                "new",
                "--spec",
                spec,
                "--seed",
                "consumer-proof",
                "--out",
                output,
            ],
            { encoding: "utf8" },
        );
        assert.equal(result.status, 0, `npc new ${gender}: ${result.error ?? result.stderr}`);
        const text = fs.readFileSync(output, "utf8");
        const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
        assert.ok(match, `npc new ${gender}: missing frontmatter`);
        const data = YAML.parse(match[1]).data;
        assert.equal(data.gender, gender);
        const appearance = data.appearance;
        if (gender === "female") assert.ok(!Object.hasOwn(appearance, "facial_hair"));
        else assert.ok(Object.hasOwn(profiles[selected[0]].facial_hair, appearance.facial_hair));
        cli[gender] = {
            facialHair: appearance.facial_hair ?? null,
            omitted: !Object.hasOwn(appearance, "facial_hair"),
        };
    }
    fs.writeFileSync(
        path.join(evidence, "results.json"),
        JSON.stringify({ indexed, counts, seededFrontmatterStable: true, cli }, null, 2) + "\n",
    );
} else if (
    process.argv[2] !== undefined &&
    process.argv[1]?.endsWith("facial-hair-consumer-overlay.mjs")
) {
    throw new Error("Expected prepare or verify");
}
