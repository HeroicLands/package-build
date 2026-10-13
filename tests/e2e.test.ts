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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    E2E_GM_ID,
    E2E_SCENE_ID,
    defaultSceneDocument,
    deployForContainer,
    findExecutable,
    freshResults,
    gmDocument,
    hashPassword,
    isWorldActive,
    missingExecutables,
    moduleConfigurationDocument,
    parseFastArgs,
    resolveE2EWorld,
    resolveSweepVersion,
    seedTestWorld,
    suiteExecutables,
    suiteVerdict,
    waitForWorld,
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

describe("what a suite command needs before it can run", () => {
    it("reads the tool a package runner is only standing in for", () => {
        // `npx` is never missing, so checking it answers nothing. The question
        // the harness has to ask is whether `cypress` is there.
        expect(suiteExecutables(["npx", "cypress", "run"])).toEqual(["npx", "cypress"]);
        expect(suiteExecutables(["npx", "--yes", "cypress", "run"])).toEqual(["npx", "cypress"]);
        expect(suiteExecutables(["pnpm", "dlx", "cypress", "run"])).toEqual(["pnpm", "cypress"]);
    });

    it("does not mistake a script name for a program", () => {
        // `npm run e2e` names a package script. There is no `e2e` executable to
        // go looking for, and reporting one missing would name a fiction.
        expect(suiteExecutables(["npm", "run", "e2e"])).toEqual(["npm"]);
    });

    it("checks the runner alone when the command names its package another way", () => {
        expect(suiteExecutables(["npx", "-p", "cypress", "cypress", "run"])).toEqual(["npx"]);
        expect(suiteExecutables(["npx", "--package=cypress", "cypress"])).toEqual(["npx"]);
    });

    it("takes a plain command at its word", () => {
        expect(suiteExecutables(["./scripts/e2e.sh", "--spec", "x"])).toEqual(["./scripts/e2e.sh"]);
        expect(suiteExecutables([])).toEqual([]);
    });

    it("names what is missing rather than failing three minutes later", () => {
        expect(
            missingExecutables({
                command: ["npx", "definitely-not-an-installed-runner", "run"],
                cwd: os.tmpdir(),
                env: { PATH: "" },
            }),
        ).toEqual(["npx", "definitely-not-an-installed-runner"]);
    });

    it("finds a tool in the repository's own node_modules/.bin", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-e2e-"));
        const bin = path.join(root, "node_modules", ".bin");
        const shim = process.platform === "win32" ? "cypress.cmd" : "cypress";
        fs.mkdirSync(bin, { recursive: true });
        fs.writeFileSync(path.join(bin, shim), "#!/bin/sh\n");

        expect(findExecutable("cypress", { cwd: root, env: { PATH: "" } })).toBe(
            path.join(bin, shim),
        );
        expect(
            missingExecutables({ command: ["cypress", "run"], cwd: root, env: { PATH: "" } }),
        ).toEqual([]);

        fs.rmSync(root, { recursive: true, force: true });
    });
});

describe("a run that executed nothing is not a pass", () => {
    it("hands back a plain result when there is nothing to check it against", () => {
        expect(suiteVerdict({ status: 0 })).toEqual({ status: 0, message: null });
        expect(suiteVerdict({ status: 3 })).toEqual({ status: 3, message: null });
    });

    it("refuses to report a run green when it wrote no results", () => {
        const verdict = suiteVerdict({
            status: 0,
            declared: ["cypress/results"],
            fresh: [],
        });

        expect(verdict.status).toBe(1);
        expect(verdict.message).toMatch(/cypress\/results/);
    });

    it("reports a run green when it did write results", () => {
        expect(
            suiteVerdict({
                status: 0,
                declared: ["cypress/results"],
                fresh: ["cypress/results"],
            }),
        ).toEqual({ status: 0, message: null });
    });

    it("leaves a failing suite its own status rather than inventing one", () => {
        // The check may only ever make a verdict worse. A harness that could
        // rewrite one non-zero status into another would be a second way to
        // report something that did not happen.
        expect(suiteVerdict({ status: 4, declared: ["cypress/results"], fresh: [] }).status).toBe(
            4,
        );
    });

    it("fails a run whose runner disappeared out from under it", () => {
        // The reported case: `npm ci` removed `node_modules` mid-run, Cypress
        // died, and the harness said 0.
        const verdict = suiteVerdict({ status: 0, vanished: ["cypress"] });

        expect(verdict.status).toBe(1);
        expect(verdict.message).toMatch(/cypress/);
    });
});

