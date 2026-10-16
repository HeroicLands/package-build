/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The S3 opt-in of the e2e container: what it resolves to, the commands it
 * builds, and the order it runs them in. Docker is replaced by recorders.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    S3_ALIAS,
    S3_BUCKET,
    S3_IMAGE,
    S3_PORT,
    dockerRunArgs,
    ensureS3,
    removeS3,
    resolveContainer,
    resolveS3,
    s3Requested,
    s3RunArgs,
} from "../container.mjs";

const PLAN = {
    network: "sohl-foundry-test-net",
    server: "sohl-foundry-test-s3",
    identities: "/repo/cypress/s3/s3-identities.json",
    awsConfig: "/repo/cypress/s3/aws-e2e.json",
    awsConfigName: "aws-e2e.json",
};

function config(extra: Record<string, unknown> = {}) {
    return {
        rootDir: "/repo",
        packageId: "sohl",
        containerImage: null,
        containerName: null,
        containerStages: {},
        compatibilityMinimum: null,
        e2eStage: "test",
        ...extra,
    };
}

describe("the opt-in", () => {
    it("is off unless FOUNDRYVTT_CONTAINER_S3 is 1 or true", () => {
        expect(s3Requested({})).toBe(false);
        expect(s3Requested({ FOUNDRYVTT_CONTAINER_S3: "" })).toBe(false);
        expect(s3Requested({ FOUNDRYVTT_CONTAINER_S3: "0" })).toBe(false);
        expect(s3Requested({ FOUNDRYVTT_CONTAINER_S3: "1" })).toBe(true);
        expect(s3Requested({ FOUNDRYVTT_CONTAINER_S3: "true" })).toBe(true);
    });

    it("resolves to nothing, and changes no container, when off", () => {
        const resolved = resolveContainer({ stage: "test", config: config(), env: {} });
        expect(resolved.s3).toBeNull();
        const args = dockerRunArgs({
            name: resolved.name,
            image: "img",
            port: 30000,
            dataRoot: "/data",
            env: {},
        });
        expect(args).not.toContain("--network");
        expect(args.join(" ")).not.toContain("FOUNDRY_AWS_CONFIG");
    });

    it("plans a network and server named after the container, reading the consumer's files", () => {
        const resolved = resolveContainer({
            stage: "test",
            config: config(),
            env: { FOUNDRYVTT_CONTAINER_S3: "1" },
        });
        expect(resolved.s3).toEqual(PLAN);
        expect(resolveS3({ name: "x", rootDir: "/r", env: {} })).toBeNull();
    });
});

describe("the commands", () => {
    it("runs SeaweedFS on the network with the alias and published port", () => {
        const args = s3RunArgs(PLAN);
        expect(args).toContain(S3_IMAGE);
        expect(args.slice(args.indexOf("--network"), args.indexOf("--network") + 2)).toEqual([
            "--network",
            PLAN.network,
        ]);
        expect(args).toContain(S3_ALIAS);
        expect(args).toContain(`${S3_PORT}:${S3_PORT}`);
        expect(args).toContain(`${PLAN.identities}:/etc/seaweedfs/s3.json:ro`);
        expect(args).toContain("-s3.allowedOrigins=*");
        expect(args).toContain("-s3.config=/etc/seaweedfs/s3.json");
    });

    it("creates the Foundry container on the network with the awsConfig set", () => {
        const args = dockerRunArgs({
            name: "n",
            image: "img",
            port: 30000,
            dataRoot: "/data",
            env: {},
            network: PLAN.network,
            awsConfig: PLAN.awsConfigName,
        });
        expect(args).toContain("--network");
        expect(args[args.indexOf("--network") + 1]).toBe(PLAN.network);
        expect(args).toContain("FOUNDRY_AWS_CONFIG=aws-e2e.json");
        expect(args[args.length - 1]).toBe("img");
    });
});

