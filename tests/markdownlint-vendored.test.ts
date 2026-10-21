/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * markdownlint ships inside this package as one module, `vendor/markdownlint.mjs`,
 * built from the installed `markdownlint` by `scripts/vendor-markdownlint.mjs`.
 *
 * markdownlint's parser enables math syntax through `micromark-extension-math`,
 * whose entry module also carries an HTML compiler that requires KaTeX.
 * markdownlint never renders HTML, so the bundle takes the extension's syntax
 * module alone: math is tokenized exactly as markdownlint tokenizes it, and a
 * package that installs this one installs no KaTeX.
 *
 * These cases prove the three halves of that: what a consumer installs, that
 * the bundle is the installed markdownlint and nothing else, and that it lints
 * byte for byte as markdownlint does.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import markdownIt from "markdown-it";
import * as upstreamMain from "markdownlint";
import * as upstreamPromise from "markdownlint/promise";

import { bundleMarkdownlint, VENDORED_FILE } from "../scripts/vendor-markdownlint.mjs";

const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const manifest = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")) as {
    files: string[];
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
};

type LockEntry = {
    version?: string;
    dev?: boolean;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
};

const lock = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package-lock.json"), "utf8")) as {
    packages: Record<string, LockEntry>;
};

/**
 * The lockfile key a dependency named `name` resolves to from the package at
 * `from`, by Node's walk: the nearest `node_modules/<name>` at or above it.
 */
function resolveInLock(from: string, name: string): string | undefined {
    let base = from;
    for (;;) {
        const key = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
        if (lock.packages[key]) return key;
        if (!base) return undefined;
        const at = base.lastIndexOf("/node_modules/");
        base = at === -1 ? "" : base.slice(0, at);
    }
}

/** Every lockfile entry a consumer installs along with this package. */
function productionClosure(): Set<string> {
    const seen = new Set<string>();
    const queue: [string, string][] = Object.keys(manifest.dependencies).map((n) => ["", n]);
    while (queue.length) {
        const [from, name] = queue.shift() as [string, string];
        const key = resolveInLock(from, name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const entry = lock.packages[key] as LockEntry;
        for (const dep of Object.keys({
            ...entry.dependencies,
            ...entry.optionalDependencies,
            ...entry.peerDependencies,
        })) {
            queue.push([key, dep]);
        }
    }
    return seen;
}

/** The package name a lockfile key or a bundled input path belongs to. */
function packageAt(file: string): string | undefined {
    const at = file.lastIndexOf("node_modules/");
    if (at === -1) return undefined;
    const parts = file.slice(at + "node_modules/".length).split("/");
    return parts[0]?.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

describe("what a consumer installs", () => {
    it("walks a closure large enough to mean something", () => {
        // A broken walk would make the KaTeX case vacuously pass.
        expect(productionClosure().size).toBeGreaterThan(Object.keys(manifest.dependencies).length);
    });

    it("includes no KaTeX", () => {
        const katex = [...productionClosure()].filter((key) => packageAt(key) === "katex");
        expect(katex).toEqual([]);
    });

    it("includes no markdownlint, which ships bundled", () => {
        expect(Object.keys(manifest.dependencies)).not.toContain("markdownlint");
        expect(Object.keys(manifest.devDependencies)).toContain("markdownlint");
        const nested = [...productionClosure()].filter((key) => packageAt(key) === "markdownlint");
        expect(nested).toEqual([]);
    });

    it("ships the bundle", () => {
        const shipped = path.relative(PKG_ROOT, VENDORED_FILE).split(path.sep)[0];
        expect(manifest.files).toContain(shipped);
    });
});

describe("the bundle", () => {
    let built: { code: string; packages: { name: string; version: string; license: string }[] };

    beforeAll(async () => {
        built = await bundleMarkdownlint();
    });

    it("is what the installed markdownlint builds to", () => {
        // A bundle left behind by an older markdownlint fails here; `npm ci`
        // rebuilds it through `prepare`.
        expect(fs.readFileSync(VENDORED_FILE, "utf8")).toBe(built.code);
    });

    it("bundles the installed markdownlint", () => {
        const version = (lock.packages["node_modules/markdownlint"] as LockEntry).version;
        expect(built.packages).toContainEqual(
            expect.objectContaining({ name: "markdownlint", version }),
        );
    });

    it("bundles math syntax and no KaTeX", () => {
        const names = built.packages.map((p) => p.name);
        expect(names).toContain("micromark-extension-math");
        expect(names).not.toContain("katex");
        expect(built.code).not.toMatch(/\bkatex\b/i);
    });

    it("carries the name, version, licence and licence text of every package in it", () => {
        expect(built.packages.length).toBeGreaterThan(1);
        for (const { name, version, license } of built.packages) {
            expect(built.code).toContain(`${name}@${version} (${license})`);
            const dir = path.dirname(
                path.join(PKG_ROOT, resolveInLock("", name) ?? `node_modules/${name}`, "x"),
            );
            const licenceFile = fs
                .readdirSync(dir)
                .find((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f)) as string;
            const firstLine = fs
                .readFileSync(path.join(dir, licenceFile), "utf8")
                .split("\n")
                .find((l) => l.trim()) as string;
            expect(built.code).toContain(firstLine.trim());
        }
    });
});

/**
 * The largest file the corpus takes. The generated references run to hundreds
 * of kilobytes each and add time, not syntax the smaller files lack.
 */
const CORPUS_FILE_LIMIT = 64 * 1024;

/** The markdown this repository carries, as `lint` input, with math probes. */
function corpus(): Record<string, string> {
    const out: Record<string, string> = {
        inlineMath: "# T\n\nA sum $a * b * c$ here.\n",
        flowMath: "# T\n\n$$\n#not a heading\n$$\n",
        noMath: "# T\n\nA sum a * b * c here.\n",
        fixable: "#  Heading  \n\nText   \n* item\n\n\n",
    };
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== "node_modules" && !entry.name.startsWith(".")) walk(full);
            } else if (entry.name.endsWith(".md") && fs.statSync(full).size <= CORPUS_FILE_LIMIT) {
                out[path.relative(PKG_ROOT, full)] = fs.readFileSync(full, "utf8");
            }
        }
    };
    for (const f of ["README.md", "CONTENT.md"]) {
        out[f] = fs.readFileSync(path.join(PKG_ROOT, f), "utf8");
    }
    walk(path.join(PKG_ROOT, "docs"));
    walk(path.join(PKG_ROOT, "tests", "fixtures"));
    return out;
}

