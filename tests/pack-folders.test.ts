/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, vi } from "vitest";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { packFolderFindings, writeManifest } from "../manifest.mjs";
import { formatDiagnostic, positionOfYamlPath } from "../engine/diagnostics.mjs";

/** The pack list `manifestPacks` derives, reduced to what the rule reads. */
const packs = (...names: string[]) => names.map((name) => ({ name }));

describe("packFolderFindings", () => {
    // The finding HM3#420 shipped: three of four names resolved to nothing.
    it("errors on a folder naming a pack the package does not ship", () => {
        const findings = packFolderFindings({
            packFolders: [
                {
                    name: "HârnMaster 3 System",
                    packs: ["character", "possessions", "esoteric", "items"],
                },
            ],
            packs: packs("items", "system-help"),
        });
        const errors = findings.filter((f) => f.severity === "error");
        expect(errors).toHaveLength(3);
        expect(errors.map((f) => f.pack)).toEqual(["character", "possessions", "esoteric"]);
        // Both halves are named, so the reader needs neither file open.
        expect(errors[0].message).toContain('"HârnMaster 3 System"');
        expect(errors[0].message).toContain('"character"');
        expect(errors[0].message).toContain("items, system-help");
    });

    // The other half of HM3#420, and the half a strict rule would get wrong.
    it("warns on a pack no folder names", () => {
        const findings = packFolderFindings({
            packFolders: [{ name: "HârnMaster 3 System", packs: ["system-help"] }],
            packs: packs("items", "system-help"),
        });
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            severity: "warning",
            pack: "items",
        });
        expect(findings[0].message).toContain('"items"');
    });

    it("says nothing when every folder and pack agree", () => {
        expect(
            packFolderFindings({
                packFolders: [{ name: "A", packs: ["items", "journals"] }],
                packs: packs("items", "journals"),
            }),
        ).toEqual([]);
    });

    // A package that declares no folder wants everything at the root. That is
    // the majority arrangement and is not a finding of any kind.
    it("says nothing when no folder is declared", () => {
        expect(
            packFolderFindings({
                packFolders: undefined,
                packs: packs("items", "journals"),
            }),
        ).toEqual([]);
        expect(packFolderFindings({ packFolders: [], packs: packs("items") })).toEqual([]);
    });

    // Foundry nests pack folders three deep (`PackageCompendiumFolder`
    // re-declares itself while `depth < 4`). A rule reading only the top level
    // would miss every nested error and report every nested pack as ungrouped.
    it("descends into nested folders, in both directions", () => {
        const findings = packFolderFindings({
            packFolders: [
                {
                    name: "Top",
                    packs: ["items"],
                    folders: [{ name: "Inner", packs: ["journals", "gone"] }],
                },
            ],
            packs: packs("items", "journals", "actors"),
        });
        expect(findings).toEqual([
            expect.objectContaining({
                severity: "error",
                folder: "Inner",
                pack: "gone",
            }),
            expect.objectContaining({ severity: "warning", pack: "actors" }),
        ]);
    });

    // The key path is what lets the caller locate the offending scalar in the
    // YAML rather than guess at a line.
    it("carries the config key path of the offending name", () => {
        const findings = packFolderFindings({
            packFolders: [
                { name: "Top", packs: ["ok"] },
                { name: "Next", packs: ["ok", "gone"] },
            ],
            packs: packs("ok"),
        });
        expect(findings).toHaveLength(1);
        expect(findings[0].keyPath).toEqual([
            "packageBuild",
            "manifest",
            "packFolders",
            1,
            "packs",
            1,
        ]);
    });

    it("reports every error before any warning, in declaration order", () => {
        const findings = packFolderFindings({
            packFolders: [{ name: "Top", packs: ["gone", "alsogone"] }],
            packs: packs("a", "b"),
        });
        expect(findings.map((f) => f.severity)).toEqual(["error", "error", "warning", "warning"]);
    });
});

describe("positionOfYamlPath", () => {
    const yaml = [
        "packageBuild:",
        "    manifest:",
        "        packFolders:",
        "            - name: Top",
        "              packs: [items, gone]",
        "",
    ].join("\n");

    it("locates a scalar deep in the document", () => {
        expect(
            positionOfYamlPath(yaml, ["packageBuild", "manifest", "packFolders", 0, "packs", 1]),
        ).toEqual({ line: 5, column: 30 });
    });

    it("locates a mapping key's value", () => {
        expect(positionOfYamlPath(yaml, ["packageBuild", "manifest", "packFolders"])).toMatchObject(
            { line: 4 },
        );
    });

    // Dropped, never guessed: an absent path yields no position at all.
    it("returns nothing for a path that is not there", () => {
        expect(positionOfYamlPath(yaml, ["packageBuild", "nope"])).toEqual({});
        expect(positionOfYamlPath("", ["a"])).toEqual({});
        expect(positionOfYamlPath("::: not yaml :::", ["a"])).toEqual({});
        expect(positionOfYamlPath(yaml, [])).toEqual({});
    });
});

