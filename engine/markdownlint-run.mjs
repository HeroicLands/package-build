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

/**
 * Running the `markdownlint` library over a repository: file discovery,
 * configuration files, and `--fix`.
 *
 * **Files.** The walk is the one the Prettier check uses (`./walk-files.mjs`), so `.git` and
 * `node_modules` are never entered. When `gitignore` is on, every `.gitignore`
 * met on the way down applies to its own directory and below, and an ignored
 * directory is not entered. The remaining files are selected by glob, relative
 * to the repository root, with dot-files matched.
 *
 * **Configuration.** A repository carries zero or more of these, and the nearest
 * one at or above a markdown file decides how that file is linted:
 *
 * - an _options file_ — `.markdownlint-cli2.jsonc`, `.yaml`, `.cjs` or `.mjs`
 *   (the first that exists), declaring any of the keys in {@link ROOT_OPTION_KEYS};
 * - a _rule file_ — `.markdownlint.jsonc`, `.json`, `.yaml`, `.yml`, `.cjs` or
 *   `.mjs`, holding the `config` object directly.
 *
 * Options merge from the root down: a key a nearer file declares replaces the
 * farther one, except `config`, which merges rule by rule. A rule file replaces
 * the merged `config` for the directory it sits in. A key an options file cannot
 * mean in its position — `globs` or `gitignore` below the root — is refused
 * with a located diagnostic, as is any key outside the closed list.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { markupFindings } from "./markup-validation.mjs";

import ignore from "ignore";
import {
    findNodeAtLocation,
    parse as parseJsonc,
    parseTree,
    printParseErrorCode,
} from "jsonc-parser";
import markdownIt from "markdown-it";
import { minimatch } from "minimatch";
import { LineCounter, parse as parseYaml, parseDocument } from "yaml";

import {
    applyFixes,
    extendConfig,
    lint,
    readConfig,
    resolveModule,
} from "../vendor/markdownlint.mjs";
import { walkFiles } from "./walk-files.mjs";

/** Option-file names, in the order the first existing one is taken. */
const OPTIONS_FILES = Object.freeze([
    ".markdownlint-cli2.jsonc",
    ".markdownlint-cli2.yaml",
    ".markdownlint-cli2.cjs",
    ".markdownlint-cli2.mjs",
]);

/** Rule-file names, in the order the first existing one is taken. */
const RULE_FILES = Object.freeze([
    ".markdownlint.jsonc",
    ".markdownlint.json",
    ".markdownlint.yaml",
    ".markdownlint.yml",
    ".markdownlint.cjs",
    ".markdownlint.mjs",
]);

/** Keys an options file may declare anywhere. */
const NESTED_OPTION_KEYS = Object.freeze([
    "config",
    "customRules",
    "frontMatter",
    "ignores",
    "noInlineConfig",
]);

/** Keys an options file may declare at the repository root. */
export const ROOT_OPTION_KEYS = Object.freeze([...NESTED_OPTION_KEYS, "globs", "gitignore"]);

/** The parsers `readConfig` and `extendConfig` try, in order. */
const CONFIG_PARSERS = Object.freeze([parseJsoncStrict, parseYaml]);

/** A configuration problem, located as far as the source allows. */
export class MarkdownConfigError extends Error {
    /**
     * @param {string} file - Absolute path of the configuration file.
     * @param {string} message - What is wrong.
     * @param {{line?: number, column?: number}} [where] - Position, when known.
     */
    constructor(file, message, where = {}) {
        super(message);
        this.name = "MarkdownConfigError";
        this.file = file;
        this.line = where.line;
        this.column = where.column;
    }
}

/**
 * Parse JSONC, throwing on any syntax error.
 *
 * @param {string} text - JSONC text.
 * @returns {any} The parsed value.
 */
function parseJsoncStrict(text) {
    const errors = [];
    const value = parseJsonc(text, errors, { allowTrailingComma: true });
    if (errors.length) {
        const first = errors[0];
        throw Object.assign(new Error(`invalid JSONC: ${printParseErrorCode(first.error)}`), {
            offset: first.offset,
        });
    }
    return value;
}

