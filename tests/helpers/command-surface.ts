/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The command surface of the `package-build` binary, read from the command
 * modules' source.
 *
 * The binary registers commands from the `bin/*-commands.mjs` modules, each
 * building its yargs tree from `<name>Command()` factory functions. This
 * helper parses those sources and returns every command with its invocation,
 * placeholders, options, choices and subcommands, so every documentation guard
 * works from one inventory.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONTAINER_ACTIONS } from "../../container.mjs";
import { E2E_MODES } from "../../e2e.mjs";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

/** One command parsed from a `<name>Command()` function body. */
export interface CommandNode {
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
 * Build the command tree for one command module: every root `.command(fooCommand())`
 * call that is not textually inside another `*Command()` function's own body,
 * recursively, with each node's own signature/options/positionals/choices.
 *
 * @param source - The command module's full source text.
 */
export function parseCommandTree(source: string): CommandNode[] {
    const bodies = functionBodies(source);

    // Every registered command, including one wrapped by the index preflight.
    const refs = [
        ...source.matchAll(/\.command\(\s*(?:with(?:Index|Body)Preflight\(\s*)*(\w+Command)\(\)/g),
    ].map((m) => ({
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
    // De-duplicate: a root function referenced more than once appears once in
    // the tree.
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
export function flatten(nodes: CommandNode[]): CommandNode[] {
    return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

const PACKAGE_BUILD_SRC = fs.readFileSync(
    path.join(ROOT, "bin/package-build-commands.mjs"),
    "utf8",
);
const CONTENT_COMMANDS_SRC =
    fs.readFileSync(path.join(ROOT, "bin/content-commands.mjs"), "utf8") +
    "\n" +
    fs.readFileSync(path.join(ROOT, "bin/settlement-command.mjs"), "utf8");

export const COMMAND_SOURCES: { binary: string; source: string }[] = [
    {
        binary: "package-build",
        source: fs.readFileSync(path.join(ROOT, "bin/encoding-commands.mjs"), "utf8"),
    },
    { binary: "package-build", source: PACKAGE_BUILD_SRC },
    { binary: "package-build", source: CONTENT_COMMANDS_SRC },
];

/** Every root command tree, tagged with the binary and its full name path. */
export interface TaggedNode {
    binary: string;
    /** e.g. `["content-format", "schema"]`. */
    path: string[];
    node: CommandNode;
}

export function allNodes(): TaggedNode[] {
    const out: TaggedNode[] = [];
    for (const { binary, source } of COMMAND_SOURCES) {
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

/** One command as a documentation guard needs it: invocation text and the words it must contain. */
export interface CommandSurfaceEntry {
    /** The binary the command belongs to, e.g. `package-build`. */
    binary: string;
    /** The full name path, e.g. `["content-format", "schema"]`. */
    path: string[];
    /** The full invocation, e.g. `package-build content-format schema`. */
    invocation: string;
    /** Placeholders of the signature: `<stage>`, `[paths..]`. */
    placeholders: string[];
    /** Option names without the leading dashes. */
    options: string[];
    /** Choice values the command's options and positionals accept. */
    choices: string[];
    /** Full invocations of the direct subcommands. */
    subcommands: string[];
}

/**
 * Every command of the binary, root and nested, depth-first, as the flat
 * inventory a documentation guard iterates.
 *
 * @returns One entry per command.
 */
export function commandSurface(): CommandSurfaceEntry[] {
    return allNodes().map(({ binary, path: nodePath, node }) => ({
        binary,
        path: nodePath,
        invocation: `${binary} ${nodePath.join(" ")}`,
        placeholders: node.placeholders,
        options: node.options,
        choices: node.choices,
        subcommands: node.children.map((child) => `${binary} ${nodePath.join(" ")} ${child.name}`),
    }));
}
