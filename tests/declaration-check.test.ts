/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkDeclarations, exportedDeclarationFiles } from "../engine/declaration-check.mjs";

function project() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "package-build-types-")));
    fs.writeFileSync(
        path.join(root, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: true }, include: ["*.d.ts"] }),
    );
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ exports: { ".": { types: "./index.d.ts" } } }),
    );
    fs.writeFileSync(path.join(root, "index.d.ts"), "export interface Note { title: string }\n");
    return root;
}

describe("declaration checks", () => {
    it("accepts a valid declaration entry point", () => {
        const root = project();
        expect(exportedDeclarationFiles(root).files).toEqual([path.join(root, "index.d.ts")]);
        expect(checkDeclarations(path.join(root, "tsconfig.json"), { exports: true })).toEqual([]);
    });

    it("locates an import of a missing declaration", () => {
        const root = project();
        fs.writeFileSync(
            path.join(root, "index.d.ts"),
            'export type Missing = import("./gone").Missing;\n',
        );
        expect(checkDeclarations(path.join(root, "tsconfig.json"))).toEqual([
            expect.objectContaining({
                file: path.join(root, "index.d.ts"),
                line: 1,
                severity: "error",
                message: expect.stringContaining("Cannot find module"),
            }),
        ]);
        const binary = path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            "../bin/package-build.mjs",
        );
        const result = spawnSync(process.execPath, [binary, "types", "check"], {
            cwd: root,
            encoding: "utf8",
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/^index\.d\.ts:1:\d+: error: TS2307:/m);
    });

    it("locates a missing published entry point", () => {
        const root = project();
        fs.unlinkSync(path.join(root, "index.d.ts"));
        expect(checkDeclarations(path.join(root, "tsconfig.json"), { exports: true })).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    file: path.join(root, "package.json"),
                    message: expect.stringContaining("does not exist"),
                }),
            ]),
        );
    });
});
