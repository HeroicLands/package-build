/* SPDX-License-Identifier: GPL-3.0-or-later */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { resolveConfig } from "vitest/node";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

it.each([false, true])(
    "bounds test workers with watch=%s and preserves file isolation",
    async (watch) => {
        // Resolve the repository configuration without inheriting this invocation's
        // CLI worker override. CI's plain npm test must have the same resource bound.
        const { test } = await resolveConfig({ root, watch });
        expect(Number.isInteger(test.maxWorkers)).toBe(true);
        expect(test.maxWorkers).toBeGreaterThanOrEqual(1);
        expect(test.maxWorkers).toBeLessThanOrEqual(2);
        expect(test.pool).toBe("forks");
        expect(test.isolate).toBe(true);
    },
);