describe("starting and stopping the server", () => {
    function setup() {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-s3-"));
        fs.mkdirSync(path.join(root, "repo"));
        fs.mkdirSync(path.join(root, "data"));
        const plan = {
            ...PLAN,
            identities: path.join(root, "repo", "ids.json"),
            awsConfig: path.join(root, "repo", "aws-e2e.json"),
        };
        fs.writeFileSync(plan.identities, "{}");
        fs.writeFileSync(plan.awsConfig, '{"endpoint":"x"}');
        return { root, plan, dataRoot: path.join(root, "data") };
    }

    it("creates the network, the server and the bucket, in that order, and copies the awsConfig", () => {
        const { plan, dataRoot } = setup();
        const calls: string[][] = [];
        let listed = 0;
        ensureS3({
            plan,
            dataRoot,
            run: (args) => (calls.push(args), 0),
            capture: (args) => {
                if (args[0] === "exec")
                    return (
                        ++listed < 3 ? "error"
                        : args.join(" ").includes("s3.bucket.list") ? "master: x filers: [a]"
                        : "ready"
                    );
                return "";
            },
            sleep: () => {},
        });
        const runs = calls.map((args) => args.slice(0, 2).join(" "));
        expect(runs).toEqual([`network create`, `run --detach`, expect.stringContaining("exec")]);
        expect(calls[0]).toEqual(["network", "create", plan.network]);
        expect(calls[1]).toEqual(s3RunArgs(plan));
        expect(calls[2].join(" ")).toContain(`s3.bucket.create -name ${S3_BUCKET}`);
        expect(listed).toBe(3);
        expect(fs.readFileSync(path.join(dataRoot, "Config", "aws-e2e.json"), "utf8")).toBe(
            '{"endpoint":"x"}',
        );
    });

    it("reuses a running server and network and ensures the bucket", () => {
        const { plan, dataRoot } = setup();
        const calls: string[][] = [];
        ensureS3({
            plan,
            dataRoot,
            run: (args) => (calls.push(args), 0),
            capture: (args) =>
                args[0] === "inspect" ?
                    JSON.stringify([
                        {
                            Type: "bind",
                            Source: plan.identities,
                            Destination: "/etc/seaweedfs/s3.json",
                        },
                    ])
                : args[0] === "network" ? plan.network
                : args.includes("-a") || args[0] === "ps" ? plan.server
                : args.join(" ").includes("s3.bucket.list") ? "master: x filers: [a]"
                : "ready",
            sleep: () => {},
        });
        expect(calls).toHaveLength(1);
        expect(calls[0].join(" ")).toContain(`s3.bucket.create -name ${S3_BUCKET}`);
    });

    it("reuses a bind named through a symlink to the current identities file", () => {
        const { root, plan, dataRoot } = setup();
        const link = path.join(root, "ids-link.json");
        fs.symlinkSync(plan.identities, link);
        const calls: string[][] = [];
        ensureS3({
            plan,
            dataRoot,
            run: (args) => (calls.push(args), 0),
            capture: (args) =>
                args[0] === "inspect" ?
                    JSON.stringify([
                        { Type: "bind", Source: link, Destination: "/etc/seaweedfs/s3.json" },
                    ])
                : args[0] === "network" ? plan.network
                : args[0] === "ps" ? plan.server
                : "ready",
            sleep: () => {},
        });
        expect(calls).toHaveLength(1);
        expect(calls[0].join(" ")).toContain("s3.bucket.create");
    });

    it.each(["", "{", "{}"])(
        "refuses reuse when mount inspection cannot be read: %j",
        (inspection) => {
            const { plan, dataRoot } = setup();
            const calls: string[][] = [];
            expect(() =>
                ensureS3({
                    plan,
                    dataRoot,
                    run: (args) => (calls.push(args), 0),
                    capture: (args) =>
                        args[0] === "inspect" ? inspection
                        : args[0] === "network" ? plan.network
                        : args[0] === "ps" ? plan.server
                        : "ready",
                    sleep: () => {},
                }),
            ).toThrow(`docker rm -f ${plan.server}`);
            expect(calls).toEqual([]);
        },
    );

    it("waits for a stopped reused server to answer before ensuring the bucket", () => {
        const { plan, dataRoot } = setup();
        const events: string[] = [];
        let listed = 0;
        ensureS3({
            plan,
            dataRoot,
            run: (args) => {
                events.push(args[0] === "start" ? "start" : "bucket");
                return 0;
            },
            capture: (args) => {
                if (args[0] === "inspect")
                    return JSON.stringify([
                        {
                            Type: "bind",
                            Source: plan.identities,
                            Destination: "/etc/seaweedfs/s3.json",
                        },
                    ]);
                if (args[0] === "network") return plan.network;
                if (args[0] === "ps") return args.includes("-a") ? plan.server : "";
                events.push("list");
                return (
                    ++listed < 3 ? "error"
                    : args.join(" ").includes("s3.bucket.list") ? "master: x filers: [a]"
                    : "ready"
                );
            },
            sleep: (ms) => events.push(`sleep ${ms}`),
        });
        expect(events).toEqual([
            "start",
            "list",
            "sleep 1000",
            "list",
            "sleep 1000",
            "list",
            "bucket",
        ]);
    });

    it.each([
        [
            {
                Type: "bind",
                Source: "/absent/old-worktree/ids.json",
                Destination: "/etc/seaweedfs/s3.json",
            },
        ],
        [{ Type: "volume", Source: "identities", Destination: "/etc/seaweedfs/s3.json" }],
        [],
    ])(
        "refuses an incompatible reused identities mount without changing the server: %j",
        (...mounts) => {
            const { plan, dataRoot } = setup();
            const calls: string[][] = [];
            expect(() =>
                ensureS3({
                    plan,
                    dataRoot,
                    run: (args) => (calls.push(args), 0),
                    capture: (args) =>
                        args[0] === "inspect" ? JSON.stringify(mounts)
                        : args[0] === "network" ? plan.network
                        : args[0] === "ps" ? plan.server
                        : args.join(" ").includes("s3.bucket.list") ? "master: x filers: [a]"
                        : "ready",
                    sleep: () => {},
                }),
            ).toThrow(new RegExp(`S3 server.*${plan.server}.*identities mount`));
            expect(calls).toEqual([]);
        },
    );

    it("does not accept a ready filer while the S3 HTTP service cannot answer", () => {
        const { plan, dataRoot } = setup();
        const calls: string[][] = [];
        const probes: string[][] = [];
        expect(() =>
            ensureS3({
                plan,
                dataRoot,
                run: (args) => (calls.push(args), 0),
                capture: (args) => {
                    if (args[0] !== "exec") return "";
                    probes.push(args);
                    return args.join(" ").includes("s3.bucket.list") ? "master: x filers: [a]" : "";
                },
                sleep: () => {},
                attempts: 2,
            }),
        ).toThrow(/did not become ready/);
        expect(probes).toHaveLength(3);
        expect(probes[0].join(" ")).toContain(`http://127.0.0.1:${S3_PORT}/healthz`);
        expect(calls.some((args) => args.join(" ").includes("s3.bucket.create"))).toBe(false);
    });

    it("rejects a directory used in place of the identities file before calling Docker", () => {
        const { plan, dataRoot } = setup();
        fs.rmSync(plan.identities);
        fs.mkdirSync(plan.identities);
        const calls: string[][] = [];
        expect(() =>
            ensureS3({
                plan,
                dataRoot,
                run: (args) => (calls.push(args), 0),
                capture: () => "",
                attempts: 0,
            }),
        ).toThrow(/ids\.json.*regular file/);
        expect(calls).toEqual([]);
    });

    it("fails naming the file when an input is missing", () => {
        const { plan, dataRoot } = setup();
        fs.rmSync(plan.identities);
        expect(() => ensureS3({ plan, dataRoot, run: () => 0, capture: () => "" })).toThrow(
            /ids\.json/,
        );
    });

    it("fails when the server never becomes ready", () => {
        const { plan, dataRoot } = setup();
        expect(() =>
            ensureS3({
                plan,
                dataRoot,
                run: () => 0,
                capture: () => "",
                sleep: () => {},
                attempts: 2,
            }),
        ).toThrow(/did not become ready/);
    });

    it("removes the server and the network", () => {
        const calls: string[][] = [];
        removeS3(
            PLAN,
            (args) => (calls.push(args), 0),
            (args) => (args[0] === "network" ? PLAN.network : PLAN.server),
        );
        expect(calls).toEqual([
            ["stop", PLAN.server],
            ["rm", PLAN.server],
            ["network", "rm", PLAN.network],
        ]);
    });
});
