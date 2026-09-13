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
 * The two binaries — `bin/package-build.mjs`, `bin/content-build.mjs` — build
 * their yargs command trees from `<name>Command()` factory functions, each
 * returning a `{ command, describe, builder, handler }` module. This file
 * parses both sources directly: it locates every `*Command()` function body by
 * brace-matching, finds which of them are wired as root commands versus nested
 * subcommands (a `.command(fooCommand())` call that falls textually inside
 * another `*Command()` function's own body is that command's child — this is
 * how `content-format` gets `schema` / `fields` / `notes` and everywhere else
 * does not), then reads each body's own `command:` signature, `.positional(`
 * names, `.option(` names, and `choices:` values.
 *
 * Two choice lists are not string literals in the source — `container`'s
 * action list is `CONTAINER_ACTIONS` from `container.mjs` and `e2e`'s is built
 * from `E2E_MODES` in `e2e.mjs` — so those two are read by importing the real
 * constants rather than guessed.
 *
 * What "documented" means, mechanically: the full invocation path
 * (`` `package-build clean` ``, `` `content-build content-format schema` ``)
 * appears verbatim; every bracketed or angled placeholder in the command
 * signature (`<stage>`, `[paths..]`) appears verbatim; every option appears as
 * `` `--name` ``; every choice value appears backtick-quoted. None of this
 * checks the prose is *correct* — only that nothing enumerable from the
 * binaries is missing from the page a developer reads instead of `--help`.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONTAINER_ACTIONS } from "../container.mjs";
import { E2E_MODES } from "../e2e.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DOC_PATH = path.join(ROOT, "docs", "commands.md");

interface CommandNode {
    /** The `<name>Command` function this node was parsed from. */
    fnName: string;
    /** The literal `command: "..."` value from this function's own body. */
    signature: string;
    /** `command`'s leading word — `"yaml"` out of `"yaml [paths..]"`. */
    name: string;
    options: string[];
    positionals: string[];
    /** Placeholders read straight off the signature: `<stage>`, `[paths..]`. */
    placeholders: string[];
    choices: string[];
    children: CommandNode[];
}

/**
 * The end index of the `{ ... }` block opening at `openBraceIndex`.
 *
 * @param source - The full file text.
 * @param openBraceIndex - Index of the opening `{`.
 * @returns Index one past the matching closing `}`.
 */
function matchBrace(source: string, openBraceIndex: number): number {
    let depth = 0;
    for (let i = openBraceIndex; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") {
            depth--;
            if (depth === 0) return i + 1;
        }
    }
    throw new Error(`unbalanced braces from index ${openBraceIndex}`);
}

/** Every `function <name>Command() { ... }` body, keyed by function name. */
function functionBodies(source: string): Map<string, { start: number; end: number; body: string }> {
    const bodies = new Map<string, { start: number; end: number; body: string }>();
    const fnPattern = /function\s+(\w+Command)\s*\(\s*\)\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = fnPattern.exec(source))) {
        const openBrace = m.index + m[0].length - 1;
        const end = matchBrace(source, openBrace);
        bodies.set(m[1], { start: openBrace, end, body: source.slice(openBrace + 1, end - 1) });
    }
    return bodies;
}

/** The leading word of a yargs command signature: `"yaml [paths..]"` → `"yaml"`. */
function leadingWord(signature: string): string {
    const word = signature.match(/^\S+/);
    if (!word) throw new Error(`command signature "${signature}" has no leading word`);
    return word[0];
}

/** Every `<name>` / `[name]` / `[name..]` placeholder in a command signature. */
function placeholdersOf(signature: string): string[] {
    return [...signature.matchAll(/<\w+>|\[\w+(?:\.\.)?\]/g)].map((m) => m[0]);
}

/** Choice values a `choices:` array or a known dynamic list resolves to. */
function choicesIn(body: string): string[] {
    const values: string[] = [];
    for (const arr of body.matchAll(/choices:\s*\[([^\]]*)\]/g)) {
        for (const s of arr[1].matchAll(/["']([^"']+)["']/g)) values.push(s[1]);
    }
    if (/choices:\s*\[\.\.\.CONTAINER_ACTIONS\]/.test(body)) values.push(...CONTAINER_ACTIONS);
    if (/choices:\s*E2E_ACTIONS/.test(body)) {
        values.push("seed", ...E2E_MODES, "fast", "sweep");
    }
    return values;
}

/**
 * Build the command tree for one binary: every root `.command(fooCommand())`
 * call that is not textually inside another `*Command()` function's own body,
 * recursively, with each node's own signature/options/positionals/choices.
 *
 * @param source - The binary's full source text.
 */
