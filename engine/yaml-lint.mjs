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
 * Lint YAML — a note's frontmatter, and every YAML file in the repository.
 *
 * Frontmatter is load-bearing here in a way ordinary prose is not: it carries a
 * note's type, its shortcode, its address and the system blocks a document is
 * compiled from. Until this existed nothing checked it *as YAML*. The parse
 * happened in {@link module:engine/helpers.parseMarkdownFile}, and a failure was
 * caught, logged at `warn`, and turned into `{frontmatter: null}` — so a note
 * with a duplicate key did not fail a build, it quietly stopped being a note.
 * Every pass downstream then saw a file with no frontmatter and skipped it, and
 * the build reported success.
 *
 * @module
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** File extensions that carry YAML, either wholly or in a frontmatter fence. */
export const YAML_GLOBS = Object.freeze(["*.md", "*.yaml", "*.yml"]);

/**
 * Directories skipped whatever git says, because git does not know about them.
 *
 * `.git` is in nobody's `.gitignore`, and a worktree under `.claude/` is a
 * checkout of this same repository — linting it reports every finding once per
 * worktree, against paths the author cannot edit from here.
 */
const ALWAYS_SKIP = Object.freeze([".git/", ".claude/"]);

/** A markdown file's leading frontmatter fence. Mirrors `parseMarkdownFile`. */
const FENCE = /^---\n([\s\S]*?)\n---/;

/**
 * Present a markdown file to ESLint as the YAML it begins with.
 *
 * An ESLint *processor* carves virtual files out of a container file — the
 * mechanism `eslint-plugin-markdown` uses for fenced code blocks. Frontmatter is
 * the easy case of it: the block is always at the top of the file, so mapping a
 * finding back to the file it came from is a constant `+1` for the opening
 * `---`, with no offset table to keep.
 *
 * The virtual file is named `0.yaml` so the flat config's `**` + `*.yaml`
 * patterns select it; ESLint addresses it as `<the note>.md/0.yaml`.
 *
 * @type {{meta: object, supportsAutofix: boolean,
 *   preprocess: (text: string) => Array<{text: string, filename: string}>,
 *   postprocess: (messages: object[][]) => object[]}}
 */
export const frontmatterProcessor = {
    meta: { name: "package-build/frontmatter", version: "1" },
    // Every rule applied here is a correctness rule with no fix, and a fix
    // written back through the processor would have to be re-offset into the
    // container file. Nothing is gained by claiming support for it.
    supportsAutofix: false,
    preprocess(text) {
        const fence = FENCE.exec(text);
        return fence ? [{ text: fence[1], filename: "0.yaml" }] : [];
    },
    postprocess(messages) {
        return (messages[0] ?? []).map((message) => ({
            ...message,
            line: message.line + 1,
            ...(message.endLine == null ? {} : { endLine: message.endLine + 1 }),
        }));
    },
};

/**
 * The shared rule set, as an ESLint flat configuration.
 *
 * **Deliberately narrow, for the same reason the markdown and stylesheet rule
 * sets are** — Prettier already owns YAML's whitespace, quoting and line
 * breaks, including inside a frontmatter fence, so a rule about any of those
 * would either duplicate the formatter or fight it. What is left is the class
 * the formatter cannot see: text that parses to something other than what it
 * looks like.
 *
 * - **A parse error is reported, not swallowed.** A duplicate key, a tab used
 *   as indentation, a mapping whose items start at different columns: the YAML
 *   parser detects all three and `parseMarkdownFile` discards all three.
 * - `no-empty-mapping-value` — `folder:` and `folder: null` parse identically
 *   and read as opposites: one is a decision, the other is a key somebody began
 *   and did not finish. YAML cannot tell them apart, so the distinction has to
 *   be made where the text still exists. A key with a block under it is not
 *   empty, which is what separates 65 unfinished keys in `sohl-thalorna` from
 *   the tens of thousands that are ordinary containers.
 * - `no-irregular-whitespace` — a non-breaking space in a key or an unquoted
 *   scalar is invisible in every editor and changes the value.
 * - `no-empty-key`, `no-empty-document` — a fence or a file that parses to
 *   nothing at all.
 *
 * **GitHub workflows are exempt from `no-empty-mapping-value`**, because an
 * empty value is the language there: `on:` `push:` and `workflow_dispatch:`
 * carry their meaning by being present, and writing `push: null` to satisfy a
 * linter would be worse YAML, not better.
 *
 * @param {object} plugin - The `eslint-plugin-yml` module.
 * @returns {object[]} A complete flat config, for `overrideConfig`.
 */
export function yamlLintConfig(plugin) {
    return [
        ...plugin.configs["flat/recommended"],
        { files: ["**/*.md"], processor: frontmatterProcessor },
        {
            files: ["**/*.yaml", "**/*.yml", "**/*.md/*.yaml"],
            rules: {
                "yml/no-empty-mapping-value": "error",
                "yml/no-irregular-whitespace": "error",
                "yml/no-empty-key": "error",
            },
        },
        {
            files: [
                "**/.github/workflows/*.yml",
                "**/.github/workflows/*.yaml",
                "**/action.yml",
                "**/action.yaml",
            ],
            rules: { "yml/no-empty-mapping-value": "off" },
        },
    ];
}

