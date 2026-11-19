/* SPDX-License-Identifier: GPL-3.0-or-later */
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

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
        writeFileSync(file, "{broken");
        const malformed = run();
        expect(malformed.status).toBe(1);
        expect(malformed.stderr).toMatch(/inputs\.json:\d+:\d+: error: invalid JSON/);
        expect(JSON.parse(malformed.stdout).missing).toHaveLength(1);
        rmSync(file);
        const missing = run();
        expect(missing.status).toBe(1);
        expect(missing.stderr).toMatch(/inputs\.json:1:1: error:/);
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
        expect(mismatch.stderr).toMatch(/map:1:1: error: saved map hash differs/);
        expect(JSON.parse(mismatch.stdout).missing).toHaveLength(1);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