describe("the bundle lints as markdownlint does", () => {
    type Results = Awaited<ReturnType<typeof upstreamPromise.lint>>;
    let vendored: typeof upstreamMain & typeof upstreamPromise;
    const strings = corpus();
    let mine: Results;
    let theirs: Results;

    beforeAll(async () => {
        vendored = await import(VENDORED_FILE);
        const options = {
            strings,
            config: { default: true },
            markdownItFactory: () => markdownIt({ html: true }),
        };
        [mine, theirs] = await Promise.all([vendored.lint(options), upstreamPromise.lint(options)]);
    }, 60_000);

    it("exports markdownlint's whole surface", () => {
        const surface = [...Object.keys(upstreamMain), ...Object.keys(upstreamPromise)].sort();
        expect(Object.keys(vendored).sort()).toEqual(surface);
    });

    it("tokenizes math, so a rule never reads inside it", () => {
        expect(mine.inlineMath).toEqual([]);
        expect(mine.flowMath).toEqual([]);
        expect(mine.noMath?.map((e) => e.ruleNames[0])).toContain("MD037");
    });

    it("reports what markdownlint reports, over every markdown file here", () => {
        expect(Object.keys(mine).length).toBeGreaterThan(10);
        expect(JSON.stringify(mine)).toBe(JSON.stringify(theirs));
    });

    it("applies fixes as markdownlint does", () => {
        const fixed = Object.keys(strings).filter((k) => mine[k]?.some((e) => e.fixInfo));
        expect(fixed).toContain("fixable");
        for (const key of fixed) {
            expect(vendored.applyFixes(strings[key] as string, mine[key] ?? [])).toBe(
                upstreamMain.applyFixes(strings[key] as string, theirs[key] ?? []),
            );
        }
    });

    it("resolves a module from given paths as markdownlint does", () => {
        expect(vendored.resolveModule("markdown-it", [PKG_ROOT])).toBe(
            upstreamMain.resolveModule("markdown-it", [PKG_ROOT]),
        );
    });

    it("reads and extends configuration files as markdownlint does", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-vendored-config-"));
        try {
            fs.writeFileSync(path.join(dir, "base.json"), '{ "MD013": false }');
            fs.writeFileSync(
                path.join(dir, "rules.json"),
                '{ "extends": "base.json", "MD041": false }',
            );
            const file = path.join(dir, "rules.json");
            const parsers = [JSON.parse];
            expect(await vendored.readConfig(file, parsers)).toEqual(
                await upstreamPromise.readConfig(file, parsers),
            );
            const config = { extends: "base.json", MD001: false };
            expect(await vendored.extendConfig(config, file, parsers, fs)).toEqual(
                await upstreamPromise.extendConfig(config, file, parsers, fs),
            );
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        expect(vendored.getVersion()).toBe(upstreamMain.getVersion());
    });
});
