/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The Texinfo manual covers every documentation page exactly once, the
 * documentation converts with nothing unmapped, and the Texinfo tools build the
 * manual without a warning.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { convertDocs, formatFinding, infoText } from "../scripts/docs-texinfo/convert.mjs";
import { resolvePackageBuildConfig } from "../config.mjs";
import { readPackConfig } from "../engine/pack-config.mjs";
import { commandSurface } from "./helpers/command-surface";
import { configurationSurface } from "./helpers/configuration-surface";
import {
    buildInfoAndHtml,
    buildPdf,
    skipUnlessPresent,
    texi2anySkip,
    texi2pdfSkip,
} from "./helpers/texinfo-tools";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DOCS = path.join(ROOT, "docs");

function pages(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry: fs.Dirent) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return pages(full);
        return entry.isFile() && entry.name.endsWith(".md") ?
                [path.relative(DOCS, full).split(path.sep).join("/")]
            :   [];
    });
}

const CONFIGURED = resolvePackageBuildConfig(
    readPackConfig(path.join(ROOT, "package-build.config.yaml")),
).texinfo;

/** Restructured tables are reported and expected; every other finding is a defect. */
const unexpected = (findings: any[]) =>
    findings.filter((f) => !(f.severity === "warning" && f.kind === "restructured"));

describe("the declared manuals", () => {
    it("start at the documentation home", () => {
        expect(CONFIGURED[0].page).toBe("index.md");
    });

    it("take every page under docs/ into the manual", () => {
        const { findings } = convertDocs({ root: ROOT, manuals: CONFIGURED });
        expect(unexpected(findings).map(formatFinding)).toEqual([]);
    });
});

describe("the documentation as a manual", () => {
    const result = convertDocs({ root: ROOT, manuals: CONFIGURED });
    const { findings } = result;
    const manual = result.manuals[0];
    const texinfo = `${manual.texinfo}\n${manual.chapters.map((c: any) => c.texinfo).join("\n")}`;

    it("converts with no unmapped construct", () => {
        expect(unexpected(findings).map(formatFinding)).toEqual([]);
    });

    it("has one node per page but the top page, and its metadata from package.json", () => {
        const nodes = [...texinfo.matchAll(/^@node (.+)$/gm)].map((m) => m[1]);
        const indexNodes = [
            "Top",
            "Concept Index",
            "Reference Index",
            "Variable Index",
            "Program Index",
            "Command Index",
            "Option Index",
            "Configuration Key Index",
            "API Index",
        ];
        expect(nodes.filter((name) => !indexNodes.includes(name))).toHaveLength(
            pages(DOCS).length - 1,
        );
        const version = JSON.parse(
            fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
        ).version;
        expect(manual.texinfo).toContain(`@set VERSION ${version}\n`);
        expect(manual.texinfo).toContain("@dircategory HeroicLands\n");
        expect(manual.chapters.length).toBeGreaterThan(10);
    });

    it("declares every node it refers to", () => {
        const declared = new Set(
            [...texinfo.matchAll(/^@node (.+)$|^@anchor\{(.+)\}$/gm)].map((m) => m[1] ?? m[2]),
        );
        const referenced = [...texinfo.matchAll(/@(?:x|px)?ref\{((?:[^,{}@]|@.)+?)(?:,|\})/g)].map(
            (m) => m[1],
        );
        expect(referenced.filter((name) => !declared.has(name))).toEqual([]);
    });

    it("gives Info no period in a node name and no colon in a reference label", () => {
        // makeinfo warns on both, and an Info reader ends the reference there.
        const named = [...texinfo.matchAll(/^@node (.+)$|^@anchor\{(.+)\}$/gm)].map(
            (m) => m[1] ?? m[2],
        );
        expect(named.filter((name) => /[.,:()]/.test(name))).toEqual([]);
        const labels = [
            ...texinfo.matchAll(/@x?ref\{(?:[^,{}@]|@.)+?,,((?:[^{}]|\{[^{}]*\})*)\}/g),
        ].map((m) => m[1]);
        expect(labels.filter((label) => label.includes(":"))).toEqual([]);
        expect(texinfo).not.toMatch(/@strong\{note\s/i);
    });

    it("makes no multitable column narrower than its longest word", () => {
        const tables = [
            ...texinfo.matchAll(/@multitable @columnfractions (.+)\n([\s\S]*?)@end multitable/g),
        ];
        expect(tables.length).toBeGreaterThan(0);
        const narrow = tables.flatMap(([, fractions, body]) => {
            const sizes = fractions.split(" ").map((f) => Math.round(Number(f) * 72));
            return body
                .split(/\n@(?:item|headitem) /)
                .flatMap((row) =>
                    row
                        .replace(/^@(?:item|headitem) /, "")
                        .split(" @tab ")
                        .map((cell, i) => ({ cell, size: sizes[i] })),
                )
                .filter(({ cell, size }) =>
                    infoText(cell)
                        .split(/[ \t\n]+/)
                        .some((word) => [...word].length + 2 > size),
                );
        });
        expect(narrow).toEqual([]);
    });

    describe("builds with the Texinfo tools and no warning", () => {
        const materialize = () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), "texinfo-docs-"));
            fs.writeFileSync(path.join(dir, `${manual.out}.texi`), manual.texinfo);
            fs.mkdirSync(path.join(dir, `${manual.out}-chapters`));
            for (const chapter of manual.chapters)
                fs.writeFileSync(path.join(dir, chapter.path), chapter.texinfo);
            return dir;
        };

        it("texi2any writes Info and HTML", (context) => {
            skipUnlessPresent(context, texi2anySkip());
            const dir = materialize();
            try {
                expect(buildInfoAndHtml(dir, `${manual.out}.texi`)).toEqual([]);
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }, 120_000);

        it("texi2pdf writes a PDF", (context) => {
            skipUnlessPresent(context, texi2pdfSkip());
            const dir = materialize();
            try {
                expect(buildPdf(dir, `${manual.out}.texi`)).toEqual([]);
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }, 600_000);
    });
});

