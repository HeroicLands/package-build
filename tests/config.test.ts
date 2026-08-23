/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The reserved `packageBuild` section — what a repository states, and what is
 * derived from what it already stated elsewhere.
 *
 * These cases run against `resolvePackageBuildConfig`, the pure half: it reads
 * no file and touches no environment, so a rule can be described directly
 * rather than through a fixture repository on disk.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";

import { resolvePackageBuildConfig } from "../config.mjs";

/** The shared configuration content-build would have resolved. */
function shared(packageBuild: Record<string, unknown> = {}) {
    return {
        rootDir: "/repo",
        packageKind: "systems",
        foundryPackage: "sohl",
        packageBuild,
    };
}

describe("what is derived rather than stated", () => {
    it("takes the package identity from the shared configuration", () => {
        // `push-stage.mjs` hard-coded both beside a config that already
        // declared them, which is two places for one fact.
        const config = resolvePackageBuildConfig(shared());

        expect(config.rootDir).toBe("/repo");
        expect(config.packageKind).toBe("systems");
        expect(config.packageId).toBe("sohl");
    });

    it("derives the release artifact from the package kind", () => {
        // Foundry installs a system from system.json and a module from
        // module.json, so the kind already decides it.
        expect(resolvePackageBuildConfig(shared()).artifact).toBe("system");
        expect(
            resolvePackageBuildConfig({
                ...shared(),
                packageKind: "modules",
            }).artifact,
        ).toBe("module");
    });

    it("still honours a stated artifact", () => {
        expect(
            resolvePackageBuildConfig(shared({ release: { artifact: "mod" } }))
                .artifact,
        ).toBe("mod");
    });

    it("defaults every optional half", () => {
        const config = resolvePackageBuildConfig(shared());

        expect(config.stageDir).toBe("build/stage");
        expect(config.assets).toEqual([]);
        expect(config.assetTransform).toBeNull();
        expect(config.cleanExtra).toEqual([]);
        expect(config.langSources).toBe("lang/*.json");
        expect(config.langHelp).toBeNull();
        expect(config.envPrefix).toBe("SOHL");
    });

    it("resolves an asset transform against the repository root", () => {
        // The one genuine piece of code in staging stays the repository's; the
        // configuration names where it lives.
        const config = resolvePackageBuildConfig(
            shared({ assetTransform: "./utils/svg-theme.mjs" }),
        );

        expect(config.assetTransform).toBe(
            path.resolve("/repo", "./utils/svg-theme.mjs"),
        );
    });
});

describe("what a repository states", () => {
    it("normalizes the asset table", () => {
        const config = resolvePackageBuildConfig(
            shared({
                assets: [
                    { from: "lang", to: "lang" },
                    { from: "LICENSE.md", to: "LICENSE.md" },
                ],
            }),
        );

        expect(config.assets).toEqual([
            { from: "lang", to: "lang" },
            { from: "LICENSE.md", to: "LICENSE.md" },
        ]);
        expect(Object.isFrozen(config.assets)).toBe(true);
    });

    it("carries the extra directories a repository's clean has to reach", () => {
        // A site generates content/, public/ and resources/; the library's own
        // list is the conventional build artifacts and nothing else.
        expect(
            resolvePackageBuildConfig(
                shared({ clean: { extra: ["site/content", "site/public"] } }),
            ).cleanExtra,
        ).toEqual(["site/content", "site/public"]);
    });

    it("carries repository-specific guidance for a lang failure", () => {
        const help = "See kb/dev-docs/reference/localization-keys.md.";
        expect(
            resolvePackageBuildConfig(shared({ lang: { help } })).langHelp,
        ).toBe(help);
    });
});

