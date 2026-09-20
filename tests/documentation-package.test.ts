/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A package that publishes a site and a book while compiling nothing.
 *
 * `packageKind: documentation` is the answer "not a Foundry package at all",
 * and the value of it is as much in what it refuses as in what it accepts: a
 * key that cannot mean anything in a package with no packs, no compendium and
 * no install directory fails at load naming the key, with the line and column
 * the loader resolves that name to.
 *
 * The cases below are the contract in three parts — what loads, what is
 * refused, and what the pipeline does with the result.
 */

import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

import { defineConfig } from "../index.mjs";
import { CONFIG_BASENAME, configFromData } from "../engine/pack-config.mjs";
import { resolveImg } from "../engine/helpers.mjs";
import { lintContentTree } from "../engine/content-lint.mjs";
import {
    HUGO_CONTENT,
    HUGO_SOURCE,
    NAVIGATION_FILE,
    THEME_PACKAGE,
    navigationCacheDir,
} from "../engine/site-config.mjs";
import type { ContentBuildConfigInput } from "../content-config.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Every temporary repository this file writes, swept at the end. */
const made: string[] = [];

afterAll(() => {
    for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

/** A throwaway repository directory with a consumer-shaped `package.json`. */
function repo(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    made.push(dir);
    fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "docpkg", version: "3.1.0" }),
    );
    return dir;
}

/** The smallest documentation configuration that resolves. */
function minimal(rootDir = "/repo"): ContentBuildConfigInput {
    return {
        rootDir,
        contentPackage: "toolkit",
        packageKind: "documentation",
        publish: { site: "content" },
    } as ContentBuildConfigInput;
}

/** The same configuration as YAML lines, so the loader can locate a key in it. */
const MINIMAL_YAML = [
    "contentPackage: toolkit",
    "packageKind: documentation",
    "publish:",
    "    site: content",
];

/** Resolve a YAML configuration the way the loader does, and return the throw. */
function failureFor(lines: readonly string[]): { err: Error; text: string } {
    const dir = repo("doc-cfg-");
    const text = `${lines.join("\n")}\n`;
    const file = path.join(dir, `${CONFIG_BASENAME}.yaml`);
    fs.writeFileSync(file, text, "utf8");
    try {
        configFromData(YAML.parse(text), file);
    } catch (err) {
        return { err: err as Error, text };
    }
    throw new Error("expected the configuration to be rejected");
}

/** The `line:column` a located diagnostic names, read back out of its message. */
function locatorOf(message: string): { line: number; column: number } {
    const at = /:(\d+):(\d+): error: /.exec(message);
    if (!at) throw new Error(`no line:column locator in: ${message}`);
    return { line: Number(at[1]), column: Number(at[2]) };
}

/* ---------------------------------------------------------------------- */

describe("what a documentation package declares", () => {
    it("loads with a minimal configuration and no packs", () => {
        const config = defineConfig(minimal());

        expect(config.packageKind).toBe("documentation");
        expect(config.packs).toEqual([]);
        expect(config.packDirectories).toEqual([]);
        expect(config.publish.site).toBe("content");
    });

    it("derives no Foundry package and no asset root", () => {
        const config = defineConfig(minimal());

        // Both are answers about a Foundry install, and there is none. `null`
        // says so; `documentation/null/assets` would be an address that
        // resolves nowhere, written into every compiled `img`.
        expect(config.foundryPackage).toBeNull();
        expect(config.assetRoot).toBeNull();
        // Nothing is compiled, so nothing is stamped.
        expect(config.stats).toBeNull();
    });

    it("keeps the keys that describe a published tree", () => {
        const config = defineConfig({
            ...minimal(),
            skipDirectories: ["Templates"],
            paths: { content: "docs" },
            site: { sections: { guides: { title: "Guides" } } },
            publish: { site: "content", address: { prefix: "guide/" } },
        } as ContentBuildConfigInput);

        expect(config.skipDirectories).toEqual(["Templates"]);
        expect(config.paths.content).toBe(path.resolve("/repo", "docs"));
        expect(config.site.sections.guides.title).toBe("Guides");
        expect(config.publish.address.prefix).toBe("guide/");
    });

    it("refuses a `documentation` package that publishes no content", () => {
        // The floor every other package may sit at: one authored page, no book,
        // and — here — no compiled documents either, which is nothing at all.
        expect(() =>
            defineConfig({ ...minimal(), publish: undefined } as ContentBuildConfigInput),
        ).toThrow(/`publish` is required in a `documentation` package/);
        expect(() =>
            defineConfig({
                ...minimal(),
                publish: { site: "homepage" },
            } as ContentBuildConfigInput),
        ).toThrow(/`publish.site` must be `content`/);
    });
});

