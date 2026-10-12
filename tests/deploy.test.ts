/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
    STAGE_ENV_MAP,
    buildConnection,
    deployLocal,
    deployStage,
    isRemoteTarget,
    packageSubpath,
    parseRemote,
    resolveAgent,
    resolveStage,
} from "../deploy.mjs";

/** A throwaway workspace with a staged `src` and a target `dest`. */
async function makeWorkspace() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pkg-deploy-"));
    const src = path.join(root, "src");
    const dest = path.join(root, "data", "systems", "sohl");
    await fs.mkdir(src, { recursive: true });
    return { root, src, dest };
}

async function readMaybe(p: string): Promise<string | null> {
    try {
        return await fs.readFile(p, "utf8");
    } catch {
        return null;
    }
}

/** Temp directories left beside the destination, if any. */
async function listSiblings(dest: string): Promise<string[]> {
    const entries = await fs.readdir(path.dirname(dest));
    const base = path.basename(dest);
    return entries.filter((e) => e !== base && e.startsWith(base));
}

describe("resolveStage", () => {
    it("normalises whitespace and case", () => {
        expect(resolveStage("  QA ")).toBe("qa");
        expect(resolveStage("Prod")).toBe("prod");
    });

    it("returns empty for an absent stage", () => {
        expect(resolveStage(undefined)).toBe("");
        expect(resolveStage("")).toBe("");
    });
});

describe("packageSubpath", () => {
    it("places a system and a module in their own trees", () => {
        expect(packageSubpath("systems", "sohl")).toEqual(["Data", "systems", "sohl"]);
        expect(packageSubpath("modules", "sohl-thalorna")).toEqual([
            "Data",
            "modules",
            "sohl-thalorna",
        ]);
    });

    it("refuses a kind Foundry does not define", () => {
        expect(() => packageSubpath("plugins" as never, "x")).toThrow(/"systems" or "modules"/);
    });

    it("refuses a missing package id", () => {
        expect(() => packageSubpath("systems", "")).toThrow(/packageId/);
    });
});

describe("isRemoteTarget", () => {
    it("reads [user@]host:/path as remote", () => {
        expect(isRemoteTarget("host:/srv/foundry")).toBe(true);
        expect(isRemoteTarget("me@host:/srv/foundry")).toBe(true);
    });

    it("reads a POSIX path as local", () => {
        expect(isRemoteTarget("/Users/me/fvtt/data")).toBe(false);
        expect(isRemoteTarget("/srv/foundry")).toBe(false);
    });

    // Without this, an ordinary Windows path parses as a host called `C` and
    // the deploy tries to open an SSH connection to it.
    it("reads a Windows drive path as local", () => {
        expect(isRemoteTarget("C:\\Foundry\\Data")).toBe(false);
        expect(isRemoteTarget("D:/Foundry/Data")).toBe(false);
    });

    it("reads an empty or absent target as local", () => {
        expect(isRemoteTarget("")).toBe(false);
        expect(isRemoteTarget(undefined as never)).toBe(false);
    });
});

describe("parseRemote", () => {
    it("splits host and path", () => {
        expect(parseRemote("host:/srv/foundry")).toEqual({
            username: undefined,
            host: "host",
            remotePath: "/srv/foundry",
        });
    });

    it("splits user, host and path", () => {
        expect(parseRemote("me@host:/srv/foundry")).toEqual({
            username: "me",
            host: "host",
            remotePath: "/srv/foundry",
        });
    });
});

describe("resolveAgent", () => {
    it("prefers a per-stage override", () => {
        expect(resolveAgent({ FOUNDRYVTT_QA_AGENT: "pageant", SSH_AUTH_SOCK: "/sock" }, "QA")).toBe(
            "pageant",
        );
    });

    it("falls back to the shared override, then the agent socket", () => {
        expect(resolveAgent({ SOHL_SFTP_AGENT: "shared", SSH_AUTH_SOCK: "/s" }, "QA")).toBe(
            "shared",
        );
        expect(resolveAgent({ SSH_AUTH_SOCK: "/sock" }, "QA")).toBe("/sock");
    });
});

