/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ClassicLevel } from "classic-level";
import YAML from "yaml";
import { configFromData } from "../engine/pack-config.mjs";
import { fixture, note, outputBytes, write } from "./content-session-fixture.js";
import { subprocessTimeout } from "./subprocess-timeout.js";

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(packageRoot, "bin/package-build.mjs");
const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function repo(size = 8) {
    const input = fixture(size);
    roots.push(input.root);
    return input;
}
function run(input: ReturnType<typeof fixture> & { failWrite?: string }, ...args: string[]) {
    const script = `
        const fs = (await import('node:fs')).default;
        const paths = new Set(${JSON.stringify([...input.files.keys()])});
        const reads = {};
        const read = fs.readFileSync;
        fs.readFileSync = function(file, ...options) {
            if (paths.has(String(file))) reads[file] = (reads[file] ?? 0) + 1;
            return read.call(this, file, ...options);
        };
        const failWrite = ${JSON.stringify(input.failWrite ?? "")};
        const write = fs.writeFileSync;
        fs.writeFileSync = function(file, ...options) {
            if (failWrite && String(file).endsWith(failWrite)) throw new Error('publication write failed deliberately');
            return write.call(this, file, ...options);
        };
        process.on('exit', () => console.log('SESSION_WORK=' + JSON.stringify(reads)));
        process.argv = [process.execPath, ${JSON.stringify(cli)}, ...${JSON.stringify(args)}];
        await import(${JSON.stringify(pathToFileURL(cli).href)});
    `;
    const started = performance.now();
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        cwd: input.root,
        env: { ...process.env, PACKAGE_BUILD_CONFIG: input.configFile },
        encoding: "utf8",
    });
    if (process.env.CONTENT_TIMING_BASELINE)
        console.log(
            JSON.stringify({
                args,
                ms: performance.now() - started,
                timing: result.stdout
                    ?.split("\n")
                    .filter(
                        (line) =>
                            line.includes("Content timings") || line.includes("Content work:"),
                    ),
            }),
        );
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    const work = /SESSION_WORK=(.*)/.exec(output)?.[1];
    return { status: result.status, output, reads: work ? JSON.parse(work) : {} };
}
function located(output: string) {
    return output.split("\n").filter((line) => /: (?:warning|error): /.test(line));
}
async function nativeContents(input: ReturnType<typeof fixture>) {
    const contents: Record<string, unknown> = {};
    for (const pack of input.config.packDirectories) {
        const db = new ClassicLevel(path.join(input.config.paths.stage, pack), {
            valueEncoding: "json",
        });
        try {
            contents[pack] = await db.iterator().all();
        } finally {
            await db.close();
        }
    }
    return contents;
}