describe("every key a documentation package refuses", () => {
    const refused: Array<[string, unknown]> = [
        ["packs", [{ name: "items", type: "Item" }]],
        ["itemBuilders", {}],
        ["docs", { itemFields: {} }],
        ["compatibility", { minimum: "14.359", verified: "14.359" }],
        ["relationships", { systems: [{ id: "sohl" }] }],
        ["systems", { sohl: { compatibility: { verified: "0.9.0" } } }],
        ["requiresSystem", "sohl"],
        ["stats", { lastModifiedBy: "docbuilder000000" }],
        ["foundryPackage", "docpkg"],
    ];

    it.each(refused)("refuses `%s`, naming the key", (key, value) => {
        expect(() =>
            defineConfig({ ...minimal(), [key]: value } as ContentBuildConfigInput),
        ).toThrow(new RegExp(`\`${key}\` is refused in a \`documentation\` package`));
    });

    it.each(refused)("locates `%s` at the line and column it was written on", (key) => {
        // The refusal is only as good as its locator: a reader has to be sent
        // to the key rather than to the top of the file.
        const yaml = [...MINIMAL_YAML, `${key}: []`];
        const { err, text } = failureFor(yaml);
        const { line, column } = locatorOf(err.message);

        expect(text.split("\n")[line - 1].slice(column - 1)).toMatch(new RegExp(`^${key}:`));
    });

    it("refuses `foundryPackage` rather than deriving it from `package.json`", () => {
        // The loader supplies this key for every other kind, reading the
        // adjacent manifest's `name`. Supplying it here would hand the
        // validator the very key it refuses, so the loader does not.
        const { err } = failureFor([...MINIMAL_YAML, "foundryPackage: docpkg"]);

        expect(err.message).toMatch(/`foundryPackage` is refused/);
    });

    it("refuses `stats` with a locator rather than a bare derivation error", () => {
        // The system version a `stats:` block would be stamped with is derived
        // by the loader, and a documentation package declares no system to
        // derive it from. The finding an author needs is the refused key.
        const { err } = failureFor([
            ...MINIMAL_YAML,
            "stats:",
            "    lastModifiedBy: doc000000000000",
        ]);

        expect(err.message).toMatch(/`stats` is refused/);
        expect(err.message).not.toMatch(/systemVersion is derived/);
    });
});

describe("the two Foundry kinds are unaffected", () => {
    function foundry(kind: "systems" | "modules"): ContentBuildConfigInput {
        return {
            rootDir: "/repo",
            contentPackage: "sohl",
            foundryPackage: "sohl",
            packageKind: kind,
            stats: { lastModifiedBy: "sohlbuilder00000" },
            packs: [{ name: "items", type: "Item" }],
            compatibility: { minimum: "14.359", verified: "14.359" },
        } as ContentBuildConfigInput;
    }

    it.each(["systems", "modules"] as const)("still derives %s' asset root", (kind) => {
        const config = defineConfig(foundry(kind));

        expect(config.assetRoot).toBe(`${kind}/sohl/assets`);
        expect(config.foundryPackage).toBe("sohl");
        expect(config.stats?.lastModifiedBy).toBe("sohlbuilder00000");
    });

    // A module that ships assets and compiles nothing is an ordinary Foundry
    // module: it installs, it is enabled, and it supplies files. Alternative
    // art for another package is the case this exists for.
    it("lets a Foundry package ship assets and compile nothing", () => {
        const config = defineConfig({
            ...foundry("modules"),
            packs: [],
        } as ContentBuildConfigInput);
        expect(config.packs).toEqual([]);
        expect(config.packageKind).toBe("modules");
    });
});

describe("a path with no asset root to be served from", () => {
    it("is refused rather than rooted against nothing", () => {
        const config = defineConfig(minimal());

        expect(() => resolveImg("icons/relic.svg", config)).toThrow(/has no asset root/);
    });

    it("still passes through what no package serves", () => {
        const config = defineConfig(minimal());

        // A `documentation` package declares no relationships — Foundry
        // installs nothing of it — so it has no package's install path to
        // derive. An address that names no package at all is untouched, and a
        // `/`-rooted one is how such a tree addresses another package's file.
        expect(resolveImg("/systems/sohl/assets/icons/shield.svg", config)).toBe(
            "/systems/sohl/assets/icons/shield.svg",
        );
        expect(resolveImg("https://example.org/art.webp", config)).toBe(
            "https://example.org/art.webp",
        );
        expect(resolveImg(null, config)).toBeNull();
        expect(resolveImg("", config)).toBe("");
    });
});