/**
 * Line and column (1-based) of a character offset.
 *
 * @param {string} text - The file text.
 * @param {number} offset - 0-based character offset.
 * @returns {{line: number, column: number}} The position.
 */
function positionOf(text, offset) {
    const before = text.slice(0, offset).split("\n");
    return { line: before.length, column: before[before.length - 1].length + 1 };
}

/**
 * Where a top-level key sits in a JSONC or YAML options file.
 *
 * @param {string} file - Absolute path.
 * @param {string} text - The file text.
 * @param {string} key - The top-level key.
 * @returns {{line?: number, column?: number}} The position, or nothing when the
 *   file is a module and has no source position for the key.
 */
function locateKey(file, text, key) {
    try {
        if (file.endsWith(".jsonc")) {
            const tree = parseTree(text, [], { allowTrailingComma: true });
            const node = tree && findNodeAtLocation(tree, [key]);
            const keyNode = node?.parent?.children?.[0];
            return keyNode ? positionOf(text, keyNode.offset) : {};
        }
        if (file.endsWith(".yaml") || file.endsWith(".yml")) {
            const lines = new LineCounter();
            const doc = parseDocument(text, { lineCounter: lines });
            const pair = doc.contents?.items?.find((item) => item.key?.value === key);
            if (!pair?.key?.range) return {};
            const { line, col } = lines.linePos(pair.key.range[0]);
            return { line, column: col };
        }
    } catch {
        // Fall through: an unlocatable key is reported against its file.
    }
    return {};
}

/**
 * Read a JSONC or YAML file as a plain value, locating a syntax error.
 *
 * @param {string} file - Absolute path.
 * @param {string} text - The file text.
 * @returns {any} The parsed value.
 */
function parseOptionsText(file, text) {
    try {
        return file.endsWith(".jsonc") ? parseJsoncStrict(text) : parseYaml(text);
    } catch (err) {
        const where = typeof err.offset === "number" ? positionOf(text, err.offset) : {};
        const yamlAt = err.linePos?.[0];
        throw new MarkdownConfigError(
            file,
            String(err.message).split("\n")[0],
            yamlAt ? { line: yamlAt.line, column: yamlAt.col } : where,
        );
    }
}

/** @param {unknown} value - Anything. @returns {boolean} Whether it is a plain object. */
const isPlainObject = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Import a module's default export.
 *
 * @param {string} file - Absolute path.
 * @returns {Promise<any>} The default export.
 */
async function importDefault(file) {
    try {
        return (await import(pathToFileURL(file).href)).default;
    } catch (err) {
        throw new MarkdownConfigError(file, `cannot be loaded: ${err.message}`);
    }
}

/**
 * Resolve custom rules named by module id, relative to a directory.
 *
 * @param {string} file - The options file, for diagnostics.
 * @param {string} dir - Directory ids resolve from.
 * @param {unknown[]} rules - Module ids and rule objects.
 * @returns {Promise<object[]>} The rule objects.
 */
async function resolveCustomRules(file, dir, rules) {
    const out = [];
    for (const rule of rules) {
        if (typeof rule !== "string") {
            out.push(rule);
            continue;
        }
        let resolved;
        try {
            resolved = pathToFileURL(resolveModule(rule, [dir])).href;
        } catch {
            resolved = pathToFileURL(path.resolve(dir, rule)).href;
        }
        let loaded;
        try {
            loaded = (await import(resolved)).default;
        } catch (err) {
            throw new MarkdownConfigError(
                file,
                `customRules: cannot load "${rule}": ${err.message}`,
            );
        }
        out.push(...[loaded].flat());
    }
    return out;
}

/**
 * Validate an options object and resolve what needs resolving.
 *
 * @param {string} file - Absolute path of the options file.
 * @param {string} text - Source text, or "" for a module.
 * @param {any} raw - The parsed options.
 * @param {boolean} isRoot - Whether the file sits at the repository root.
 * @returns {Promise<object>} The validated options.
 */
