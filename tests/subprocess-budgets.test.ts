/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * `SUBPROCESS_TEST_TIMEOUT` budgets one spawn. This guard reads every
 * `tests/*.test.ts` and fails, with `file:line`, on a test that gives the bare
 * constant while spawning more than once or spawning inside a loop, and on a
 * test that gives a numeric literal below `SUBPROCESS_TEST_TIMEOUT` times its
 * spawn count. Those use `subprocessTimeout(n)`; a literal at or above that
 * budget, or on a test that never spawns, passes.
 *
 * Spawning calls are `spawnSync`, `execFileSync`, `spawn` and `execFile`, plus
 * every function declared in the same file whose body calls a spawning call or
 * another such function. The wrappers are derived from the file's own source.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SUBPROCESS_TEST_TIMEOUT } from "./subprocess-timeout.js";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const NATIVE_SPAWNS = ["spawnSync", "execFileSync", "spawn", "execFile"];
const LOOP_CALLBACKS = ["forEach", "map", "flatMap", "filter", "some", "every", "reduce"];

/**
 * Replaces comments and the text of string and template literals with spaces,
 * keeping offsets and newlines, so structural scans see only code. The
 * expressions inside a template's `${}` stay as code.
 */
function mask(src: string): string {
    const out = src.split("");
    const blank = (from: number, to: number) => {
        for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
    };
    // Each entry is the brace depth at which a template literal's `${` opened.
    const templates: number[] = [];
    let depth = 0;
    let i = 0;
    /** Blanks template text from `from` to the next `${` or closing backtick. */
    const template = (from: number): number => {
        let j = from;
        while (j < src.length && src[j] !== "`" && !(src[j] === "$" && src[j + 1] === "{")) {
            j += src[j] === "\\" ? 2 : 1;
        }
        blank(from, j);
        if (src[j] === "$") {
            templates.push(depth);
            depth++;
            return j + 2;
        }
        return j + 1;
    };
    while (i < src.length) {
        const c = src[i];
        const n = src[i + 1];
        if (c === "/" && n === "/") {
            const end = src.indexOf("\n", i);
            const stop = end === -1 ? src.length : end;
            blank(i, stop);
            i = stop;
        } else if (c === "/" && n === "*") {
            const end = src.indexOf("*/", i + 2);
            const stop = end === -1 ? src.length : end + 2;
            blank(i, stop);
            i = stop;
        } else if (c === '"' || c === "'") {
            let j = i + 1;
            while (j < src.length && src[j] !== c && src[j] !== "\n") {
                j += src[j] === "\\" ? 2 : 1;
            }
            blank(i + 1, j);
            i = j + 1;
        } else if (c === "`") {
            i = template(i + 1);
        } else if (c === "{") {
            depth++;
            i++;
        } else if (c === "}") {
            depth--;
            i =
                templates.length && templates[templates.length - 1] === depth ?
                    (templates.pop(), template(i + 1))
                :   i + 1;
        } else {
            i++;
        }
    }
    return out.join("");
}

/** The offset of the bracket closing the one at `open`, or -1. */
function matchClose(code: string, open: number): number {
    const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
    let depth = 0;
    for (let i = open; i < code.length; i++) {
        const c = code[i];
        if ("({[".includes(c)) depth++;
        else if (")}]".includes(c) && --depth === 0) {
            return pairs[code[open]] === c ? i : -1;
        }
    }
    return -1;
}

/** The offsets at which each top-level argument of the call at `open` starts. */
function argStarts(code: string, open: number, close: number): number[] {
    const starts = [open + 1];
    let depth = 0;
    for (let i = open + 1; i < close; i++) {
        const c = code[i];
        if ("({[".includes(c)) depth++;
        else if (")}]".includes(c)) depth--;
        else if (c === "," && depth === 0) starts.push(i + 1);
    }
    return starts;
}

function lineOf(src: string, offset: number): number {
    return src.slice(0, offset).split("\n").length;
}

/** Matches a call to any of `names`; a member call needs `member` set. */
function callPattern(names: string[], member = false): RegExp {
    const before = member ? "(?<![\\w$])" : "(?<![\\w$.])";
    return new RegExp(`${before}(?:${names.join("|")})\\s*\\(`, "g");
}

interface Spawners {
    /** Names of functions in the file whose bodies reach a spawning call. */
    names: string[];
    /** The source extent of each such function, as [start, end) offsets. */
    extents: [number, number][];
}

