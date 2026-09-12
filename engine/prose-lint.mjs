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
 * Running the shared prose conventions over a repository — Prettier for
 * formatting, markdownlint for the structure Prettier is indifferent to.
 *
 * Both are thin: the rules live in `./prose-config.mjs` and the tools are
 * Prettier and markdownlint themselves. What this module adds is the two things
 * a consumer would otherwise have to get right on its own — supplying the
 * shared configuration *as a default a local one overrides*, and reporting
 * findings in the one parseable form every check in this package emits.
 *
 * **Neither tool's own file discovery is reimplemented.** Prettier decides what
 * it formats and what an ignore file excludes, through `getFileInfo`;
 * markdownlint expands its own globs and honours `.gitignore` itself. A second
 * implementation of either would drift from the tool it stands in for, and the
 * whole point of the command is that `content-build format --check` and a bare
 * `prettier --check .` report the same thing.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import {
    MARKDOWNLINT_CONFIG,
    MARKDOWN_GLOBS,
    MARKDOWN_IGNORES,
    sharedPrettierDivergence,
    sharedPrettierOptionsFor,
} from "./prose-config.mjs";

/**
 * Directories never walked, whatever the ignore files say.
 *
 * `node_modules` is in every consumer's `.gitignore` and would be excluded
 * anyway; skipping it in the walk rather than per file is the difference
 * between a check that takes a second and one that stats a hundred thousand
 * files to be told each is ignored. `.git` is in nobody's `.gitignore`, so it
 * has to be named.
 */
const NEVER_WALK = Object.freeze(new Set([".git", "node_modules"]));

/**
 * The ignore files Prettier consults, in its own default order.
 *
 * Stated explicitly because passing `ignorePath` at all replaces the default,
 * and the default is both of these — dropping `.gitignore` would start
 * reporting on build output.
 */
const IGNORE_FILES = Object.freeze([".gitignore", ".prettierignore"]);

/**
 * How many times `--write` will format one file looking for a fixpoint.
 *
 * `format` is *assumed* idempotent and is not guaranteed to be: a single pass
 * can leave text the next pass would still change, and a `--write` run that
 * takes one pass then reports success has called such a file formatted while
 * `prettier --check` still rejects it. Formatting to a fixpoint removes
 * the assumption — the file lands on the value repeated formatting converges
 * to, whatever it took to get there.
 *
 * Three, not "until it stops": a file that oscillates would loop forever, and
 * the cap turns that into a report. Three is enough for the case this is for
 * (one pass short) with a pass to spare, and costs nothing on a tree that is
 * already formatted, where the first pass converges immediately.
 */
const MAX_FORMAT_PASSES = 3;

/**
 * The two paths whose resolved configuration stands for the repository's.
 *
 * Prettier resolves a configuration *per file*, so asking what a repository is
 * configured to do means asking about a file. These are the two answers that
 * differ: markdown carries the shared `tabWidth` override and everything else
 * does not, so a single probe would check half the conventions and miss the one
 * most worth checking.
 *
 * Ordinary names at the repository root, and neither has to exist —
 * `resolveConfig` reads the path to walk up from it and to match `overrides`
 * against it, never the file. That is also the limit of what this can say: it
 * reports the configuration a file *at the root* resolves to, so an override a
 * consumer scoped to some subtree of its own is outside the question being
 * asked, and rightly so.
 */
const CONVENTION_PROBES = Object.freeze({ code: "index.mjs", markdown: "README.md" });

/** The one line a consumer writes to adopt the shared configuration verbatim. */
const SHARED_CONFIG_RE_EXPORT = 'export { default } from "@heroiclands/package-build/prettier";';

/**
 * Every file under a root, minus the directories nothing should walk.
 *
 * @param {string} root - Absolute path to walk.
 * @returns {string[]} Absolute file paths, in directory order.
 */
function walkFiles(root) {
    const out = [];
    /** @param {string} dir - Directory to descend into. */
    const descend = (dir) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            // A directory that vanished or cannot be read is not a finding
            // about prose; leave it to whatever owns it.
            return;
        }
        for (const entry of entries) {
            const abs = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!NEVER_WALK.has(entry.name)) descend(abs);
            } else if (entry.isFile()) {
                out.push(abs);
            }
        }
    };
    descend(root);
    return out;
}

