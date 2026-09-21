/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The rendered site carries a search index, written by `package-build
 * site-root` after `_headers`.
 *
 * Every package site ends the same way — Hugo renders into the mount's output
 * directory, then `site-root` post-processes it there — so the index is built
 * in that step and lands beside the pages as `<out>/<package>/pagefind/`,
 * served at `/<package>/pagefind/`. `site.search: false` turns it off, and
 * the default is on.
 *
 * Three contracts, in three parts: the configuration key, the function that
 * runs the indexer over the rendered directory and reports a failure as a
 * located finding, and the command as a consumer runs it — against the real
 * Pagefind binary the package installs, so what is asserted on is the index a
 * deployment would carry.
 */

import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import YAML from "yaml";

import { defineConfig } from "../index.mjs";
import { CONFIG_BASENAME, configFromData } from "../engine/pack-config.mjs";
import { SEARCH_DIR, indexSite, writeSiteRoot } from "../engine/site-root.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Every temporary directory this file writes, swept at the end. */
const made: string[] = [];

afterAll(() => {
    for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

/** A throwaway directory. */
function scratch(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    made.push(dir);
    return dir;
}

/** A minimal configuration `defineConfig` accepts without complaint. */
function minimal(overrides: Record<string, unknown> = {}) {
    return {
        rootDir: "/repo",
        contentPackage: "acme",
        foundryPackage: "acme",
        packageKind: "systems",
        stats: { lastModifiedBy: "acmebuilder0000" },
        packs: [{ name: "items", type: "Item" }],
        ...overrides,
    };
}

/** One rendered page, the shape Hugo writes: a directory holding `index.html`. */
function page(site: string, slug: string, title: string, body: string): void {
    const dir = slug ? path.join(site, slug) : site;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        path.join(dir, "index.html"),
        `<!doctype html><html lang="en"><head><title>${title}</title></head>` +
            `<body><main><h1>${title}</h1><p>${body}</p></main></body></html>\n`,
    );
}

/**
 * A deployment directory holding a rendered site of two pages, the way Hugo
 * leaves it for `site-root`.
 *
 * @returns The deployment root and the rendered site inside it.
 */
function rendered(pkg = "kethira"): { out: string; site: string } {
    const out = scratch("site-search-");
    const site = path.join(out, pkg);
    page(site, "", "The Package", "A homepage, and the front of the site.");
    page(site, "doc-welcome", "Welcome", "Every reader lands on the Kethira welcome page.");
    return { out, site };
}

/** The index fragments an index of any page at all writes. */
function fragments(site: string): string[] {
    const dir = path.join(site, SEARCH_DIR, "fragment");
    return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

/* ---------------------------------------------------------------------- */
/*  1. `site.search`                                                       */
/* ---------------------------------------------------------------------- */

describe("`site.search`", () => {
    it("is on unless the configuration says otherwise", () => {
        expect(defineConfig(minimal()).site.search).toBe(true);
        expect(defineConfig(minimal({ site: {} })).site.search).toBe(true);
        expect(defineConfig(minimal({ site: { search: false } })).site.search).toBe(false);
        expect(defineConfig(minimal({ site: { search: true } })).site.search).toBe(true);
    });

    it("refuses anything but a boolean, and the finding names the key's line", () => {
        for (const bad of ["yes", 1, null, {}]) {
            expect(() => defineConfig(minimal({ site: { search: bad } }))).toThrow(
                "`site.search` must be a boolean",
            );
        }

        const dir = scratch("site-search-cfg-");
        fs.writeFileSync(
            path.join(dir, "package.json"),
            JSON.stringify({ name: "acme", version: "1.0.0" }),
        );
        const text = [
            "contentPackage: acme",
            "packageKind: documentation",
            "publish:",
            "    site: content",
            "site:",
            "    search: off",
            "",
        ].join("\n");
        const file = path.join(dir, `${CONFIG_BASENAME}.yaml`);
        fs.writeFileSync(file, text);

        let thrown: Error | undefined;
        try {
            configFromData(YAML.parse(text), file);
        } catch (err) {
            thrown = err as Error;
        }
        expect(thrown?.message).toBe(
            `${file}:6:5: error: package-build config: \`site.search\` must be a boolean.`,
        );
    });
});

/* ---------------------------------------------------------------------- */
/*  2. `writeSiteRoot` runs the indexer over the rendered site             */
/* ---------------------------------------------------------------------- */

describe("writeSiteRoot and the indexer", () => {
    it("hands the indexer the rendered site directory and its output, after `_headers`", async () => {
        const { out, site } = rendered();
        const calls: { site: string; output: string; headersWritten: boolean }[] = [];
        const indexer = async ({ site: s, output }: { site: string; output: string }) => {
            calls.push({
                site: s,
                output,
                headersWritten: fs.existsSync(path.join(out, "_headers")),
            });
            return { pages: 2 };
        };

        const result = await writeSiteRoot({ pkg: "kethira", out, indexer });

        expect(calls).toEqual([
            { site, output: path.join(site, SEARCH_DIR), headersWritten: true },
        ]);
        expect(result.files.map((f) => path.basename(f))).toEqual(["_headers"]);
        expect(result.search).toEqual({ dir: path.join(site, SEARCH_DIR), pages: 2 });
    });

    it("skips the indexer and removes a stale index when `search` is off", async () => {
        const { out, site } = rendered();
        // Left by an earlier build that indexed: without this it would be
        // deployed as a search index of pages that may no longer exist.
        fs.mkdirSync(path.join(site, SEARCH_DIR, "fragment"), { recursive: true });
        fs.writeFileSync(path.join(site, SEARCH_DIR, "pagefind.js"), "");
        let called = false;
        const indexer = async () => {
            called = true;
            return { pages: 0 };
        };

        const result = await writeSiteRoot({ pkg: "kethira", out, search: false, indexer });

        expect(called).toBe(false);
        expect(result.search).toBeNull();
        expect(fs.existsSync(path.join(site, SEARCH_DIR))).toBe(false);
        expect(fs.existsSync(path.join(out, "_headers"))).toBe(true);
    });

    it("reports an indexer failure as a located finding naming the rendered site", async () => {
        const { out, site } = rendered();
        const indexer = async () => {
            throw new Error("the indexer said no");
        };

        let thrown: (Error & { located?: boolean; file?: string }) | undefined;
        try {
            await writeSiteRoot({ pkg: "kethira", out, indexer });
        } catch (err) {
            thrown = err as Error;
        }

        // The site is a directory, so the locator is the file field alone —
        // never a guessed `1:1`.
        expect(thrown?.message).toBe(`${site}: error: search index: the indexer said no`);
        expect(thrown?.located).toBe(true);
        expect(thrown?.file).toBe(site);
    });

    it("still refuses an unrendered site before touching anything", async () => {
        const out = scratch("site-search-empty-");
        let called = false;
        const indexer = async () => {
            called = true;
            return { pages: 0 };
        };

        await expect(writeSiteRoot({ pkg: "kethira", out, indexer })).rejects.toThrow(
            /no rendered site/,
        );
        expect(called).toBe(false);
        expect(fs.existsSync(path.join(out, "_headers"))).toBe(false);
    });
});

/* ---------------------------------------------------------------------- */
/*  3. The real indexer, and the command a consumer runs                   */
/* ---------------------------------------------------------------------- */

describe("the index a deployment carries", () => {
    it("indexes every rendered page into `<site>/pagefind/`", async () => {
        const { site } = rendered();

        const { pages } = await indexSite({ site, output: path.join(site, SEARCH_DIR) });

        expect(pages).toBe(2);
        expect(fs.existsSync(path.join(site, SEARCH_DIR, "pagefind.js"))).toBe(true);
        expect(fragments(site).length).toBeGreaterThan(0);
    });

    it("refuses a directory that is not there rather than indexing nothing", async () => {
        const dir = scratch("site-search-missing-");
        const site = path.join(dir, "nowhere");

        await expect(indexSite({ site, output: path.join(site, SEARCH_DIR) })).rejects.toThrow(
            /nowhere/,
        );
    });

    /** A consumer repository around a rendered site, and one `site-root` run over it. */
    function consumer(siteLines: readonly string[]) {
        const dir = scratch("site-search-cli-");
        fs.writeFileSync(
            path.join(dir, "package.json"),
            JSON.stringify({ name: "toolkit", version: "1.0.0" }),
        );
        fs.writeFileSync(
            path.join(dir, `${CONFIG_BASENAME}.yaml`),
            [
                "contentPackage: toolkit",
                "packageKind: documentation",
                "publish:",
                "    site: content",
                ...siteLines,
                "",
            ].join("\n"),
        );
        const site = path.join(dir, "build", "site", "toolkit");
        page(site, "", "The Toolkit", "The front of the documentation.");
        page(site, "doc-commands", "Commands", "Every command, and what it reads.");
        const r = spawnSync(
            process.execPath,
            [path.join(ROOT, "bin", "package-build.mjs"), "site-root"],
            {
                cwd: dir,
                env: {
                    ...process.env,
                    PACKAGE_BUILD_CONFIG: path.join(dir, `${CONFIG_BASENAME}.yaml`),
                },
                encoding: "utf8",
            },
        );
        return { dir, site, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, status: r.status };
    }

    it("`package-build site-root` writes the index beside the pages", () => {
        const { dir, site, out, status } = consumer([]);

        expect(out).not.toMatch(/error:/);
        expect(status).toBe(0);
        expect(fs.existsSync(path.join(dir, "build", "site", "_headers"))).toBe(true);
        expect(fs.existsSync(path.join(site, SEARCH_DIR, "pagefind.js"))).toBe(true);
        const found = fragments(site);
        expect(found.length).toBeGreaterThan(0);
        // The fragments carry the pages' own text, which is what a search
        // returns. Each is gzip-compressed, so a known sentence is findable
        // in them with nothing more than `gzip -dc` and `grep`.
        const text = found
            .map((f) =>
                gunzipSync(fs.readFileSync(path.join(site, SEARCH_DIR, "fragment", f))).toString(
                    "utf8",
                ),
            )
            .join("\n");
        expect(text).toContain("Every command, and what it reads.");
        expect(out).toMatch(/2 pages/);
    });

    it("`site.search: false` leaves no `pagefind/` directory", () => {
        const { dir, site, out, status } = consumer(["site:", "    search: false"]);

        expect(out).not.toMatch(/error:/);
        expect(status).toBe(0);
        expect(fs.existsSync(path.join(dir, "build", "site", "_headers"))).toBe(true);
        expect(fs.existsSync(path.join(site, SEARCH_DIR))).toBe(false);
    });
});
