/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `package-build npc new` against a content tree: the spec arrives on the
 * command line or from a file, the culture and its language resolve through
 * the tree, the note goes to standard output or a new file, and the note it
 * writes passes the package's own lint.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { SUBPROCESS_TEST_TIMEOUT, subprocessTimeout } from "./subprocess-timeout.js";

const CLI = path.resolve(__dirname, "../bin/package-build.mjs");

let root: string;

/** One note, written into the fixture's content tree. */
function note(rel: string, text: string) {
    const file = path.join(root, "assets/content", rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}

const PROSE =
    "This note exists so the tree has something to say about it, and it says enough " +
    "to pass the word count an ordinary finished note is held to.\n";

const PROFILE =
    `  appearanceProfile:\n` +
    `    frame: { light: 2, medium: 5, heavy: 2 }\n` +
    `    eye_color: { brown: 6, dark_brown: 3, hazel: 1 }\n` +
    `    hair_color: { black: 6, dark_brown: 3 }\n` +
    `    skin_color: { tawny: 5, olive: 3, brown: 2 }\n` +
    `    complexion: { clear: 3, weathered: 2, smooth: 2 }\n` +
    `    height:\n      female:\n        min: 4' 11"\n        max: 5' 8"\n` +
    `      male:\n        min: 5' 4"\n        max: 6' 3"\n`;

/** A culture note whose `data:` block is `data`. */
function culture(file: string, shortcode: string, data: string) {
    note(
        `Cultures/${file}.md`,
        `---\nshortcode: ${shortcode}\nname: { full: The ${file} }\ntype: lore\nsubType: culture\n` +
            `data:\n${data}---\n\n${PROSE}`,
    );
}

/** A language skill note whose `data:` block adds `data`. */
function language(file: string, shortcode: string, data: string) {
    note(
        `Skills/${file}.md`,
        `---\nshortcode: ${shortcode}\nname: { full: ${file} Language }\ntype: skill\n` +
            `subType: language\ndata:\n  pack: skills\n${data}---\n\n${PROSE}`,
    );
}

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "npc-new-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "demo", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(root, "package-build.config.yaml"),
        `contentPackage: demo
packageKind: modules
compatibility: { minimum: "14.359", verified: "14.359" }
stats: { lastModifiedBy: npcnewbuild00000 }
packs:
  - { name: journals, type: JournalEntry, default: true }
  - { name: skills, type: Item }
`,
    );
    note("Home.md", `---\nshortcode: root\nname: { full: Demo }\ntype: homepage\n---\n\n${PROSE}`);
    note(
        "World.md",
        `---\nshortcode: world\nname: { full: The World }\ntype: place\nsubType: world\n` +
            `data:\n  year: { days: 365 }\n  present: "720.300"\n---\n\n${PROSE}`,
    );
    culture("Khelathi", "khelathi", "  language: skill-khelathilng\n" + PROFILE);
    culture("Plainfolk", "plainfolk", "  language: skill-khelathilng\n");
    culture("Wordless", "wordless", PROFILE);
    culture("Unlisted", "unlisted", "  language: skill-silentlng\n" + PROFILE);
    language(
        "Khelathi",
        "khelathilng",
        `  names:\n    pattern: "{given} {kin}"\n` +
            `    given:\n      female: [Agosi, Rethutê]\n      male: [Ahmetega, Aguri]\n` +
            `    kin: [Zekar, Lêru, Iqu]\n`,
    );
    language("Silent", "silentlng", "");
    note(
        "Customs/Feast.md",
        `---\nshortcode: feast\nname: { full: The Feast }\ntype: lore\nsubType: custom\n---\n\n${PROSE}`,
    );
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** Run the CLI in the fixture tree. */
function run(...args: string[]) {
    const r = spawnSync(process.execPath, [CLI, ...args], {
        cwd: root,
        env: { ...process.env, PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml") },
        encoding: "utf8",
    });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const SPEC = { name: { full: "Ahmetega Zekar" }, data: { culture: "khelathi", gender: "male" } };

const UNNAMED = { data: { culture: "khelathi", gender: "female" } };

/** A generated note's frontmatter. */
const frontmatterOf = (text: string) => YAML.parse(text.split("---\n")[1]);

describe("package-build npc new", () => {
    it(
        "requires exactly one of --spec and --specfile",
        () => {
            const neither = run("npc", "new");
            expect(neither.status).toBe(1);
            expect(neither.stderr).toMatch(/--spec.*--specfile/);
            const both = run("npc", "new", "--spec", "{}", "--specfile", "x.json");
            expect(both.status).toBe(1);
            expect(both.stderr).toMatch(/--spec.*--specfile/);
        },
        subprocessTimeout(2),
    );

    it(
        "refuses a spec missing a required field, naming the field",
        () => {
            const r = run("npc", "new", "--spec", JSON.stringify({ name: { full: "Agosi Iqu" } }));
            expect(r.status).toBe(1);
            expect(r.stderr).toContain("data.culture");
            expect(r.stderr).toContain("data.gender");
            expect(r.stdout).toBe("");
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "writes the same note to standard output for the same spec",
        () => {
            const a = run("npc", "new", "--spec", JSON.stringify(SPEC));
            const b = run("npc", "new", "--spec", JSON.stringify(SPEC));
            expect(a.status).toBe(0);
            expect(a.stdout).toMatch(/^---\nshortcode: /);
            expect(a.stdout).toBe(b.stdout);
            expect(frontmatterOf(a.stdout).data.born).toMatch(/^\d+\.\d+$/);
        },
        subprocessTimeout(2),
    );

    it(
        "reads the same spec from a JSON or a YAML file",
        () => {
            const json = path.join(root, "spec.json");
            const yaml = path.join(root, "spec.yaml");
            fs.writeFileSync(json, JSON.stringify(SPEC));
            fs.writeFileSync(yaml, YAML.stringify(SPEC));
            const inline = run("npc", "new", "--spec", JSON.stringify(SPEC));
            expect(run("npc", "new", "--specfile", json).stdout).toBe(inline.stdout);
            expect(run("npc", "new", "--specfile", yaml).stdout).toBe(inline.stdout);
        },
        subprocessTimeout(3),
    );

    it(
        "writes a new file with --out and never overwrites one",
        () => {
            const out = path.join(root, "assets/content/Characters/Ahmetega_Zekar.md");
            const first = run("npc", "new", "--spec", JSON.stringify(SPEC), "--out", out);
            expect(first.status).toBe(0);
            expect(first.stdout).toBe("");
            const written = fs.readFileSync(out, "utf8");
            const again = run(
                "npc",
                "new",
                "--spec",
                JSON.stringify({ ...SPEC, name: { full: "Someone Else" } }),
                "--out",
                out,
            );
            expect(again.status).toBe(1);
            expect(again.stderr).toContain("already exists");
            expect(fs.readFileSync(out, "utf8")).toBe(written);

            // The note it wrote passes the package's own lint.
            const lint = run("lint");
            expect(`${lint.stdout}${lint.stderr}`).not.toMatch(
                /^assets\/content\/Characters\/Ahmetega_Zekar\.md:/m,
            );
            expect(lint.status).toBe(0);
            fs.rmSync(out);
        },
        subprocessTimeout(3),
    );

    it(
        "draws a name from the language's lists when the spec states none, the same each time",
        () => {
            const a = run("npc", "new", "--spec", JSON.stringify(UNNAMED));
            const b = run("npc", "new", "--spec", JSON.stringify(UNNAMED));
            expect(a.status).toBe(0);
            expect(a.stdout).toBe(b.stdout);
            const fm = frontmatterOf(a.stdout);
            const [given, kin] = fm.name.full.split(" ");
            expect(["Agosi", "Rethutê"]).toContain(given);
            expect(["Zekar", "Lêru", "Iqu"]).toContain(kin);
            expect(fm.shortcode).toMatch(/^[a-z]+$/);
            const seeded = run("npc", "new", "--spec", JSON.stringify(UNNAMED), "--seed", "x");
            expect(seeded.status).toBe(0);
            expect(seeded.stdout).not.toBe(a.stdout);
        },
        subprocessTimeout(3),
    );

    it(
        "refuses a supplied name that does not fit the language's lists, naming the part",
        () => {
            const unlisted = run(
                "npc",
                "new",
                "--spec",
                JSON.stringify({ ...SPEC, name: { full: "Ahmetega Zekarson" } }),
            );
            expect(unlisted.status).toBe(1);
            expect(unlisted.stderr).toMatch(/demo-note-skill-khelathilng.*"Zekarson".*\{kin\}/);
            const gendered = run(
                "npc",
                "new",
                "--spec",
                JSON.stringify({ ...SPEC, name: { full: "Agosi Zekar" } }),
            );
            expect(gendered.status).toBe(1);
            expect(gendered.stderr).toMatch(/"Agosi".*not a male given name/);
            expect(gendered.stdout).toBe("");
            fs.writeFileSync(
                path.join(root, "bad.yaml"),
                "name:\n  full: Ahmetega Zekarson\ndata:\n  culture: khelathi\n  gender: male\n",
            );
            const located = run("npc", "new", "--specfile", "bad.yaml");
            expect(located.status).toBe(1);
            expect(located.stderr).toMatch(/^bad\.yaml:2:9: error: .*"Zekarson"/m);
        },
        subprocessTimeout(3),
    );

    it(
        "refuses a culture with no appearance profile or no language, at the culture note",
        () => {
            const noProfile = run(
                "npc",
                "new",
                "--spec",
                JSON.stringify({ data: { culture: "plainfolk", gender: "female" } }),
            );
            expect(noProfile.status).toBe(1);
            expect(noProfile.stderr).toMatch(
                /^assets\/content\/Cultures\/Plainfolk\.md:\d+:\d+: error: .*appearanceProfile/m,
            );
            const noLanguage = run(
                "npc",
                "new",
                "--spec",
                JSON.stringify({ data: { culture: "wordless", gender: "female" } }),
            );
            expect(noLanguage.status).toBe(1);
            expect(noLanguage.stderr).toMatch(
                /^assets\/content\/Cultures\/Wordless\.md:\d+:\d+: error: .*data\.language/m,
            );
        },
        subprocessTimeout(2),
    );

    it(
        "refuses a language with no name lists, or with broken ones, at the language note",
        () => {
            const noNames = run(
                "npc",
                "new",
                "--spec",
                JSON.stringify({ data: { culture: "unlisted", gender: "female" } }),
            );
            expect(noNames.status).toBe(1);
            expect(noNames.stderr).toMatch(
                /^assets\/content\/Skills\/Silent\.md:\d+:\d+: error: .*data\.names/m,
            );

            const silent = path.join(root, "assets/content/Skills/Silent.md");
            const before = fs.readFileSync(silent, "utf8");
            try {
                language(
                    "Silent",
                    "silentlng",
                    `  names:\n    pattern: "{given} {clan}"\n` +
                        `    given:\n      female: [Agosi]\n      male: [Aguri]\n`,
                );
                const broken = run(
                    "npc",
                    "new",
                    "--spec",
                    JSON.stringify({ data: { culture: "unlisted", gender: "female" } }),
                );
                expect(broken.status).toBe(1);
                expect(broken.stderr).toMatch(
                    /^assets\/content\/Skills\/Silent\.md:\d+:\d+: error: .*\{clan\}.*names no list/m,
                );
            } finally {
                fs.writeFileSync(silent, before);
            }
        },
        subprocessTimeout(2),
    );

    it(
        "refuses a culture that resolves to no culture note",
        () => {
            const missing = run(
                "npc",
                "new",
                "--spec",
                JSON.stringify({ ...SPEC, data: { culture: "nowhere", gender: "male" } }),
            );
            expect(missing.status).toBe(1);
            expect(missing.stderr).toContain("nowhere");
            const custom = run(
                "npc",
                "new",
                "--spec",
                JSON.stringify({ ...SPEC, data: { culture: "feast", gender: "male" } }),
            );
            expect(custom.status).toBe(1);
            expect(custom.stderr).toMatch(/feast.*not a culture/);
        },
        subprocessTimeout(2),
    );
});