describe("buildConnection", () => {
    it("uses the agent, reading no secret from disk", async () => {
        const conn = await buildConnection(
            "QA",
            { username: undefined, host: "h" },
            { env: { SSH_AUTH_SOCK: "/sock", USER: "me" } },
        );
        expect(conn).toMatchObject({
            host: "h",
            port: 22,
            username: "me",
            agent: "/sock",
        });
        expect(conn.privateKey).toBeUndefined();
    });

    it("prefers the username in the target over the environment", async () => {
        const conn = await buildConnection(
            "QA",
            { username: "target", host: "h" },
            { env: { FOUNDRYVTT_QA_USER: "envuser", USER: "me" } },
        );
        expect(conn.username).toBe("target");
    });

    it("honours a per-stage port", async () => {
        const conn = await buildConnection(
            "PROD",
            { username: "u", host: "h" },
            { env: { FOUNDRYVTT_PROD_PORT: "2222" } },
        );
        expect(conn.port).toBe(2222);
    });

    it("reads a key file when one is named, and then uses no agent", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pkg-key-"));
        const keyPath = path.join(dir, "id");
        await fs.writeFile(keyPath, "KEYBYTES");
        const conn = await buildConnection(
            "DEV",
            { username: "u", host: "h" },
            { env: { FOUNDRYVTT_DEV_KEY: keyPath, SSH_AUTH_SOCK: "/sock" } },
        );
        expect(conn.privateKey.toString()).toBe("KEYBYTES");
        expect(conn.agent).toBeUndefined();
    });
});

describe("deployLocal — atomic staged swap (safe with a live server)", () => {
    let ws: { root: string; src: string; dest: string };

    beforeEach(async () => {
        ws = await makeWorkspace();
    });
    afterEach(async () => {
        await fs.rm(ws.root, { recursive: true, force: true });
    });

    it("creates the destination on a fresh deploy", async () => {
        await fs.writeFile(path.join(ws.src, "system.json"), "v1");
        await fs.mkdir(path.join(ws.src, "packs", "actors"), {
            recursive: true,
        });
        await fs.writeFile(path.join(ws.src, "packs", "actors", "CURRENT"), "MANIFEST-1");

        await deployLocal(ws.src, ws.dest);

        expect(await readMaybe(path.join(ws.dest, "system.json"))).toBe("v1");
        expect(await readMaybe(path.join(ws.dest, "packs", "actors", "CURRENT"))).toBe(
            "MANIFEST-1",
        );
    });

    it("replaces existing content and removes stale files", async () => {
        await fs.mkdir(ws.dest, { recursive: true });
        await fs.writeFile(path.join(ws.dest, "system.json"), "old");
        await fs.writeFile(path.join(ws.dest, "stale.txt"), "remove me");
        await fs.writeFile(path.join(ws.src, "system.json"), "new");

        await deployLocal(ws.src, ws.dest);

        expect(await readMaybe(path.join(ws.dest, "system.json"))).toBe("new");
        // The swap is a full replace, not a merge.
        expect(await readMaybe(path.join(ws.dest, "stale.txt"))).toBeNull();
    });

    // The reason the whole design is a swap: LevelDB "repairs" an inconsistent
    // pack directory to zero on its next open.
    it("never mutates the live directory in place — a file held open by a running server keeps its original bytes", async () => {
        await fs.mkdir(path.join(ws.dest, "packs", "actors"), {
            recursive: true,
        });
        const livePack = path.join(ws.dest, "packs", "actors", "000001.ldb");
        await fs.writeFile(livePack, "LIVE-DATA");
        const held = await fs.open(livePack, "r");
        try {
            await fs.mkdir(path.join(ws.src, "packs", "actors"), {
                recursive: true,
            });
            await fs.writeFile(path.join(ws.src, "packs", "actors", "000001.ldb"), "NEW-DATA");

            await deployLocal(ws.src, ws.dest);

            // The open handle — the "server" — still sees the original bytes:
            // the old inode was swapped aside, not overwritten underneath it.
            const buf = Buffer.alloc(9);
            await held.read(buf, 0, 9, 0);
            expect(buf.toString("utf8")).toBe("LIVE-DATA");
            // Meanwhile the on-disk deploy is the new build.
            expect(await readMaybe(livePack)).toBe("NEW-DATA");
        } finally {
            await held.close();
        }
    });

    it("leaves no staging/old temp directories behind on success", async () => {
        await fs.writeFile(path.join(ws.src, "system.json"), "v1");
        await fs.mkdir(ws.dest, { recursive: true });
        await fs.writeFile(path.join(ws.dest, "system.json"), "v0");

        await deployLocal(ws.src, ws.dest);

        expect(await listSiblings(ws.dest)).toEqual([]);
    });
});

/**
 * Lock a directory against the host user, the way a tree written by a
 * container's mapped user is locked: its entries cannot be unlinked, so a
 * recursive remove fails with `EACCES`. Root ignores the mode, so the tests
 * that rely on it cannot run as root.
 */