describe("evidence that the suite ran", () => {
    it("counts what this run wrote, not what a previous one left behind", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-e2e-"));
        const stale = path.join(root, "stale", "nested");
        const written = path.join(root, "written");
        fs.mkdirSync(stale, { recursive: true });
        fs.mkdirSync(written, { recursive: true });
        fs.writeFileSync(path.join(stale, "old.json"), "{}");
        const yesterday = new Date(Date.now() - 86_400_000);
        fs.utimesSync(path.join(stale, "old.json"), yesterday, yesterday);

        const since = Date.now();
        fs.writeFileSync(path.join(written, "results.json"), "{}");

        expect(freshResults({ paths: ["written", "stale"], since, cwd: root })).toEqual([
            "written",
        ]);

        fs.rmSync(root, { recursive: true, force: true });
    });

    it("counts nothing for a results path that was never created", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-e2e-"));

        expect(freshResults({ paths: ["never-written"], since: Date.now(), cwd: root })).toEqual(
            [],
        );

        fs.rmSync(root, { recursive: true, force: true });
    });
});

describe("seeding a world the container's user can use", () => {
    /** Seed into a scratch data root, recording each helper-container call. */
    async function seed(containerUser: string | null = null) {
        const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pb-seed-"));
        const calls: Record<string, unknown>[] = [];
        const worldDir = path.join(dataRoot, "Data", "worlds", "sohl-e2e");
        let hostWrites: string[] = [];
        const runScript = (opts: Record<string, unknown>) => {
            calls.push(opts);
            if (calls.length === 2) {
                // What the host has written by the time the world is handed
                // over: the final world directory must still be untouched.
                hostWrites = fs.existsSync(worldDir) ? fs.readdirSync(worldDir) : [];
            }
            return calls.length === 1 ? "1000:1000\n" : "";
        };
        await seedTestWorld({
            config: config({
                e2eStage: "test",
                compatibilityMinimum: "14",
                systemId: "sohl",
                e2eDocuments: {},
                containerStages: {},
                containerImage: null,
                containerName: null,
                rootDir: dataRoot,
            }),
            packageJson: { version: "1.0.0" },
            env: {
                FOUNDRYVTT_TEST_DATA: dataRoot,
                ...(containerUser ? { FOUNDRYVTT_CONTAINER_USER: containerUser } : {}),
            },
            runScript,
        } as never);
        return { dataRoot, calls, hostWrites, worldDir };
    }

    it("builds the databases outside the world and never touches the world itself", async () => {
        // A LevelDB the host user writes carries a LOCK the container's user
        // cannot take, so the host must not leave one in the world directory.
        const { dataRoot, hostWrites, worldDir } = await seed();

        expect(hostWrites).toEqual([]);
        expect(fs.existsSync(worldDir)).toBe(false);
        const locks = fs
            .readdirSync(path.join(dataRoot, ".seed-sohl-e2e", "data", "users"))
            .filter((name) => name === "LOCK");
        expect(locks).toEqual(["LOCK"]);
    });

    it("replaces the old world as root, so files the container wrote do not stop it", async () => {
        const { calls } = await seed();
        const finish = calls[1] as { user: string; script: string; args: string[] };

        expect(finish.user).toBe("0:0");
        expect(finish.script).toContain('rm -rf "/data/Data/worlds/$1"');
        expect(finish.script).toContain('mv "/data/$2" "/data/Data/worlds/$1"');
        expect(finish.args).toEqual(["sohl-e2e", ".seed-sohl-e2e", "1000:1000"]);
    });

    it("hands the world to the user the container runs as", async () => {
        const { calls } = await seed("0:0");
        const ask = calls[0] as { user: string | null; script: string };
        const finish = calls[1] as { script: string; args: string[] };

        expect(ask.user).toBe("0:0");
        expect(ask.script).toContain("id -u");
        expect(finish.script).toContain('chown -R "$3" "/data/Data/worlds/$1"');
        expect(finish.args[2]).toMatch(/^\d+:\d+$/);
    });
});

describe("the world-activation timeout", () => {
    it("names the stage in the log command, so it can be pasted as written", async () => {
        await expect(
            waitForWorld({
                url: "http://localhost:1",
                container: "none",
                stage: "test",
                timeoutMs: 0,
            }),
        ).rejects.toThrow("Check `package-build container test logs`.");
    });
});