function deriveSpawners(code: string): Spawners {
    const decls: { name: string; body: string; extent: [number, number] }[] = [];
    const declRe =
        /(?:function\s+([\w$]+)\s*(?:<[^>]*>)?\s*\(|(?:const|let)\s+([\w$]+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\s*)?\()/g;
    for (let m = declRe.exec(code); m; m = declRe.exec(code)) {
        const name = m[1] ?? m[2];
        const open = code.indexOf("(", m.index + m[0].length - 1);
        const close = matchClose(code, open);
        if (close === -1) continue;
        let k = close + 1;
        while (k < code.length && /[\s:\w<>[\],|.={]/.test(code[k]) && code[k] !== "{") {
            if (code[k] === "=" && code[k + 1] === ">") {
                k += 2;
                break;
            }
            k++;
        }
        while (/\s/.test(code[k])) k++;
        let end: number;
        if (code[k] === "{") end = matchClose(code, k);
        else {
            end = k;
            let depth = 0;
            while (end < code.length) {
                const c = code[end];
                if ("({[".includes(c)) depth++;
                else if (")}]".includes(c)) depth--;
                if (depth < 0 || (depth === 0 && c === ";")) break;
                end++;
            }
        }
        if (end > k) decls.push({ name, body: code.slice(k, end + 1), extent: [m.index, end + 1] });
    }
    const spawners = new Set<string>(NATIVE_SPAWNS);
    let grew = true;
    while (grew) {
        grew = false;
        for (const d of decls) {
            if (spawners.has(d.name)) continue;
            if (callPattern([...spawners], true).test(d.body)) {
                spawners.add(d.name);
                grew = true;
            }
        }
    }
    const wrappers = decls.filter((d) => spawners.has(d.name));
    return {
        names: wrappers.map((d) => d.name),
        extents: wrappers.map((d) => d.extent),
    };
}

/** Extents of every loop construct in `code`, as [start, end) offsets. */
function loopExtents(code: string): [number, number][] {
    const extents: [number, number][] = [];
    const kw = /(?<![\w$])(?:for|while)\s*(?:await\s*)?\(/g;
    for (let m = kw.exec(code); m; m = kw.exec(code)) {
        const open = code.indexOf("(", m.index);
        const close = matchClose(code, open);
        if (close === -1) continue;
        let k = close + 1;
        while (/\s/.test(code[k])) k++;
        const end = code[k] === "{" ? matchClose(code, k) : code.indexOf(";", k);
        extents.push([k, end === -1 ? code.length : end + 1]);
    }
    const cb = new RegExp(`\\.(?:${LOOP_CALLBACKS.join("|")})\\s*\\(`, "g");
    for (let m = cb.exec(code); m; m = cb.exec(code)) {
        const open = code.indexOf("(", m.index);
        const close = matchClose(code, open);
        if (close !== -1) extents.push([open, close + 1]);
    }
    return extents;
}

interface Violation {
    where: string;
    spawns: number;
    inLoop: boolean;
    calls: string[];
    /** The numeric timeout the test gives, when it is a literal. */
    literal?: number;
}

/** Tests in `file` budgeted at one spawn that spawn more than once. */
export function overBudgetTests(file: string): Violation[] {
    const src = fs.readFileSync(file, "utf8");
    const code = mask(src);
    const derived = deriveSpawners(code);
    const spawnRes = [callPattern(NATIVE_SPAWNS, true)];
    if (derived.names.length) spawnRes.push(callPattern(derived.names));
    const rel = path.relative(path.dirname(TESTS_DIR), file);
    const found: Violation[] = [];
    const testRe = /(?<![\w$.])(?:it|test)(?:\.\w+)?\s*\(/g;
    for (let m = testRe.exec(code); m; m = testRe.exec(code)) {
        const open = code.indexOf("(", m.index);
        const close = matchClose(code, open);
        if (close === -1) continue;
        const starts = argStarts(code, open, close);
        if (code.slice(starts[starts.length - 1], close).trim() === "") starts.pop();
        if (starts.length < 3) continue;
        const last = starts[starts.length - 1];
        const timeoutArg = code.slice(last, close).trim().replace(/,$/, "");
        const literal =
            /^\d[\d_]*$/.test(timeoutArg) ? Number(timeoutArg.replaceAll("_", "")) : undefined;
        if (timeoutArg !== "SUBPROCESS_TEST_TIMEOUT" && literal === undefined) continue;
        const bodyStart = starts[1];
        const bodyEnd = last - 1;
        const body = code.slice(bodyStart, bodyEnd);
        const loops = loopExtents(code).filter(([s, e]) => s >= bodyStart && e <= bodyEnd);
        let spawns = 0;
        let inLoop = false;
        const calls: string[] = [];
        const inside = (at: number, [from, to]: [number, number]) => at >= from && at < to;
        for (const spawnRe of spawnRes) {
            spawnRe.lastIndex = 0;
            for (let s = spawnRe.exec(body); s; s = spawnRe.exec(body)) {
                const at = bodyStart + s.index;
                // A wrapper's own body is counted once per call to it.
                if (derived.extents.some((e) => inside(at, e))) continue;
                spawns++;
                calls.push(`${s[0].replace(/\s*\($/, "")}@${lineOf(src, bodyStart + s.index)}`);
                if (loops.some((e) => inside(at, e))) inLoop = true;
            }
        }
        // A bare constant budgets one spawn; a literal budgets what it says.
        const budget = literal ?? SUBPROCESS_TEST_TIMEOUT;
        const short = spawns > 0 && budget < spawns * SUBPROCESS_TEST_TIMEOUT;
        if ((literal === undefined && (spawns > 1 || inLoop)) || short) {
            found.push({
                where: `${rel}:${lineOf(src, m.index)}`,
                spawns,
                inLoop,
                calls,
                literal,
            });
        }
    }
    return found;
}

describe("subprocess budgets", () => {
    it("gives every test that spawns more than once a budget per spawn", () => {
        const files = fs
            .readdirSync(TESTS_DIR)
            .filter((f) => f.endsWith(".test.ts") && f !== "subprocess-budgets.test.ts")
            .map((f) => path.join(TESTS_DIR, f));
        const over = files.flatMap(overBudgetTests);
        const report = over.map(
            (v) =>
                `${v.where}: error: ${v.spawns} spawn call(s)${v.inLoop ? " (in a loop)" : ""} under ${v.literal ?? "SUBPROCESS_TEST_TIMEOUT"} [${v.calls.join(", ")}]; use subprocessTimeout(n)`,
        );
        expect(report).toEqual([]);
    });
});