async function lockTree(dir: string): Promise<() => Promise<void>> {
    await fs.chmod(dir, 0o555);
    return () => fs.chmod(dir, 0o755);
}

const asRoot = process.getuid?.() === 0;

describe.skipIf(asRoot)("deployLocal — removing the previous tree", () => {
    let ws: { root: string; src: string; dest: string };

    beforeEach(async () => {
        ws = await makeWorkspace();
        await fs.writeFile(path.join(ws.src, "system.json"), "new");
        await fs.mkdir(path.join(ws.dest, "owned"), { recursive: true });
        await fs.writeFile(path.join(ws.dest, "owned", "LICENSE.md"), "old");
    });
    afterEach(async () => {
        for (const sibling of await listSiblings(ws.dest)) {
            await fs
                .chmod(path.join(path.dirname(ws.dest), sibling, "owned"), 0o755)
                .catch(() => {});
        }
        await fs.rm(ws.root, { recursive: true, force: true });
    });

    it("hands a tree the host user cannot unlink to the injected remover", async () => {
        await lockTree(path.join(ws.dest, "owned"));
        const removed: string[] = [];
        const removeTree = async (tree: string) => {
            removed.push(tree);
            await fs.chmod(path.join(tree, "owned"), 0o755);
            await fs.rm(tree, { recursive: true, force: true });
        };

        const result = await deployLocal(ws.src, ws.dest, { removeTree });

        expect(removed).toEqual([`${ws.dest}.old-${process.pid}`]);
        expect(result.leftovers).toEqual([]);
        expect(await readMaybe(path.join(ws.dest, "system.json"))).toBe("new");
        expect(await listSiblings(ws.dest)).toEqual([]);
    });

    it("never calls the remover when the host user can remove the tree", async () => {
        const removeTree = async () => {
            throw new Error("not expected");
        };

        const result = await deployLocal(ws.src, ws.dest, { removeTree });

        expect(result.leftovers).toEqual([]);
        expect(await listSiblings(ws.dest)).toEqual([]);
    });

    it("installs and reports the leftover tree when no remover can clear it", async () => {
        await lockTree(path.join(ws.dest, "owned"));
        const removeTree = async () => {
            throw new Error("A helper container failed (exit 125):\ndocker was not found on PATH.");
        };

        const result = await deployLocal(ws.src, ws.dest, { removeTree });

        const old = `${ws.dest}.old-${process.pid}`;
        expect(result.leftovers).toMatchObject([{ path: old }]);
        // On one line, so the warning that carries it stays one diagnostic.
        expect(result.leftovers[0]?.reason).toBe(
            "A helper container failed (exit 125): docker was not found on PATH.",
        );
        // The install is complete, and the previous tree keeps its name and
        // its contents.
        expect(await readMaybe(path.join(ws.dest, "system.json"))).toBe("new");
        expect(await readMaybe(path.join(old, "owned", "LICENSE.md"))).toBe("old");
    });

    it("reports the leftover tree, naming the refusal, when there is no remover", async () => {
        await lockTree(path.join(ws.dest, "owned"));

        const result = await deployLocal(ws.src, ws.dest);

        expect(result.leftovers).toMatchObject([{ path: `${ws.dest}.old-${process.pid}` }]);
        expect(result.leftovers[0]?.reason).toMatch(/EACCES/);
        expect(await readMaybe(path.join(ws.dest, "system.json"))).toBe("new");
    });

    it("sweeps a backup an earlier deployment left under another pid", async () => {
        const stale = `${ws.dest}.old-1`;
        await fs.mkdir(stale, { recursive: true });
        await fs.writeFile(path.join(stale, "system.json"), "stale");

        const result = await deployLocal(ws.src, ws.dest);

        expect(result.leftovers).toEqual([]);
        expect(await listSiblings(ws.dest)).toEqual([]);
    });

    it("hands a stale backup the host user cannot unlink to the injected remover", async () => {
        const stale = `${ws.dest}.old-1`;
        await fs.mkdir(path.join(stale, "owned"), { recursive: true });
        await fs.writeFile(path.join(stale, "owned", "LICENSE.md"), "stale");
        await lockTree(path.join(stale, "owned"));
        const removed: string[] = [];
        const removeTree = async (tree: string) => {
            removed.push(tree);
            await fs.chmod(path.join(tree, "owned"), 0o755);
            await fs.rm(tree, { recursive: true, force: true });
        };

        const result = await deployLocal(ws.src, ws.dest, { removeTree });

        expect(removed).toEqual([stale]);
        expect(result.leftovers).toEqual([]);
        expect(await listSiblings(ws.dest)).toEqual([]);
    });

    it("reports each stale backup it cannot remove", async () => {
        const stale = `${ws.dest}.old-1`;
        await fs.mkdir(path.join(stale, "owned"), { recursive: true });
        await fs.writeFile(path.join(stale, "owned", "LICENSE.md"), "stale");
        await lockTree(path.join(stale, "owned"));

        const result = await deployLocal(ws.src, ws.dest);

        expect(result.leftovers).toMatchObject([{ path: stale }]);
        expect(result.leftovers[0]?.reason).toMatch(/EACCES/);
        expect(await readMaybe(path.join(ws.dest, "system.json"))).toBe("new");
    });

    it("leaves a sibling that is not one of its backups alone", async () => {
        const others = [`${ws.dest}-thalorna`, `${ws.dest}.older`, `${ws.dest}.old`];
        for (const other of others) await fs.mkdir(other, { recursive: true });

        const result = await deployLocal(ws.src, ws.dest);

        expect(result.leftovers).toEqual([]);
        expect((await listSiblings(ws.dest)).sort()).toEqual(
            others.map((other) => path.basename(other)).sort(),
        );
    });
});