describe("the explicit multi-target content command", () => {
    it(
        "shares actual reads and emits standalone-equivalent index, pack JSON and native contents",
        async () => {
            const input = repo();
            for (const args of [["content-index"], ["lint"], ["links"], ["package", "compile"]]) {
                const result = run(input, ...args);
                expect(result.status, result.output).toBe(0);
            }
            const expectedIndex = outputBytes(input.config.paths.contentIndex);
            const expectedPacks = outputBytes(input.config.paths.packJson);
            const expectedNative = await nativeContents(input);
            for (const targets of [
                ["compile", "links", "index", "lint"],
                ["index", "lint", "links", "compile"],
            ]) {
                for (const dir of [
                    input.config.paths.contentIndex,
                    input.config.paths.packJson,
                    input.config.paths.stage,
                ])
                    fs.rmSync(dir, { recursive: true, force: true });
                const result = run(input, "content", "run", ...targets);
                expect(result.status, result.output).toBe(0);
                expect(result.reads).toEqual(
                    Object.fromEntries([...input.files.keys()].map((file) => [file, 1])),
                );
                expect(outputBytes(input.config.paths.contentIndex)).toEqual(expectedIndex);
                expect(outputBytes(input.config.paths.packJson)).toEqual(expectedPacks);
                expect(await nativeContents(input)).toEqual(expectedNative);
            }
        },
        subprocessTimeout(8),
    );

    it(
        "rejects unknown or empty target lists before reading the source",
        () => {
            const input = repo();
            for (const targets of [[], ["watch"], ["index", "wat"]]) {
                const result = run(input, "content", "run", ...targets);
                expect(result.status, result.output).toBe(1);
                expect(result.reads).toEqual({});
                expect(fs.existsSync(input.config.paths.contentIndex)).toBe(false);
            }
        },
        subprocessTimeout(3),
    );

    it(
        "preserves exact located diagnostics and canonical order for a read-only target subset",
        () => {
            const input = repo();
            const file = [...input.files.keys()][0];
            write(file, input.files.get(file)!.replaceAll("lore-n1#here", "lore-n1#missing"));
            const lint = run(input, "lint");
            const links = run(input, "links");
            const combined = run(input, "content", "run", "links", "lint", "links");
            expect(lint.status, lint.output).toBe(0);
            expect(links.status, links.output).toBe(1);
            expect(combined.status, combined.output).toBe(1);
            expect(located(combined.output)).toEqual([
                ...located(lint.output),
                ...located(links.output),
            ]);
            expect(located(links.output)).toHaveLength(2);
            expect(combined.reads).toEqual(
                Object.fromEntries([...input.files.keys()].map((file) => [file, 1])),
            );
            expect(fs.existsSync(input.config.paths.contentIndex)).toBe(false);
            expect(fs.existsSync(input.config.paths.packJson)).toBe(false);
        },
        subprocessTimeout(3),
    );

    it(
        "leaves writer outputs untouched after shared preparation failure and reports read-only findings",
        async () => {
            const input = repo();
            const valid = run(input, "package", "compile");
            expect(valid.status, valid.output).toBe(0);
            const expectedNative = await nativeContents(input);
            const expectedPacks = outputBytes(input.config.paths.packJson);
            const expectedStage = outputBytes(input.config.paths.stage);
            write(
                path.join(input.config.paths.content, "Malformed.md"),
                "---\ntype: doc\nbroken: [ }\n---\n\nə\n",
            );
            const sentinel = path.join(input.config.paths.contentIndex, "keep.txt");
            write(sentinel, "Keep this output.\n");
            const result = run(input, "content", "run", "index", "lint", "links", "compile");
            expect(result.status, result.output).toBe(1);
            expect(result.output).toContain("YAML parse error");
            expect(result.output).toContain("U+0259");
            expect(fs.readFileSync(sentinel, "utf8")).toBe("Keep this output.\n");
            expect(fs.readdirSync(input.config.paths.contentIndex)).toEqual(["keep.txt"]);
            expect(outputBytes(input.config.paths.packJson)).toEqual(expectedPacks);
            expect(outputBytes(input.config.paths.stage)).toEqual(expectedStage);
            expect(await nativeContents(input)).toEqual(expectedNative);
            expect(
                result.output.match(/Malformed\.md:\d+:\d+: error: YAML parse error/g),
            ).toHaveLength(1);
        },
        subprocessTimeout(2),
    );

    it(
        "continues compilation after an ordinary lint-only error",
        async () => {
            const input = repo();
            const file = [...input.files.keys()][0];
            write(file, input.files.get(file)!.replace("---\n", "---\nunknown: true\n"));
            const lint = run(input, "lint");
            const compile = run(input, "package", "compile");
            expect(lint.status, lint.output).toBe(1);
            expect(lint.output).toContain("unknown");
            expect(compile.status, compile.output).toBe(0);
            const expectedPacks = outputBytes(input.config.paths.packJson);
            const expectedNative = await nativeContents(input);
            for (const dir of [input.config.paths.packJson, input.config.paths.stage])
                fs.rmSync(dir, { recursive: true, force: true });
            const combined = run(input, "content", "run", "compile", "lint");
            expect(combined.status, combined.output).toBe(1);
            expect(located(combined.output)).toEqual(located(lint.output));
            expect(outputBytes(input.config.paths.packJson)).toEqual(expectedPacks);
            expect(await nativeContents(input)).toEqual(expectedNative);
        },
        subprocessTimeout(3),
    );

    it(
        "checks compile eligibility before any writer while allowing documentation index alone",
        () => {
            const input = repo();
            const data = {
                contentPackage: input.config.contentPackage,
                packageKind: "documentation",
            };
            write(input.configFile, YAML.stringify(data));
            input.config = configFromData(data, input.configFile);
            fs.rmSync(input.config.paths.content, { recursive: true, force: true });
            const file = path.join(input.config.paths.content, "Home.md");
            const raw = note({ type: "homepage", shortcode: "root", name: { full: "Guides" } });
            write(file, raw);
            input.files.clear();
            input.files.set(file, raw);
            for (const kind of ["metadata", "dictionary", "terms"])
                write(
                    path.join(
                        input.config.paths.contentIndex,
                        `${input.config.contentPackage}-${kind}.jsonl`,
                    ),
                    `Keep ${kind}.\n`,
                );
            const before = outputBytes(input.config.paths.contentIndex);
            const standalone = run(input, "package", "compile");
            const result = run(input, "content", "run", "index", "lint", "compile");
            expect(standalone.status, standalone.output).toBe(1);
            expect(result.status, result.output).toBe(1);
            const refusal = /`packageKind: documentation`[^\n]+/.exec(standalone.output)?.[0];
            expect(refusal).toBeDefined();
            expect(result.output).toContain(refusal);
            expect(result.output).toContain("1 notes — 1 full, 0 draft, 0 stub");
            expect(outputBytes(input.config.paths.contentIndex)).toEqual(before);
            expect(fs.existsSync(input.config.paths.packJson)).toBe(false);
            expect(fs.existsSync(input.config.paths.stage)).toBe(false);
            const index = run(input, "content", "run", "index");
            expect(index.status, index.output).toBe(0);
            expect(outputBytes(input.config.paths.contentIndex)).not.toEqual(before);
            expect(
                fs.readFileSync(
                    path.join(
                        input.config.paths.contentIndex,
                        `${input.config.contentPackage}-metadata.jsonl`,
                    ),
                    "utf8",
                ),
            ).toContain('"shortcode":"root"');
        },
        subprocessTimeout(3),
    );
});

