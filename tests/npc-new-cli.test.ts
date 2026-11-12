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

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
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

/** The letters every fixture language writes its names in. */
const ROMAN = "abcdefghijklmnopqrstuvwxyzê";

/** A language skill note whose `data:` block adds `data`. */
function language(file: string, shortcode: string, data: string) {
    note(
        `Skills/${file}.md`,
        `---\nshortcode: ${shortcode}\nname: { full: ${file} Language }\ntype: skill\n` +
            `subType: language\ndata:\n  pack: skills\n  roman: ${ROMAN}\n${data}---\n\n${PROSE}`,
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
currentDate: "720.300"
packageKind: modules
compatibility: { minimum: "14.359", verified: "14.359" }
stats: { lastModifiedBy: npcnewbuild00000 }
languages:
  khelathi: { tag: art-x-khelathi, note: skill-khelathilng }
  silent: { tag: art-x-silent, note: skill-silentlng }
  ownwords: { tag: art-x-ownwords, note: skill-ownwordslng }
  shared: { tag: art-x-shared, note: skill-sharedlng }
  caseless: { tag: art-x-caseless, note: skill-caselesslng }
packs:
  - { name: journals, type: JournalEntry, default: true }
  - { name: skills, type: Item }
`,
    );
    note("Home.md", `---\nshortcode: root\nname: { full: Demo }\ntype: homepage\n---\n\n${PROSE}`);
    note(
        "World.md",
        `---\nshortcode: world\nname: { full: The World }\ntype: place\nsubType: world\n` +
            `data:\n  year: { days: 365 }\n---\n\n${PROSE}`,
    );
    culture("Khelathi", "khelathi", "  lang: khelathi\n" + PROFILE);
    culture(
        "Equipped",
        "equipped",
        "  lang: khelathi\n" +
            PROFILE +
            "  items:\n    - {key: bag, name: Bag, kind: container}\n    - {key: lost, name: Hat, kind: clothing, chance: 0}\n",
    );
    culture("Plainfolk", "plainfolk", "  lang: khelathi\n");
    culture("Wordless", "wordless", PROFILE);
    culture("Unlisted", "unlisted", "  lang: silent\n" + PROFILE);
    culture("Caseless", "caseless", "  lang: caseless\n" + PROFILE);
    language(
        "Khelathi",
        "khelathilng",
        `  names:\n    pattern: "{given} {kin}"\n` +
            `    given:\n      female: [Agosi, Rethutê]\n      male: [Ahmetega, Aguri]\n` +
            `    kin: [Zekar, Lêru, Iqu]\n`,
    );
    language("Silent", "silentlng", "");
    culture("Shared", "shared", "  lang: shared\n" + PROFILE);
    language(
        "Shared",
        "sharedlng",
        '  names:\n    pattern: "{given} {kin}"\n' + "    given: [Nara, Taro]\n    kin: [Mori]\n",
    );

    language(
        "Caseless",
        "caselesslng",
        '  names:\n    pattern: "{given} of the {clan}"\n' +
            "    given:\n      female: [nali]\n      male: [lumawesa]\n    clan: [simi manik]\n",
    );
    language(
        "Ownwords",
        "ownwordslng",
        '  names:\n    pattern: "{given} {kin}"\n' +
            "    given:\n      female: [Nara]\n      male: [Taro]\n    kin: [Mori]\n",
    );
    note(
        "Customs/Feast.md",
        `---\nshortcode: feast\nname: { full: The Feast }\ntype: lore\nsubType: custom\n---\n\n${PROSE}`,
    );
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function occupationFixtures() {
    note(
        "Jobs/Porter.md",
        `---\nshortcode: porter\nname: {full: Porter}\ntype: being\nsubType: npc\ndata:\n  items:\n    - {key: bag, name: Bag, kind: container}\n    - {key: rope, name: Rope, kind: miscgear, chance: 100}\n---\n\n${PROSE}`,
    );
    note(
        "Jobs/Conflict.md",
        `---\nshortcode: conflict\nname: {full: Conflict}\ntype: being\nsubType: npc\ndata:\n  items:\n    - {key: bag, name: Box, kind: container}\n---\n\n${PROSE}`,
    );
    note(
        "Jobs/Character.md",
        `---\nshortcode: character\nname: {full: Character}\ntype: being\nsubType: character\n---\n\n${PROSE}`,
    );
}

afterEach(() =>
    fs.rmSync(path.join(root, "assets/content/Jobs"), { recursive: true, force: true }),
);

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
        "capitalizes the English name and retains its caseless language form",
        () => {
            const generated = run(
                "npc",
                "new",
                "--spec",
                JSON.stringify({ data: { culture: "caseless", gender: "male" } }),
            );
            expect(generated.status).toBe(0);
            expect(frontmatterOf(generated.stdout).name).toEqual({
                full: "Lumawesa of the Simi Manik",
                caseless: ["lumawesa of the simi manik"],
            });
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "draws items from the selected culture in the normal command",
        () => {
            const input = { ...SPEC, data: { ...SPEC.data, culture: "equipped" } };
            const generated = run("npc", "new", "--spec", JSON.stringify(input), "--seed", "one");
            expect(generated.status).toBe(0);
            expect(frontmatterOf(generated.stdout).data.items).toEqual([
                { key: "bag", name: "Bag", kind: "container" },
            ]);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "resolves the explicit occupation template and combines identical items",
        () => {
            occupationFixtures();
            const input = {
                ...SPEC,
                data: {
                    ...SPEC.data,
                    culture: "equipped",
                    occupation: "Porter",
                    occupationNote: "porter",
                },
            };
            const generated = run("npc", "new", "--spec", JSON.stringify(input));
            expect(generated.status).toBe(0);
            expect(frontmatterOf(generated.stdout).data).toMatchObject({
                occupation: "Porter",
                occupationNote: "porter",
                items: [
                    { key: "bag", name: "Bag", kind: "container" },
                    { key: "rope", name: "Rope", kind: "miscgear" },
                ],
            });
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "uses the occupation item and rejects missing or wrong occupation targets",
        () => {
            occupationFixtures();
            const input = {
                ...SPEC,
                data: { ...SPEC.data, culture: "equipped", occupationNote: "conflict" },
            };
            const conflict = run("npc", "new", "--spec", JSON.stringify(input));
            expect(conflict.status, conflict.stderr).toBe(0);
            expect(frontmatterOf(conflict.stdout).data.items).toEqual([
                { key: "bag", name: "Box", kind: "container" },
            ]);
            for (const occupationNote of ["absent", "character", "lore-feast"]) {
                const result = run(
                    "npc",
                    "new",
                    "--spec",
                    JSON.stringify({ ...input, data: { ...input.data, occupationNote } }),
                );
                expect(result.status).toBe(1);
                expect(result.stderr).toContain("occupationNote");
            }
        },
        subprocessTimeout(4),
    );

    it(
        "locates duplicate keys within either source and names a remedy",
        () => {
            culture(
                "Repeated",
                "repeated",
                "  lang: khelathi\n" +
                    PROFILE +
                    "  items:\n    - {key: bag, name: Bag, kind: container}\n    - {key: bag, name: Box, kind: container, chance: 0}\n",
            );
            const result = run(
                "npc",
                "new",
                "--spec",
                JSON.stringify({ ...SPEC, data: { ...SPEC.data, culture: "repeated" } }),
            );
            expect(result.status).toBe(1);
            expect(result.stderr).toMatch(/Cultures\/Repeated.md:23:\d+: error:/);
            expect(result.stderr).toMatch(/bag.*(?:remove|change)/);
            expect(result.stderr).not.toMatch(/TypeError|undefined/);
            fs.rmSync(path.join(root, "assets/content/Cultures/Repeated.md"));
            occupationFixtures();
            note(
                "Jobs/Repeated.md",
                `---\nshortcode: repeatedjob\nname: {full: Repeated}\ntype: being\nsubType: npc\ndata:\n  items:\n    - {key: tool, name: Hammer, kind: miscgear, chance: 0}\n    - {key: tool, name: Saw, kind: miscgear}\n---\n\n${PROSE}`,
            );
            const job = run(
                "npc",
                "new",
                "--spec",
                JSON.stringify({ ...SPEC, data: { ...SPEC.data, occupationNote: "repeatedjob" } }),
            );
            expect(job.status).toBe(1);
            expect(job.stderr).toMatch(/Jobs\/Repeated.md:9:\d+: error:/);
            expect(job.stderr).toMatch(/tool.*(?:remove|change)/);
        },
        subprocessTimeout(2),
    );

    it(
        "preserves authored model entries from local and dependency notes",
        () => {
            const configFile = path.join(root, "package-build.config.yaml");
            const originalConfig = fs.readFileSync(configFile, "utf8");
            const cache = path.join(root, "build/cache/metadata/source@1.0.0");
            try {
                note(
                    "Gear/Tool.md",
                    `---\nshortcode: tool\nname: {full: Tool}\ntype: miscgear\ndata:\n  kind: miscgear\n  name: Hammer\n  system: {weight: 3}\n---\n\n${PROSE}`,
                );
                culture(
                    "WithTool",
                    "withtool",
                    "  lang: khelathi\n" +
                        PROFILE +
                        "  items:\n    - {key: first, model: miscgear-tool, system: {quantity: 2}}\n",
                );
                note(
                    "Jobs/Worker.md",
                    `---\nshortcode: worker\nname: {full: Worker}\ntype: being\nsubType: npc\ndata:\n  items:\n    - {key: second, model: miscgear-tool, name: Mallet}\n---\n\n${PROSE}`,
                );
                const result = run(
                    "npc",
                    "new",
                    "--spec",
                    JSON.stringify({
                        ...SPEC,
                        data: { ...SPEC.data, culture: "withtool", occupationNote: "worker" },
                    }),
                );
                expect(result.status, result.stderr).toBe(0);
                expect(frontmatterOf(result.stdout).data.items).toEqual([
                    {
                        key: "first",
                        model: "demo-note-miscgear-tool",
                        system: { quantity: 2 },
                    },
                    {
                        key: "second",
                        model: "demo-note-miscgear-tool",
                        name: "Mallet",
                    },
                ]);
                fs.mkdirSync(cache, { recursive: true });
                const resolvedItem = {
                    model: "source-note-miscgear-tool",
                    kind: "miscgear",
                    name: "Hammer",
                    system: { weight: 3 },
                };
                const records = [
                    {
                        package: "source",
                        type: "lore",
                        subType: "culture",
                        shortcode: "withtool",
                        lang: "khelathi",
                        address: { canonical: "source-note-lore-withtool" },
                        data: {
                            ...YAML.parse(PROFILE),
                            items: [
                                {
                                    key: "first",
                                    ...resolvedItem,
                                    system: { weight: 3, quantity: 2 },
                                },
                            ],
                        },
                        authoredItems: [
                            {
                                key: "first",
                                model: {
                                    address: "source-note-miscgear-tool",
                                    anchor: null,
                                    anchorKind: null,
                                },
                                system: { quantity: 2 },
                            },
                        ],
                    },
                    {
                        package: "source",
                        type: "being",
                        subType: "npc",
                        shortcode: "worker",
                        address: { canonical: "source-note-being-worker" },
                        data: { items: [{ key: "second", ...resolvedItem, name: "Mallet" }] },
                        authoredItems: [
                            {
                                key: "second",
                                model: {
                                    address: "source-note-miscgear-tool",
                                    anchor: null,
                                    anchorKind: null,
                                },
                                name: "Mallet",
                            },
                        ],
                    },
                ];
                fs.writeFileSync(
                    path.join(cache, "source-metadata.jsonl"),
                    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
                );
                fs.writeFileSync(path.join(cache, ".complete"), "");
                fs.writeFileSync(
                    configFile,
                    originalConfig +
                        `\nrelationships:\n  requires:\n    - {id: source, type: module, manifest: 'https://example.invalid/module.json', compatibility: {verified: '1.0.0'}}\n`,
                );
                const foreign = run(
                    "npc",
                    "new",
                    "--spec",
                    JSON.stringify({
                        ...SPEC,
                        data: {
                            ...SPEC.data,
                            culture: "source-note-lore-withtool",
                            occupationNote: "source-note-being-worker",
                        },
                    }),
                );
                expect(foreign.status, foreign.stderr).toBe(0);
                const localItems = frontmatterOf(result.stdout).data.items.map(
                    ({ model, ...rest }: any) => rest,
                );
                const foreignItems = frontmatterOf(foreign.stdout).data.items.map(
                    ({ model, ...rest }: any) => rest,
                );
                expect(foreignItems).toEqual(localItems);
            } finally {
                fs.writeFileSync(configFile, originalConfig);
                fs.rmSync(cache, { recursive: true, force: true });
                fs.rmSync(path.join(root, "assets/content/Gear/Tool.md"), { force: true });
                fs.rmSync(path.join(root, "assets/content/Cultures/WithTool.md"), { force: true });
            }
        },
        subprocessTimeout(2),
    );

    it(
        "describes item draws and the occupation link in help",
        () => {
            const help = run("npc", "--help");
            expect(help.stdout).toMatch(/occupationNote/);
            expect(help.stdout).toMatch(/items/i);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

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

            // An ordinary prose name is not a marked-name occurrence.
            const lint = run("lint");
            const diagnostics = `${lint.stdout}${lint.stderr}`
                .split(/\r?\n/)
                .filter((line) => line.startsWith("assets/content/Characters/Ahmetega_Zekar.md:"));
            expect(written.split("\n")[30].startsWith(SPEC.name.full)).toBe(true);
            expect(diagnostics).toEqual([]);
            expect(lint.status, lint.stderr + lint.stdout).toBe(0);
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
        "generates and accepts a shared given name for every gender",
        () => {
            for (const gender of ["female", "male", "nonbinary"]) {
                const generated = run(
                    "npc",
                    "new",
                    "--spec",
                    JSON.stringify({
                        data: { culture: "shared", gender },
                    }),
                );
                expect(generated.status, generated.stderr).toBe(0);
                expect(frontmatterOf(generated.stdout).name.full).toMatch(/^(Nara|Taro) Mori$/);
                const supplied = run(
                    "npc",
                    "new",
                    "--spec",
                    JSON.stringify({
                        name: { full: "Nara Mori" },
                        data: { culture: "shared", gender },
                    }),
                );
                expect(supplied.status, supplied.stderr).toBe(0);
                expect(frontmatterOf(supplied.stdout).name.full).toBe("Nara Mori");
            }
        },
        subprocessTimeout(6),
    );

    it(
        "draws a child culture's name and appearance from its resolved parent fields",
        () => {
            const file = path.join(root, "assets/content/Cultures/Childfolk.md");
            try {
                culture("Childfolk", "childfolk", "  parents: [lore-khelathi]\n");
                const generated = run(
                    "npc",
                    "new",
                    "--spec",
                    JSON.stringify({ data: { culture: "childfolk", gender: "female" } }),
                );
                expect({
                    status: generated.status,
                    stdout: generated.stdout,
                    stderr: generated.stderr,
                }).toEqual({
                    status: 0,
                    stdout: expect.stringMatching(/^---\n/),
                    stderr: "",
                });
                const fm = frontmatterOf(generated.stdout);
                expect(fm.data.culture).toBe("childfolk");
                const [given, kin] = fm.name.full.split(" ");
                expect(["Agosi", "Rethutê"]).toContain(given);
                expect(["Zekar", "Lêru", "Iqu"]).toContain(kin);
                expect(["light", "medium", "heavy"]).toContain(fm.data.frame);
                expect(["tawny", "olive", "brown"]).toContain(fm.data.appearance.skin_color);
            } finally {
                fs.rmSync(file, { force: true });
            }
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "keeps a child culture's own language while inheriting its appearance profile",
        () => {
            const cultureFile = path.join(root, "assets/content/Cultures/Ownwords.md");
            try {
                culture("Ownwords", "ownwords", "  parents: [lore-khelathi]\n  lang: ownwords\n");
                const generated = run(
                    "npc",
                    "new",
                    "--spec",
                    JSON.stringify({ data: { culture: "ownwords", gender: "female" } }),
                );
                expect({
                    status: generated.status,
                    stdout: generated.stdout,
                    stderr: generated.stderr,
                }).toEqual({
                    status: 0,
                    stdout: expect.stringMatching(/^---\n/),
                    stderr: "",
                });
                const fm = frontmatterOf(generated.stdout);
                expect(fm.name.full).toBe("Nara Mori");
                expect(fm.data.culture).toBe("ownwords");
                expect(["light", "medium", "heavy"]).toContain(fm.data.frame);
                expect(["tawny", "olive", "brown"]).toContain(fm.data.appearance.skin_color);
            } finally {
                fs.rmSync(cultureFile, { force: true });
            }
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "refuses a culture parent cycle even when its own language and profile are complete",
        () => {
            const file = path.join(root, "assets/content/Cultures/Loopfolk.md");
            try {
                culture(
                    "Loopfolk",
                    "loopfolk",
                    "  parents: [lore-loopfolk]\n  lang: khelathi\n" + PROFILE,
                );
                const generated = run(
                    "npc",
                    "new",
                    "--spec",
                    JSON.stringify({ data: { culture: "loopfolk", gender: "female" } }),
                );
                expect(generated.status).toBe(1);
                expect(generated.stdout).toBe("");
                expect(generated.stderr).toMatch(
                    /^assets\/content\/Cultures\/Loopfolk\.md:\d+:\d+: error: .*cycle/m,
                );
            } finally {
                fs.rmSync(file, { force: true });
            }
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "takes the first parent's language where parents speak different ones",
        () => {
            const cultureFile = path.join(root, "assets/content/Cultures/Dividedfolk.md");
            const parentFile = path.join(root, "assets/content/Cultures/Otherfolk.md");
            try {
                culture("Otherfolk", "otherfolk", "  lang: silent\n" + PROFILE);
                culture(
                    "Dividedfolk",
                    "dividedfolk",
                    "  parents: [lore-khelathi, lore-otherfolk]\n" + PROFILE,
                );
                const generated = run(
                    "npc",
                    "new",
                    "--spec",
                    JSON.stringify({ data: { culture: "dividedfolk", gender: "female" } }),
                );
                expect(generated.stderr).toBe("");
                expect(generated.status).toBe(0);
                const [given] = frontmatterOf(generated.stdout).name.full.split(" ");
                expect(["Agosi", "Rethutê"]).toContain(given);
            } finally {
                fs.rmSync(cultureFile, { force: true });
                fs.rmSync(parentFile, { force: true });
            }
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "generates from a valid culture when an unrelated culture has a parent cycle",
        () => {
            const file = path.join(root, "assets/content/Cultures/Unrelatedloop.md");
            try {
                culture("Unrelatedloop", "unrelatedloop", "  parents: [lore-unrelatedloop]\n");
                const generated = run("npc", "new", "--spec", JSON.stringify(SPEC));
                expect(generated.status).toBe(0);
                expect(frontmatterOf(generated.stdout).name.full).toBe(SPEC.name.full);
            } finally {
                fs.rmSync(file, { force: true });
            }
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "locates a malformed inherited appearance profile on its authored grandparent",
        () => {
            const files = ["Grandfolk", "Middlefolk", "Youngfolk"].map((name) =>
                path.join(root, `assets/content/Cultures/${name}.md`),
            );
            try {
                culture(
                    "Grandfolk",
                    "grandfolk",
                    "  lang: khelathi\n" +
                        PROFILE.replace("light: 2, medium: 5, heavy: 2", "medium: 0"),
                );
                culture("Middlefolk", "middlefolk", "  parents: [lore-grandfolk]\n");
                culture("Youngfolk", "youngfolk", "  parents: [lore-middlefolk]\n");
                const generated = run(
                    "npc",
                    "new",
                    "--spec",
                    JSON.stringify({ data: { culture: "youngfolk", gender: "female" } }),
                );
                expect(generated.status).toBe(1);
                expect(generated.stdout).toBe("");
                expect(generated.stderr).toMatch(
                    /^assets\/content\/Cultures\/Grandfolk\.md:9:22: error: .*positive/m,
                );
                expect(generated.stderr).not.toMatch(
                    /^assets\/content\/Cultures\/(?:Middlefolk|Youngfolk)\.md:/m,
                );
            } finally {
                for (const file of files) fs.rmSync(file, { force: true });
            }
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "refuses an inherited language whose configured note does not exist",
        () => {
            const parentFile = path.join(root, "assets/content/Cultures/Lostwords.md");
            const childFile = path.join(root, "assets/content/Cultures/Quietfolk.md");
            const configFile = path.join(root, "package-build.config.yaml");
            const config = fs.readFileSync(configFile, "utf8");
            try {
                fs.writeFileSync(
                    configFile,
                    config.replace(
                        "languages:\n",
                        "languages:\n  missing: { tag: art-x-missing, note: skill-missinglng }\n",
                    ),
                );
                culture("Lostwords", "lostwords", "  lang: missing\n" + PROFILE);
                culture("Quietfolk", "quietfolk", "  parents: [lore-lostwords]\n");
                const generated = run(
                    "npc",
                    "new",
                    "--spec",
                    JSON.stringify({ data: { culture: "quietfolk", gender: "female" } }),
                );
                expect(generated.status).toBe(1);
                expect(generated.stdout).toBe("");
                expect(generated.stderr).toMatch(
                    /`languages\.missing\.note` skill-missinglng.*names no note/,
                );
            } finally {
                fs.writeFileSync(configFile, config);
                fs.rmSync(parentFile, { force: true });
                fs.rmSync(childFile, { force: true });
            }
        },
        SUBPROCESS_TEST_TIMEOUT,
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
                /^assets\/content\/Cultures\/Wordless\.md:\d+:\d+: error: .*data\.lang/m,
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
