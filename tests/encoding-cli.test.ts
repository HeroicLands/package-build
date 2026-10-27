/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SUBPROCESS_TEST_TIMEOUT, subprocessTimeout } from "./subprocess-timeout.js";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const binary = path.join(root, "bin/package-build.mjs");
import { installEncodingNote } from "./helpers/encoding-note.js";
const encoding = "aelwsemaronenc";
let directory: string;
beforeAll(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "encoding-cli-"));
    installEncodingNote(directory);
});
afterAll(() => {
    fs.rmSync(directory, { recursive: true, force: true });
});
function run(args: string[], input?: string) {
    const value = spawnSync(process.execPath, [binary, ...args], {
        cwd: directory,
        encoding: "utf8",
        input,
        timeout: SUBPROCESS_TEST_TIMEOUT,
        maxBuffer: 8 * 1024 * 1024,
        env: {
            ...process.env,
            PACKAGE_BUILD_CONFIG: path.join(directory, "package-build.config.yaml"),
        },
    });
    return { code: value.status, out: value.stdout, err: value.stderr };
}
describe("bare encoding commands", () => {
    it(
        "encodes a string and decodes it through a content encoding document",
        () => {
            const encoded = run(["encode", "--enc", encoding, "a"]);
            expect(encoded.code, encoded.err).toBe(0);
            expect(encoded.out).toBe("\u{F0230}\n");
            const decoded = run(["decode", "--enc", encoding, "\u{F0230}"]);
            expect(decoded.code, decoded.err).toBe(0);
            expect(decoded.out).toBe("a\n");
        },
        subprocessTimeout(2),
    );
    it(
        "refuses usage errors before reading files",
        () => {
            for (const args of [
                ["encode", "--enc", encoding],
                ["encode", "--enc", encoding, "a", "b"],
                ["encode", "--enc", encoding, "--in", "missing", "a"],
                ["encode", "a"],
            ]) {
                const value = run(args);
                expect(value.code, value.err).toBe(2);
                expect(value.out).toBe("");
            }
        },
        subprocessTimeout(4),
    );
});

describe("encoding command streams, files and refusals", () => {
    it(
        "supports input/output files and their short aliases without adding bytes",
        () => {
            const input = path.join(directory, "roman.txt");
            const native = path.join(directory, "native.txt");
            const decoded = path.join(directory, "decoded.txt");
            fs.writeFileSync(input, "a b");
            let result = run(["encode", "--enc", encoding, "-i", input, "-o", native]);
            expect(result, result.err).toMatchObject({ code: 0, out: "", err: "" });
            expect(fs.readFileSync(native, "utf8")).toBe("\u{F0230} \u{F0231}");
            result = run(["decode", "--enc", encoding, "--in", native, "--out", decoded]);
            expect(result.code, result.err).toBe(0);
            expect(fs.readFileSync(decoded, "utf8")).toBe("a b");
            result = run(["encode", "--enc", encoding, "--out", native, "a"]);
            expect(result.out).toBe("");
            expect(fs.readFileSync(native, "utf8")).toBe("\u{F0230}");
        },
        subprocessTimeout(3),
    );
    it(
        "drains more than 64 KiB from stdin and never appends a newline",
        () => {
            const input = "a ".repeat(40000);
            const result = run(["encode", "--enc", encoding, "--in", "-"], input);
            expect(result.code, result.err).toBe(0);
            expect(result.out).toBe("\u{F0230} ".repeat(40000));
        },
        SUBPROCESS_TEST_TIMEOUT,
    );
    it(
        "reports scalar columns and preserves an existing output on refusal",
        () => {
            const out = path.join(directory, "refused.txt");
            fs.writeFileSync(out, "keep");
            const result = run(["encode", "--enc", encoding, "--out", out, "a\n😀"]);
            expect(result.code).toBe(1);
            expect(result.out).toBe("");
            expect(result.err).toMatch(/<text>:2:1: error:/);
            expect(fs.readFileSync(out, "utf8")).toBe("keep");
            expect(run(["decode", "--enc", encoding, "😀"]).err).toMatch(/<text>:1:1: error:/);
        },
        subprocessTimeout(2),
    );
    it(
        "rejects unknown options and missing option values as usage errors",
        () => {
            for (const args of [
                ["encode", "--enc"],
                ["decode", "--enc", encoding, "--in"],
                ["encode", "--bad", "a"],
            ])
                expect(run(args).code).toBe(2);
        },
        subprocessTimeout(3),
    );
    it(
        "keeps default encoding independent of package configuration",
        () => {
            expect(run(["encode", "--enc", "default", "unchanged"]).out).toBe("unchanged\n");
        },
        SUBPROCESS_TEST_TIMEOUT,
    );
    it(
        "resolves a named encoding from the consumer when invoked in a subdirectory",
        () => {
            expect(run(["encode", "--enc", encoding, "a"])).toMatchObject({
                code: 0,
                out: "\u{F0230}\n",
            });
            const subdirectory = path.join(directory, "subdir");
            fs.mkdirSync(subdirectory);
            const result = spawnSync(
                process.execPath,
                [binary, "decode", "--enc", encoding, "\u{F0230}"],
                {
                    cwd: subdirectory,
                    encoding: "utf8",
                    timeout: SUBPROCESS_TEST_TIMEOUT,
                    env: {
                        ...process.env,
                        PACKAGE_BUILD_CONFIG: path.join(directory, "package-build.config.yaml"),
                    },
                },
            );
            expect(result.status, result.stderr).toBe(0);
            expect(result.stdout).toBe("a\n");
        },
        subprocessTimeout(2),
    );
});

describe("CLI executes the authored encoding template", () => {
    it(
        "uses font glyph codes in literals and refuses characters outside the note",
        () => {
            const encoded = run(["encode", "--enc", encoding, "⟦ANKRON_MIN⟧"]);
            expect(encoded).toMatchObject({
                code: 0,
                out: "\u{E0112}\u{F0230}\u{E0113}\n",
                err: "",
            });
            const decoded = run(["decode", "--enc", encoding, encoded.out.trimEnd()]);
            expect(decoded).toMatchObject({ code: 0, out: "⟦ANKRON_MIN⟧\n", err: "" });
            const refused = run(["encode", "--enc", encoding, "c"]);
            expect(refused.code).toBe(1);
            expect(refused.err).toContain("<text>:1:1: error:");
        },
        subprocessTimeout(3),
    );
});