function buildRepo() {
    const input = repo();
    const data = YAML.parse(fs.readFileSync(input.configFile, "utf8"));
    data.packageBuild = { assets: [{ from: "build/calendars", to: "calendars" }] };
    write(input.configFile, YAML.stringify(data));
    input.config = configFromData(data, input.configFile);
    for (const [name, fm] of Object.entries({
        World: {
            type: "place",
            subType: "world",
            shortcode: "world",
            name: { full: "World" },
            data: {
                year: { days: 365, hoursPerDay: 24, minutesPerHour: 60, secondsPerMinute: 60 },
            },
        },
        Calendar: {
            type: "lore",
            subType: "calendar",
            shortcode: "calendar",
            name: { full: "Calendar" },
            data: {
                epoch: "720.1",
                months: [{ name: "Year", days: 365 }],
                eras: [
                    { shortcode: "before", name: "Before", start: null },
                    { shortcode: "present", name: "Present", start: 1 },
                ],
            },
        },
    })) {
        const file = path.join(input.config.paths.content, `${name}.md`);
        const raw = note(fm);
        write(file, raw);
        input.files.set(file, raw);
    }
    return input;
}
const ready = (input: ReturnType<typeof fixture>) =>
    path.join(input.config.paths.contentIndex, ".publication-ready");

