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
 * The end-to-end harness: the disposable world it seeds, when it decides a
 * world is serving, and what a sweep or a fast loop was asked to do.
 *
 * The suite itself is never here. The harness's whole claim is that it does not
 * care what runs, only that something does — so what runs is configuration, and
 * these cases check the harness's own decisions.
 */

import { describe, it, expect } from "vitest";

import {
    E2E_GM_ID,
    E2E_SCENE_ID,
    defaultSceneDocument,
    gmDocument,
    hashPassword,
    isWorldActive,
    moduleConfigurationDocument,
    parseFastArgs,
    resolveE2EWorld,
    resolveSweepVersion,
    worldManifest,
} from "../e2e.mjs";

/** A resolved package-build configuration, as the CLI would hand it over. */
function config(overrides: Record<string, unknown> = {}) {
    return {
        packageId: "sohl",
        packageKind: "systems",
        envPrefix: "SOHL",
        e2eWorld: {},
        e2eGm: {},
        ...overrides,
    } as never;
}

describe("the disposable world", () => {
    it("names itself after the package, so nothing is stated twice", () => {
        const world = resolveE2EWorld(config(), {});

        expect(world.worldId).toBe("sohl-e2e");
        expect(world.gmName).toBe("Gamemaster");
        expect(world.gmId).toBe(E2E_GM_ID);
    });

    it("takes a declared id and title over the derived ones", () => {
        const world = resolveE2EWorld(
            config({ e2eWorld: { id: "thal-e2e", title: "Thalorna E2E" } }),
            {},
        );

        expect(world.worldId).toBe("thal-e2e");
        expect(world.worldTitle).toBe("Thalorna E2E");
    });

    it("lets the environment override, under the repository's own prefix", () => {
        const world = resolveE2EWorld(config(), {
            SOHL_E2E_WORLD_ID: "scratch",
            SOHL_E2E_GM_PASSWORD: "hunter2",
        });

        expect(world.worldId).toBe("scratch");
        expect(world.gmPassword).toBe("hunter2");
    });

    it("hashes the GM password exactly as Foundry does", () => {
        // pbkdf2, 1000 rounds, 64 bytes, sha512 — the shape `core/auth.mjs`
        // checks against. A different one logs nobody in.
        const hash = hashPassword("sohl-e2e", "abcdef");

        expect(hash).toHaveLength(128);
        expect(hash).toBe(hashPassword("sohl-e2e", "abcdef"));
        expect(hash).not.toBe(hashPassword("sohl-e2e", "fedcba"));
    });

    it("gives the GM a fixed id, so a spec needs no handoff", () => {
        const gm = gmDocument({
            id: E2E_GM_ID,
            name: "Gamemaster",
            password: "x",
            salt: "ab",
        });

        expect(gm._id).toBe(E2E_GM_ID);
        expect(gm._key).toBe(`!users!${E2E_GM_ID}`);
        expect(gm.role).toBe(4);
        expect(gm.password).not.toBe("x");
    });

    it("declares the system the world runs, and the range it accepts", () => {
        const world = worldManifest({
            worldId: "sohl-e2e",
            worldTitle: "SoHL E2E",
            worldDescription: "Disposable.",
            systemId: "sohl",
            systemVersion: "1.2.3",
            coreVersion: "14",
        });

        expect(world.id).toBe("sohl-e2e");
        expect(world.system).toBe("sohl");
        expect(world.systemVersion).toBe("1.2.3");
        expect(world.compatibility).toEqual({ minimum: "14", verified: "14" });
    });

    it("seeds one active scene, so the canvas is ready and no tour starts", () => {
        // An empty world auto-starts Foundry's welcome tour, whose callout
        // overlays sheets; a world with no active scene has no ready canvas.
        const scene = defaultSceneDocument();

        expect(scene._id).toBe(E2E_SCENE_ID);
        expect(scene.active).toBe(true);
        expect(scene._key).toBe(`!scenes!${E2E_SCENE_ID}`);
    });

    it("activates a module package, which a world otherwise never loads", () => {
        // A system is the world's own; a module has to be switched on, and
        // that switch is a world setting rather than anything in world.json.
        const setting = moduleConfigurationDocument("sohl-thalorna");

        expect(setting.key).toBe("core.moduleConfiguration");
        expect(JSON.parse(setting.value)).toEqual({ "sohl-thalorna": true });
        expect(setting._key).toBe(`!settings!${setting._id}`);
    });
});

describe("when the world counts as serving", () => {
    it("waits for the join screen, not for the port to answer", () => {
        // Foundry answers on the port long before a world is active; a suite
        // started then fails every spec for no visible reason.
        expect(isWorldActive('<div id="join-game">…</div>')).toBe(true);
        expect(isWorldActive("<h1>Foundry Virtual Tabletop</h1>")).toBe(false);
    });
});

describe("what a sweep was asked to run against", () => {
    it("takes an exact build", () => {
        expect(resolveSweepVersion(["14.367"])).toBe("14.367");
    });

    it("refuses to guess one", () => {
        // The product of a sweep is a citable result, so there is no default.
        expect(() => resolveSweepVersion([])).toThrow(/name the build/i);
    });

    it("refuses a bare major or a tag", () => {
        expect(() => resolveSweepVersion(["14"])).toThrow(/exact/i);
        expect(() => resolveSweepVersion(["latest"])).toThrow(/exact/i);
    });
});

describe("what the fast loop was asked to do", () => {
    /** An ordered build table, as a repository declares it. */
    const build = {
        code: { script: "build:code", recreate: false },
        assets: { script: "build:assets", recreate: false },
        db: { script: "build:db", recreate: false },
        system: { script: "build:system", recreate: true },
    };

    it("rebuilds everything, in the order the repository declared", () => {
        // The bundler empties the stage, so it has to run before the passes
        // that copy into it — declaration order is that order.
        const args = parseFastArgs([], build);

        expect(args.targets).toEqual(["code", "assets", "db", "system"]);
    });

    it("rebuilds a named subset, still in declared order", () => {
        expect(parseFastArgs(["--build=db,code"], build).targets).toEqual(["code", "db"]);
    });

    it("builds nothing when asked for none", () => {
        expect(parseFastArgs(["--build=none"], build).targets).toEqual([]);
    });

    it("refuses an unknown target rather than half-deploying", () => {
        expect(() => parseFastArgs(["--build=styles"], build)).toThrow(/styles/);
    });

    it("recreates the container when a target says the world must relaunch", () => {
        // The manifest is read once at world launch, so deploying it into a
        // running world deploys a file nothing will look at.
        expect(parseFastArgs(["--build=system"], build).recreate).toBe(true);
        expect(parseFastArgs(["--build=code"], build).recreate).toBe(false);
        expect(parseFastArgs(["--build=code", "--recreate"], build).recreate).toBe(true);
    });

    it("can stop once the environment is current", () => {
        expect(parseFastArgs(["--no-run"], build).runSuite).toBe(false);
    });

    it("hands everything else to the suite verbatim", () => {
        const args = parseFastArgs(
            ["--spec", "cypress/e2e/skill.cy.js", "--", "--browser", "chrome"],
            build,
        );

        expect(args.suiteArgs).toEqual([
            "--browser",
            "chrome",
            "--spec",
            "cypress/e2e/skill.cy.js",
        ]);
    });
});
