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
 * Running a built package in a Foundry VTT container.
 *
 * Everything here is the pure half: what a stage resolves to, which image and
 * build a run pins, and the `docker run` argument vector that follows. The
 * half that talks to `docker` is named for it and is not exercised here.
 */

import { describe, it, expect } from "vitest";

import {
    CACHE_MOUNT,
    CONTAINER_PORT,
    containerName,
    dataEnvVar,
    dockerRunArgs,
    passthroughEnv,
    resolveContainer,
    resolveDataRoot,
    resolveFoundryVersion,
    resolveImage,
    resolveStagePort,
    resolveWorld,
} from "../container.mjs";

describe("what a stage resolves to", () => {
    it("names the container after the package, so two can run at once", () => {
        expect(containerName("sohl", "test")).toBe("sohl-foundry-test");
        expect(containerName("sohl-thalorna", "dev")).toBe("sohl-thalorna-foundry-dev");
    });

    it("takes a declared name, so packages can share one licence", () => {
        // A signed licence is bound to the hostname, which follows the name.
        // Two packages naming the same container are one instance, and one
        // signature covers both.
        expect(containerName("sohl", "test", "heroiclands-foundry")).toBe(
            "heroiclands-foundry-test",
        );
        expect(containerName("hm3", "test", "heroiclands-foundry")).toBe(
            "heroiclands-foundry-test",
        );
    });

    it("keeps the stage in a declared name, so two stages stay two", () => {
        // Used whole, `container dev` would find the test container already
        // there and serve the test data root on the dev port.
        expect(containerName("sohl", "dev", "heroiclands-foundry")).not.toBe(
            containerName("sohl", "test", "heroiclands-foundry"),
        );
    });

    it("derives the data-root variable rather than tabulating it", () => {
        expect(dataEnvVar("test")).toBe("FOUNDRYVTT_TEST_DATA");
        expect(dataEnvVar("leg")).toBe("FOUNDRYVTT_LEG_DATA");
    });

    it("publishes a distinct default port per conventional stage", () => {
        expect(resolveStagePort("dev")).toBe(30000);
        expect(resolveStagePort("qa")).toBe(30001);
        expect(resolveStagePort("prod")).toBe(30002);
        expect(resolveStagePort("test")).toBe(30003);
    });

    it("takes a declared stage's port from configuration", () => {
        expect(resolveStagePort("leg", { stages: { leg: { port: 30010 } } })).toBe(30010);
    });

    it("lets the environment override any of them", () => {
        expect(
            resolveStagePort("test", {
                env: { FOUNDRYVTT_TEST_PORT: "31000" },
            }),
        ).toBe(31000);
    });

    it("refuses a stage with no data root configured", () => {
        expect(() => resolveDataRoot("test", { env: {} })).toThrow(/FOUNDRYVTT_TEST_DATA/);
    });

    it("refuses a remote data root, which cannot be bind-mounted", () => {
        expect(() =>
            resolveDataRoot("qa", {
                env: { FOUNDRYVTT_QA_DATA: "user@host:/srv/foundry" },
            }),
        ).toThrow(/remote/i);
    });

    it("accepts a local data root", () => {
        expect(
            resolveDataRoot("qa", {
                env: { FOUNDRYVTT_QA_DATA: "/srv/foundry" },
            }),
        ).toBe("/srv/foundry");
    });
});

describe("which Foundry build a run pins", () => {
    it("pins the test stage to the compatibility floor it claims", () => {
        // The manifest promises a minimum, and a promise is only defended if
        // something exercises it — so the evidence and the claim are one number.
        expect(resolveFoundryVersion("test", { compatibilityMinimum: "14.359" })).toBe("14.359");
    });

    it("leaves the maintainer's own stages unpinned", () => {
        // dev/qa/prod track whatever Foundry they are meant to.
        expect(resolveFoundryVersion("dev", { compatibilityMinimum: "14.359" })).toBeNull();
    });

    it("cannot pin a floor that names no build", () => {
        // A bare major would resolve to whatever the registry served that week,
        // which is the drift a pin exists to prevent.
        expect(resolveFoundryVersion("test", { compatibilityMinimum: "14" })).toBeNull();
    });

    it("takes a declared stage's build from configuration", () => {
        expect(
            resolveFoundryVersion("leg", {
                stages: { leg: { version: "12.331" } },
            }),
        ).toBe("12.331");
    });

    it("lets the environment win, so a sweep needs no committed change", () => {
        expect(
            resolveFoundryVersion("test", {
                env: { FOUNDRYVTT_TEST_VERSION: "14.367" },
                compatibilityMinimum: "14.359",
            }),
        ).toBe("14.367");
    });
});