describe("the complete content build", () => {
    it(
        "publishes, emits calendars, stages assets and compiles with standalone artifact parity and one source read",
        async () => {
            const input = buildRepo();
            for (const args of [
                ["content-index"],
                ["calendars", "--calendaria-version", "1.4.2"],
                ["assets"],
                ["content", "run", "lint", "links", "compile"],
            ]) {
                const result = run(input, ...args);
                expect(result.status, result.output).toBe(0);
            }
            const index = outputBytes(input.config.paths.contentIndex);
            const calendars = outputBytes(path.join(input.root, "build/calendars"));
            const staged = outputBytes(path.join(input.root, "build/stage/calendars"));
            const packs = outputBytes(input.config.paths.packJson);
            const native = await nativeContents(input);
            write(path.join(input.config.paths.contentIndex, "stale.jsonl"), "stale");
            write(path.join(input.root, "build/stage/stale.txt"), "stale");
            const result = run(input, "content", "build", "--calendaria-version", "1.4.2");
            expect(result.status, result.output).toBe(0);
            expect(fs.existsSync(ready(input))).toBe(true);
            const actualIndex = outputBytes(input.config.paths.contentIndex);
            delete actualIndex[".publication-ready"];
            expect(actualIndex).toEqual(index);
            expect(outputBytes(path.join(input.root, "build/calendars"))).toEqual(calendars);
            expect(outputBytes(path.join(input.root, "build/stage/calendars"))).toEqual(staged);
            expect(outputBytes(input.config.paths.packJson)).toEqual(packs);
            expect(await nativeContents(input)).toEqual(native);
            expect(fs.readFileSync(path.join(input.root, "build/stage/stale.txt"), "utf8")).toBe(
                "stale",
            );
            expect(result.reads).toEqual(
                Object.fromEntries([...input.files.keys()].map((file) => [file, 1])),
            );
            expect(result.output).toContain("Content timings (exclusive)");
            expect(result.output).toContain("source capture");
            expect(result.output).toContain("index derivation");
        },
        subprocessTimeout(5),
    );

    it(
        "clears stale publication readiness on preparation failure and still reports independent findings",
        () => {
            const input = buildRepo();
            write(ready(input), "stale");
            write(path.join(input.config.paths.contentIndex, "stale.jsonl"), "stale");
            write(
                path.join(input.config.paths.content, "Malformed.md"),
                "---\ntype: doc\nbroken: [ }\n---\n\nə\n",
            );
            const result = run(input, "content", "build", "--calendaria-version", "1.4.2");
            expect(result.status, result.output).toBe(1);
            expect(result.output).toContain("YAML parse error");
            expect(result.output).toContain("U+0259");
            expect(fs.existsSync(ready(input))).toBe(false);
            expect(fs.existsSync(path.join(input.config.paths.contentIndex, "stale.jsonl"))).toBe(
                false,
            );
            expect(fs.existsSync(input.config.paths.packJson)).toBe(false);
            expect(fs.existsSync(path.join(input.root, "build/stage/calendars"))).toBe(false);
        },
        subprocessTimeout(1),
    );

    it(
        "does not mark a partly written publication ready and still runs independent checks",
        () => {
            const input = buildRepo();
            write(ready(input), "stale");
            const result = run(
                { ...input, failWrite: `${input.config.contentPackage}-dictionary.jsonl` },
                "content",
                "build",
                "--calendaria-version",
                "1.4.2",
            );
            expect(result.status, result.output).toBe(1);
            expect(result.output).toContain("publication write failed deliberately");
            expect(result.output).toContain("U+000D");
            expect(fs.existsSync(ready(input))).toBe(false);
            expect(fs.existsSync(input.config.paths.packJson)).toBe(false);
        },
        subprocessTimeout(1),
    );

    it(
        "retains a fresh publication after later lint failure and preserves located diagnostics",
        () => {
            const input = buildRepo();
            const file = [...input.files.keys()][0];
            write(file, input.files.get(file)!.replace("---\n", "---\nunknown: true\n"));
            const lint = run(input, "lint");
            const result = run(input, "content", "build", "--calendaria-version", "1.4.2");
            expect(result.status, result.output).toBe(1);
            expect(located(result.output)).toEqual(located(lint.output));
            expect(fs.existsSync(ready(input))).toBe(true);
            expect(fs.existsSync(input.config.paths.packJson)).toBe(true);
        },
        subprocessTimeout(2),
    );

    it(
        "keeps publication ready after asset failure, reports checks, and refuses compilation",
        () => {
            const input = buildRepo();
            const data = YAML.parse(fs.readFileSync(input.configFile, "utf8"));
            data.packageBuild.assetTransform = "./broken-transform.mjs";
            write(input.configFile, YAML.stringify(data));
            write(
                path.join(input.root, "broken-transform.mjs"),
                'export function transform() { throw new Error("staging failed deliberately"); }',
            );
            const result = run(input, "content", "build", "--calendaria-version", "1.4.2");
            expect(result.status, result.output).toBe(1);
            expect(result.output).toContain("staging failed deliberately");
            expect(result.output).toContain("notes —");
            expect(fs.existsSync(ready(input))).toBe(true);
            expect(fs.existsSync(input.config.paths.packJson)).toBe(false);
        },
        subprocessTimeout(1),
    );

    it(
        "refuses changed source inventory after an asset transform instead of compiling a stale capture",
        () => {
            const input = buildRepo();
            const data = YAML.parse(fs.readFileSync(input.configFile, "utf8"));
            data.packageBuild.assetTransform = "./mutating-transform.mjs";
            write(input.configFile, YAML.stringify(data));
            write(
                path.join(input.root, "mutating-transform.mjs"),
                `import fs from 'node:fs'; export function transform() { fs.writeFileSync(${JSON.stringify(path.join(input.config.paths.content, "New.md"))}, ${JSON.stringify(note({ type: "lore", subType: "history", shortcode: "new", name: { full: "New" } }))}); return null; }`,
            );
            const result = run(input, "content", "build", "--calendaria-version", "1.4.2");
            expect(result.status, result.output).toBe(1);
            expect(result.output).toContain("Content sources changed during the build");
            expect(fs.existsSync(ready(input))).toBe(false);
            expect(fs.existsSync(input.config.paths.packJson)).toBe(false);
        },
        subprocessTimeout(1),
    );

    it(
        "validates the build grammar before reading sources",
        () => {
            const input = buildRepo();
            for (const args of [
                ["content", "build"],
                ["content", "build", "index", "--calendaria-version", "1.4.2"],
                ["content", "build", "--calendaria-version", "wrong"],
            ]) {
                const result = run(input, ...args);
                expect(result.status, result.output).toBe(1);
                expect(result.reads).toEqual({});
            }
        },
        subprocessTimeout(3),
    );
});
