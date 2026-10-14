/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Every asset is covered by a provenance record, and every record states `ai`.
 *
 * The stage ships a picture only on what its record says, so a file no record
 * covers, and a record that does not say whether a machine made the file, are
 * both findings rather than blanks read as permission. Each finding is a
 * parseable `file[:line[:column]]: error: message` line, located at the file
 * whose fix it is: the asset for a missing record, the record for a missing key.
 *
 * Resolution is per file. The cases mix a folder record with sidecars beside it,
 * so a check that judged a folder by one file's answer fails here.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { collectAssetRecords } from "../engine/asset-index.mjs";
import { formatDiagnostic } from "../engine/diagnostics.mjs";

/** A throwaway asset tree. */
function assetTree(files: Record<string, string>): string {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "cb-provenance-"));
    for (const [rel, body] of Object.entries(files)) {
        const full = path.join(base, ...rel.split("/"));
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, body, "utf8");
    }
    return base;
}

/** The findings a reader collects for a tree. */
function findingsFor(base: string) {
    const problems: Record<string, any>[] = [];
    collectAssetRecords(base, { contentPackage: "tpkg", problems });
    return problems;
}

/** A file as a diagnostic names it: relative inside the working directory. */
function shown(file: string): string {
    const rel = path.relative(process.cwd(), file);
    return rel.startsWith("..") ? file : rel;
}

const COMPLETE = "attribution: A\nlicense: CC-BY-3.0\nai: false\n";

describe("`ai` is a required provenance key", () => {
    it("reports a folder record that omits `ai`, at the record", () => {
        const base = assetTree({
            "icons/game/provenance.yaml": "attribution: A\nlicense: CC-BY-3.0\n",
            "icons/game/anvil.svg": "<svg/>",
        });
        const findings = findingsFor(base);
        const record = path.join(base, "icons/game/provenance.yaml");
        const hit = findings.filter((f) => f.file === record);
        expect(hit).toHaveLength(1);
        expect(hit[0].severity).toBe("error");
        expect(hit[0].message).toMatch(/`ai`/);
        expect(formatDiagnostic(hit[0]).startsWith(`${shown(record)}: error: `)).toBe(true);
    });

    it("reports a sidecar that omits `ai`, at the sidecar", () => {
        const base = assetTree({
            "icons/provenance.yaml": COMPLETE,
            "icons/anvil.svg": "<svg/>",
            "icons/bolt.svg": "<svg/>",
            "icons/bolt.svg.yaml": "attribution: B\nlicense: CC0-1.0\n",
        });
        const findings = findingsFor(base);
        expect(findings.map((f) => f.file)).toEqual([path.join(base, "icons/bolt.svg.yaml")]);
        expect(findings[0].message).toMatch(/`ai`/);
    });

    it("accepts `ai: false` as stated, not as absent", () => {
        const base = assetTree({ "images/provenance.yaml": COMPLETE, "images/map.png": "x" });
        expect(findingsFor(base)).toEqual([]);
    });

    it("never reads an unstated `ai` as `false` — the emitter refuses the tree", () => {
        const base = assetTree({
            "images/provenance.yaml": "attribution: A\nlicense: CC-BY-3.0\n",
            "images/map.png": "x",
        });
        expect(() => collectAssetRecords(base, { contentPackage: "tpkg" })).toThrow(/`ai`/);
    });

    it("holds an empty record to every required key", () => {
        const base = assetTree({ "icons/provenance.yaml": "", "icons/anvil.svg": "<svg/>" });
        const messages = findingsFor(base).map((f) => f.message);
        for (const key of ["attribution", "license", "ai"]) {
            expect(messages.some((m) => m.includes(`\`${key}\``))).toBe(true);
        }
    });
});

describe("every asset is covered by a provenance record", () => {
    it("reports a file no record covers, at the file", () => {
        const base = assetTree({ "icons/game/anvil.svg": "<svg/>" });
        const findings = findingsFor(base);
        const asset = path.join(base, "icons/game/anvil.svg");
        expect(findings).toHaveLength(1);
        expect(findings[0].file).toBe(asset);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].message).toMatch(/no provenance record covers this file/);
        expect(formatDiagnostic(findings[0]).startsWith(`${shown(asset)}: error: `)).toBe(true);
    });

    it("counts a sidecar, its own folder's record, and an ancestor's up to the root", () => {
        const base = assetTree({
            "images/provenance.yaml": COMPLETE,
            "images/deep/deeper/map.png": "x",
            "icons/a/provenance.yaml": COMPLETE,
            "icons/a/anvil.svg": "<svg/>",
            "icons/b/bolt.svg": "<svg/>",
            "icons/b/bolt.svg.yaml": COMPLETE,
        });
        expect(findingsFor(base)).toEqual([]);
    });

    it("resolves each file in a folder individually", () => {
        const base = assetTree({
            "icons/mixed/anvil.svg": "<svg/>",
            "icons/mixed/bolt.svg": "<svg/>",
            "icons/mixed/bolt.svg.yaml": COMPLETE,
            "icons/mixed/crown.svg": "<svg/>",
        });
        const files = findingsFor(base)
            .map((f) => path.basename(f.file))
            .sort();
        expect(files).toEqual(["anvil.svg", "crown.svg"]);
    });

    it("stops the search at the type root, so a record above it covers nothing", () => {
        const base = assetTree({ "provenance.yaml": COMPLETE, "icons/anvil.svg": "<svg/>" });
        expect(findingsFor(base).map((f) => path.basename(f.file))).toEqual(["anvil.svg"]);
    });
});
