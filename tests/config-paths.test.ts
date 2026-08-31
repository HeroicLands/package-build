/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * What #1508 made configurable, asserted from a consumer's point of view: a
 * repository that does **not** use the conventional layout, built from a
 * throwaway tree that is nobody's working directory.
 *
 * `pack-config.test.ts` covers the same seam from the inside, against this
 * repository's own resolved configuration. This file covers the half that only
 * a foreign layout can prove — that the directories are read from configuration
 * rather than assumed, and that the core version is located by a *path* rather
 * than captured as a value.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { defineConfig } from "../index.mjs";
import { buildStats as buildStatsRaw } from "../engine/helpers.mjs";
import { countContentNotes } from "../engine/content-tree.mjs";

// The pack helpers are plain ESM whose JSDoc types the return as `object`.
const buildStats = (systemVersion?: string, config?: unknown): any =>
    buildStatsRaw(systemVersion as any, config as any);

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Two directories inside this package, used only as *different* launch
// directories. The cwd-independence check below needs somewhere to run from,
// not any particular repository — it used to reach the host repository root and
// a `packages/content-build` path beneath it, which only existed while this
// package was vendored inside the system repository.
const PKG_ROOT = path.resolve(HERE, "..");
const PKG_SUBDIR = path.join(PKG_ROOT, "engine");
const CONFIG_URL = pathToFileURL(path.resolve(HERE, "../content-config.mjs")).href;
const HELPERS_URL = pathToFileURL(path.resolve(HERE, "../engine/helpers.mjs")).href;

/** A note the content walk will find, wherever the consumer put its tree. */
const NOTE = `---
name:
  full: Relocated Note
id: FFFFFFFFFFFFFFFF
shortcode: relocated
type: doc
sohl:
  archetype: null
---

# Overview

A note in a content tree that is not where the defaults expect it.
`;

/**
 * A throwaway consumer repository whose content tree and manifest both sit
 * somewhere the defaults would never look.
 *
 * @param coreVersion  The `compatibility.minimum` its manifest declares.
 */
function sandbox(coreVersion: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sohl-layout-"));
    fs.mkdirSync(path.join(root, "vault/notes"), { recursive: true });
    fs.mkdirSync(path.join(root, "meta"), { recursive: true });
    fs.writeFileSync(path.join(root, "vault/notes/Relocated.md"), NOTE, "utf8");
    fs.writeFileSync(
        path.join(root, "meta/module.template.json"),
        `${JSON.stringify(
            {
                id: "sohl-elsewhere",
                packs: [],
                compatibility: { minimum: coreVersion },
            },
            null,
            2,
        )}\n`,
        "utf8",
    );
    return root;
}

/**
 * The configuration such a consumer writes: relocated paths, and the Foundry
 * floor it supports.
 *
 * The floor is declared here rather than read out of the manifest in the
 * sandbox (#50). The sandbox still writes one, because the package-id guard
 * reads it — but it no longer feeds the stamp, and the two are deliberately
 * allowed to disagree in the cases below.
 */
function configFor(root: string, coreVersion = "14.359") {
    return defineConfig({
        compatibility: { minimum: coreVersion, verified: coreVersion },
        rootDir: root,
        contentPackage: "elsewhere",
        foundryPackage: "sohl-elsewhere",
        packageKind: "modules",
        // The identity is declared under `systems:` and selected by
        // `requiresSystem` now; `stats.systemId`/`systemVersion` are derived
        // and may not be authored (#48).
        systems: { sohl: { compatibility: { verified: "3.2.1" } } },
        requiresSystem: "sohl",
        stats: {
            lastModifiedBy: "elsewherebuild0",
        },
        paths: { content: "vault/notes" },
        packs: [{ name: "items", type: "Item" }],
    });
}

describe("a consumer that moves a directory is honoured (#1508)", () => {
    const root = sandbox("14.412");
    const config = configFor(root);

    it("resolves a relocated directory against the consumer's own root", () => {
        expect(config.paths.content).toBe(path.join(root, "vault/notes"));
        // Nothing is left pointing at the convention the consumer declined.
        expect(fs.existsSync(path.join(root, "assets/content"))).toBe(false);
    });

    it("is the path the content walk actually reads", () => {
        // Not merely "the string came back": a real consumer of the path finds
        // the notes there, which a resolution that quietly kept the default
        // could not do.
        expect(countContentNotes(config.paths.content)).toBe(1);
        expect(countContentNotes(path.join(root, "assets/content"))).toBe(0);
    });

    it("stamps that consumer's identity, from configuration", () => {
        const stats = buildStats(undefined, config);
        expect(stats.systemId).toBe("sohl");
        expect(stats.systemVersion).toBe("3.2.1");
        expect(stats.lastModifiedBy).toBe("elsewherebuild0");
    });
});

describe("the core version is configuration, and the stamp follows it", () => {
    it("moves with the declared floor", () => {
        // Two configurations differing only in the floor they declare.
        const older = configFor(sandbox("14.001"), "14.360");
        const newer = configFor(sandbox("14.001"), "14.999");

        expect(buildStats(undefined, older).coreVersion).toBe("14.360");
        expect(buildStats(undefined, newer).coreVersion).toBe("14.999");
    });

    it("ignores what the manifest in the tree happens to say", () => {
        // The direction of truth reversed in #50: package-build generates the
        // manifest *from* the configuration, so reading it back would be a
        // round trip through an artifact that need not exist yet — `build:db`
        // can run before it is written. Here the sandbox's manifest says
        // something else entirely and is correctly disregarded.
        const config = configFor(sandbox("14.001"), "14.500");

        expect(buildStats(undefined, config).coreVersion).toBe("14.500");
    });
});

describe("path resolution does not depend on the working directory", () => {
    it("resolves the same tree from any launch directory", () => {
        // The failure this rules out is invisible in-repo, because the
        // repository root is almost always the cwd: a path resolved against
        // `process.cwd()` works for `npm run build` at the root and breaks for
        // `npm test -w @heroiclands/package-build`, or for a consumer whose CI
        // launches from anywhere else.
        const root = sandbox("14.377");
        const script = `
            const { defineConfig } = await import(${JSON.stringify(CONFIG_URL)});
            const { buildStats } = await import(${JSON.stringify(HELPERS_URL)});
            const config = defineConfig({
                compatibility: { minimum: "14.377", verified: "14.377" },
                rootDir: ${JSON.stringify(root)},
                contentPackage: "elsewhere",
                foundryPackage: "sohl-elsewhere",
                packageKind: "modules",
                stats: {
                    lastModifiedBy: "elsewherebuild0",
                },
                paths: { content: "vault/notes" },
                packs: [{ name: "items", type: "Item" }],
            });
            process.stdout.write(JSON.stringify({
                content: config.paths.content,
                core: buildStats(undefined, config).coreVersion,
            }));
        `;

        /** Run the script with `cwd` as the working directory. */
        const from = (cwd: string) => {
            const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
                cwd,
                encoding: "utf8",
            });
            expect(result.stderr).toBe("");
            expect(result.status).toBe(0);
            return result.stdout;
        };

        const expected = JSON.stringify({
            content: path.join(root, "vault/notes"),
            core: "14.377",
        });
        expect(from(PKG_ROOT)).toBe(expected);
        expect(from(PKG_SUBDIR)).toBe(expected);
        expect(from(os.tmpdir())).toBe(expected);
    });
});
