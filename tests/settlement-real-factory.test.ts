/* SPDX-License-Identifier: GPL-3.0-or-later */
import { expect, it } from "vitest";

it.skipIf(!process.env.SETTLEMENT_SETTING_CHECKOUT)(
    "runs the actual setting factory through dry run, write and fresh index",
    async () => {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const { spawnSync } = await import("node:child_process");
        const { fixture, note, write } = await import("./content-session-fixture.js");
        const { createContentSession } = await import("../engine/content-session.mjs");
        const { prepareSettlementEdit, commitSettlementEdit } =
            await import("../engine/settlement-source.mjs");
        const { settlementMapFixture } = await import("./settlement-cli-map-fixture.js");
        const setting = process.env.SETTLEMENT_SETTING_CHECKOUT;
        if (!setting) throw new Error("SETTLEMENT_SETTING_CHECKOUT is required");
        const YAML = await import("yaml");
        const f = fixture(8, "thalorna");
        const configData = YAML.parse(fs.readFileSync(f.configFile, "utf8"));
        configData.languages = { aelw: { tag: "art-x-aelw", note: "skill-aelwthlng" } };
        write(f.configFile, YAML.stringify(configData));
        const { configFromData } = await import("../engine/pack-config.mjs");
        const config = configFromData(configData, f.configFile);
        try {
            const content = f.config.paths.content;
            fs.copyFileSync(
                path.join(setting, "assets/content/Skills/Languages/Eilwithi_Language.md"),
                path.join(content, "Note2.md"),
            );
            write(
                path.join(content, "Note3.md"),
                note({
                    type: "lore",
                    subType: "culture",
                    shortcode: "folk",
                    name: { full: "Folk" },
                    data: { lang: "aelw", householdSize: 5 },
                }),
            );
            const crown = path.join(content, "Crown.md");
            const before = note(
                {
                    type: "affiliation",
                    subType: "polity",
                    shortcode: "crown",
                    name: { full: "Crown" },
                    data: { territorial_population: 5, settlements: [] },
                },
                "Keep this prose.",
            );
            write(crown, before);
            const session = await createContentSession({ config });
            try {
                write(
                    path.join(f.root, "index.jsonl"),
                    session.records.map((r: any) => JSON.stringify(r)).join("\n") + "\n",
                );
            } finally {
                session.dispose();
            }
            const mapFixture = settlementMapFixture();
            const input = mapFixture.input();
            write(path.join(f.root, "world.map"), input.map);
            write(path.join(f.root, "world.json"), input.json);
            const polity = "thalorna-note-affiliation-crown";
            const profile = {
                land: [5, 5, 5, 5],
                development: 1,
                holdingAcres: 25,
                foodApproach: "agrarian",
                economicFocus: "agrarian",
                governance: "appointed",
                obligation: 0.3,
                upwardShare: 0.3,
            };
            write(
                path.join(f.root, "inputs.json"),
                JSON.stringify({
                    pin: input.pin,
                    mapping: {
                        state: { id: 1, address: polity },
                        cultures: { "1": "thalorna-note-lore-folk" },
                    },
                    bindings: {},
                    settings: {
                        urbanShares: { [polity]: 0 },
                        placements: [],
                        landRules: [{ when: { biome: 1 }, profile }],
                        urban: { sources: [], routes: [], cities: [] },
                    },
                    selection: {
                        cellIds: [0],
                        existingSites: [],
                        spacingMeters: 5556,
                        candidateLimit: 100,
                        workLimit: 1000000000000,
                    },
                }),
            );
            const binary = path.resolve("bin/package-build.mjs");
            const provider = path.join(setting, "utils/setting-checks.mjs");
            const args = [
                binary,
                "settlement",
                "--polity",
                polity,
                "--map",
                "world.map",
                "--json",
                "world.json",
                "--inputs",
                "inputs.json",
                "--checks-module",
                provider,
                "--checks-index",
                "index.jsonl",
                "--checks-guide",
                path.join(setting, "assets/content/Lore/Pronouncing_Thalorna.md"),
                "--checks-english-words",
                path.join(setting, "assets/data/english-words.json"),
                "--checks-english-sources",
                path.join(setting, "assets/data/english-words.sources.json"),
                "--seed",
                "fixture",
                "--name-limit",
                "10000",
            ];
            const run = (...extra: string[]) =>
                spawnSync(process.execPath, [...args, ...extra], {
                    cwd: f.root,
                    encoding: "utf8",
                    env: {
                        ...process.env,
                        PACKAGE_BUILD_CONFIG: path.join(f.root, "package-build.config.yaml"),
                    },
                    timeout: 30000,
                });
            const dry = run();
            expect(dry.status, dry.stderr).toBe(0);
            const dryReport = JSON.parse(dry.stdout);
            expect(dryReport.rows).toHaveLength(1);
            expect(dryReport.resourceInputs.map((item: any) => path.basename(item.file))).toEqual(
                expect.arrayContaining([
                    "index.jsonl",
                    "Pronouncing_Thalorna.md",
                    "english-words.json",
                    "english-words.sources.json",
                ]),
            );
            expect(
                dryReport.resourceInputs.every((item: any) => /^[a-f0-9]{64}$/.test(item.sha256)),
            ).toBe(true);
            expect(fs.readFileSync(crown, "utf8")).toBe(before);
            const missingArgs = [...args];
            missingArgs[missingArgs.indexOf("--checks-guide") + 1] = path.join(
                f.root,
                "missing-guide.md",
            );
            const unavailable = spawnSync(process.execPath, [...missingArgs, "--write"], {
                cwd: f.root,
                encoding: "utf8",
                env: { ...process.env, PACKAGE_BUILD_CONFIG: f.configFile },
                timeout: 30000,
            });
            expect(unavailable.status).toBe(1);
            expect(fs.readFileSync(crown, "utf8")).toBe(before);
            // The dry-run rows come from the actual setting factory. Capture their source
            // edit, then change the fixture before the source editor attempts the write.
            const captured = await createContentSession({ config });
            try {
                const edit = prepareSettlementEdit({
                    contentRoot: captured.contentBase,
                    contentPackage: captured.config.contentPackage,
                    polityAddress: polity,
                    records: captured.records,
                    sources: captured.sources,
                    rows: dryReport.rows,
                });
                expect(edit.changed).toBe(true);
                const otherFiles = [
                    f.configFile,
                    ...fs
                        .readdirSync(content, { recursive: true, withFileTypes: true })
                        .filter((entry) => entry.isFile())
                        .map((entry) => path.join(entry.parentPath, entry.name))
                        .filter((file) => file !== crown),
                    ...["index.jsonl", "world.map", "world.json", "inputs.json"].map((name) =>
                        path.join(f.root, name),
                    ),
                ];
                const otherBytes = otherFiles.map((file) => fs.readFileSync(file));
                const intervening = before + "Another author edited this note.\n";
                fs.writeFileSync(crown, intervening);
                expect(() => commitSettlementEdit(edit)).toThrow(/stale source.*changed/i);
                expect(fs.readFileSync(crown, "utf8")).toBe(intervening);
                for (const [i, file] of otherFiles.entries())
                    expect(fs.readFileSync(file)).toEqual(otherBytes[i]);
            } finally {
                captured.dispose();
                fs.writeFileSync(crown, before);
            }
            const lock = path.join(content, ".Crown.md.settlement-write.lock");
            fs.writeFileSync(lock, "busy");
            const blocked = run("--write");
            expect(blocked.status).toBe(1);
            expect(blocked.stderr).toContain(crown);
            expect(JSON.parse(blocked.stdout).missing[0].file).toBe(crown);
            expect(fs.readFileSync(crown, "utf8")).toBe(before);
            fs.rmSync(lock);
            const saved = run("--write");
            expect(saved.status, saved.stderr).toBe(0);
            expect(JSON.parse(saved.stdout).write.written).toBe(true);
            const after = fs.readFileSync(crown, "utf8");
            expect(after).toContain(dryReport.rows[0].settlement);
            expect(after).toContain("Keep this prose.");
            const refreshed = await createContentSession({ config });
            try {
                write(
                    path.join(f.root, "index.jsonl"),
                    refreshed.records.map((r: any) => JSON.stringify(r)).join("\n") + "\n",
                );
            } finally {
                refreshed.dispose();
            }
            const selected = dryReport.selection.candidates.find(
                (item: any) => item.households > 0,
            );
            expect(selected).toBeDefined();
            const nextInputs = JSON.parse(
                fs.readFileSync(path.join(f.root, "inputs.json"), "utf8"),
            );
            nextInputs.selection.existingSites = [{ identity: "row:0", point: selected.point }];
            nextInputs.settings.placements = [
                {
                    source: dryReport.rows[0].generatorSource,
                    cellId: selected.cellId,
                    areaAcres: selected.areaAcres,
                    cellAreaAcres: selected.physicalAcres,
                },
            ];
            write(path.join(f.root, "inputs.json"), JSON.stringify(nextInputs));
            const repeat = run("--write");
            expect(repeat.status, repeat.stderr).toBe(0);
            expect(JSON.parse(repeat.stdout).rows).toHaveLength(1);
            expect(fs.readFileSync(crown, "utf8")).toBe(after);
        } finally {
            fs.rmSync(f.root, { recursive: true, force: true });
        }
    },
    120000,
);
