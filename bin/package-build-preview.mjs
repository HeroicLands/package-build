#!/usr/bin/env node
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

/** Render stdin with optional date-only configuration and no content index. */
import { formatDiagnostic } from "../engine/diagnostics.mjs";

const HELP = `Usage: package-build-preview [--dark] [--current-date DATE] [--css]

Read Markdown from stdin and write an HTML fragment to stdout.
No package configuration, content tree or content index is required.

Options:
  --dark       Select the dark palette (default: light).
  --current-date DATE  Override the setting's neutral current date (default: 720.1).
  --css        Write shared scoped CSS instead of HTML; does not read stdin.
  --help, -h   Show this help.

Findings go to stderr. Exit status: 0 for success, 1 for errors.
`;

try {
    let dark = false;
    let css = false;
    let help = false;
    let currentDate;
    const args = process.argv.slice(2);
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === "--dark") dark = true;
        else if (arg === "--current-date") {
            currentDate = args[++index];
            if (!currentDate || currentDate.startsWith("--"))
                throw new Error("--current-date requires a neutral date");
        } else if (arg === "--css") css = true;
        else if (arg === "--help" || arg === "-h") help = true;
        else
            throw new Error(
                `${arg.startsWith("-") ? "Unknown option" : "Unexpected argument"}: ${arg}`,
            );
    }
    if (help) process.stdout.write(HELP);
    else {
        const { renderPreview, previewStyles, readPreviewCurrentDate } =
            await import("../engine/site-preview.mjs");
        const { readStdin } = await import("../engine/read-stdin.mjs");
        if (css) process.stdout.write(`${previewStyles()}\n`);
        else {
            currentDate ??= await readPreviewCurrentDate(process.cwd());
            const result = await renderPreview(await readStdin(), {
                dark,
                file: "<stdin>",
                currentDate,
            });
            for (const finding of result.findings) {
                process.stderr.write(`${formatDiagnostic(finding)}\n`);
            }
            process.stdout.write(result.html);
            if (!result.ok) process.exitCode = 1;
        }
    }
} catch (error) {
    process.stderr.write(`package-build-preview: ${error.message}\n`);
    process.exitCode = 1;
}