/* ---------------------------------------------------------------------- */

/**
 * A documentation repository, complete enough for every command below.
 *
 * One homepage — the floor every package publishes — and two `doc` notes, which
 * with `homepage` is the whole vocabulary a package compiling nothing has. The
 * site build also reads `package.json`'s `homepage`, the installed theme and
 * the cached navigation, so the fixture carries each.
 */
function documentationRepo(): string {
    const dir = repo("doc-pkg-");
    fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({
            name: "docpkg",
            version: "3.1.0",
            description: "The toolkit, documented.",
            homepage: "https://www.heroiclands.org/toolkit/",
        }),
    );
    const theme = path.join(dir, "node_modules", THEME_PACKAGE);
    fs.mkdirSync(theme, { recursive: true });
    fs.writeFileSync(path.join(theme, "theme.toml"), 'name = "Heroic Lands"\n');
    const config = defineConfig(minimal(dir));
    const cache = navigationCacheDir(config);
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(
        path.join(cache, NAVIGATION_FILE),
        JSON.stringify([{ name: "Home", url: "https://www.heroiclands.org/" }]),
    );
    fs.writeFileSync(path.join(cache, ".complete"), "");
    const content = path.join(dir, "assets", "content");
    fs.mkdirSync(path.join(content, "Guides"), { recursive: true });
    fs.writeFileSync(
        path.join(content, "homepage.md"),
        "---\ntype: homepage\nshortcode: root\nname:\n  full: The Toolkit\n---\n\nFront.\n",
    );
    const doc = (file: string, shortcode: string, title: string, body: string) =>
        fs.writeFileSync(
            path.join(content, "Guides", file),
            `---\ntype: doc\nsubType: reference\nshortcode: ${shortcode}\n` +
                `name:\n  full: ${title}\n---\n\n${body}\n`,
        );
    doc("commands.md", "commands", "Commands", "Every command, and what it reads.");
    doc("configure.md", "configure", "Configuration", "See [[doc-commands|the commands]].");

    fs.writeFileSync(
        path.join(dir, "book.yaml"),
        [
            "contents:",
            "  - sectionName: Guides",
            "    contents:",
            "      - filter: \"type = 'doc'\"",
        ].join("\n") + "\n",
    );
    fs.writeFileSync(
        path.join(dir, `${CONFIG_BASENAME}.yaml`),
        [
            ...MINIMAL_YAML,
            "    address:",
            "        prefix: guide/",
            "site:",
            "    description: The toolkit, documented.",
            "packageBuild:",
            "    manifest:",
            "        title: The Toolkit",
            "pdf:",
            "    title: The Toolkit",
            "    document: book.yaml",
            "    fonts:",
            "        serif: Libertinus Serif",
            "",
        ].join("\n"),
    );
    return dir;
}

/** Run one command of either binary against a fixture repository. */
function run(dir: string, binary: "content-build" | "package-build", ...args: string[]) {
    const r = spawnSync(process.execPath, [path.join(ROOT, "bin", `${binary}.mjs`), ...args], {
        cwd: dir,
        env: {
            ...process.env,
            PACKAGE_BUILD_CONFIG: path.join(dir, `${CONFIG_BASENAME}.yaml`),
        },
        encoding: "utf8",
    });
    return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, status: r.status };
}

