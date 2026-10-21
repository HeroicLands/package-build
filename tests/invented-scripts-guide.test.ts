/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **The guide to writing in invented scripts stays true to the code.** It is
 * the explanatory account that ties the reference together, so its guard
 * checks four things the reference guards cannot:
 *
 * - **Coverage.** Every key, option and markup key the guide's subject has is
 *   named in it, enumerated at runtime from the note vocabulary, the verse and
 *   run key lists and the command definitions.
 * - **Findings.** Every finding the guide quotes in a block quote is found in
 *   the toolchain's source: every literal fragment of the message must be held
 *   by one source file, allowing at most three words between chunks
 *   where the code supplies a value, so a quoted message cannot drift from the
 *   code that emits it.
 * - **The worked example runs.** The files the worked example labels are
 *   written into a project and linted: the first run reports exactly the
 *   findings the guide prints, and the second is clean.
 * - **Register.** The guide carries no history, no issue number and no marker
 *   for deferred work.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { COLUMN_KEYS, VERSE_KEYS } from "../engine/content-verse.mjs";
import { GENERIC_FONTS, RUN_KEYS } from "../engine/content-scripts.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { SUBPROCESS_TEST_TIMEOUT } from "./subprocess-timeout.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GUIDE_FILE = "docs/guides/writing-in-invented-scripts.md";
const GUIDE = fs.readFileSync(path.join(ROOT, GUIDE_FILE), "utf8");
const BIN = path.join(ROOT, "bin", "package-build.mjs");
const FIXTURE_FONTS = path.join(ROOT, "tests", "fixtures", "script-fonts", "fonts");

/** Every word the guide writes outside a code fence. */
const PROSE = GUIDE.replace(/^(`{3,})[^\n]*\n[\s\S]*?^\1$/gm, "");

describe("the guide is reachable", () => {
    it("is linked from the documentation index and the README", () => {
        for (const file of ["docs/index.md", "README.md"]) {
            const text = fs.readFileSync(path.join(ROOT, file), "utf8");
            const target =
                file === "README.md" ? GUIDE_FILE : "guides/writing-in-invented-scripts.md";
            expect(text, file).toContain(`](${target})`);
        }
    });
});

describe("the guide's register", () => {
    const bannedPhrases = [
        /\bused to\b/i,
        /\bformerly\b/i,
        /\bno longer\b/i,
        /\bpreviously\b/i,
        /\bwill be\b/i,
        /\beventually\b/i,
        /\bTODO\b/,
        /\bFIXME\b/,
    ];

    it("states the present and nothing else", () => {
        for (const pattern of bannedPhrases) expect(GUIDE, String(pattern)).not.toMatch(pattern);
    });

    it("carries no issue, pull request or commit number", () => {
        expect(GUIDE).not.toMatch(/(^|[\s(])#\d{2,}\b/);
        expect(GUIDE).not.toMatch(/\b[0-9a-f]{40}\b/);
    });

    it("names the checked verse key `scan=` and no other metre key", () => {
        for (const key of ["metre", "meter", "rhyme", "syllables"])
            expect(GUIDE, `${key}=`).not.toContain(`${key}=`);
        expect(GUIDE).toContain("scan=");
    });

    it("names no retired verse key anywhere in the documentation", () => {
        const files: string[] = ["README.md", "CONTENT.md"];
        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
                const here = `${dir}/${entry.name}`;
                if (entry.isDirectory()) walk(here);
                else if (entry.name.endsWith(".md")) files.push(here);
            }
        };
        walk("docs");
        const stale = files.flatMap((file) => {
            const text = fs.readFileSync(path.join(ROOT, file), "utf8");
            return ["metre", "meter", "rhyme", "syllables"]
                .filter((key) => text.includes(`${key}=`))
                .map((key) => `${file}: ${key}=`);
        });
        expect(stale).toEqual([]);
    });

    it("never appends an invented observer to a fact", () => {
        expect(GUIDE).not.toMatch(/, and (a|an|anyone|you) (\w+ )?(will|would|can|could)\b/i);
    });
});

/** The leaf names under a vocabulary field, dotted from `prefix`. */
function paths(fields: any[], prefix = ""): string[] {
    const found: string[] = [];
    for (const field of fields ?? []) {
        const here = prefix ? `${prefix}.${field.name}` : field.name;
        found.push(here);
        const children = field.fields ?? field.entries?.fields ?? field.entries?.entries?.fields;
        if (children) found.push(...paths(children, here));
    }
    return found;
}

const SKILL = paths((NOTE_VOCABULARY as any).skill.data);
const DOC = paths((NOTE_VOCABULARY as any).doc.data);

/** The roots of `data` the guide's subject owns, by the note type that holds them. */
const SUBJECT = [
    ...DOC.filter((key) => /^(map|metres|concepts)(\.|$)/.test(key)),
    ...SKILL.filter((key) =>
        /^(core|emphasis|script|grammar\.(agreement|participles|native)|affixes\.(attachesTo|replaces|native)|words\.(concept|native)|sounds\.stress|sounds\.syllables\.vowelPairs)(\.|$)/.test(
            key,
        ),
    ),
];

describe("the guide names its whole subject", () => {
    it("derives a non-empty subject from the note vocabulary", () => {
        expect(SUBJECT.length).toBeGreaterThan(30);
    });

    it("names every key of the subject", () => {
        const missing = SUBJECT.filter((key) => {
            const leaf = key.split(".").pop()!;
            const dotted = key.includes(".") ? key : `data.${key}`;
            const named =
                GUIDE.includes(`\`${leaf}\``) ||
                GUIDE.includes(`\`${leaf}=`) ||
                GUIDE.includes(`\`${key}\``) ||
                GUIDE.includes(`\`${dotted}\``) ||
                new RegExp(`(^|[\\s{,\\[\`])${leaf}:`, "m").test(GUIDE);
            return !named;
        });
        expect(missing).toEqual([]);
    });

    it("names every markup key a run, a verse fence and a column takes", () => {
        // `scan` names the declared metre; the keys below it are not part of the guide's subject.
        const keys = [...new Set([...RUN_KEYS, ...VERSE_KEYS, ...COLUMN_KEYS, "scan"])].filter(
            (key) =>
                !["dir", "data-pagefind-ignore", "meter", "metre", "rhyme", "syllables"].includes(
                    key,
                ),
        );
        const missing = keys.filter((key) => !GUIDE.includes(`${key}=`));
        expect(missing).toEqual([]);
    });

    it("names every generic family", () => {
        const missing = Object.keys(GENERIC_FONTS).filter((name) => !GUIDE.includes(`\`${name}\``));
        expect(missing).toEqual([]);
    });
});