function parseCommandTree(source: string): CommandNode[] {
    const bodies = functionBodies(source);

    // Every `.command(xCommand())` reference in the file, wherever it sits.
    const refs = [...source.matchAll(/\.command\(\s*(\w+Command)\(\)\s*\)/g)].map((m) => ({
        fnName: m[1],
        index: m.index,
    }));

    /** The innermost `*Command()` body a source index falls inside, if any. */
    function enclosingFn(index: number): string | undefined {
        let best: { fnName: string; span: number } | undefined;
        for (const [fnName, { start, end }] of bodies) {
            if (index > start && index < end) {
                const span = end - start;
                if (!best || span < best.span) best = { fnName, span };
            }
        }
        return best?.fnName;
    }

    function buildNode(fnName: string): CommandNode {
        const entry = bodies.get(fnName);
        if (!entry) throw new Error(`no function body found for ${fnName}`);
        const { body } = entry;
        const sigMatch = body.match(/command:\s*["']([^"']+)["']/);
        if (!sigMatch) throw new Error(`${fnName} declares no "command:" signature`);
        const signature = sigMatch[1];
        const options = [...body.matchAll(/\.option\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
        const positionals = [...body.matchAll(/\.positional\(\s*["']([^"']+)["']/g)].map(
            (m) => m[1],
        );
        const children = refs
            .filter((r) => enclosingFn(r.index) === fnName)
            .map((r) => buildNode(r.fnName));
        return {
            fnName,
            signature,
            name: leadingWord(signature),
            options,
            positionals,
            placeholders: placeholdersOf(signature),
            choices: choicesIn(body),
            children,
        };
    }

    const roots = refs.filter((r) => enclosingFn(r.index) === undefined);
    // De-duplicate: each root function is wired exactly once in a real chain,
    // but the filter above is defensive against a future second reference.
    const seen = new Set<string>();
    const tree: CommandNode[] = [];
    for (const r of roots) {
        if (seen.has(r.fnName)) continue;
        seen.add(r.fnName);
        tree.push(buildNode(r.fnName));
    }
    return tree;
}

/** Every node in a tree, root and nested alike, depth-first. */
function flatten(nodes: CommandNode[]): CommandNode[] {
    return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

const PACKAGE_BUILD_SRC = fs.readFileSync(path.join(ROOT, "bin/package-build.mjs"), "utf8");
const CONTENT_BUILD_SRC = fs.readFileSync(path.join(ROOT, "bin/content-build.mjs"), "utf8");

const BINARIES: { binary: string; source: string }[] = [
    { binary: "package-build", source: PACKAGE_BUILD_SRC },
    { binary: "content-build", source: CONTENT_BUILD_SRC },
];

/** Every root command tree, tagged with the binary and its full name path. */
interface TaggedNode {
    binary: string;
    /** e.g. `["content-format", "schema"]`. */
    path: string[];
    node: CommandNode;
}

function allNodes(): TaggedNode[] {
    const out: TaggedNode[] = [];
    for (const { binary, source } of BINARIES) {
        const roots = parseCommandTree(source);
        const walk = (node: CommandNode, prefix: string[]) => {
            const nodePath = [...prefix, node.name];
            out.push({ binary, path: nodePath, node });
            for (const child of node.children) walk(child, nodePath);
        };
        for (const root of roots) walk(root, []);
    }
    return out;
}

const nodes = allNodes();
const doc = fs.readFileSync(DOC_PATH, "utf8");

describe("the two binaries' real command surface, extracted from source", () => {
    it("has 25 top-level commands", () => {
        const topLevel = nodes.filter((n) => n.path.length === 1);
        expect(topLevel.map((n) => `${n.binary} ${n.path.join(" ")}`).sort()).toHaveLength(25);
    });

    it("includes `content-build pdf`", () => {
        expect(nodes.some((n) => n.binary === "content-build" && n.path.join(" ") === "pdf")).toBe(
            true,
        );
    });

    // A representative sample of the parse itself, independent of the
    // document — if this drifts, the parser is wrong, not the document.
    it("finds content-format's three actions nested under it", () => {
        const names = nodes
            .filter((n) => n.binary === "content-build" && n.path[0] === "content-format")
            .map((n) => n.path.join(" "));
        expect(names.sort()).toEqual(
            [
                "content-format",
                "content-format fields",
                "content-format notes",
                "content-format schema",
            ].sort(),
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

describe("the seven options named nowhere before this document", () => {
    const required = ["coverage", "doc", "fields", "id", "references", "registry", "root"];
    for (const name of required) {
        it(`documents \`--${name}\``, () => {
            expect(doc.includes(`\`--${name}\``)).toBe(true);
        });
    }
});

describe("guard sanity: the parse is not vacuous", () => {
    it("found at least one option and one choice value in the real surface", () => {
        const flat = flatten(BINARIES.flatMap(({ source }) => parseCommandTree(source)));
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

/** Every `### ...` command section in a markdown document, heading paired with body. */
function commandSections(source: string): DocSection[] {
    const sections: DocSection[] = [];
    let current: DocSection | null = null;
    for (const line of source.split("\n")) {
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