describe("what the pipeline does with one", () => {
    it("builds the site, and no Foundry document with it", () => {
        const dir = documentationRepo();
        const { out, status } = run(dir, "content-build", "site");

        expect(out).not.toMatch(/error:/);
        expect(status).toBe(0);
        const guide = path.join(dir, HUGO_CONTENT, "guide");
        expect(fs.existsSync(path.join(guide, "doc-commands.md"))).toBe(true);
        // The homepage publishes at the package's own root, one level above the
        // content mount.
        expect(fs.existsSync(path.join(dir, HUGO_CONTENT, "homepage-root.md"))).toBe(true);
        // The Hugo configuration lands beside the mount, generated from the
        // sources the repository already states.
        const toml = fs.readFileSync(path.join(dir, HUGO_SOURCE, "hugo.toml"), "utf8");
        expect(toml).toMatch(/^baseURL = "https:\/\/www\.heroiclands\.org\/toolkit\/"$/m);
        expect(toml).toMatch(/^title = "The Toolkit"$/m);
        expect(toml).toMatch(/^description = "The toolkit, documented\."$/m);
        expect(toml).toMatch(/^publishDir = "\.\.\/site\/toolkit"$/m);
        // Nothing anywhere is a compiled pack.
        expect(fs.existsSync(path.join(dir, "build", "packs"))).toBe(false);
    });

    it("refuses to build the site from a cold navigation cache, naming `deps fetch`", () => {
        const dir = documentationRepo();
        fs.rmSync(navigationCacheDir(defineConfig(minimal(dir))), { recursive: true });
        const { out, status } = run(dir, "content-build", "site");

        expect(status).not.toBe(0);
        expect(out).toMatch(
            /navigation has not been fetched\. Run `content-build deps fetch` first/,
        );
        // Nothing was written: the sources are read before the output tree is
        // touched, so the previous site is intact to look at.
        expect(fs.existsSync(path.join(dir, HUGO_SOURCE))).toBe(false);
    });

    it("builds the book from the same tree", () => {
        const dir = documentationRepo();
        const { out, status } = run(dir, "content-build", "pdf", "--no-compile");

        expect(out).toMatch(/Typst source:/);
        expect(status).toBe(0);
    });

    it("publishes a content index another package can resolve an address into", () => {
        const dir = documentationRepo();
        const { status } = run(dir, "content-build", "content-index");

        expect(status).toBe(0);
        const index = path.join(dir, "build", "content-index", "toolkit-metadata.jsonl");
        expect(fs.existsSync(index)).toBe(true);
        const addresses = fs
            .readFileSync(index, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line).address?.canonical);
        expect(addresses).toContain("toolkit-none-doc-commands");
    });

    it("refuses to generate a Foundry manifest", () => {
        const dir = documentationRepo();
        const { out, status } = run(dir, "package-build", "manifest");

        expect(out).toMatch(/ships no Foundry package, so there is no manifest/);
        expect(status).not.toBe(0);
        expect(fs.existsSync(path.join(dir, "build", "stage", "module.json"))).toBe(false);
    });

    it("refuses to run a compile pass", () => {
        const dir = documentationRepo();
        const { out, status } = run(dir, "content-build", "package", "compile");

        // Exiting 0 having compiled nothing is the quiet failure — a build that
        // succeeds and produces no documents.
        expect(out).toMatch(/compiles no compendium, so there is nothing to compile/);
        expect(status).not.toBe(0);
    });

    it("reports a note whose type would have to become a document", () => {
        const dir = documentationRepo();
        fs.writeFileSync(
            path.join(dir, "assets", "content", "Guides", "dagger.md"),
            "---\ntype: weapongear\nshortcode: dagger\nname:\n  full: Dagger\n---\n\nA blade.\n",
        );
        const { out, status } = run(dir, "content-build", "lint");

        expect(out).toMatch(/`type: weapongear` compiles to a Foundry document/);
        // Located at the value the finding is about, not at the frontmatter's
        // first line.
        expect(out).toMatch(/dagger\.md:2:\d+: error:/);
        expect(status).not.toBe(0);
    });

    it("passes a tree of the vocabulary it does have", () => {
        const dir = documentationRepo();
        const { out, status } = run(dir, "content-build", "lint");

        expect(out).not.toMatch(/error:/);
        expect(status).toBe(0);
    });
});

describe("the narrowed vocabulary is the kind's, not the linter's", () => {
    it("holds a Foundry package to the wide vocabulary", () => {
        const dir = documentationRepo();
        fs.writeFileSync(
            path.join(dir, "assets", "content", "Guides", "sword.md"),
            "---\ntype: weapongear\nshortcode: sword\nname:\n  full: Sword\n---\n\nA blade.\n",
        );
        const config = defineConfig({
            rootDir: dir,
            contentPackage: "toolkit",
            foundryPackage: "docpkg",
            packageKind: "modules",
            stats: { lastModifiedBy: "docbuilder000000" },
            packs: [{ name: "items", type: "Item" }],
        } as ContentBuildConfigInput);

        const { findings } = lintContentTree(path.join(dir, "assets", "content"), {
            contentPackage: "toolkit",
            config,
            skipDirectories: [],
        });

        expect(findings.map((f) => f.message).join("\n")).not.toMatch(/compiles to a Foundry/);
    });
});