/**
 * Check — or rewrite — every file Prettier claims, under one root.
 *
 * The configuration resolution is the part that matters: a consumer's own
 * Prettier config, found by Prettier walking up from each file, always wins.
 * {@link sharedPrettierOptionsFor} is what a file gets when that search finds
 * nothing, which is the case in a repository that has deliberately declared
 * none.
 *
 * @param {string} root - Repository (or subtree) to check.
 * @param {object} [opts]
 * @param {readonly string[]} [opts.paths] - Files or directories to check
 *   instead of the whole root.
 * @param {boolean} [opts.write=false] - Rewrite unformatted files in place
 *   rather than reporting them. Each file is formatted to a fixpoint (up to
 *   {@link MAX_FORMAT_PASSES} passes), so a written tree is one a second run
 *   leaves alone; a file that will not converge is reported and left unchanged.
 * @param {object} [opts.prettier] - The Prettier module, for tests.
 * @returns {Promise<{findings: Array<{file: string, severity: string,
 *   message: string}>, checked: number, written: string[]}>} The findings, how
 *   many files were considered, and what was rewritten. `--write` reports
 *   findings too — a file it cannot parse, or cannot format to a fixpoint.
 */
export async function checkFormatting(root, opts = {}) {
    const { paths, write = false } = opts;
    const prettier = opts.prettier ?? (await import("prettier"));
    const base = path.resolve(root);
    const ignorePath = IGNORE_FILES.map((name) => path.join(base, name)).filter((file) =>
        fs.existsSync(file),
    );

    const roots = paths?.length ? paths.map((entry) => path.resolve(base, entry)) : [base];
    const candidates = roots.flatMap((entry) =>
        fs.existsSync(entry) && fs.statSync(entry).isDirectory() ? walkFiles(entry) : [entry],
    );

    const findings = [];
    const written = [];
    let checked = 0;

    for (const file of candidates) {
        const info = await prettier.getFileInfo(file, { ignorePath });
        // `ignored` is the ignore files' answer; a null parser means Prettier
        // has no opinion about this kind of file at all (an image, a lockfile
        // it was told to skip). Neither is a finding.
        if (info.ignored || !info.inferredParser) continue;
        checked += 1;

        const local = await prettier.resolveConfig(file, {
            editorconfig: false,
        });
        // `resolveConfig` has already applied any `overrides` the consumer's
        // own config declares. The shared fallback has to apply its own, since
        // Prettier ignores an `overrides` block passed inline.
        const options = {
            ...(local ?? sharedPrettierOptionsFor(file)),
            filepath: file,
        };
        const source = fs.readFileSync(file, "utf8");

        // A file Prettier cannot parse is a finding, not a crash. Its own CLI
        // reports the syntax error and carries on to the next file, and a
        // single unparseable file in a large tree must not cost the report on
        // every other one.
        try {
            if (write) {
                // Format to a fixpoint rather than once, so what lands on disk
                // is what a second run would have produced.
                let formatted = source;
                let converged = false;
                for (let pass = 0; pass < MAX_FORMAT_PASSES; pass += 1) {
                    const next = await prettier.format(formatted, options);
                    if (next === formatted) {
                        converged = true;
                        break;
                    }
                    formatted = next;
                }

                if (!converged) {
                    // Nothing is written. A formatting the command cannot
                    // reproduce is not one to commit to disk — writing it
                    // would make `--write` churn the file on every run — and a
                    // file that never settles is a defect somewhere that has
                    // to be named rather than absorbed.
                    findings.push({
                        file,
                        severity: "error",
                        // No line or column: the verdict is about the whole
                        // file, and the rule is to drop a field rather than
                        // invent one.
                        message:
                            `did not converge after ${MAX_FORMAT_PASSES} formatting passes; ` +
                            "left unchanged",
                    });
                    continue;
                }

                if (formatted !== source) {
                    fs.writeFileSync(file, formatted);
                    written.push(file);
                }
                continue;
            }

            if (!(await prettier.check(source, options))) {
                findings.push({
                    file,
                    severity: "error",
                    // No line or column: Prettier's answer is about the whole
                    // file, and the rule is to drop a field rather than
                    // invent one.
                    message: "is not formatted; run `content-build format --write` to fix it",
                });
            }
        } catch (err) {
            // Prettier hangs a `loc` off a syntax error, shaped `{start:
            // {line, column}}` — a range, not a point. Reading `loc.line`
            // directly finds `undefined` and yields a locator-less finding for
            // the one class of finding that has an exact position. The wrapped
            // parser error underneath carries a flat, 0-based `loc`; the outer
            // one is 1-based and agrees with the message, so it wins.
            const loc = err?.loc?.start ?? err?.loc;
            findings.push({
                file,
                ...(Number.isFinite(loc?.line) ? { line: loc.line, column: loc.column } : {}),
                severity: "error",
                message: `cannot be parsed: ${String(err?.message ?? err).split("\n")[0]}`,
            });
        }
    }

    return { findings, checked, written };
}