describe("a Foundry licence that is not signed", () => {
    const unsigned = [
        "[info] Authenticating with foundryvtt.com",
        "[info] Applying license key passed via FOUNDRY_LICENSE_KEY.",
        "Software license requires signature.",
    ].join("\n");

    it("fails at once, naming the data root and the one-time signing step", async () => {
        const reads: number[] = [];
        const error = await waitForWorld({
            url: "http://localhost:1",
            container: "none",
            stage: "test",
            dataRoot: "/srv/fvtt-test",
            readLog: () => {
                reads.push(1);
                return unsigned;
            },
        }).catch((e: Error) => e);

        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;
        expect(message).toContain("not signed");
        expect(message).toContain("/srv/fvtt-test");
        expect(message).toContain("Config/license.json");
        expect(message).toContain("package-build container test start");
        expect(message).toMatch(/accept the (licen[sc]e )?agreement/i);
        expect(message).toContain("own signature");
        expect(message).not.toMatch(/image signs/i);
        expect(reads).toHaveLength(1);
    });

    it("is read from a log that the join polling would have scrolled past", async () => {
        const noisy = [
            unsigned,
            ...Array.from({ length: 200 }, () => "Created client session"),
        ].join("\n");

        await expect(
            waitForWorld({
                url: "http://localhost:1",
                container: "none",
                stage: "test",
                readLog: () => noisy,
            }),
        ).rejects.toThrow(/not signed/);
    });
});

describe("deploying the package for the container's user", () => {
    it("removes the old install and hands over the new one, as root, around the copy", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-deploy-"));
        const dataRoot = path.join(root, "data");
        fs.mkdirSync(path.join(root, "build", "stage", "packs", "actors"), { recursive: true });
        fs.writeFileSync(path.join(root, "build", "stage", "packs", "actors", "LOCK"), "");
        const installed = path.join(dataRoot, "Data", "systems", "sohl");
        const events: string[] = [];
        const runScript = (opts: Record<string, unknown>) => {
            events.push(`${String(opts.script)} | installed=${fs.existsSync(installed)}`);
            return String(opts.script).includes("id -u") ? "1000:1000" : "";
        };

        await deployForContainer({
            config: config({
                e2eStage: "test",
                stageDir: "build/stage",
                rootDir: root,
                compatibilityMinimum: "14",
                containerStages: {},
            }),
            env: { FOUNDRYVTT_TEST_DATA: dataRoot },
            runScript,
        } as never);

        expect(events).toEqual([
            'rm -rf "/data/$1" | installed=false',
            'echo "$(id -u):$(id -g)" | installed=true',
            'chown -R "$2" "/data/$1" | installed=true',
        ]);
        expect(fs.existsSync(path.join(installed, "packs", "actors", "LOCK"))).toBe(true);
    });

    it.skipIf(process.getuid?.() === 0)(
        "removes, as root, a backup an earlier deployment left beside the package",
        async () => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-deploy-"));
            const dataRoot = path.join(root, "data");
            fs.mkdirSync(path.join(root, "build", "stage"), { recursive: true });
            fs.writeFileSync(path.join(root, "build", "stage", "system.json"), "{}");
            const stale = path.join(dataRoot, "Data", "systems", "sohl.old-1");
            fs.mkdirSync(path.join(stale, "owned"), { recursive: true });
            fs.writeFileSync(path.join(stale, "owned", "system.json"), "{}");
            // Owned by the container's user: the host user cannot unlink it.
            fs.chmodSync(path.join(stale, "owned"), 0o555);
            const removedAsRoot: unknown[] = [];
            const runScript = (opts: Record<string, unknown>) => {
                const args = (opts.args as string[] | undefined) ?? [];
                if (String(opts.script) === 'rm -rf "/data/$1"' && args[0]?.includes(".old-")) {
                    removedAsRoot.push([opts.user, args[0]]);
                    const tree = path.join(dataRoot, args[0]);
                    fs.chmodSync(path.join(tree, "owned"), 0o755);
                    fs.rmSync(tree, { recursive: true, force: true });
                }
                return String(opts.script).includes("id -u") ? "1000:1000" : "";
            };

            try {
                await deployForContainer({
                    config: config({
                        e2eStage: "test",
                        stageDir: "build/stage",
                        rootDir: root,
                        compatibilityMinimum: "14",
                        containerStages: {},
                    }),
                    env: { FOUNDRYVTT_TEST_DATA: dataRoot },
                    runScript,
                } as never);

                expect(removedAsRoot).toEqual([["0:0", "Data/systems/sohl.old-1"]]);
                expect(fs.readdirSync(path.join(dataRoot, "Data", "systems"))).toEqual(["sohl"]);
            } finally {
                if (fs.existsSync(stale)) fs.chmodSync(path.join(stale, "owned"), 0o755);
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    );
});
