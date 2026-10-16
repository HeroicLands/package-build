/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture = path.join(root, "tests/fixtures/content-session-consumer.mts");

it("a typed consumer can use the emitted session and captured-input APIs without ignored types", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-content-session-types-"));
    try {
        const configFile = ts.readConfigFile(path.join(root, "tsconfig.dts.json"), ts.sys.readFile);
        expect(configFile.error).toBeUndefined();
        const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
        const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
        const exportPaths = (field: "types" | "import", base: string) =>
            Object.fromEntries(
                Object.entries(pkg.exports).flatMap(([subpath, target]) => {
                    if (
                        !target ||
                        typeof target !== "object" ||
                        !(field in target) ||
                        typeof target[field] !== "string"
                    )
                        return [];
                    const specifier = subpath === "." ? pkg.name : pkg.name + subpath.slice(1);
                    return [[specifier, [path.join(base, target[field])]]];
                }),
            );
        const imports = ts.preProcessFile(
            fs.readFileSync(fixture, "utf8"),
            true,
            true,
        ).importedFiles;
        const sourceOptions = { ...config.options, paths: exportPaths("import", root) };
        const sourceFiles = imports.map(
            (entry) =>
                ts.resolveModuleName(entry.fileName, fixture, sourceOptions, ts.sys).resolvedModule
                    ?.resolvedFileName,
        );
        expect(sourceFiles.every((file) => file?.endsWith(".mjs"))).toBe(true);
        const declarationDir = path.join(temp, "types");
        const emit = ts.createProgram(
            sourceFiles.filter((file): file is string => typeof file === "string"),
            { ...config.options, declarationDir },
        );
        const emitted = emit.emit();
        expect(
            [...ts.getPreEmitDiagnostics(emit), ...emitted.diagnostics].map((diagnostic) =>
                ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
            ),
        ).toEqual([]);
        const paths = exportPaths("types", temp);
        const consumer = ts.createProgram([fixture], {
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.NodeNext,
            moduleResolution: ts.ModuleResolutionKind.NodeNext,
            types: ["node"],
            paths,
        });
        const diagnostics = ts.getPreEmitDiagnostics(consumer);
        expect(
            consumer
                .getSourceFiles()
                .filter((source) => source.fileName.startsWith(path.join(root, "types") + path.sep))
                .map((source) => source.fileName),
        ).toEqual([]);
        expect(
            diagnostics.map(
                (diagnostic) =>
                    `${diagnostic.file?.fileName ?? "consumer"}:${diagnostic.start ?? 0}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`,
            ),
        ).toEqual([]);
        expect(fs.existsSync(path.join(declarationDir, "engine/content-session.d.mts"))).toBe(true);
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
}, 30_000);