describe("which image a run uses", () => {
    it("takes the major from the pinned build", () => {
        expect(resolveImage({ version: "14.359" })).toBe("felddy/foundryvtt:14");
        expect(resolveImage({ version: "12.331" })).toBe("felddy/foundryvtt:12");
    });

    it("falls back to the major of the compatibility floor", () => {
        expect(resolveImage({ compatibilityMinimum: "14.359" })).toBe("felddy/foundryvtt:14");
    });

    it("floats only when the package claims no floor at all", () => {
        expect(resolveImage({})).toBe("felddy/foundryvtt:release");
    });

    it("honours a configured image, then an environment override", () => {
        expect(resolveImage({ image: "local/foundry:wip", version: "14.359" })).toBe(
            "local/foundry:wip",
        );
        expect(
            resolveImage({
                env: { FOUNDRYVTT_CONTAINER_IMAGE: "mirror/foundry:14" },
                image: "local/foundry:wip",
            }),
        ).toBe("mirror/foundry:14");
    });
});

describe("which world a stage launches", () => {
    it("leaves it unset by default, so the image decides", () => {
        expect(resolveWorld("dev", { env: {} })).toBeNull();
    });

    it("takes an explicit world from the environment", () => {
        expect(
            resolveWorld("test", {
                env: { FOUNDRYVTT_TEST_WORLD: "sohl-e2e" },
            }),
        ).toBe("sohl-e2e");
    });

    it("lets a declared stage force no auto-launch at all", () => {
        // The legacy stage's world is managed by hand.
        expect(resolveWorld("leg", { stages: { leg: { world: "" } } })).toBe("");
    });
});

describe("the environment the container is created with", () => {
    it("passes every FOUNDRY_ and CONTAINER_ variable through", () => {
        expect(
            passthroughEnv({
                FOUNDRY_USERNAME: "toasty",
                CONTAINER_PRESERVE_CONFIG: "true",
                PATH: "/usr/bin",
            }),
        ).toEqual([
            ["FOUNDRY_USERNAME", "toasty"],
            ["CONTAINER_PRESERVE_CONFIG", "true"],
        ]);
    });

    it("withholds CONTAINER_CACHE, which names a path inside the container", () => {
        // A host path leaking through would name a mount that does not exist.
        expect(passthroughEnv({ CONTAINER_CACHE: "/host/zips" })).toEqual([]);
    });
});

describe("the docker run argument vector", () => {
    const base = {
        name: "sohl-foundry-test",
        image: "felddy/foundryvtt:14",
        port: 30003,
        dataRoot: "/data-e2e",
        env: {},
    };

    it("publishes the host port onto the port Foundry listens on", () => {
        const args = dockerRunArgs(base);
        expect(args).toContain("--publish");
        expect(args).toContain(`30003:${CONTAINER_PORT}`);
    });

    it("bind-mounts the data root the deploy already writes into", () => {
        expect(dockerRunArgs(base)).toContain("/data-e2e:/data");
    });

    it("pins the hostname, because Foundry binds a signed licence to it", () => {
        const args = dockerRunArgs(base);
        expect(args[args.indexOf("--hostname") + 1]).toBe("sohl-foundry-test");
    });

    it("passes the pinned build to the image as FOUNDRY_VERSION", () => {
        expect(dockerRunArgs({ ...base, version: "14.359" })).toContain("FOUNDRY_VERSION=14.359");
    });

    it("omits FOUNDRY_VERSION entirely when nothing is pinned", () => {
        expect(dockerRunArgs(base).join(" ")).not.toContain("FOUNDRY_VERSION");
    });

    it("sets an empty world when a stage forces no auto-launch", () => {
        expect(dockerRunArgs({ ...base, world: "" })).toContain("FOUNDRY_WORLD=");
    });

    it("mounts a host cache and points the image at the mount", () => {
        const args = dockerRunArgs({ ...base, cacheDir: "/host/zips" });
        expect(args).toContain(`/host/zips:${CACHE_MOUNT}`);
        expect(args).toContain(`CONTAINER_CACHE=${CACHE_MOUNT}`);
    });

    it("lets a per-stage licence beat the one passed through", () => {
        // docker takes the last `-e` for a repeated key, so order is the rule.
        const args = dockerRunArgs({
            ...base,
            env: { FOUNDRY_LICENSE_KEY: "SHARED" },
            licenseKey: "DEDICATED",
        });
        const keys = args
            .map((a, i) => (a === "FOUNDRY_LICENSE_KEY=DEDICATED" ? i : -1))
            .filter((i) => i >= 0);
        const shared = args.indexOf("FOUNDRY_LICENSE_KEY=SHARED");
        expect(keys[0]).toBeGreaterThan(shared);
    });
});

describe("resolving a stage from configuration", () => {
    /** The fields `resolveContainer` reads, at their defaults. */
    function config(extra: Record<string, unknown> = {}) {
        return {
            packageId: "hm3",
            containerImage: null,
            containerName: null,
            containerStages: {},
            compatibilityMinimum: null,
            e2eStage: "test",
            ...extra,
        };
    }

    it("names the container after the package by default", () => {
        const resolved = resolveContainer({
            stage: "test",
            config: config(),
            env: {},
        });

        expect(resolved.name).toBe("hm3-foundry-test");
    });

    it("carries a declared name through to the container", () => {
        // The point of declaring one: the hostname docker runs under is what
        // the signed licence in the shared data root was issued for.
        const resolved = resolveContainer({
            stage: "test",
            config: config({ containerName: "heroiclands-foundry" }),
            env: {},
        });

        expect(resolved.name).toBe("heroiclands-foundry-test");
    });
});
