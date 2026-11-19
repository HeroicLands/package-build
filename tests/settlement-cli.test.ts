/* SPDX-License-Identifier: GPL-3.0-or-later */
import { execFileSync } from "node:child_process";
import { expect, it, vi } from "vitest";
import { SUBPROCESS_TEST_TIMEOUT, subprocessTimeout } from "./subprocess-timeout.js";

it("describes on-demand settlement inputs without loading project configuration", () => {
    const env = { ...process.env };
    delete env.PACKAGE_BUILD_CONFIG;
    delete env.CONTENT_BUILD_CONFIG;
    const help = execFileSync(process.execPath, ["bin/package-build.mjs", "settlement", "--help"], {
        env,
        encoding: "utf8",
    });
    for (const option of ["--polity", "--map", "--json", "--inputs", "--write"])
        expect(help).toContain(option);
});

it("bounds a growing file through one descriptor and closes it", async () => {
    const { boundedRead } = await import("../bin/settlement-command.mjs");
    let requested = 0;
    let closed = false;
    const io = {
        openSync: () => 4,
        fstatSync: () => ({ isFile: () => true, size: 0 }),
        readSync: (_fd: number, _buffer: Buffer, _offset: number, length: number) => {
            requested += length;
            return length;
        },
        closeSync: () => {
            closed = true;
        },
    };
    expect(() => boundedRead("growing", 8, io as any)).toThrow(/limit/);
    expect(requested).toBe(9);
    expect(closed).toBe(true);
});

