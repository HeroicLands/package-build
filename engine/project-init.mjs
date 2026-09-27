/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Render and inspect a new content package without requiring a project config. */

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import prettier from "prettier";
import prettierConfig from "../prettier-config.mjs";
import { CONFIG_FILENAMES, configFromData } from "./pack-config.mjs";
import { checkLabelRegistry } from "../labels.mjs";

export const INIT_KINDS = Object.freeze(["systems", "modules", "documentation"]);
export const INIT_LICENSES = Object.freeze(["original", "fan"]);

const REQUIRED_SCRIPTS = Object.freeze([
    "prepare",
    "clean",
    "build",
    "build:noci",
    "build:content-index",
    "build:site",
    "build:book",
    "serve:site",
    "lint",
    "format",
    "changeset",
]);

/** @param {string} value */
function nonempty(value) {
    return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validate values before creating a target directory.
 * @param {object} answers
 */
export function validateInitAnswers(answers) {
    for (const key of ["name", "title", "description", "author"]) {
        if (!nonempty(answers[key])) throw new Error(`init: --${key} is required`);
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(answers.name)) {
        throw new Error("init: --name must be lowercase letters, digits, and internal hyphens");
    }
    const contentPackage = answers.name.replaceAll("-", "");
    if (!contentPackage) throw new Error("init: --name must yield a content package id");
    if (!INIT_KINDS.includes(answers.kind)) {
        throw new Error(`init: --kind must be one of ${INIT_KINDS.join(", ")}`);
    }
    if (!INIT_LICENSES.includes(answers.license)) {
        throw new Error(`init: --license must be one of ${INIT_LICENSES.join(", ")}`);
    }
    if (!nonempty(answers.version)) throw new Error("init: toolchain version is unavailable");
    if (answers.kind !== "documentation") {
        for (const key of ["coreMinimum", "coreVerified"]) {
            if (!nonempty(answers[key])) throw new Error(`init: --${key} is required`);
        }
    }
    return { ...answers, contentPackage };
}

/** @param {object} answers */
function projectScripts(answers) {
    const scripts = {
        prepare:
            "git config core.hooksPath node_modules/@heroiclands/package-build/githooks || true",
        clean: "package-build clean",
        distclean: "package-build clean --distclean",
        build: "npm ci && npm run build:noci",
        "build:local": "npm install && npm run build:noci",
        "build:content-index": "package-build content-index",
        "build:deps": "package-build deps fetch",
        "build:site-content": "package-build site",
        "build:site-html": "hugo --source build/hugo --minify --gc --cleanDestinationDir",
        "build:site-root": "package-build site-root",
        "build:site":
            "run-s build:deps build:content-index build:site-content build:site-html build:site-root",
        "serve:site":
            "npm run build:deps && npm run build:site-content && hugo server --source build/hugo",
        "build:book": "package-build pdf",
        lint: "run-s lint:format lint:markdown lint:addresses lint:content-links lint:labels",
        "lint:format": "package-build format",
        "lint:markdown": "package-build markdown",
        "lint:markdown:fix": "package-build markdown --fix",
        "lint:addresses": "package-build lint",
        "lint:content-links": "package-build links",
        "lint:labels": "package-build labels check",
        format: "package-build format --write",
        "format:check": "package-build format",
        changeset: "changeset",
        "changeset:version":
            "changeset version && package-build changelog group && npm install --package-lock-only",
    };
    if (answers.kind === "documentation") {
        scripts["build:noci"] = "run-s lint build:content-index";
        return scripts;
    }
    Object.assign(scripts, {
        "build:assets": "package-build assets",
        "build:compiledb": "package-build package compile",
        "build:unpackdb": "package-build package unpack",
        "build:module": "package-build manifest",
        "build:db": "run-s build:content-index build:assets build:compiledb",
        "build:noci": "run-s lint build:db build:module",
        "build:pack-release": "package-build release",
        "lint:lang": "package-build lang check",
        "push:dev": "package-build deploy dev",
        "push:qa": "package-build deploy qa",
        "push:prod": "package-build deploy prod",
    });
    scripts.lint =
        "run-s lint:format lint:markdown lint:lang lint:addresses lint:content-links lint:labels";
    return scripts;
}

/** @param {object} answers */
function projectConfig(answers) {
    const config = {
        contentPackage: answers.contentPackage,
        packageKind: answers.kind,
    };
    if (answers.kind !== "documentation") {
        config.compatibility = {
            minimum: answers.coreMinimum,
            verified: answers.coreVerified,
        };
        config.stats = { lastModifiedBy: "builder000000000" };
        config.packs = [{ name: "journals", label: "Journals", type: "JournalEntry" }];
    }
    config.publish = { site: "content", address: { prefix: "" } };
    config.pdf = { title: answers.title, document: "book.yaml", out: "build/pdf" };
    config.site = {
        assets: "https://cdn.heroiclands.org",
        description: answers.description,
    };
    if (answers.kind !== "documentation") {
        config.packageBuild = {
            assets: [
                { from: "README.md", to: "README.md" },
                { from: "LICENSE.md", to: "LICENSE.md" },
                { from: "lang", to: "lang" },
            ],
            manifest: {
                title: answers.title,
                description: answers.description,
                authors: [{ name: answers.author }],
                license: "LICENSE.md",
                readme: "README.md",
                languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
                packFolders: [{ name: answers.title, sorting: "m", packs: ["journals"] }],
            },
        };
    }
    return config;
}

/** @param {object} answers */
function projectManifest(answers) {
    return {
        name: answers.name,
        version: "0.1.0",
        private: true,
        description: answers.description,
        author: answers.author,
        license:
            answers.license === "original" ?
                "GPL-3.0-or-later AND CC-BY-SA-4.0"
            :   "SEE LICENSE IN LICENSE.md",
        type: "module",
        repository: { type: "git", url: `https://github.com/HeroicLands/${answers.name}` },
        homepage: `https://www.heroiclands.org/${answers.contentPackage}/`,
        engines: { node: ">=24.0.0" },
        scripts: projectScripts(answers),
        devDependencies: {
            "@changesets/cli": "^3.0.0",
            "@heroiclands/hugo-theme": "^0.9.0",
            "@heroiclands/package-build": `^${answers.version}`,
            "npm-run-all": "^4.1.5",
        },
    };
}

/** @param {object} answers */
function projectText(answers) {
    const license =
        answers.license === "original" ?
            `# License\n\nCopyright © ${new Date().getFullYear()} ${answers.author}.\n\nCode is licensed under GPL-3.0-or-later. Original content is licensed under CC-BY-SA-4.0.\n`
        :   `# License\n\nCopyright © ${new Date().getFullYear()} ${answers.author} for original contributions.\n\nOriginal content is licensed under CC-BY-NC-SA-4.0. Third-party setting material retains its owners' rights. This is unofficial fan material.\n`;
    const config = projectConfig(answers);
    const homepage = [
        "---",
        YAML.stringify(
            {
                shortcode: "root",
                name: { full: answers.title },
                type: "homepage",
                description: answers.description,
            },
            { indent: 4 },
        ).trim(),
        "---",
        "",
        `# ${answers.title}`,
        "",
        answers.description,
        "",
        "Start with [Introduction](doc-introduction/).",
        "",
    ].join("\n");
    const introduction = [
        "---",
        YAML.stringify(
            {
                shortcode: "introduction",
                name: { full: "Introduction" },
                type: "doc",
                subType: "concept",
                description: `An introduction to ${answers.title}.`,
            },
            { indent: 4 },
        ).trim(),
        "---",
        "",
        "# Introduction",
        "",
        `${answers.title} is ready for its first notes. This page introduces the package to readers.`,
        "",
    ].join("\n");
    const files = {
        "package.json": JSON.stringify(projectManifest(answers)),
        "package-build.config.yaml": YAML.stringify(config, { indent: 4 }),
        ".gitignore": [
            "node_modules",
            "/build/",
            "/nogit/",
            "/.env*",
            "/.DS_Store",
            "/.claude/",
            "*.tgz",
            "",
        ].join("\n"),
        "prettier.config.js":
            '/* SPDX-License-Identifier: GPL-3.0-or-later */\nexport { default } from "@heroiclands/package-build/prettier";\n',
        ".prettierignore": "CHANGELOG.md\n",
        "README.md": `# ${answers.title}\n\n${answers.description}\n\nRun \`npm install\`, then \`npm run lint\`. Build the website with \`npm run build:site\`, serve it with \`npm run serve:site\`, and build the book with \`npm run build:book\`. The site requires Hugo Extended and the book requires Typst on your PATH. Site deployment needs its own hosting configuration.\n`,
        "LICENSE.md": license,
        "lang/en.json": JSON.stringify({
            [answers.contentPackage.toUpperCase()]: { Title: answers.title },
        }),
        "assets/content/homepage.md": homepage,
        "assets/content/Introduction.md": introduction,
        "book.yaml": YAML.stringify({
            contents: [
                {
                    sectionName: "Introduction",
                    contents: [{ filter: "type = 'doc' AND shortcode = 'introduction'" }],
                },
            ],
        }),
        ".changeset/config.json": JSON.stringify({
            $schema: "https://unpkg.com/@changesets/config@4.0.0/schema.json",
            changelog: "@heroiclands/package-build/changelog",
            commit: true,
            baseBranch: "main",
            privatePackages: { version: true, tag: false },
            updateInternalDependencies: "patch",
            ignore: [],
        }),
        ".github/labels.yml": YAML.stringify([
            {
                name: "documentation",
                color: "0075ca",
                description: "Documentation and author guides.",
            },
            { name: "devops", color: "e07b31", description: "Build, CI, and release work." },
        ]),
        ".github/ISSUE_REPORTING.md": [
            "# Issue reporting",
            "",
            "## 1. Scope",
            "",
            "File a reproducible issue in the repository whose change can resolve it.",
            "",
            "## 2. Work shape",
            "",
            "Use the organization issue type for a bug, feature, task, spike, or epic.",
            "",
            "## 3. Labels — the closed registry",
            "",
            "| Label | Use it for |",
            "| ----- | ---------- |",
            "| `documentation` | Documentation and author guides. |",
            "| `devops` | Build, CI, and release work. |",
            "",
        ].join("\n"),
        ".github/workflows/build.yml": [
            "# SPDX-License-Identifier: GPL-3.0-or-later",
            "name: Build and Test",
            "on:",
            "    pull_request:",
            "        branches: [main]",
            "    push:",
            "        branches: [main]",
            "jobs:",
            "    test-build:",
            "        runs-on: ubuntu-latest",
            "        steps:",
            "            - uses: actions/checkout@v7",
            "            - uses: actions/setup-node@v7",
            "              with:",
            "                  node-version: 24",
            "                  cache: npm",
            "            - run: npm ci",
            "            - run: npm run build:noci",
            "",
        ].join("\n"),
    };
    return files;
}

/** Format every generated file with the toolchain's own conventions. */
export async function renderProject(answers) {
    const valid = validateInitAnswers(answers);
    const files = projectText(valid);
    const result = new Map();
    for (const [file, source] of Object.entries(files)) {
        if (file === ".gitignore" || file === ".prettierignore") {
            result.set(file, source);
            continue;
        }
        result.set(
            file,
            await prettier.format(source, {
                ...prettierConfig,
                filepath: file,
            }),
        );
    }
    return result;
}

/** Write a complete scaffold after collision checks; undo this run's files on failure. */
export async function initializeProject(rootDir, answers) {
    const root = path.resolve(rootDir);
    const files = await renderProject(answers);
    const parent = path.dirname(root);
    if (!fs.existsSync(parent)) throw new Error(`init: parent directory does not exist: ${parent}`);
    const existed = fs.existsSync(root);
    if (existed && !fs.statSync(root).isDirectory()) {
        throw new Error(`init: target is not a directory: ${root}`);
    }
    if (existed && fs.lstatSync(root).isSymbolicLink()) {
        throw new Error(`init: target must not be a symbolic link: ${root}`);
    }
    for (const name of CONFIG_FILENAMES) {
        if (fs.existsSync(path.join(root, name))) {
            throw new Error(`init: configuration already exists: ${path.join(root, name)}`);
        }
    }
    for (const file of files.keys()) {
        const dest = path.join(root, file);
        if (fs.existsSync(dest)) throw new Error(`init: refusing to overwrite ${dest}`);
    }
    const written = [];
    const madeDirs = [];
    try {
        if (!existed) {
            fs.mkdirSync(root);
            madeDirs.push(root);
        }
        for (const [file, source] of files) {
            const dest = path.join(root, file);
            const dir = path.dirname(dest);
            const missing = [];
            for (let p = dir; p !== root && !fs.existsSync(p); p = path.dirname(p)) missing.push(p);
            for (const p of missing.reverse()) {
                fs.mkdirSync(p);
                madeDirs.push(p);
            }
            fs.writeFileSync(dest, source, { flag: "wx" });
            written.push(dest);
        }
    } catch (err) {
        for (const file of written.reverse()) fs.rmSync(file, { force: true });
        for (const dir of madeDirs.reverse()) {
            try {
                fs.rmdirSync(dir);
            } catch {
                // An existing file in the directory remains untouched.
            }
        }
        throw err;
    }
    return [...files.keys()];
}

/** Report required structure and meaning in an existing package without writes. */
export function checkProject(rootDir) {
    const root = path.resolve(rootDir);
    const findings = [];
    const add = (file, message) => findings.push({ file, message });
    const required = [
        "package.json",
        ".gitignore",
        "prettier.config.js",
        ".prettierignore",
        "README.md",
        "LICENSE.md",
        ".changeset/config.json",
        ".github/labels.yml",
        ".github/ISSUE_REPORTING.md",
        ".github/workflows/build.yml",
    ];
    for (const file of required) {
        if (!fs.existsSync(path.join(root, file))) add(file, "required project file is missing");
    }
    const names = CONFIG_FILENAMES.filter((name) => fs.existsSync(path.join(root, name)));
    if (names.length !== 1) {
        add("package-build.config.yaml", "exactly one package-build configuration is required");
    }
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
        for (const name of REQUIRED_SCRIPTS) {
            if (!nonempty(manifest.scripts?.[name])) {
                add("package.json", `scripts.${name} is required`);
            }
        }
        if (!manifest.devDependencies?.["@heroiclands/package-build"]) {
            add("package.json", "the package-build development dependency is required");
        }
        if (!manifest.devDependencies?.["@heroiclands/hugo-theme"]) {
            add("package.json", "the Hugo theme development dependency is required");
        }
        if (!nonempty(manifest.homepage))
            add("package.json", "homepage is required for the website");
    } catch (err) {
        if (fs.existsSync(path.join(root, "package.json"))) {
            add("package.json", `cannot read package metadata: ${err.message}`);
        }
    }
    let config;
    if (names.length === 1 && names[0] !== "package-build.config.mjs") {
        const file = names[0];
        try {
            const source = fs.readFileSync(path.join(root, file), "utf8");
            config = YAML.parse(source);
            configFromData(config, path.join(root, file));
        } catch (err) {
            add(file, `invalid package configuration: ${err.message}`);
        }
    }
    if (config) {
        if (config.publish?.site !== "content") {
            add(names[0], "publish.site must include the content pages");
        }
        if (!nonempty(config.site?.assets) || !nonempty(config.site?.description)) {
            add(names[0], "site.assets and site.description are required for the website");
        }
        if (!nonempty(config.pdf?.title) || !nonempty(config.pdf?.document)) {
            add(names[0], "pdf.title and pdf.document are required for the book");
        } else if (!fs.existsSync(path.join(root, config.pdf.document))) {
            add(config.pdf.document, "the book document tree is missing");
        }
        if (config.packageKind !== "documentation") {
            if (!nonempty(config.packageBuild?.manifest?.title)) {
                add(names[0], "packageBuild.manifest.title is required");
            }
            if (!fs.existsSync(path.join(root, "lang/en.json"))) {
                add("lang/en.json", "the localization file is missing");
            }
        }
    }
    const contentRoot = path.join(root, "assets/content");
    if (!fs.existsSync(contentRoot)) {
        add("assets/content", "the content tree is missing");
    } else if (!fs.readdirSync(contentRoot).some((file) => file.endsWith(".md"))) {
        add("assets/content", "the content tree has no notes");
    }
    const labelsPath = path.join(root, ".github/labels.yml");
    const reportingPath = path.join(root, ".github/ISSUE_REPORTING.md");
    if (fs.existsSync(labelsPath) && fs.existsSync(reportingPath)) {
        const result = checkLabelRegistry({
            registryText: fs.readFileSync(labelsPath, "utf8"),
            docText: fs.readFileSync(reportingPath, "utf8"),
        });
        for (const finding of result.registry) add(".github/labels.yml", finding.message);
        for (const finding of result.doc) add(".github/ISSUE_REPORTING.md", finding.message);
    }
    return findings;
}
