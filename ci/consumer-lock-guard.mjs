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
import path from "node:path";

/** Check that only the candidate and its newly required dependencies change. */
export function checkConsumerLock(before, after) {
    const candidate = "node_modules/@heroiclands/package-build";
    const { packages: oldPackages, ...oldMetadata } = before;
    const { packages: newPackages, ...newMetadata } = after;
    assert.deepEqual(newMetadata, oldMetadata, "lock metadata changed");
    const reachable = new Set();
    function visit(key) {
        if (reachable.has(key)) return;
        reachable.add(key);
        const entry = newPackages[key];
        assert.ok(entry, `missing lock entry: ${key}`);
        const dependencies = { ...entry.dependencies, ...entry.optionalDependencies };
        for (const name of Object.keys(dependencies)) {
            let dir = key;
            let resolved;
            while (true) {
                if (path.posix.basename(dir) !== "node_modules") {
                    const target = dir ? `${dir}/node_modules/${name}` : `node_modules/${name}`;
                    if (newPackages[target]) {
                        resolved = target;
                        break;
                    }
                }
                if (!dir) break;
                dir = path.posix.dirname(dir);
                if (dir === ".") dir = "";
            }
            if (resolved) visit(resolved);
            else
                assert.ok(
                    entry.optionalDependencies?.[name],
                    `missing dependency: ${name} from ${key}`,
                );
        }
    }
    visit(candidate);
    for (const key of new Set([...Object.keys(oldPackages), ...Object.keys(newPackages)])) {
        if (key === candidate) continue;
        if (key === "") {
            const a = structuredClone(oldPackages[key]);
            const b = structuredClone(newPackages[key]);
            delete a.devDependencies["@heroiclands/package-build"];
            delete b.devDependencies["@heroiclands/package-build"];
            assert.deepEqual(b, a, "consumer root dependencies changed");
        } else if (!(oldPackages[key] === undefined && reachable.has(key))) {
            assert.deepEqual(
                newPackages[key],
                oldPackages[key],
                `unrelated lock entry changed: ${key}`,
            );
        }
    }
}