describe("the manifest specification", () => {
    it("passes an arbitrary block through, so Foundry can add keys", () => {
        const manifest = {
            title: "Song of Heroic Lands",
            documentTypes: { Actor: { being: { htmlFields: ["dossier"] } } },
            somethingFoundryAddsLater: true,
        };

        expect(
            resolvePackageBuildConfig(shared({ manifest })).manifest,
        ).toEqual(manifest);
    });

    it("defaults to an empty block", () => {
        expect(resolvePackageBuildConfig(shared()).manifest).toEqual({});
    });

    it.each([
        ["id", "foundryPackage"],
        ["version", "package.json"],
        ["url", "package.json"],
        ["bugs", "package.json"],
        ["manifest", "package.json"],
        ["download", "package.json"],
        ["compatibility", "the top level"],
        ["relationships", "the top level"],
        ["packs", "the top level"],
    ])("refuses a declared %s, which the build derives", (key) => {
        // An override would be silently overwritten, and the two would disagree
        // with nothing to say so.
        expect(() =>
            resolvePackageBuildConfig(shared({ manifest: { [key]: "x" } })),
        ).toThrow(new RegExp(`packageBuild\\.manifest\\.${key}`));
    });

    it("names where the value actually comes from", () => {
        expect(() =>
            resolvePackageBuildConfig(
                shared({ manifest: { version: "9.9.9" } }),
            ),
        ).toThrow(/package\.json/);
    });

    it("resolves the flags module against the repository root", () => {
        expect(
            resolvePackageBuildConfig(
                shared({ manifestFlags: "./utils/manifest-flags.mjs" }),
            ).manifestFlags,
        ).toBe(path.resolve("/repo", "./utils/manifest-flags.mjs"));
    });
});

describe("what it refuses", () => {
    it.each([
        ["an unknown section key", { notAKey: true }, /notAKey/],
        ["a non-list asset table", { assets: {} }, /assets/],
        ["an asset with no destination", { assets: [{ from: "lang" }] }, /to/],
        [
            "an unknown asset key",
            { assets: [{ from: "a", to: "b", mode: "copy" }] },
            /mode/,
        ],
        ["a non-mapping clean block", { clean: [] }, /clean/],
        ["a non-list clean.extra", { clean: { extra: "site" } }, /extra/],
        ["an unknown deploy key", { deploy: { user: "root" } }, /user/],
        ["an empty stageDir", { stageDir: "" }, /stageDir/],
    ])("rejects %s", (_name, section, pattern) => {
        expect(() =>
            resolvePackageBuildConfig(
                shared(section as Record<string, unknown>),
            ),
        ).toThrow(pattern as RegExp);
    });

    it("names the section in every message, so the file is obvious", () => {
        expect(() =>
            resolvePackageBuildConfig(shared({ clean: { extra: "site" } })),
        ).toThrow(/packageBuild\.clean\.extra/);
    });
});

describe("the bundle entry", () => {
    it("derives the entry from the package id", () => {
        // A Foundry package's bundle is conventionally named after the package,
        // and the id is already derived from package.json `name`. Stating it
        // again would be a third spelling of one fact.
        expect(resolvePackageBuildConfig(shared()).bundleEntry).toBe(
            "sohl.mjs",
        );
    });

    it("still honours a stated entry", () => {
        expect(
            resolvePackageBuildConfig(shared({ bundle: { entry: "main.mjs" } }))
                .bundleEntry,
        ).toBe("main.mjs");
    });

    it("rejects an entry that is not a non-empty string", () => {
        expect(() =>
            resolvePackageBuildConfig(shared({ bundle: { entry: "" } })),
        ).toThrow(/packageBuild\.bundle\.entry/);
    });

    it("rejects an unknown key in the section", () => {
        expect(() =>
            resolvePackageBuildConfig(
                shared({ bundle: { entrypoint: "main.mjs" } }),
            ),
        ).toThrow(/packageBuild\.bundle\./);
    });

    it("rejects a section that is not a mapping", () => {
        expect(() =>
            resolvePackageBuildConfig(shared({ bundle: "main.mjs" })),
        ).toThrow(/packageBuild\.bundle/);
    });
});

describe("the result is frozen", () => {
    it("cannot be mutated by whoever reads it", () => {
        const config = resolvePackageBuildConfig(shared());
        expect(Object.isFrozen(config)).toBe(true);
    });
});
