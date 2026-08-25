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
 * How the command line reports what a rule found.
 *
 * The package's rules are pure: they take source text and return findings,
 * leaving discovery, I/O and reporting to whoever called them. That is what
 * makes them testable, but it also means every caller has to decide the same
 * two things — what a finding looks like once emitted, and what a run's exit
 * code should be. Before there was a command line, every consumer decided them
 * separately, and no two agreed.
 *
 * This module is where the binary decides them once. It lives under `bin/`
 * rather than beside the rules deliberately: it is the *caller's* half, not
 * part of the pure surface, and nothing importing this package as a library
 * should reach it.
 *
 * The emitted form is the toolchain's diagnostic contract —
 * `file:line:column: severity: message`, the path starting the line, a field
 * dropped rather than guessed — which `@heroiclands/package-build` already
 * owns. This module maps findings onto it rather than restating it, so the two
 * packages cannot drift into two nearly-identical formats.
 *
 * @module
 */

import { emitDiagnostic } from "../engine/diagnostics.mjs";

/**
 * A finding as the pure rules report one.
 *
 * @typedef {object} Finding
 * @property {string} message                 What is wrong, in one sentence.
 * @property {string} [file]                  The file it is about, when the
 *   rule knows — a rule spanning many files does, and one handed a single
 *   file's text does not.
 * @property {"warning"|"error"} [severity]   Defaults to `error`.
 * @property {number} [line]                  1-based line, when known.
 * @property {number} [column]                1-based column, when known.
 */

/**
 * Turn a rule's findings into diagnostics, attaching the file they are about.
 *
 * A rule is handed source text and never learns the path it came from, so the
 * caller is the only one who can say it — and a finding without a file is one
 * nothing can navigate to.
 *
 * **A field is dropped, never guessed.** A finding that knows no line emits as
 * `file: severity: message`, because defaulting to `1:1` sends a reader to the
 * top of the file every time and reads exactly like a real position. A column
 * without a line is dropped for the same reason: it locates nothing on its own.
 *
 * **Unless the finding names its own.** A rule handed one file's text cannot;
 * a rule handed a whole repository — coverage, which compares the localization
 * file against every source that references it — can name nothing else, since
 * no single path is right for both halves of what it found.
 *
 * @param {Finding[]} findings - What the rule returned.
 * @param {object} opts
 * @param {string} [opts.file] - Path to the file, relative to the working
 *   directory, so the emitted line is one an editor or `cc`-style parser can
 *   open. Optional only for a rule whose every finding carries its own.
 * @returns {Array<{file: string, line?: number, column?: number,
 *   severity: "warning"|"error", message: string}>} The diagnostics, in the
 *   order the rule reported them.
 */
export function toDiagnostics(findings, { file }) {
    return findings.map((finding) => {
        const hasLine = finding.line !== undefined && finding.line !== null;
        const hasColumn =
            finding.column !== undefined && finding.column !== null;
        return {
            file: finding.file ?? file,
            ...(hasLine ? { line: finding.line } : {}),
            // Only alongside a line: `formatLocator` ignores a lone column, and
            // carrying it anyway would invite a reader to trust it.
            ...(hasLine && hasColumn ? { column: finding.column } : {}),
            severity: finding.severity ?? "error",
            message: finding.message,
        };
    });
}

/**
 * Emit a rule's findings and say how many of them fail the run.
 *
 * Warnings are emitted and counted separately from the return value, so a
 * command can report something worth reading without failing a build over it.
 *
 * @param {Finding[]} findings - What the rule returned.
 * @param {object} opts
 * @param {string} [opts.file] - Path to the file, relative to the working dir.
 *   Optional only when every finding carries its own.
 * @param {(d: object) => void} [opts.emit] - How to emit one diagnostic.
 *   Injectable so a test can capture the emitted shape without reaching for
 *   the console; defaults to content-build's `emitDiagnostic`, which writes
 *   both severities to stderr.
 * @returns {number} How many diagnostics were errors — the count a command
 *   turns into its exit code.
 */
export function reportFindings(findings, { file, emit = emitDiagnostic }) {
    const diagnostics = toDiagnostics(findings, { file });
    for (const diagnostic of diagnostics) emit(diagnostic);
    return diagnostics.filter((d) => d.severity === "error").length;
}