/**
 * One divergence as the sentence a diagnostic carries.
 *
 * The two cases read differently on purpose. A key set to something else is a
 * choice someone made and can defend; a key that is simply absent is the
 * silent half — a consumer does not choose Prettier's default, it
 * arrived because declaring one option discards every option not restated.
 *
 * @param {{key: string, shared: unknown, local: unknown}} divergence - From
 *   {@link sharedPrettierDivergence}.
 * @param {string} [scope=""] - Which files this is about, when it is not all of
 *   them. Prefixed to the key, so the line reads `markdown \`tabWidth\` …`.
 * @returns {string} The message.
 */
function divergenceMessage({ key, shared, local }, scope = "") {
    const here =
        local === undefined ?
            "is not set here, so Prettier's own default applies"
        :   `is ${JSON.stringify(local)} here`;
    return `${scope}\`${key}\` ${here}; the shared configuration says ${JSON.stringify(shared)}`;
}

/**
 * Report where a repository's own Prettier configuration parts from the shared
 * one — or that it has none at all.
 *
 * **Warnings, every one of them.** A consumer's config wins by design and this
 * does not change that; it only refuses to let the divergence be silent, which
 * is the whole of what the issue asks for. Turning any of this into an error
 * would make the shared conventions mandatory, and they are a default.
 *
 * The no-configuration case is the sharper one and is reported even though the
 * command itself behaves correctly there: with no config file the shared
 * conventions reach `content-build format` and reach *nothing else*, so an
 * editor's format-on-save and a bare `npx prettier --check .` apply Prettier's
 * own defaults to the same tree, and the two take turns rewriting the same
 * lines. That is not hypothetical — it is what the config files in
 * `sohl-thalorna` and `sohl-kethira-basic` were added to stop.
 *
 * @param {string} root - Repository to ask about.
 * @param {object} [opts]
 * @param {object} [opts.prettier] - The Prettier module, for tests.
 * @returns {Promise<{findings: Array<{file?: string, severity: string,
 *   message: string}>, configFile: string|null}>} The findings and the config
 *   file they are about, which is `null` when the repository declares none. A
 *   finding about a missing file carries no `file`: the rule is to drop a
 *   field rather than invent one.
 */
export async function checkPrettierConventions(root, opts = {}) {
    const prettier = opts.prettier ?? (await import("prettier"));
    const base = path.resolve(root);
    const probe = (name) => path.join(base, name);

    const configFile = await prettier.resolveConfigFile(probe(CONVENTION_PROBES.code));
    if (!configFile) {
        return {
            findings: [
                {
                    severity: "warning",
                    message:
                        "this repository declares no Prettier configuration, so `content-build " +
                        "format` applies the shared conventions while an editor and a bare `npx " +
                        "prettier` apply Prettier's own to the same tree; declare them in a " +
                        `prettier.config.mjs — ${SHARED_CONFIG_RE_EXPORT}`,
                },
            ],
            configFile: null,
        };
    }

    /** @param {string} name - One of {@link CONVENTION_PROBES}. */
    const divergenceFor = async (name) =>
        sharedPrettierDivergence(
            await prettier.resolveConfig(probe(name), { editorconfig: false }),
            probe(name),
        );

    const code = await divergenceFor(CONVENTION_PROBES.code);
    const markdown = await divergenceFor(CONVENTION_PROBES.markdown);

    const findings = code.map((divergence) => ({
        file: configFile,
        severity: "warning",
        message: divergenceMessage(divergence),
    }));
    for (const divergence of markdown) {
        // A key that resolves the same way everywhere is one finding, not two.
        // Only what markdown alone gets wrong is worth a line of its own — and
        // it is the line that matters most, `tabWidth` being the value a note
        // moving between repositories reindents on.
        const everywhere = code.some(
            (other) => other.key === divergence.key && Object.is(other.local, divergence.local),
        );
        if (everywhere) continue;
        findings.push({
            file: configFile,
            severity: "warning",
            message: divergenceMessage(divergence, "markdown "),
        });
    }

    return { findings, configFile };
}