// The guard converts the real documentation and imports every export surface,
// so it lives with the other tests that convert the real docs rather than with
// the fixture-based converter tests.
describe("the indexes hold the real surface", () => {
    const result = convertDocs({ root: ROOT, manuals: CONFIGURED });
    const manual = result.manuals[0];
    const texinfo = `${manual.texinfo}\n${manual.chapters.map((c: any) => c.texinfo).join("\n")}`;

    /** The entries of one index, by the command that fills it. */
    const entries = (command: string) =>
        new Set(
            [...texinfo.matchAll(new RegExp(`^@${command} (.+)$`, "gm"))].map((m) =>
                (command === "opindex" ? m[1].replace(/@option\{([^}]*)\}/g, "$1") : m[1]).replace(
                    /@([@{}])/g,
                    "$1",
                ),
            ),
        );

    const commands = entries("cmindex");
    const options = entries("opindex");
    const keys = entries("ckindex");
    const api = entries("apindex");
    const surface = commandSurface();

    it("reads inventories worth checking", () => {
        // Guards the guard: an empty inventory would let every check pass.
        expect(surface.length).toBeGreaterThan(40);
        expect(surface.some((entry) => entry.options.length > 0)).toBe(true);
        expect(configurationSurface().length).toBeGreaterThan(100);
    });

    /** Whether a command entry or an entry beneath it is in a set. */
    const covered = (invocation: string, indexed: Set<string>) =>
        [...indexed].some((name) => name === invocation || name.startsWith(`${invocation} `));

    it("has a command index entry for every command", () => {
        // A command that takes an action has a section for each action, and
        // those sections carry its entries.
        const missing = surface
            .map((entry) => entry.invocation)
            .filter((name) => !covered(name, commands));
        expect(missing).toEqual([]);
    });

    it("has an option index entry for every option of every command", () => {
        // An option of a command that takes an action is documented in the
        // section of the action that takes it.
        const missing = surface.flatMap((entry) =>
            entry.options
                .filter(
                    (option) =>
                        ![...options].some((name) => {
                            const [flag, command] = name.split(" @subentry ");
                            return (
                                flag === `--${option}` &&
                                (command === entry.invocation ||
                                    command.startsWith(`${entry.invocation} `))
                            );
                        }),
                )
                .map((option) => `${entry.invocation} --${option}`),
        );
        expect(missing).toEqual([]);
    });

    it("has a configuration key index entry for every configuration key", () => {
        expect(
            configurationSurface()
                .map((key) => key.path)
                .filter((name) => !keys.has(name)),
        ).toEqual([]);
    });

    it("has an API index entry for every export of every subpath entry", async () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
        const subpaths = Object.keys(pkg.exports).filter(
            (entry) => !entry.endsWith("*") && entry !== "./package.json",
        );
        const interop = new Set(["default", "module.exports"]);
        const missing: string[] = [];
        for (const subpath of subpaths) {
            const specifier =
                subpath === "." ?
                    "@heroiclands/package-build"
                :   `@heroiclands/package-build/${subpath.slice(2)}`;
            const mod: Record<string, unknown> = await import(specifier);
            for (const [name, value] of Object.entries(mod)) {
                if (interop.has(name)) continue;
                if (!api.has(name) && !api.has(`${subpath.slice(2)}.${name}`))
                    missing.push(`${subpath} ${name}`);
                if (Object.prototype.toString.call(value) === "[object Module]")
                    for (const member of Object.keys(value as object))
                        if (!api.has(member) && !api.has(`${name}.${member}`))
                            missing.push(`${subpath} ${name}.${member}`);
            }
        }
        expect(missing).toEqual([]);
    }, 120_000);

    const DOCUMENTED_WILDCARD_MODULES = new Set(
        [
            "see-also",
            "content-sources",
            "first-use",
            "name-markup",
            "name-rows",
            "names",
            "markup-validation",
        ].map((name) => `engine/${name}`),
    );

    it("has an API index entry for every export of every documented wildcard module", async () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
        const missing: string[] = [];
        let checked = 0;
        for (const subpath of Object.keys(pkg.exports).filter((entry) => entry.endsWith("/*"))) {
            const dir = subpath.slice(2, -2);
            // The wildcard modules whose exports the API reference documents.
            const modules = fs
                .readdirSync(path.join(ROOT, dir))
                .filter((file) => DOCUMENTED_WILDCARD_MODULES.has(`${dir}/${file.slice(0, -4)}`));
            checked += modules.length;
            for (const file of modules) {
                const name = file.slice(0, -4);
                const mod: Record<string, unknown> = await import(
                    `@heroiclands/package-build/${dir}/${name}`
                );
                for (const exported of Object.keys(mod))
                    if (!api.has(exported) && !api.has(`${dir}.${exported}`))
                        missing.push(`${dir}/${name} ${exported}`);
            }
        }
        expect(checked).toBeGreaterThan(0);
        expect(missing).toEqual([]);
    }, 300_000);

    it("has a concept index entry for every heading", () => {
        const concepts = entries("cindex");
        const headings = [
            ...texinfo.matchAll(
                /^@(?:chapter|section|subsection|subsubsection|heading|subheading|subsubheading) (.+)$/gm,
            ),
        ].map((m) =>
            m[1]
                .replace(/@([@{}])/g, "$1")
                .replace(/\u2014/g, "---")
                .replace(/\u2013/g, "--"),
        );
        expect(headings.length).toBeGreaterThan(100);
        expect(headings.filter((name) => !concepts.has(name))).toEqual([]);
    });

    it("prints every index it fills", () => {
        for (const code of ["cp", "cm", "op", "ck", "ap"])
            expect(manual.texinfo).toContain(`@printindex ${code}\n`);
    });
});