async function validateOptions(file, text, raw, isRoot) {
    const refuse = (key, message) => {
        throw new MarkdownConfigError(file, message, locateKey(file, text, key));
    };
    if (!isPlainObject(raw)) throw new MarkdownConfigError(file, "must declare an object");
    const allowed = isRoot ? ROOT_OPTION_KEYS : NESTED_OPTION_KEYS;
    for (const key of Object.keys(raw)) {
        if (allowed.includes(key)) continue;
        refuse(
            key,
            ROOT_OPTION_KEYS.includes(key) ?
                `\`${key}\` can only be declared in the repository root's options file`
            :   `unknown option \`${key}\`; accepted: ${allowed.join(", ")}`,
        );
    }
    const strings = (key) => {
        if (
            raw[key] !== undefined &&
            !(Array.isArray(raw[key]) && raw[key].every((v) => typeof v === "string"))
        ) {
            refuse(key, `\`${key}\` must be an array of strings`);
        }
    };
    strings("globs");
    strings("ignores");
    for (const key of ["gitignore", "noInlineConfig"]) {
        if (raw[key] !== undefined && typeof raw[key] !== "boolean") {
            refuse(key, `\`${key}\` must be true or false`);
        }
    }
    if (raw.config !== undefined && !isPlainObject(raw.config)) {
        refuse("config", "`config` must be an object of rule settings");
    }
    if (raw.frontMatter !== undefined) {
        try {
            new RegExp(raw.frontMatter, "u");
        } catch {
            refuse("frontMatter", "`frontMatter` must be a regular expression source string");
        }
    }
    if (raw.customRules !== undefined && !Array.isArray(raw.customRules)) {
        refuse("customRules", "`customRules` must be an array of module ids or rule objects");
    }
    const options = { ...raw };
    if (raw.customRules) {
        options.customRules = await resolveCustomRules(file, path.dirname(file), raw.customRules);
    }
    if (isPlainObject(raw.config) && raw.config.extends !== undefined) {
        options.config = await extendRules(file, raw.config);
    }
    return options;
}

/**
 * Apply a configuration's `extends` chain.
 *
 * @param {string} file - The file the configuration came from.
 * @param {object} config - A configuration holding an `extends` key.
 * @returns {Promise<object>} The configuration with the chain resolved.
 */
async function extendRules(file, config) {
    try {
        // `extendConfig`, unlike `readConfig`, has no default file system.
        return await extendConfig(config, file, [...CONFIG_PARSERS], fs);
    } catch (err) {
        throw new MarkdownConfigError(file, `cannot resolve \`extends\`: ${err.message}`);
    }
}

/**
 * The first of `names` that exists in `dir`.
 *
 * @param {string} dir - Directory to look in.
 * @param {readonly string[]} names - Candidate file names.
 * @returns {string | undefined} Absolute path of the match.
 */
function firstExisting(dir, names) {
    return names.map((name) => path.join(dir, name)).find((file) => fs.existsSync(file));
}

/**
 * Load a directory's options file and rule file.
 *
 * @param {string} dir - Absolute directory.
 * @param {boolean} isRoot - Whether it is the repository root.
 * @returns {Promise<{dir: string, options?: object, ruleConfig?: object}>} What the
 *   directory declares.
 */
async function loadDirectory(dir, isRoot) {
    const layer = { dir };
    const optionsFile = firstExisting(dir, OPTIONS_FILES);
    if (optionsFile) {
        const isModule = /\.[cm]js$/u.test(optionsFile);
        const text = isModule ? "" : fs.readFileSync(optionsFile, "utf8");
        const raw =
            isModule ? await importDefault(optionsFile) : parseOptionsText(optionsFile, text);
        layer.options = await validateOptions(optionsFile, text, raw, isRoot);
    }
    const ruleFile = firstExisting(dir, RULE_FILES);
    if (ruleFile) {
        try {
            layer.ruleConfig =
                /\.[cm]js$/u.test(ruleFile) ?
                    await extendRules(ruleFile, await importDefault(ruleFile))
                :   await readConfig(ruleFile, [...CONFIG_PARSERS]);
        } catch (err) {
            if (err instanceof MarkdownConfigError) throw err;
            throw new MarkdownConfigError(ruleFile, `cannot be read: ${err.message}`);
        }
    }
    return layer;
}