/** The body of `function <name>() {…}` in a command module, by brace matching. */
function commandBody(source: string, name: string): string {
    const at = source.search(new RegExp(`function\\s+${name}\\s*\\(`));
    expect(at, name).toBeGreaterThanOrEqual(0);
    const open = source.indexOf("{", at);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
    }
    throw new Error(`unbalanced braces in ${name}`);
}

describe("the guide documents the commands it uses", () => {
    const source = fs.readFileSync(path.join(ROOT, "bin", "content-commands.mjs"), "utf8");
    for (const [command, factory] of [
        ["transliterate", "transliterateCommand"],
        ["lexicon", "lexiconCommand"],
        ["core", "coreCommand"],
    ]) {
        it(`names \`package-build ${command}\` and every option it takes`, () => {
            const body = commandBody(source, factory);
            const options = [...body.matchAll(/\.option\(\s*["']([\w-]+)["']/g)].map((m) => m[1]);
            expect(options.length, command).toBeGreaterThan(0);
            expect(GUIDE).toContain(`package-build ${command}`);
            const missing = options.filter((option) => !GUIDE.includes(`--${option}`));
            expect(missing, command).toEqual([]);
        });
    }
});

/**
 * The text of the toolchain's source, with the joins a long message is
 * written with undone, so a quoted message can be looked up in it.
 */
function sourceText(): Map<string, string> {
    const files = new Map<string, string>();
    for (const dir of ["engine", "bin", "sohl"]) {
        for (const name of fs.readdirSync(path.join(ROOT, dir))) {
            if (!name.endsWith(".mjs")) continue;
            const text = fs
                .readFileSync(path.join(ROOT, dir, name), "utf8")
                .replace(/\\`/g, "`")
                .replace(/\\"/g, '"')
                .replace(/(["'`])\s*\+\s*\n\s*(["'`])/g, "")
                .replace(/\$\{[^}]*\}/g, "\u0000");
            files.set(`${dir}/${name}`, text);
        }
    }
    return files;
}

/** The message of every block-quoted finding in the guide. */
function quotedFindings(): string[] {
    return [...GUIDE.matchAll(/^> (``+)\s*([^\n]+?)\s*\1(?: \([^)]*\))?\s*$/gm)].map((m) => m[2]);
}

/** The literal fragments of a quoted message, which the code must hold in order. */
function fragments(message: string): string[] {
    const pieces = message
        .replace(/\([^)]*\)/g, "\u0001")
        .split(/`[^`]*`|“[^”]*”|"[^"]*"|U\+[0-9A-F]+|[0-9]+|[\u0001\[\];:,]|\.{3}|…/)
        .map((piece) => piece.replace(/\s+/g, " "))
        .map((piece) => piece.trim());
    const long = pieces.filter((piece) => piece.length >= 16);
    return long.length ? long : pieces.filter((piece) => piece.length >= 8);
}

/**
 * Whether `text` holds the words of `piece` as a chain of contiguous chunks,
 * each starting within 300 characters of the end of the one before, with at
 * most three words between chunks that the code does not spell out. A message
 * the code builds from a conditional or an interpolation is split across
 * literals, and the words that sit where it splits are the ones it supplies.
 */
function holds(text: string, piece: string): boolean {
    const words = piece.trim().split(" ").filter(Boolean);
    const failed = new Set<string>();
    const chain = (index: number, from: number): boolean => {
        if (index >= words.length) return true;
        if (words.slice(index).join(" ").length < 8 && from >= 0) return true;
        const key = `${index}:${from}`;
        if (failed.has(key)) return false;
        for (let end = words.length; end > index; end--) {
            const chunk = words.slice(index, end).join(" ");
            // The first chunk anchors the chain, so it must be a phrase and not a stray word.
            if (from < 0 && chunk.length < 8) continue;
            for (let at = text.indexOf(chunk); at >= 0; at = text.indexOf(chunk, at + 1)) {
                if (from >= 0 && at - from > 300) break;
                if (at < from) continue;
                for (let skip = 0; skip <= 3; skip++)
                    if (chain(end + skip, at + chunk.length)) return true;
                if (from < 0) break;
            }
        }
        failed.add(key);
        return false;
    };
    return chain(0, -1);
}

describe("every finding the guide quotes is emitted by the toolchain", () => {
    const messages = quotedFindings();
    const files = sourceText();

    it("quotes findings", () => {
        expect(messages.length).toBeGreaterThan(20);
    });

    for (const message of messages) {
        it(message.slice(0, 90), () => {
            const parts = fragments(message);
            expect(parts.length).toBeGreaterThan(0);
            const found = [...files.entries()].some(([, text]) => {
                const squashed = text.replace(/\s+/g, " ");
                for (const part of parts) if (!holds(squashed, part)) return false;
                return true;
            });
            expect(found, `no one source file holds all of ${JSON.stringify(parts)}`).toBe(true);
        });
    }
});

/** A file the worked example labels: the path above its fence, and the fence. */
interface Labelled {
    file: string;
    text: string;
}

/** The labelled files of the guide, in order. */
function labelled(): Labelled[] {
    return [...GUIDE.matchAll(/^\*\*`([^`\n]+)`\*\*\n\n(`{3,})[\w-]*\n([\s\S]*?)\n\2$/gm)].map(
        (m) => ({ file: m[1], text: `${m[3]}\n` }),
    );
}

/** The located findings printed in the first `text` fence after a heading. */
function printedFindings(heading: string): string[] {
    const from = GUIDE.indexOf(heading);
    expect(from, heading).toBeGreaterThanOrEqual(0);
    const fence = /^```text\n([\s\S]*?)\n```$/m.exec(GUIDE.slice(from));
    expect(fence, `a text fence after ${heading}`).not.toBeNull();
    return fence![1].split("\n").filter(Boolean);
}

const made: string[] = [];
afterAll(() => {
    for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

/** Write a project holding `files` and lint it; the located lines it reports. */
function lintProject(files: Map<string, string>): { status: number | null; lines: string[] } {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "invented-scripts-")));
    made.push(root);
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "demo", version: "1.0.0" }),
    );
    fs.cpSync(FIXTURE_FONTS, path.join(root, "node_modules", "@heroiclands", "fonts"), {
        recursive: true,
    });
    for (const [file, text] of files) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), text);
    }
    const run = spawnSync(process.execPath, [BIN, "lint"], {
        cwd: root,
        env: {
            ...process.env,
            PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
        },
        encoding: "utf8",
    });
    const lines = `${run.stdout ?? ""}${run.stderr ?? ""}`
        .split("\n")
        .filter((line) => /^assets\/content\/.+:\d+:\d+: (error|warning): /.test(line));
    return { status: run.status, lines };
}

describe("the worked example runs", () => {
    const blocks = labelled();

    it("labels the files of a package", () => {
        const names = blocks.map((block) => block.file);
        expect(names).toContain("package-build.config.yaml");
        expect(names.some((name) => name.startsWith("assets/content/Skills/"))).toBe(true);
        expect(names.some((name) => /Spelling|Map/i.test(name))).toBe(true);
    });

    /** The package every example sits in, with a homepage the lint requires. */
    const base = () =>
        new Map<string, string>([
            ["package.json", JSON.stringify({ name: "demo", version: "1.0.0" })],
            [
                "assets/content/homepage.md",
                "---\nshortcode: root\nname: { full: Demo }\ntype: homepage\n---\n\n" +
                    "The home page of the sample package that the guide to writing in invented scripts builds, " +
                    "with enough words in its body that the lint does not ask for a draft tag.\n",
            ],
        ]);

    it(
        "reports exactly the findings the guide prints, then lints clean once the word is coined",
        () => {
            // The first stage is every labelled file before the first one written twice.
            const first = base();
            const seen = new Set<string>();
            let split = blocks.length;
            for (const [at, block] of blocks.entries()) {
                if (seen.has(block.file)) {
                    split = at;
                    break;
                }
                seen.add(block.file);
                first.set(block.file, block.text);
            }
            expect(split, "a labelled file is written a second time").toBeLessThan(blocks.length);

            const before = lintProject(first);
            const printed = printedFindings("## A worked example");
            expect(before.lines.sort()).toEqual(printed.sort());

            const after = new Map(first);
            for (const block of blocks.slice(split)) after.set(block.file, block.text);
            const clean = lintProject(after);
            expect(clean.lines).toEqual([]);
            expect(clean.status).toBe(0);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );
});