describe("writeManifest reporting", () => {
    const packageJson = {
        version: "1.2.3",
        repository: { url: "https://github.com/HeroicLands/x" },
    };

    /** A resolved-config stand-in carrying only what the manifest reads. */
    const configWith = (packFolders: unknown, names: string[]) => ({
        foundryPackage: "x",
        stats: { systemId: "x" },
        packs: names.map((name) => ({
            name,
            label: name,
            type: "Item",
            private: false,
        })),
        packageBuild: { manifest: { packFolders } },
    });

    it("refuses to write a manifest whose folder names a missing pack", async () => {
        const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-folders-"));
        const errors: string[] = [];
        const spy = vi
            .spyOn(console, "error")
            .mockImplementation((line: string) => void errors.push(line));
        try {
            await expect(
                writeManifest({
                    config: configWith([{ name: "Top", packs: ["gone"] }], ["items"]),
                    packageJson,
                    artifact: "system",
                    outDir,
                }),
            ).rejects.toThrow(/packFolders/);
        } finally {
            spy.mockRestore();
        }
        expect(errors.join("\n")).toContain("error: packFolders:");
        // Nothing is staged: a manifest known to be wrong is not written.
        expect(fs.existsSync(path.join(outDir, "system.json"))).toBe(false);
    });

    it("warns, writes, and resolves the position from the config file", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-folders-"));
        const configFile = path.join(dir, "package-build.config.yaml");
        fs.writeFileSync(
            configFile,
            [
                "packageBuild:",
                "    manifest:",
                "        packFolders:",
                "            - name: Top",
                "              packs: [items]",
                "",
            ].join("\n"),
            "utf8",
        );
        const warnings: string[] = [];
        const spy = vi
            .spyOn(console, "warn")
            .mockImplementation((line: string) => void warnings.push(line));
        try {
            const { manifest } = await writeManifest({
                config: configWith([{ name: "Top", packs: ["items"] }], ["items", "journals"]),
                packageJson,
                artifact: "system",
                outDir: dir,
                configFile,
            });
            expect(manifest.packs).toHaveLength(2);
        } finally {
            spy.mockRestore();
        }
        expect(warnings).toHaveLength(1);
        // `file:line:column: warning: …` — the path starts the line, and the
        // position is the `packFolders` declaration the pack is missing from.
        // The temp directory sits outside the working directory, so the locator
        // stays absolute, which is `formatLocator`'s rule and not this one's.
        expect(warnings[0]).toBe(
            `${configFile}:4:13: warning: packFolders: pack "journals" is ` +
                "named by no folder, so it ships outside every folder this " +
                "package declares",
        );
        expect(fs.existsSync(path.join(dir, "system.json"))).toBe(true);
    });

    it("emits an unlocated diagnostic when no config file is given", async () => {
        const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-folders-"));
        const warnings: string[] = [];
        const spy = vi
            .spyOn(console, "warn")
            .mockImplementation((line: string) => void warnings.push(line));
        try {
            await writeManifest({
                config: configWith([{ name: "Top", packs: ["items"] }], ["items", "journals"]),
                packageJson,
                artifact: "system",
                outDir,
            });
        } finally {
            spy.mockRestore();
        }
        expect(warnings[0]).toMatch(/^warning: packFolders: pack "journals"/);
    });

    it("says nothing at all for a package declaring no folders", async () => {
        const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-folders-"));
        const said: string[] = [];
        const warn = vi.spyOn(console, "warn").mockImplementation((l: string) => void said.push(l));
        const err = vi.spyOn(console, "error").mockImplementation((l: string) => void said.push(l));
        try {
            await writeManifest({
                config: configWith(undefined, ["items", "journals"]),
                packageJson,
                artifact: "system",
                outDir,
            });
        } finally {
            warn.mockRestore();
            err.mockRestore();
        }
        expect(said).toEqual([]);
    });
});

describe("formatDiagnostic, as the rule emits it", () => {
    it("is compiler-parseable with a position and without one", () => {
        expect(
            formatDiagnostic({
                file: "package-build.config.yaml",
                line: 12,
                column: 30,
                severity: "error",
                message: 'packFolders: folder "A" names pack "gone"',
            }),
        ).toBe(
            'package-build.config.yaml:12:30: error: packFolders: folder "A" ' +
                'names pack "gone"',
        );
    });
});