/**
 * Merge options: later keys replace earlier ones, `config` merges rule by rule.
 *
 * @param {object} first - Farther options.
 * @param {object | undefined} second - Nearer options.
 * @returns {object} The merged options.
 */
function mergeOptions(first, second) {
    const merged = { ...first, ...second };
    if (first.config || second?.config) merged.config = { ...first.config, ...second?.config };
    return merged;
}

/** @param {string} p - A path. @returns {string} The path with POSIX separators. */
const posix = (p) => p.split(path.sep).join("/");

/**
 * Normalise a command-line or configuration glob.
 *
 * `#pattern` negates like `!pattern`; a directory that exists selects its markdown;
 * a leading `./` is dropped.
 *
 * @param {string} root - Repository root.
 * @param {string} glob - The pattern.
 * @returns {{negated: boolean, pattern: string}} The pattern and its sense.
 */
function normaliseGlob(root, glob) {
    const negated = glob.startsWith("!") || glob.startsWith("#");
    let pattern = negated ? glob.slice(1) : glob;
    if (path.isAbsolute(pattern)) pattern = posix(path.relative(root, pattern));
    pattern = pattern.replace(/^\.\//u, "");
    if (pattern === "." || pattern === "") pattern = "**/*.md";
    else if (
        fs.existsSync(path.join(root, pattern)) &&
        fs.statSync(path.join(root, pattern)).isDirectory()
    ) {
        pattern = `${pattern.replace(/\/+$/u, "")}/**/*.md`;
    }
    return { negated, pattern };
}

/**
 * Ignore-file handling: a path is ignored when any `.gitignore` at or above its
 * directory (inside the root) says so.
 *
 * @param {string} root - Absolute repository root.
 * @returns {{enter: (dir: string) => void, ignored: (abs: string, isDirectory: boolean) => boolean}}
 *   Hooks for {@link walkFiles}.
 */
function gitignoreHooks(root) {
    /** @type {Map<string, ReturnType<typeof ignore>>} */
    const matchers = new Map();
    return {
        enter(dir) {
            const file = path.join(dir, ".gitignore");
            if (fs.existsSync(file)) matchers.set(dir, ignore().add(fs.readFileSync(file, "utf8")));
        },
        ignored(abs, isDirectory) {
            let dir = path.dirname(abs);
            for (;;) {
                const matcher = matchers.get(dir);
                if (matcher) {
                    const rel = posix(path.relative(dir, abs));
                    if (matcher.ignores(isDirectory ? `${rel}/` : rel)) return true;
                }
                if (dir === root) return false;
                const parent = path.dirname(dir);
                if (parent === dir) return false;
                dir = parent;
            }
        },
    };
}

/**
 * Lint markdown under a root with the `markdownlint` library.
 *
 * @param {object} params
 * @param {string} params.directory - Repository root.
 * @param {readonly string[]} [params.globs] - Globs selecting the files; when
 *   absent, `defaults.globs` plus the root options file's `globs`.
 * @param {object} params.defaults - Options the root options file overrides:
 *   `config`, `ignores`, `gitignore` and `globs`.
 * @param {boolean} [params.fix=false] - Repair what markdownlint can, then
 *   report what remains.
 * @returns {Promise<{results: object[], markup: object[]}>} markdownlint results, each with its
 *   `fileName` relative to `directory`, ordered by file, line and rule.
 *   `markup` carries block syntax diagnostics with absolute filenames.
 * @throws {MarkdownConfigError} A configuration file the contract refuses.
 */
export async function runMarkdownlint(params) {
    const { globs, defaults, fix = false } = params;
    const root = path.resolve(params.directory);

    /** @type {Map<string, object>} */
    const layers = new Map();
    const layerOf = async (dir) => {
        if (!layers.has(dir)) layers.set(dir, await loadDirectory(dir, dir === root));
        return layers.get(dir);
    };

    const rootLayer = await layerOf(root);
    const rootOptions = mergeOptions(defaults, rootLayer.options);

    // Discovery.
    const git = rootOptions.gitignore ? gitignoreHooks(root) : undefined;
    const candidates = walkFiles(root, {
        enter: (dir) => git?.enter(dir),
        skip: (abs, isDirectory) => Boolean(git?.ignored(abs, isDirectory)),
    });

    const selectors = (
        globs?.length ?
            [...globs]
        :   [...(defaults.globs ?? []), ...(rootLayer.options?.globs ?? [])]).map((glob) =>
        normaliseGlob(root, glob),
    );
    const include = selectors.filter((s) => !s.negated).map((s) => s.pattern);
    const exclude = [
        ...selectors.filter((s) => s.negated).map((s) => s.pattern),
        ...(rootOptions.ignores ?? []),
    ];
    const matches = (rel, patterns) => patterns.some((p) => minimatch(rel, p, { dot: true }));
    const selected = candidates.filter((abs) => {
        const rel = posix(path.relative(root, abs));
        return matches(rel, include) && !matches(rel, exclude);
    });

    // Group files by the nearest directory that declares configuration.
    /** @type {Map<string, string[]>} */
    const groups = new Map();
    const chainOf = async (dir) => {
        const chain = [];
        for (let d = dir; ; d = path.dirname(d)) {
            chain.unshift(await layerOf(d));
            if (d === root) break;
        }
        return chain;
    };
    for (const abs of selected) {
        const chain = await chainOf(path.dirname(abs));
        const nestedIgnored = chain.slice(1).some((layer) => {
            const patterns = layer.options?.ignores ?? [];
            return matches(posix(path.relative(layer.dir, abs)), patterns);
        });
        if (nestedIgnored) continue;
        const owner =
            [...chain].reverse().find((layer) => layer.options || layer.ruleConfig) ?? chain[0];
        if (!groups.has(owner.dir)) groups.set(owner.dir, []);
        groups.get(owner.dir).push(abs);
    }

    const lintOptions = async (dir, files) => {
        const chain = await chainOf(dir);
        let merged = defaults;
        for (const layer of chain) merged = mergeOptions(merged, layer.options);
        const owner = chain[chain.length - 1];
        return {
            files,
            config: owner.ruleConfig ?? merged.config,
            customRules: merged.customRules,
            frontMatter: merged.frontMatter ? new RegExp(merged.frontMatter, "u") : undefined,
            handleRuleFailures: true,
            markdownItFactory: () => markdownIt({ html: true }),
            noInlineConfig: Boolean(merged.noInlineConfig),
        };
    };

    const resultsByFile = new Map();
    const markup = [];
    for (const [dir, files] of groups) {
        const options = await lintOptions(dir, files);
        const malformed = new Set();
        for (const file of files) {
            const findings = markupFindings(fs.readFileSync(file, "utf8"), file);
            if (findings.length) malformed.add(file);
            markup.push(...findings);
        }
        let results = await lint(options);
        if (fix) {
            const toFix = [];
            for (const file of files) {
                if (malformed.has(file)) continue;
                const fixable = (results[file] ?? []).filter((error) => error.fixInfo);
                if (!fixable.length) continue;
                const original = fs.readFileSync(file, "utf8");
                fs.writeFileSync(file, applyFixes(original, fixable), "utf8");
                toFix.push(file);
            }
            if (toFix.length)
                results = { ...results, ...(await lint({ ...options, files: toFix })) };
        }
        for (const [file, errors] of Object.entries(results)) resultsByFile.set(file, errors);
    }

    // Order: file, line, rule id, then discovery order.
    const flat = [];
    for (const [file, errors] of resultsByFile) {
        for (const error of errors) {
            flat.push({ fileName: posix(path.relative(root, path.resolve(root, file))), ...error });
        }
    }
    const order = new Map(flat.map((result, index) => [result, index]));
    flat.sort(
        (a, b) =>
            a.fileName.localeCompare(b.fileName) ||
            a.lineNumber - b.lineNumber ||
            a.ruleNames[0].localeCompare(b.ruleNames[0]) ||
            order.get(a) - order.get(b),
    );
    return { results: flat, markup };
}
