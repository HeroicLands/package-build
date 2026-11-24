/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Runs `texi2any` (Info and split HTML) and `texi2pdf` on a Texinfo manual and
 * reports every warning, so a test can require a manual that builds cleanly.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** The path of a program on `PATH`, or undefined. */
function which(program: string): string | undefined {
    const run = spawnSync("which", [program], { encoding: "utf8" });
    return run.status === 0 ? run.stdout.trim() : undefined;
}

/** The directory holding `texinfo.tex`, or undefined when TeX cannot find one. */
function texinfoTexDir(): string | undefined {
    const known = spawnSync("kpsewhich", ["texinfo.tex"], { encoding: "utf8" });
    if (known.status === 0 && known.stdout.trim()) return path.dirname(known.stdout.trim());
    const roots = ["/opt/homebrew/Cellar", "/usr/share", "/usr/local/share"];
    for (const root of roots) {
        if (!fs.existsSync(root)) continue;
        const stack = [root];
        while (stack.length) {
            const dir = stack.pop() as string;
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isFile() && entry.name === "texinfo.tex") return dir;
                if (
                    entry.isDirectory() &&
                    (dir === root ?
                        /^(?:automake|texinfo)/.test(entry.name)
                    :   !entry.name.startsWith("."))
                )
                    stack.push(full);
            }
        }
    }
    return undefined;
}

/** Why `texi2any` cannot run, or undefined when it can. */
export function texi2anySkip(): string | undefined {
    return which("texi2any") ? undefined : "texi2any is not installed";
}

/** Why `texi2pdf` cannot run, or undefined when it can. */
export function texi2pdfSkip(): string | undefined {
    if (!which("texi2pdf")) return "texi2pdf is not installed";
    if (!which("pdftex")) return "pdftex is not installed";
    if (!texinfoTexDir()) return "no texinfo.tex is installed";
    if (process.env.CI && !hasEpsf()) return "no epsf.tex is installed, and images need it";
    return undefined;
}

/**
 * Skip a test for a missing tool, naming the reason. In CI a missing tool fails
 * the test instead, so the Texinfo builds are never silently unchecked there.
 *
 * @param context - The test context.
 * @param reason - Why the tool is missing, or undefined when it is present.
 */
export function skipUnlessPresent(
    context: { skip: (note?: string) => never },
    reason: string | undefined,
): void {
    if (reason === undefined) return;
    if (process.env.CI) throw new Error(`the Texinfo build tests need a tool CI lacks: ${reason}`);
    context.skip(reason);
}

/** Whether TeX can find `epsf.tex`, which `@image` needs in the printed manual. */
export function hasEpsf(): boolean {
    const run = spawnSync("kpsewhich", ["epsf.tex"], { encoding: "utf8" });
    return run.status === 0 && run.stdout.trim() !== "";
}

/** One problem a Texinfo tool reported. */
export type ToolProblem = string;

/**
 * Build the Info and split HTML output of `master` in `dir`; every line either
 * run prints, and every nonzero exit, is a problem.
 */
export function buildInfoAndHtml(dir: string, master: string): ToolProblem[] {
    const problems: ToolProblem[] = [];
    for (const [name, args] of [
        ["info", ["-o", path.join(dir, "out-info")]],
        ["html", ["--html", "-o", path.join(dir, "out-html")]],
    ] as const) {
        const run = spawnSync("texi2any", [...args, master], {
            cwd: dir,
            encoding: "utf8",
            maxBuffer: 1 << 26,
        });
        if (run.status !== 0) problems.push(`${name}: exit status ${run.status}`);
        for (const text of `${run.stdout}${run.stderr}`.split("\n"))
            if (text.trim()) problems.push(`${name}: ${text}`);
    }
    return problems;
}

/**
 * Build the PDF of `master` in `dir`. The problems are a nonzero exit and the
 * lines of the final TeX log that report an error or a warning: `!` errors,
 * `Warning:` lines, missing characters and undefined references. Typesetting
 * notices such as overfull boxes are not problems.
 */
export function buildPdf(dir: string, master: string): ToolProblem[] {
    const texDir = texinfoTexDir();
    const env = { ...process.env };
    if (texDir) env.TEXINPUTS = `${texDir}${path.delimiter}${env.TEXINPUTS ?? ""}`;
    const run = spawnSync(
        "texi2pdf",
        ["--batch", "--quiet", "--build=local", "-o", path.join(dir, "out.pdf"), master],
        { cwd: dir, encoding: "utf8", env, maxBuffer: 1 << 26 },
    );
    const problems: ToolProblem[] = [];
    if (run.status !== 0) problems.push(`pdf: exit status ${run.status}`);
    const log = path.join(dir, `${path.basename(master, ".texi")}.log`);
    if (fs.existsSync(log)) {
        for (const text of fs.readFileSync(log, "utf8").split("\n"))
            if (
                /^! |^l\.\d+: Warning|Missing character|Undefined control|^\S+\.texi:\d+: |Undefined cross reference/.test(
                    text,
                )
            )
                problems.push(`pdf: ${text}`);
    }
    if (!fs.existsSync(path.join(dir, "out.pdf"))) problems.push("pdf: no PDF was written");
    return problems;
}