describe("deployStage", () => {
    let ws: { root: string; src: string; dest: string };

    beforeEach(async () => {
        ws = await makeWorkspace();
        await fs.writeFile(path.join(ws.src, "system.json"), "v1");
    });
    afterEach(async () => {
        await fs.rm(ws.root, { recursive: true, force: true });
    });

    it("deploys a system beneath Data/systems/<id>", async () => {
        const dataRoot = path.join(ws.root, "fvtt");
        const result = await deployStage({
            stage: "qa",
            source: ws.src,
            packageKind: "systems",
            packageId: "sohl",
            env: { FOUNDRYVTT_QA_DATA: dataRoot },
        });

        expect(result).toMatchObject({ stage: "qa", remote: false });
        expect(await readMaybe(path.join(dataRoot, "Data", "systems", "sohl", "system.json"))).toBe(
            "v1",
        );
    });

    it("deploys a module beneath Data/modules/<id>", async () => {
        const dataRoot = path.join(ws.root, "fvtt");
        await deployStage({
            stage: "dev",
            source: ws.src,
            packageKind: "modules",
            packageId: "sohl-thalorna",
            env: { FOUNDRYVTT_DEV_DATA: dataRoot },
        });
        expect(
            await readMaybe(path.join(dataRoot, "Data", "modules", "sohl-thalorna", "system.json")),
        ).toBe("v1");
    });

    it.skipIf(asRoot)(
        "passes the data root to the remover and returns any leftover tree",
        async () => {
            const dataRoot = path.join(ws.root, "fvtt");
            const dest = path.join(dataRoot, "Data", "systems", "sohl");
            await fs.mkdir(path.join(dest, "owned"), { recursive: true });
            await fs.writeFile(path.join(dest, "owned", "LICENSE.md"), "old");
            await lockTree(path.join(dest, "owned"));
            const calls: [string, { dataRoot: string }][] = [];
            const removeTree = async (tree: string, where: { dataRoot: string }) => {
                calls.push([tree, where]);
            };

            const result = await deployStage({
                stage: "test",
                source: ws.src,
                packageKind: "systems",
                packageId: "sohl",
                env: { FOUNDRYVTT_TEST_DATA: dataRoot },
                removeTree,
            });

            const old = `${dest}.old-${process.pid}`;
            expect(calls).toEqual([[old, { dataRoot }]]);
            expect(result.leftovers).toMatchObject([{ path: old }]);
            await fs.chmod(path.join(old, "owned"), 0o755);
        },
    );

    it("refuses an unknown stage, naming the valid ones", async () => {
        await expect(
            deployStage({
                stage: "staging",
                source: ws.src,
                packageKind: "systems",
                packageId: "sohl",
                env: {},
            }),
        ).rejects.toThrow(/dev, qa, prod, test/);
    });

    it("refuses a stage with no destination configured, naming the variable", async () => {
        await expect(
            deployStage({
                stage: "prod",
                source: ws.src,
                packageKind: "systems",
                packageId: "sohl",
                env: {},
            }),
        ).rejects.toThrow(/FOUNDRYVTT_PROD_DATA/);
    });

    it("declares one environment variable per stage", () => {
        expect(Object.keys(STAGE_ENV_MAP)).toEqual(["dev", "qa", "prod", "test"]);
        expect(Object.isFrozen(STAGE_ENV_MAP)).toBe(true);
    });
});
