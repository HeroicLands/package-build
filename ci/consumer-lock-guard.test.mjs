/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE.md file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkConsumerLock } from "./consumer-lock-guard.mjs";

const candidate = "node_modules/@heroiclands/package-build";
function fixture() {
    const before = {
        name: "consumer",
        version: "1.0.0",
        lockfileVersion: 3,
        requires: true,
        packages: {
            "": { devDependencies: { "@heroiclands/package-build": "^1" } },
            [candidate]: { version: "1" },
            "node_modules/existing": { version: "1" },
        },
    };
    const after = structuredClone(before);
    after.packages[""].devDependencies["@heroiclands/package-build"] = "file:candidate.tgz";
    after.packages[candidate] = { version: "2", dependencies: { direct: "1", existing: "1" } };
    after.packages["node_modules/direct"] = {
        version: "1",
        dependencies: { nested: "1" },
        optionalDependencies: { absent: "1" },
    };
    after.packages["node_modules/direct/node_modules/nested"] = {
        version: "1",
        dependencies: { direct: "1" },
    };
    return { before, after };
}

test("accepts candidate dependencies, nested resolution, optional absence and cycles", () => {
    const { before, after } = fixture();
    checkConsumerLock(before, after);
});

test("rejects an unrelated new entry", () => {
    const { before, after } = fixture();
    after.packages["node_modules/stray"] = { version: "1" };
    assert.throws(() => checkConsumerLock(before, after), /unrelated lock entry changed/);
});

test("rejects a dependency resolved through a doubled node_modules segment", () => {
    const { before, after } = fixture();
    after.packages[candidate].dependencies.bad = "1";
    after.packages["node_modules/node_modules/bad"] = { version: "1" };
    assert.throws(() => checkConsumerLock(before, after), /missing dependency: bad/);
});

test("rejects changes to existing reachable entries", () => {
    const { before, after } = fixture();
    after.packages["node_modules/existing"].version = "2";
    assert.throws(() => checkConsumerLock(before, after), /unrelated lock entry changed/);
});

test("rejects changed top-level metadata", () => {
    const { before, after } = fixture();
    after.lockfileVersion = 2;
    assert.throws(() => checkConsumerLock(before, after), /lock metadata changed/);
});

test("rejects changed consumer root metadata", () => {
    const { before, after } = fixture();
    after.packages[""].name = "other";
    assert.throws(() => checkConsumerLock(before, after), /consumer root dependencies changed/);
});

test("rejects a missing required dependency", () => {
    const { before, after } = fixture();
    after.packages[candidate].dependencies.missing = "1";
    assert.throws(() => checkConsumerLock(before, after), /missing dependency: missing/);
});
