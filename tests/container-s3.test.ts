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
                if (args[0] === "exec") return ++listed < 3 ? "error" : "master: x filers: [a]";
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

    it("reuses a running server and network, creating nothing", () => {
        const { plan, dataRoot } = setup();
        const calls: string[][] = [];
        ensureS3({
            plan,
            dataRoot,
            run: (args) => (calls.push(args), 0),
            capture: (args) =>
                args[0] === "network" ? plan.network
                : args.includes("-a") || args[0] === "ps" ? plan.server
                : "",
            sleep: () => {},
        });
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