/**
 * One markdownlint result as a diagnostic.
 *
 * @param {string} directory - The root the result's `fileName` is relative to.
 * @param {object} result - A markdownlint `LintResult`.
 * @returns {{file: string, line: number, column?: number, severity: string,
 *   message: string}} The diagnostic.
 */
function toDiagnostic(directory, result) {
    const {
        fileName,
        lineNumber,
        ruleNames = [],
        ruleDescription,
        errorDetail,
        errorContext,
        errorRange,
    } = result;
    // `ruleNames` is [id, name, ...aliases]; the pair is what markdownlint's own
    // output shows and what a reader searches the rule set for.
    const rule = ruleNames.slice(0, 2).join("/");
    const detail = errorDetail ? ` [${errorDetail}]` : "";
    const context = errorContext ? ` [Context: "${errorContext}"]` : "";
    return {
        file: path.resolve(directory, fileName),
        line: lineNumber,
        // `errorRange` is `[column, length]`, 1-based, and absent for a finding
        // about a whole line.
        ...(Array.isArray(errorRange) ? { column: errorRange[0] } : {}),
        severity: "error",
        message: `${rule} ${ruleDescription}${detail}${context}`,
    };
}

/**
 * Lint a repository's markdown against the shared rule set.
 *
 * {@link MARKDOWNLINT_CONFIG} is passed as markdownlint's `optionsDefault`,
 * which is precisely the "shipped default, consumer overrides" behaviour the
 * command promises: a repository with no configuration of its own gets these
 * rules, and a `.markdownlint-cli2.jsonc` found in the tree overrides them.
 *
 * The override is **key by key, and each key wholesale** — which is not the same
 * as "replaces it", and the difference is the one worth stating. A consumer file
 * declaring only `ignores` keeps this rule set intact, including `default: false`
 * and every per-rule option; but its `ignores` *replaces*
 * {@link MARKDOWN_IGNORES} rather than extending it, so such a file must restate
 * every shared entry it still wants. Omitting `CHANGELOG.md` there silently
 * starts linting a generated file.
 *
 * @param {string} root - Repository to lint.
 * @param {object} [opts]
 * @param {readonly string[]} [opts.paths] - Globs to lint instead of every
 *   markdown file.
 * @param {boolean} [opts.fix=false] - Apply the fixes markdownlint can make.
 * @param {(params: object) => Promise<number>} [opts.run] - The
 *   markdownlint-cli2 entry point, for tests.
 * @returns {Promise<{findings: object[], exitCode: number}>} The findings, and
 *   markdownlint's own exit code.
 */
export async function lintMarkdown(root, opts = {}) {
    const { paths, fix = false } = opts;
    const run = opts.run ?? (await import("markdownlint-cli2")).main;
    const directory = path.resolve(root);

    /** @type {object[]} */
    const collected = [];
    // A formatter is normally a module id resolved from disk, but
    // markdownlint-cli2 passes a non-string through untouched — so the results
    // can be collected in process rather than parsed back out of its output.
    const collect = ({ results }) => {
        collected.push(...results);
    };

    const argv = [...(paths?.length ? paths : MARKDOWN_GLOBS)];
    if (fix) argv.push("--fix");

    const exitCode = await run({
        directory,
        argv,
        optionsDefault: {
            config: MARKDOWNLINT_CONFIG,
            // Generated markdown reports on its generator, not its author, and
            // every consumer already lists its generated trees here.
            gitignore: true,
            ignores: [...MARKDOWN_IGNORES],
            noProgress: true,
            noBanner: true,
        },
        optionsOverride: { outputFormatters: [[collect]] },
        logMessage: () => {},
        logError: () => {},
    });

    return {
        findings: collected.map((result) => toDiagnostic(directory, result)),
        exitCode,
    };
}
