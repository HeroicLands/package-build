/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `docs/commands.md` documents the real command surface, not a hand-kept
 * transcription of it.
 *
 * The CLI registers commands from `bin/package-build-commands.mjs` and
 * `bin/content-commands.mjs`. Both build their yargs command trees from `<name>Command()` factory functions, each
 * returning a `{ command, describe, builder, handler }` module. This file
 * parses both sources directly: it locates every `*Command()` function body by
 * brace-matching, finds which of them are wired as root commands versus nested
 * subcommands (a `.command(fooCommand())` call, possibly with validation preflights,
 * that falls textually inside
 * another `*Command()` function's own body is that command's child — this is
 * how `content-format` gets `schema` / `fields` and everywhere else
 * does not), then reads each body's own `command:` signature, `.positional(`
 * names, `.option(` names, and `choices:` values.
 *
 * Two choice lists are not string literals in the source — `container`'s
 * action list is `CONTAINER_ACTIONS` from `container.mjs` and `e2e`'s is built
 * from `E2E_MODES` in `e2e.mjs` — so those two are read by importing the real
 * constants rather than guessed.
 *
 * What "documented" means, mechanically: the full invocation path
 * (`` `package-build clean` ``, `` `package-build content-format schema` ``)
 * appears verbatim; every bracketed or angled placeholder in the command
 * signature (`<stage>`, `[paths..]`) appears verbatim; every option appears as
 * `` `--name` ``; every choice value appears backtick-quoted. None of this
 * checks the prose is *correct* — only that nothing enumerable from the
 * command modules is missing from the page a developer reads instead of `--help`.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { COMMAND_SOURCES, allNodes, flatten, parseCommandTree } from "./helpers/command-surface.js";
import { SUBPROCESS_TEST_TIMEOUT, subprocessTimeout } from "./subprocess-timeout.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DOC_PATH = path.join(ROOT, "docs", "commands.md");

const nodes = allNodes();
const doc = fs.readFileSync(DOC_PATH, "utf8");

