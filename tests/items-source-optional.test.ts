/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A package with no Item pack of its own can still compile actors (#49).
 *
 * The actors pass used to throw unless at least one Item pack was declared,
 * which asked a package to declare the very thing it may exist not to have: an
 * Item pack is system-bound by construction, so a deliberately system-agnostic
 * module could satisfy the guard only by naming a system. `harn-ensemble` is
 * the case that motivates it — 2,512 beings whose embedded items address the
 * `sohl` and `hm3` catalogues, and five affiliation notes of its own.
 *
 * The guard also did not test what it claimed: it counted *declared
 * directories*, not resolvable items. These tests pin both halves — that an
 * empty list is accepted, and that the condition actually cared about is still
 * enforced, at the point of use and naming the item.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Actors } from "../sohl/actors.mjs";

describe("itemsSourceDirs is optional (#49)", () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "items-optional-"));
        fs.mkdirSync(path.join(dir, "content"));
        fs.mkdirSync(path.join(dir, "foreign"));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("constructs with no Item pack at all", () => {
        const compiler = new Actors({
            skipDirectories: [],
            contentBase: path.join(dir, "content"),
            dest: path.join(dir, "out"),
        });
        expect(compiler.itemsSourceDirs).toEqual([]);
    });

    it("constructs with an explicitly empty list", () => {
        const compiler = new Actors({
            skipDirectories: [],
            contentBase: path.join(dir, "content"),
            dest: path.join(dir, "out"),
            itemsSourceDirs: [],
        });
        expect(compiler.itemsSourceDirs).toEqual([]);
    });

    // The case the issue describes: every address resolves against a
    // dependency's catalogue, so the local Item pack has nothing to contribute
    // and declaring one would name a system the package does not have.
    it("keeps a foreign catalogue with no local Item pack", () => {
        const compiler = new Actors({
            skipDirectories: [],
            contentBase: path.join(dir, "content"),
            dest: path.join(dir, "out"),
            foreignSourceDirs: [path.join(dir, "foreign")],
        });
        expect(compiler.itemsSourceDirs).toEqual([]);
        expect(compiler.foreignSourceDirs).toEqual([path.join(dir, "foreign")]);
    });

    // The guard that was removed counted directories; this is the condition it
    // was standing in for, reported where it can name the item rather than as a
    // refusal to start.
    it("still reports an item that resolves nowhere, naming it", () => {
        const compiler = new Actors({
            skipDirectories: [],
            contentBase: path.join(dir, "content"),
            dest: path.join(dir, "out"),
        });
        const errors: string[] = [];
        compiler.noteError = (msg: string) => errors.push(msg);
        compiler.errorCount = 0;

        const resolved = compiler.resolveEmbedded(
            new Map(),
            "actor-id",
            "skill",
            "awar",
            null,
            0,
            "Bandit",
        );

        expect(resolved).toBeNull();
        expect(compiler.errorCount).toBe(1);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain("Bandit");
        expect(errors[0]).toContain('no predefined item for "skill:awar"');
    });
});