it("preserves a located configuration file in both error outputs", async () => {
    const fs = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const config = await import("../engine/pack-config.mjs");
    const adapter = await import("../engine/azgaar-map.mjs");
    const { settlementCommand } = await import("../bin/settlement-command.mjs");
    const root = fs.mkdtempSync(join(tmpdir(), "settlement-config-error-"));
    const priorExit = process.exitCode;
    try {
        const inputs = join(root, "inputs.json"),
            map = join(root, "map"),
            json = join(root, "map.json"),
            configFile = join(root, "package-build.config.yaml");
        fs.writeFileSync(inputs, "{}");
        fs.writeFileSync(map, "map");
        fs.writeFileSync(json, "{}");
        fs.writeFileSync(configFile, "contentPackage: invalid\n");
        const failure = config.locateConfigError(
            Object.assign(new Error("invalid package"), { field: "contentPackage" }),
            configFile,
        ) as Error & { file: string; located: boolean };
        expect(failure.file).toBe(configFile);
        expect(failure.located).toBe(true);
        vi.spyOn(adapter, "readAzgaarMap").mockReturnValue({} as any);
        vi.spyOn(config, "loadPackConfig").mockImplementation(() => {
            throw failure;
        });
        const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
        const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
        await settlementCommand().handler({
            inputs,
            map,
            json,
            polity: "example-note-affiliation-crown",
        });
        expect(process.exitCode).toBe(1);
        expect(stderr.mock.calls).toEqual([[failure.message]]);
        expect(stdout).toHaveBeenCalledTimes(1);
        expect(JSON.parse(String(stdout.mock.calls[0][0])).missing).toEqual([
            { file: configFile, line: 1, column: 1, severity: "error", message: "invalid package" },
        ]);
        expect(fs.readFileSync(inputs, "utf8")).toBe("{}");
        expect(fs.readFileSync(configFile, "utf8")).toBe("contentPackage: invalid\n");
    } finally {
        process.exitCode = priorExit;
        vi.restoreAllMocks();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

it("reports malformed and missing input as located diagnostics", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { spawnSync } = await import("node:child_process");
    const dir = mkdtempSync(join(tmpdir(), "settlement-cli-"));
    try {
        const file = join(dir, "inputs.json");
        const run = () =>
            spawnSync(
                process.execPath,
                [
                    "bin/package-build.mjs",
                    "settlement",
                    "--polity",
                    "x-note-affiliation-a",
                    "--map",
                    "map",
                    "--json",
                    "map.json",
                    "--inputs",
                    file,
                ],
                { encoding: "utf8" },
            );
        writeFileSync(file, '{\n  "a": }');
        const malformed = run();
        expect(malformed.status).toBe(1);
        const finding = JSON.parse(malformed.stdout).missing[0];
        expect(finding).toMatchObject({ file, severity: "error", message: "invalid JSON" });
        if (finding.line !== undefined) {
            expect(finding.line).toBe(2);
            expect(finding.column).toBe(8);
            expect(malformed.stderr).toBe(`${file}:2:8: error: invalid JSON\n`);
        } else {
            expect(finding.column).toBeUndefined();
            expect(malformed.stderr).toBe(`${file}: error: invalid JSON\n`);
        }
        writeFileSync(file, '{"a":');
        const eof = run();
        expect(eof.status).toBe(1);
        expect(eof.stderr).toBe(`${file}: error: invalid JSON\n`);
        rmSync(file);
        const missing = run();
        expect(missing.status).toBe(1);
        expect(missing.stderr).toMatch(/inputs\.json: error:/);
        expect(JSON.parse(missing.stdout).missing).toHaveLength(1);
        writeFileSync(
            file,
            JSON.stringify({
                pin: { mapHash: "0".repeat(64), jsonHash: "0".repeat(64) },
                mapping: {},
            }),
        );
        const map = join(dir, "map");
        const json = join(dir, "map.json");
        writeFileSync(map, "map bytes");
        writeFileSync(json, "{}");
        const mismatch = spawnSync(
            process.execPath,
            [
                "bin/package-build.mjs",
                "settlement",
                "--polity",
                "x-note-affiliation-a",
                "--map",
                map,
                "--json",
                json,
                "--inputs",
                file,
            ],
            { encoding: "utf8" },
        );
        expect(mismatch.status).toBe(1);
        expect(mismatch.stderr).toMatch(/map: error: saved map hash differs/);
        expect(JSON.parse(mismatch.stdout).missing).toHaveLength(1);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

it(
    "rejects a FIFO without a writer and identifies oversized map and JSON files",
    async () => {
        const { mkdtempSync, writeFileSync, truncateSync, rmSync } = await import("node:fs");
        const { tmpdir } = await import("node:os");
        const { join } = await import("node:path");
        const { spawnSync } = await import("node:child_process");
        const dir = mkdtempSync(join(tmpdir(), "settlement-bounds-"));
        try {
            const file = join(dir, "inputs.json"),
                map = join(dir, "map"),
                json = join(dir, "map.json"),
                pipe = join(dir, "pipe");
            writeFileSync(file, JSON.stringify({ pin: {}, mapping: {} }));
            writeFileSync(map, "map");
            writeFileSync(json, "{}");
            const run = (input: string, mapPath = map, jsonPath = json) =>
                spawnSync(
                    process.execPath,
                    [
                        "bin/package-build.mjs",
                        "settlement",
                        "--polity",
                        "x-note-affiliation-a",
                        "--map",
                        mapPath,
                        "--json",
                        jsonPath,
                        "--inputs",
                        input,
                    ],
                    { encoding: "utf8", timeout: SUBPROCESS_TEST_TIMEOUT },
                );
            const made = spawnSync("mkfifo", [pipe]);
            expect(made.status).toBe(0);
            const fifo = run(pipe);
            expect(fifo.signal).toBeNull();
            expect(fifo.status).toBe(1);
            expect(fifo.stderr).toContain(`${pipe}: error:`);
            expect(JSON.parse(fifo.stdout).missing[0].file).toBe(pipe);
            truncateSync(map, 64 * 1024 * 1024 + 1);
            const largeMap = run(file);
            expect(largeMap.status).toBe(1);
            expect(largeMap.stderr).toContain(`${map}: error:`);
            expect(JSON.parse(largeMap.stdout).missing[0].file).toBe(map);
            truncateSync(map, 0);
            truncateSync(json, 256 * 1024 * 1024 + 1);
            const largeJson = run(file);
            expect(largeJson.status).toBe(1);
            expect(largeJson.stderr).toContain(`${json}: error:`);
            expect(JSON.parse(largeJson.stdout).missing[0].file).toBe(json);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    },
    subprocessTimeout(5),
);

it("snapshots a bounded index and word lists independently of later file changes", async () => {
    const { snapshotSettingInputs } = await import("../bin/settlement-command.mjs");
    const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } =
        await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "setting-resource-")));
    try {
        const words = join(dir, "words");
        mkdirSync(words);
        writeFileSync(join(dir, "index.jsonl"), "one\n");
        writeFileSync(join(words, "words.txt"), "word\n");
        writeFileSync(join(dir, "guide.md"), "alphabet");
        writeFileSync(join(dir, "english.json"), "[]");
        writeFileSync(join(dir, "sources.json"), "{}");
        const captured = snapshotSettingInputs({
            root: dir,
            indexFile: "index.jsonl",
            guideFile: "guide.md",
            englishWordsFile: "english.json",
            englishSourcesFile: "sources.json",
            wordlistDirs: [words],
            maxBytes: 100,
        });
        try {
            writeFileSync(join(dir, "index.jsonl"), "changed\n");
            writeFileSync(join(words, "words.txt"), "changed\n");
            expect(readFileSync(captured.indexFile, "utf8")).toBe("one\n");
            expect(readFileSync(captured.guideFile, "utf8")).toBe("alphabet");
            expect(readFileSync(captured.englishWordsFile, "utf8")).toBe("[]");
            expect(readFileSync(captured.englishSourcesFile, "utf8")).toBe("{}");
            expect(
                captured.evidence.find((item: any) => item.file.endsWith("guide.md")).sha256,
            ).toMatch(/^[a-f0-9]{64}$/);
            expect(readFileSync(join(captured.wordlistDirs[0], "words.txt"), "utf8")).toBe(
                "word\n",
            );
        } finally {
            captured.cleanup();
        }
        expect(() =>
            snapshotSettingInputs({
                root: dir,
                indexFile: "index.jsonl",
                guideFile: "guide.md",
                englishWordsFile: "english.json",
                englishSourcesFile: "sources.json",
                wordlistDirs: [words],
                maxBytes: 2,
            }),
        ).toThrow(/limit/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

it("preserves source and structured validation locations in command findings", async () => {
    const { settlementErrorFindings } = await import("../bin/settlement-command.mjs");
    const source = settlementErrorFindings(
        new Error("/notes/crown.md:4:9: error: stale source"),
        "inputs.json",
    );
    expect(source).toEqual([
        { file: "/notes/crown.md", line: 4, column: 9, severity: "error", message: "stale source" },
    ]);
    const actual = [
        { file: "/notes/other.md", line: 8, severity: "error", message: "invalid row" },
    ];
    expect(
        settlementErrorFindings(
            Object.assign(new Error("invalid"), { findings: actual, located: true }),
            "inputs.json",
        ),
    ).toEqual(actual);
});

it("runs a bounded named settlement preview and explicit write with captured inputs", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { spawnSync } = await import("node:child_process");
    const { fixture, note, write } = await import("./content-session-fixture.js");
    const { createContentSession } = await import("../engine/content-session.mjs");
    const { settlementMapFixture } = await import("./settlement-cli-map-fixture.js");
    const f = fixture();
    try {
        const content = f.config.paths.content;
        write(
            path.join(content, "Note2.md"),
            note({
                type: "skill",
                subType: "language",
                shortcode: "tongue",
                name: { full: "Tongue" },
                data: {
                    roman: "abcdefghijklmnopqrstuvwxyz",
                    elements: [
                        { form: "ash", position: "opening", kind: "place", sense: "a tree" },
                        { form: "ford", position: "closing", kind: "place", sense: "a crossing" },
                    ],
                    naming: { draws: [{ kind: "place", elements: ["place"] }] },
                },
            }),
        );
        write(
            path.join(content, "Note3.md"),
            note({
                type: "lore",
                subType: "culture",
                shortcode: "folk",
                name: { full: "Folk" },
                data: { lang: "tongue", householdSize: 5 },
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
        const session = await createContentSession({ config: f.config });
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
        const polity = "sessionproof-note-affiliation-crown";
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
                    cultures: { "1": "sessionproof-note-lore-folk" },
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
        write(path.join(f.root, "guide.md"), "alphabet");
        write(path.join(f.root, "english.json"), JSON.stringify(["blocked"]));
        write(
            path.join(f.root, "sources.json"),
            JSON.stringify({ baseline: { name: "fixture", version: "1" } }),
        );
        const provider = path.resolve("tests/settlement-cli-setting-fixture.mjs");
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
            "guide.md",
            "--checks-english-words",
            "english.json",
            "--checks-english-sources",
            "sources.json",
            "--seed",
            "fixture",
            "--name-limit",
            "10",
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
            expect.arrayContaining(["index.jsonl", "guide.md", "english.json", "sources.json"]),
        );
        expect(
            dryReport.resourceInputs.every((item: any) => /^[a-f0-9]{64}$/.test(item.sha256)),
        ).toBe(true);
        expect(fs.readFileSync(crown, "utf8")).toBe(before);
        const lock = path.join(content, ".Crown.md.settlement-write.lock");
        fs.writeFileSync(lock, "busy");
        const blocked = run("--write");
        expect(blocked.status).toBe(1);
        const blockedFinding = JSON.parse(blocked.stdout).missing[0];
        expect(path.resolve(f.root, blockedFinding.file)).toBe(crown);
        expect(blockedFinding.message).toContain("cannot acquire settlement write lock");
        expect(blocked.stderr).toContain(`${path.relative(f.root, crown)}:1:1: error:`);
        expect(fs.readFileSync(crown, "utf8")).toBe(before);
        fs.rmSync(lock);
        const saved = run("--write");
        expect(saved.status, saved.stderr).toBe(0);
        expect(JSON.parse(saved.stdout).write.written).toBe(true);
        const after = fs.readFileSync(crown, "utf8");
        expect(after).toContain("ashford");
        expect(after).toContain("Keep this prose.");
        const repeat = run("--write");
        expect(repeat.status).toBe(1);
        expect(fs.readFileSync(crown, "utf8")).toBe(after);
    } finally {
        fs.rmSync(f.root, { recursive: true, force: true });
    }
});