describe("the command's real surface, extracted from source", () => {
    it("has 46 top-level commands", () => {
        const topLevel = nodes.filter((n) => n.path.length === 1);
        expect(topLevel.map((n) => `${n.binary} ${n.path.join(" ")}`).sort()).toHaveLength(46);
    });

    it("includes `package-build site-root`", () => {
        expect(
            nodes.some((n) => n.binary === "package-build" && n.path.join(" ") === "site-root"),
        ).toBe(true);
    });

    it("includes `package-build pdf`", () => {
        expect(nodes.some((n) => n.binary === "package-build" && n.path.join(" ") === "pdf")).toBe(
            true,
        );
    });

    it(
        "lists every top-level command in root help",
        () => {
            const help = execFileSync(
                process.execPath,
                [path.join(ROOT, "bin/package-build.mjs"), "--help"],
                {
                    encoding: "utf8",
                },
            );
            for (const node of nodes.filter((entry) => entry.path.length === 1)) {
                expect(help).toContain(`package-build ${node.path[0]}`);
            }
            expect(help).toContain("package-build <command> --help");
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    const commandHelp = (command: string) =>
        execFileSync(
            process.execPath,
            [path.join(ROOT, "bin/package-build.mjs"), command, "--help"],
            {
                encoding: "utf8",
            },
        );

    it(
        "shows package actions in command help",
        () => {
            const help = commandHelp("package");
            expect(help).toContain("compile");
            expect(help).toContain("unpack");
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "shows content build and dependency fetch options in command help",
        () => {
            expect(
                nodes.some((entry) => entry.binary === "package-build" && entry.path[0] === "art"),
            ).toBe(false);
            const buildHelp = execFileSync(
                process.execPath,
                [path.join(ROOT, "bin/package-build.mjs"), "content", "build", "--help"],
                { encoding: "utf8" },
            );
            expect(buildHelp).toContain("package-build content build");
            expect(buildHelp).toContain("--calendaria-version");
            const depsHelp = commandHelp("deps");
            expect(depsHelp).toContain("package-build deps <action>");
            expect(depsHelp).toContain("fetch");
            expect(depsHelp).toContain("--from");
            expect(depsHelp).toContain("--id");
        },
        subprocessTimeout(4),
    );

    it(
        "shows documentation actions in command help",
        () => {
            expect(commandHelp("docs")).toContain("item-fields");
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "shows PDF options in command help",
        () => {
            const help = commandHelp("pdf");
            expect(help).toContain("--book-version");
            expect(help).toMatch(/--book\s/);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    // A representative sample of the parse itself, independent of the
    // document — if this drifts, the parser is wrong, not the document.
    it("finds content-format's two actions nested under it", () => {
        const names = nodes
            .filter((n) => n.binary === "package-build" && n.path[0] === "content-format")
            .map((n) => n.path.join(" "));
        expect(names.sort()).toEqual(
            ["content-format", "content-format fields", "content-format schema"].sort(),
        );
    });
});

describe("docs/commands.md documents every command, action and option", () => {
    for (const { binary, path: cmdPath, node } of nodes) {
        const invocation = `${binary} ${cmdPath.join(" ")}`;

        it(`names \`${invocation}\``, () => {
            // Not required to stand alone in its own backtick span — a
            // heading like `` `package-build lang <action>` `` carries the
            // invocation as a substring of a longer signature, which is a
            // perfectly good place to name a command. What matters is that
            // the exact invocation text is there to find.
            expect(doc.includes(invocation)).toBe(true);
        });

        for (const placeholder of node.placeholders) {
            it(`\`${invocation}\` — states its ${placeholder} placeholder`, () => {
                expect(doc.includes(placeholder)).toBe(true);
            });
        }

        for (const option of node.options) {
            it(`\`${invocation}\` — documents \`--${option}\``, () => {
                expect(doc.includes(`\`--${option}\``)).toBe(true);
            });
        }

        for (const choice of node.choices) {
            it(`\`${invocation}\` — names the \`${choice}\` action`, () => {
                expect(doc.includes(`\`${choice}\``)).toBe(true);
            });
        }
    }
});

describe("the five options named nowhere before this document", () => {
    const required = ["coverage", "fields", "id", "references", "root"];
    for (const name of required) {
        it(`documents \`--${name}\``, () => {
            expect(doc.includes(`\`--${name}\``)).toBe(true);
        });
    }
});

describe("guard sanity: the parse is not vacuous", () => {
    it("found at least one option and one choice value in the real surface", () => {
        const flat = flatten(COMMAND_SOURCES.flatMap(({ source }) => parseCommandTree(source)));
        expect(flat.some((n) => n.options.length > 0)).toBe(true);
        expect(flat.some((n) => n.choices.length > 0)).toBe(true);
    });
});

/**
 * `docs/commands.md` reads as a manual page: every `### \`...\`` heading is one
 * invocable command's own entry, carrying seven bold labels — NAME, SYNOPSIS,
 * DESCRIPTION, OPTIONS, EXIT STATUS, EXAMPLES, SEE ALSO — in that order. This
 * is a shape guard over the document itself, independent of `parseCommandTree`:
 * a `### ` heading is a command section whether or not the binaries wire its
 * action as a nested yargs command (`content-format schema` is; `lang coverage`
 * is a choice of one positional, not its own command module, and still gets a
 * full section). Checking document shape this way, rather than by walking the
 * source tree's nodes, is what lets one source command legitimately expand into
 * several manual-page entries without the guard needing a special case for it.
 */
const SEVEN_LABELS = [
    "NAME",
    "SYNOPSIS",
    "DESCRIPTION",
    "OPTIONS",
    "EXIT STATUS",
    "EXAMPLES",
    "SEE ALSO",
];

interface DocSection {
    /** The heading text, backticks included — e.g. `` `package-build clean` ``. */
    heading: string;
    /** Everything between this heading and the next `#`/`##`/`###` heading. */
    body: string;
}

/**
 * Every `### ...` command section in a markdown document, heading paired with
 * body. A `#` line inside a code fence is the example's text, not a heading.
 */
function commandSections(source: string): DocSection[] {
    const sections: DocSection[] = [];
    let current: DocSection | null = null;
    let fenced = false;
    for (const line of source.split("\n")) {
        if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced;
        if (fenced || /^\s*(?:```|~~~)/.test(line)) {
            if (current) current.body += line + "\n";
            continue;
        }
        const h3 = line.match(/^### (.+)$/);
        if (h3) {
            if (current) sections.push(current);
            current = { heading: h3[1], body: "" };
            continue;
        }
        if (/^#{1,2} /.test(line)) {
            if (current) sections.push(current);
            current = null;
            continue;
        }
        if (current) current.body += line + "\n";
    }
    if (current) sections.push(current);
    return sections;
}

describe("every command section in docs/commands.md carries all seven labels, in order", () => {
    const sections = commandSections(doc);

    it("found at least one command section", () => {
        expect(sections.length).toBeGreaterThan(0);
    });

    for (const { heading, body } of sections) {
        it(`\`${heading}\` names NAME, SYNOPSIS, DESCRIPTION, OPTIONS, EXIT STATUS, EXAMPLES, SEE ALSO in order`, () => {
            const positions = SEVEN_LABELS.map((label) => {
                const marker = `**${label}**`;
                const index = body.indexOf(marker);
                expect(index, `${heading} is missing the ${marker} label`).toBeGreaterThanOrEqual(
                    0,
                );
                return index;
            });
            for (let i = 1; i < positions.length; i++) {
                expect(
                    positions[i],
                    `${heading}: ${SEVEN_LABELS[i]} must appear after ${SEVEN_LABELS[i - 1]}`,
                ).toBeGreaterThan(positions[i - 1]);
            }
        });
    }
});