/** The findings a CLI run printed, as objects. */
function parseLines(stderr: string) {
    return stderr
        .split("\n")
        .filter(Boolean)
        .map((text) => ({
            text,
            severity: /: (error|warning): /.exec(text)?.[1],
            kind: /too wide for its columns/.test(text) ? "restructured" : "other",
        }));
}

describe("node scripts/docs-texinfo.mjs", () => {
    it("writes the manuals and the Info dir file where --out names", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-texinfo-"));
        try {
            const out = dir;
            const run = spawnSync(process.execPath, ["scripts/docs-texinfo.mjs", "--out", out], {
                cwd: ROOT,
                encoding: "utf8",
                env: { ...process.env, SOURCE_DATE_EPOCH: "1700000000" },
            });
            expect(run.status).toBe(0);
            expect(unexpected(parseLines(run.stderr))).toEqual([]);
            expect(
                fs
                    .readFileSync(path.join(out, "package-build.texi"), "utf8")
                    .startsWith("\\input texinfo "),
            ).toBe(true);
            expect(fs.readFileSync(path.join(out, "dir"), "utf8")).toContain("(package-build)");
            expect(fs.readdirSync(path.join(out, "package-build-chapters")).length).toBeGreaterThan(
                10,
            );
            expect(fs.existsSync(path.join(out, "package-build.report.txt"))).toBe(true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }, 120_000);

    it("writes a dir file Info reads: a node separator, then the Top node", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-texinfo-"));
        try {
            const run = spawnSync(process.execPath, ["scripts/docs-texinfo.mjs", "--out", dir], {
                cwd: ROOT,
                encoding: "utf8",
            });
            expect(run.status).toBe(0);
            const bytes = fs.readFileSync(path.join(dir, "dir"));
            const text = bytes.toString("latin1");
            expect(bytes.filter((b) => b === 0x1f).length).toBe(1);
            expect(text).toMatch(/\n\x1f\nFile: dir,\tNode: Top\t[^\n]*\n\n\* Menu:\n/);
            expect(text.indexOf("\x1f")).toBeLessThan(text.indexOf("* Menu:"));

            const info = spawnSync("info", ["-d", dir, "-o", "-", "(dir)"], {
                encoding: "utf8",
                env: { ...process.env, INFOPATH: "" },
            });
            if (!info.error && info.status === 0) {
                expect(info.stdout).toContain("(package-build)");
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }, 120_000);

    describe("with a configuration it cannot accept", () => {
        const run = (config: string, docs: Record<string, string> = { "index.md": "# T\n" }) => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-texinfo-root-"));
            try {
                fs.mkdirSync(path.join(root, "docs"));
                fs.writeFileSync(path.join(root, "package.json"), '{"name":"p","version":"1.0.0"}');
                fs.writeFileSync(path.join(root, "package-build.config.yaml"), config);
                for (const [name, body] of Object.entries(docs))
                    fs.writeFileSync(path.join(root, "docs", name), body);
                return spawnSync(
                    process.execPath,
                    [path.join(ROOT, "scripts/docs-texinfo.mjs"), "--root", root, "--check"],
                    { cwd: root, encoding: "utf8" },
                );
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        };

        it("positions a bad entry, exits 1 and prints no stack trace", () => {
            const result = run(
                "contentPackage: p\npackageKind: documentation\nauthors:\n  - name: A\npackageBuild:\n  texinfo:\n    - page: ../index.md\n",
            );
            expect(result.status).toBe(1);
            expect(result.stderr).toMatch(
                /^package-build\.config\.yaml:7:\d+: error: .*packageBuild\.texinfo\[0\]\.page/m,
            );
            expect(result.stderr).not.toMatch(/\n\s+at /);
        });

        it("positions an empty list at the configuration file", () => {
            const result = run(
                "contentPackage: p\npackageKind: documentation\nauthors:\n  - name: A\npackageBuild:\n  texinfo: []\n",
            );
            expect(result.status).toBe(1);
            expect(result.stderr).toMatch(
                /^package-build\.config\.yaml:1:1: error: packageBuild\.texinfo declares no manual/m,
            );
        });
    });

    it("prints its usage, options, and exit status for --help", () => {
        const run = spawnSync(process.execPath, ["scripts/docs-texinfo.mjs", "--help"], {
            cwd: ROOT,
            encoding: "utf8",
        });
        expect(run.status).toBe(0);
        for (const text of [
            "usage: node scripts/docs-texinfo.mjs",
            "--root <dir>",
            "--out <dir>",
            "--check",
            "Exit status:",
        ])
            expect(run.stdout).toContain(text);
    });

    it("refuses an unknown option", () => {
        const run = spawnSync(process.execPath, ["scripts/docs-texinfo.mjs", "--nope"], {
            cwd: ROOT,
            encoding: "utf8",
        });
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("usage: node scripts/docs-texinfo.mjs");
    });
});
