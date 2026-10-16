/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("@puppeteer/browsers", () => ({
    Browser: { CHROME: "chrome" },
    BrowserPlatform: { MAC_ARM: "mac_arm", LINUX: "linux" },
    computeExecutablePath: vi.fn(({ cacheDir, buildId, platform }) =>
        path.join(cacheDir, platform, buildId, "chrome"),
    ),
    install: vi.fn(async ({ cacheDir, buildId, platform }) => {
        const executablePath = path.join(cacheDir, platform, buildId, "chrome");
        fs.mkdirSync(path.dirname(executablePath), { recursive: true });
        fs.writeFileSync(executablePath, "browser");
        return { executablePath };
    }),
}));

import { install } from "@puppeteer/browsers";
import { CHROME_BUILD_ID, browserCacheDir, prepareSuiteBrowser } from "../e2e.mjs";

const roots: string[] = [];
afterEach(() => {
    roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
    vi.clearAllMocks();
});
function options(extra = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-browser-"));
    roots.push(root);
    return {
        command: ["npx", "cypress", "run"],
        args: [],
        env: { HL_BROWSER_CACHE: root },
        platform: "darwin",
        arch: "arm64",
        ...extra,
    };
}

describe("the e2e Cypress browser", () => {
    it.each(["run", "open"])("adds pinned Chrome for %s and reports it once", async (mode) => {
        const opts = options({ command: ["npx", "cypress", mode] });
        const log = vi.fn();
        const args = await prepareSuiteBrowser({ ...opts, log });
        expect(args).toEqual([
            "--browser",
            path.join(opts.env.HL_BROWSER_CACHE, "mac_arm", CHROME_BUILD_ID, "chrome"),
        ]);
        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0][0]).toContain(CHROME_BUILD_ID);
    });
    it.each([
        { command: ["npx", "cypress", "run", "--browser", "chromium"], args: [] },
        { command: ["cypress", "open", "--browser=electron"], args: [] },
        { args: ["--browser", "electron"] },
        { args: ["--browser=/my/chrome"] },
    ])("preserves an explicit browser without installing", async (extra) => {
        const opts = options({ ...extra, platform: "unsupported" });
        expect(await prepareSuiteBrowser(opts)).toEqual(opts.args);
        expect(install).not.toHaveBeenCalled();
    });
    it("reuses the installed cache", async () => {
        const opts = options({ platform: "linux", arch: "x64" });
        const first = await prepareSuiteBrowser(opts);
        expect(await prepareSuiteBrowser(opts)).toEqual(first);
        expect(install).toHaveBeenCalledTimes(1);
    });
    it.each([
        ["node", "suite.mjs"],
        ["npm", "run", "cypress"],
        ["npx", "playwright", "test"],
    ])("leaves another suite unchanged: %j", async (...command) => {
        const args = ["--headed"];
        expect(await prepareSuiteBrowser(options({ command, args }))).toEqual(args);
        expect(install).not.toHaveBeenCalled();
    });
    it("names an unsupported platform and the override", async () => {
        await expect(
            prepareSuiteBrowser(options({ platform: "linux", arch: "arm64" })),
        ).rejects.toThrow(/linux\/arm64.*--browser/);
    });
    it("keeps caches outside disposable Foundry data", () => {
        expect(browserCacheDir({ HL_BROWSER_CACHE: "/custom" })).toBe("/custom");
        expect(browserCacheDir({ FOUNDRYVTT_CACHE: "/e2e/cache" })).toBe("/e2e/browser-cache");
        expect(browserCacheDir({ HL_E2E_ROOT: "/ci/e2e" })).toBe("/ci/e2e/browser-cache");
        expect(browserCacheDir({ XDG_CACHE_HOME: "/user/cache" })).toBe(
            "/user/cache/heroiclands/chrome-for-testing",
        );
    });
});