/**
 * The files to lint: every YAML file git would consider, and no other.
 *
 * `--cached --others --exclude-standard` is tracked files plus untracked ones
 * that are not ignored, which is the same set `gitignore: true` gives the
 * markdown linter — and it matters more than it sounds. Asking ESLint for
 * `**\/*.md` in `Song-of-Heroic-Lands-FoundryVTT` offers it 60,792 files, almost
 * all of them inside `nogit/` and `.claude/worktrees/`; this offers 1,888, in
 * 20ms. Untracked-but-not-ignored is included so a note gets linted while it is
 * being written, not only once it has been staged.
 *
 * `-z` because git otherwise quotes any path outside ASCII, and these trees are
 * full of them.
 *
 * @param {string} root - Repository root.
 * @param {readonly string[]} [globs] - Path globs, defaulting to
 *   {@link YAML_GLOBS}.
 * @returns {string[]} Repository-relative paths.
 */
export function candidateFiles(root, globs = YAML_GLOBS) {
    let listed;
    try {
        listed = execFileSync(
            "git",
            ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...globs],
            {
                cwd: root,
                encoding: "utf8",
                maxBuffer: 64 * 1024 * 1024,
                // Not a repository is an ordinary outcome here, not a failure
                // worth printing: it falls back to the walk below.
                stdio: ["ignore", "pipe", "ignore"],
            },
        );
    } catch {
        // Not a git repository, or git is unavailable: fall back to a walk, so
        // the check still runs somewhere a consumer has unpacked a tarball.
        return walk(root, globs);
    }
    return listed
        .split("\0")
        .filter(Boolean)
        .filter(
            (file) =>
                !ALWAYS_SKIP.some((skip) => file.startsWith(skip) || file.includes(`/${skip}`)),
        );
}

/**
 * Enumerate YAML files without git.
 *
 * @param {string} root - Directory to walk.
 * @param {readonly string[]} globs - Path globs, matched on extension only.
 * @returns {string[]} Repository-relative paths.
 */
function walk(root, globs) {
    const extensions = new Set(globs.map((glob) => path.extname(glob)));
    /** @type {string[]} */
    const found = [];
    /** @param {string} dir - Directory to descend. */
    const descend = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "node_modules" || entry.name === "build") continue;
                if (ALWAYS_SKIP.includes(`${entry.name}/`)) continue;
                descend(full);
            } else if (extensions.has(path.extname(entry.name))) {
                found.push(path.relative(root, full));
            }
        }
    };
    descend(root);
    return found;
}

/**
 * Lint a repository's YAML against the shared rule set.
 *
 * ESLint is run through its Node API with `overrideConfigFile: true`, which
 * stops it looking for an `eslint.config.js` at all. That is what lets this ship
 * as a command rather than as a configuration a consumer has to adopt: a
 * repository needs no ESLint of its own, and one that *has* an ESLint — as
 * `Song-of-Heroic-Lands-FoundryVTT` does, for `src/` — keeps it untouched and
 * unconsulted.
 *
 * @param {string} root - Repository to lint.
 * @param {object} [opts]
 * @param {readonly string[]} [opts.paths] - Globs to lint instead of every
 *   YAML file git would consider.
 * @param {object} [opts.plugin] - The `eslint-plugin-yml` module, for tests.
 * @param {Function} [opts.ESLint] - The `ESLint` class, for tests.
 * @returns {Promise<{findings: object[], checked: number}>} The findings, and
 *   how many files were linted.
 */
export async function lintYaml(root, opts = {}) {
    const directory = path.resolve(root);
    const plugin = opts.plugin ?? (await import("eslint-plugin-yml")).default;
    const ESLint = opts.ESLint ?? (await import("eslint")).ESLint;

    const files = opts.paths?.length ? [...opts.paths] : candidateFiles(directory);
    if (!files.length) return { findings: [], checked: 0 };

    const eslint = new ESLint({
        cwd: directory,
        overrideConfigFile: true,
        overrideConfig: yamlLintConfig(plugin),
        errorOnUnmatchedPattern: false,
    });

    const results = await eslint.lintFiles(files);
    /** @type {object[]} */
    const findings = [];
    for (const result of results) {
        for (const message of result.messages)
            findings.push(toDiagnostic(directory, result, message));
    }
    return { findings, checked: results.length };
}

/**
 * One ESLint message as a diagnostic.
 *
 * A parse error carries no `ruleId` and reports column 0, which is not a
 * position any compiler-parseable format admits — columns are 1-based. It is
 * clamped rather than dropped, because the line is right and the line is what
 * the author needs.
 *
 * @param {string} directory - The root `filePath` is resolved against.
 * @param {object} result - An ESLint `LintResult`.
 * @param {object} message - One of its messages.
 * @returns {{file: string, line: number, column: number, severity: string,
 *   message: string}} The diagnostic.
 */
function toDiagnostic(directory, result, message) {
    const rule = message.ruleId ? `${message.ruleId} ` : "";
    return {
        file: path.resolve(directory, result.filePath),
        line: message.line,
        column: Math.max(1, message.column ?? 1),
        severity: message.severity === 1 ? "warning" : "error",
        message: `${rule}${message.message}`,
    };
}
