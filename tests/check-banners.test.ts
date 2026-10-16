/*
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { SUBPROCESS_TEST_TIMEOUT } from "./subprocess-timeout.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const inventory = parse(
    readFileSync(new URL("../hugo-theme/data/banners.yaml", import.meta.url), "utf8"),
);
const target = inventory.available[0];

/** Run the real CLI with controlled HTTP responses and transport failures. */
function check(fetchBody: string) {
    const preload = `globalThis.fetch = async (url, options) => { ${fetchBody} };`;
    return spawnSync(
        process.execPath,
        [
            "--import",
            `data:text/javascript,${encodeURIComponent(preload)}`,
            "ci/check-banners.mjs",
            "--base",
            "https://banner.test",
        ],
        { cwd: root, encoding: "utf8", timeout: SUBPROCESS_TEST_TIMEOUT },
    );
}

describe("banner publication check", () => {
    it(
        "checks every declared banner with HEAD",
        () => {
            const result = check(
                `if (options.method !== 'HEAD') throw new Error('expected HEAD'); console.log(url); return {status: 200};`,
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain(
                `all ${inventory.available.length} declared banners resolve`,
            );
            expect(
                result.stdout
                    .split("\n")
                    .filter((line) => line.startsWith("https://"))
                    .sort(),
            ).toEqual(
                inventory.available
                    .map((name: string) => `https://banner.test/${inventory.dir}/${name}.webp`)
                    .sort(),
            );
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it.each([405, 501])(
        "uses a ranged GET when HEAD returns %s",
        (status) => {
            const result = check(`
            if (options.method === 'HEAD') return {status: ${status}};
            if (options.headers?.Range !== 'bytes=0-0') throw new Error('expected ranged GET');
            return {status: 206};
        `);
            expect(result.status).toBe(0);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it.each([404, 410])(
        "identifies an absent asset from HTTP %s",
        (status) => {
            const result = check(
                `return {status: url.endsWith('/${target}.webp') ? ${status} : 200};`,
            );
            expect(result.status).toBe(1);
            expect(result.stderr).toContain(
                `declared banner ${target} is not published (HTTP ${status})`,
            );
            expect(result.stderr).toContain("1 missing, 0 unverified");
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it.each([403, 429, 500, 503])(
        "does not infer missing artwork from HTTP %s",
        (status) => {
            const result = check(`return {status: ${status}};`);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain(`could not be verified (HTTP ${status})`);
            expect(result.stderr).toContain(`0 missing, ${inventory.available.length} unverified`);
            expect(result.stderr).not.toMatch(/not published|drop the name/);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "fails closed and preserves a nested transport cause",
        () => {
            const result = check(`
            const cause = Object.assign(new Error('socket closed'), {code: 'UND_ERR_SOCKET'});
            throw new TypeError('fetch failed', {cause});
        `);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain(
                "could not be verified (network error: fetch failed; UND_ERR_SOCKET: socket closed)",
            );
            expect(result.stderr).toContain(`0 missing, ${inventory.available.length} unverified`);
            expect(result.stderr).not.toMatch(/not published|drop the name/);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "preserves individual connection failures from an aggregate cause",
        () => {
            const result = check(`
            const failures = ['ETIMEDOUT', 'ENETUNREACH'].map(code => Object.assign(new Error('connect'), {code}));
            throw new TypeError('fetch failed', {cause: new AggregateError(failures)});
        `);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain("ETIMEDOUT: connect");
            expect(result.stderr).toContain("ENETUNREACH: connect");
        },
        SUBPROCESS_TEST_TIMEOUT,
    );
});
