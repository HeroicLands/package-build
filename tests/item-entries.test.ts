/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **`data.items` lists the items a note has or typically carries**, and an item
 * note's `data` block states the same shape. A `model` must resolve to an item
 * note of the note's own package or of a module it requires, followed through
 * each module's own required modules, and never to a game system.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    collectContentIndex,
    indexRecordsFor,
    serializeContentIndex,
} from "../engine/content-index.mjs";
import { encodeAddresses } from "../engine/address-values.mjs";
import { decodeIndexAddresses } from "../engine/note-addresses.mjs";
import { isNoteRecord, isPackageRecord } from "../engine/index-records.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import {
    ITEM_KINDS,
    ITEM_NOTE_TYPES,
    itemPackages,
    requiredModulePackages,
    systemPackages,
} from "../engine/item-entries.mjs";
import {
    metadataCacheDir,
    metadataFileName,
    markComplete,
    loadForeignIndexes,
} from "../engine/metadata-index.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { configFromData } from "../engine/pack-config.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { Actors } from "../sohl/actors.mjs";
import { Hm3Actors } from "../hm3/actors.mjs";
import { buildCompileCorpus } from "../engine/compile-corpus.mjs";
import { routerFor } from "../engine/pack-router.mjs";
import { buildContentLinkIndex } from "../engine/helpers.mjs";

const MANIFEST = "https://example.invalid/module.json";

let root: string;
let config: ReturnType<typeof configFromData>;
let counter = 0;

function write(file: string, text: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}

/** One note's file text. */
const noteText = (fm: object) => `---\n${YAML.stringify(fm)}---\n\nProse that fills the page.\n`;

/** An item note of the given type. */
const item = (type: string, shortcode: string, data: object = { kind: "miscgear" }) => ({
    type,
    shortcode,
    name: { full: shortcode },
    data,
});

/**
 * Publish a dependency's index into the cache, as `deps fetch` leaves it.
 *
 * @param pkg - The package that publishes it.
 * @param notes - Its notes.
 * @param requiredModules - The modules it requires, which its item notes publish.
 */
function publish(pkg: string, notes: object[], requiredModules: string[] = []) {
    const tree = path.join(root, "published", pkg);
    notes.forEach((fm: any, at) => write(path.join(tree, `${at}.md`), noteText(fm)));
    const records = collectContentIndex(tree, {
        contentPackage: pkg,
        skipDirectories: [],
        requiredModules,
    });
    const dir = metadataCacheDir(config, pkg, "1.0.0");
    write(path.join(dir, metadataFileName(pkg)), serializeContentIndex(records));
    markComplete(dir);
}

beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "item-entries-")));
    write(path.join(root, "package.json"), JSON.stringify({ name: "demo", version: "1.0.0" }));
    config = configFromData(
        {
            contentPackage: "demo",
            packageKind: "modules",
            compatibility: { minimum: "14", verified: "14.367" },
            stats: { lastModifiedBy: "itementries00000" },
            packs: [{ name: "journals", type: "JournalEntry", default: true }],
            relationships: {
                systems: [
                    {
                        id: "sohl",
                        manifest: MANIFEST,
                        compatibility: { minimum: "0.8.2", verified: "0.8.2" },
                    },
                ],
                requires: [{ id: "modone", manifest: MANIFEST, type: "module" }],
                recommends: [
                    { id: "modtwo", manifest: MANIFEST, itemCatalog: true },
                    { id: "stray", manifest: MANIFEST, itemCatalog: true },
                ],
            },
        },
        path.join(root, "package-build.config.yaml"),
    );
    // `modone` requires `modtwo`, which in turn names a system among its modules:
    // the system is never entered whatever a package publishes.
    publish(
        "modone",
        [
            {
                ...item("weapongear", "axe", { kind: "weapon", packFolder: "folder-weapons" }),
                sohl: { type: "weapongear", templatePriority: null, system: { weight: 3 } },
                hm3: { type: "weapongear", templatePriority: null, system: { weight: 3 } },
            },
        ],
        ["modtwo"],
    );
    publish("modtwo", [item("miscgear", "rope")], ["sohl"]);
    publish("stray", [item("miscgear", "lantern")]);
    publish("sohl", [item("weapongear", "dagger", { kind: "weapon" })]);
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/**
 * Lint a tree of this package's notes and return its findings as
 * `file:line:column: message` strings.
 */
function lint(notes: Record<string, object>) {
    const content = path.join(root, `tree-${(counter += 1)}`);
    for (const [name, fm] of Object.entries(notes)) write(path.join(content, name), noteText(fm));
    const parsed = new Map();
    const records = indexRecordsFor({ contentBase: content, config, parsed });
    const index = buildLinkIndex(content, { config, records, parsed });
    const { findings } = lintFrontmatter(index, {
        schemas: NOTE_SCHEMAS,
        vocabulary: NOTE_VOCABULARY,
    });
    return findings.map(
        (finding: any) =>
            `${path.basename(finding.file)}:${finding.line}:${finding.column}: ${finding.severity}: ${finding.message}`,
    );
}

/** A being listing the given entries. */
const being = (items: unknown[], extra: object = {}) => ({
    type: "being",
    subType: "creature",
    shortcode: "subject",
    name: { full: "Subject" },
    data: { items, ...extra },
});

const blade = item("weapongear", "blade", { kind: "weapon" });

/** The findings that concern `data.items`. */
const itemFindings = (lines: string[]) => lines.filter((line) => /items/.test(line));

describe("the entry shape", () => {
    it("accepts an entry with `model` alone", () => {
        expect(
            itemFindings(
                lint({ "blade.md": blade, "subject.md": being([{ model: "weapongear-blade" }]) }),
            ),
        ).toEqual([]);
    });

    it("accepts an inline entry with `name` and `kind`, and every optional key", () => {
        expect(
            lint({
                "subject.md": being([
                    {
                        key: "coin",
                        name: "Silver coin",
                        kind: "miscgear",
                        img: "icon-coin",
                        chance: 40,
                        system: { subType: "coin", quantity: 12, weight: 0.5 },
                    },
                ]),
            }).filter((line) => /items\[0\](?!.*img)/.test(line)),
        ).toEqual([]);
    });

    it("refuses an inline entry without `name` or `kind`, saying how to correct it", () => {
        const lines = itemFindings(lint({ "subject.md": being([{ key: "coin" }]) }));
        expect(lines.some((line) => /no `name`; add `name`, or give `model`/.test(line))).toBe(
            true,
        );
        expect(lines.some((line) => /no `kind`; add `kind`, or give `model`/.test(line))).toBe(
            true,
        );
        expect(lines.every((line) => /^subject\.md:\d+:\d+: error: /.test(line))).toBe(true);
    });

    it("refuses an unknown `kind`", () => {
        const lines = lint({ "subject.md": being([{ name: "Gem", kind: "gemstone" }]) });
        expect(lines.some((line) => /items\[0\]\.kind` should be .*"gemstone"/.test(line))).toBe(
            true,
        );
    });

    it("accepts every kind in the closed list", () => {
        expect(ITEM_KINDS).toHaveLength(22);
        const lines = lint({
            "subject.md": being(ITEM_KINDS.map((kind) => ({ name: kind, kind }))),
        });
        expect(itemFindings(lines)).toEqual([]);
    });

    it("refuses a `chance` outside 0 to 100", () => {
        const lines = lint({
            "culture.md": {
                type: "lore",
                subType: "culture",
                shortcode: "cultureone",
                name: { full: "Cultureone" },
                data: {
                    items: [
                        { name: "Rope", kind: "miscgear", chance: 101 },
                        { name: "Cord", kind: "miscgear", chance: -1 },
                        { name: "Twine", kind: "miscgear", chance: 100 },
                        { name: "Thread", kind: "miscgear", chance: 0 },
                    ],
                },
            },
        });
        expect(lines.filter((line) => /outside 0 to 100/.test(line))).toHaveLength(2);
    });

    it("refuses a `quantity` or `weight` that is not a number", () => {
        const lines = lint({
            "subject.md": being([
                { name: "Rope", kind: "miscgear", system: { quantity: "many", weight: "heavy" } },
            ]),
        });
        expect(lines.some((line) => /system\.quantity` should be number/.test(line))).toBe(true);
        expect(lines.some((line) => /system\.weight` should be number/.test(line))).toBe(true);
    });

    it("refuses a key the entry does not declare", () => {
        const lines = lint({ "subject.md": being([{ name: "Rope", kind: "miscgear", mass: 3 }]) });
        expect(lines.some((line) => /"mass" is not a key of `data\.items\[0\]`/.test(line))).toBe(
            true,
        );
    });

    it("lists items on a culture lore note and on no other lore note", () => {
        const entry = [{ name: "Rope", kind: "miscgear" }];
        const lore = (subType: string) => ({
            type: "lore",
            subType,
            shortcode: `lore${subType}`,
            name: { full: subType },
            data: { items: entry },
        });
        expect(itemFindings(lint({ "culture.md": lore("culture") }))).toEqual([]);
        expect(
            lint({ "law.md": lore("law") }).some((line) =>
                /on a lore note states what a culture's people carry/.test(line),
            ),
        ).toBe(true);
    });
});

describe("the Address rule", () => {
    const model = (address: string) =>
        itemFindings(lint({ "subject.md": being([{ model: address }]) })).filter((line) =>
            /model/.test(line),
        );

    it("accepts an item note of its own package", () => {
        const lines = itemFindings(
            lint({ "blade.md": blade, "subject.md": being([{ model: "weapongear-blade" }]) }),
        );
        expect(lines).toEqual([]);
    });

    it("accepts an item note of a required module", () => {
        expect(model("modone-note-weapongear-axe")).toEqual([]);
    });

    it("accepts an item note of a module reached through a required module", () => {
        expect(model("modtwo-note-miscgear-rope")).toEqual([]);
    });

    it("refuses an item a system defines, naming the remedy", () => {
        const lines = model("sohl-note-weapongear-dagger");
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/\.md:\d+:\d+: error: /);
        expect(lines[0]).toMatch(/`sohl` — a game system — defines/);
        expect(lines[0]).toMatch(/`sohl\.items` list instead/);
    });

    it("refuses a system reached through a module, at any level", () => {
        expect(
            itemPackages(
                config,
                new Map([
                    ["modone", ["modtwo"]],
                    ["modtwo", ["sohl"]],
                ]),
            ),
        ).toEqual(new Set(["demo", "modone", "modtwo"]));
        expect(model("sohl-note-weapongear-dagger")).toHaveLength(1);
    });

    it("refuses an item of a package that is not required as a module", () => {
        const lines = model("stray-note-miscgear-lantern");
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/does not require `stray` as a module/);
        expect(lines[0]).toMatch(/`relationships.requires` with `type: module`/);
    });

    it("refuses an Address that resolves to nothing", () => {
        const lines = model("weapongear-missing");
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/resolves to no note; correct the Address/);
    });

    it("refuses a note that is not an item note", () => {
        const lines = itemFindings(
            lint({
                "place.md": {
                    type: "place",
                    subType: "settlement",
                    shortcode: "vylar",
                    name: { full: "Vylar" },
                    data: { notes: "A place." },
                },
                "subject.md": being([{ model: "place-vylar" }]),
            }),
        ).filter((line) => /model/.test(line));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/names a `place` note, which is not an item note/);
    });

    it("refuses a document Address and names the note Address to write", () => {
        const lines = model("demo-sohl-weapongear-blade");
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/write the note Address `demo-note-weapongear-blade`/);
    });

    it("refuses a value that is no Address", () => {
        const lines = model("not an address");
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/is "not an address", which is not an accepted Address/);
    });

    it("reads the packages a configuration reaches", () => {
        expect(requiredModulePackages(config)).toEqual(["modone"]);
        expect(systemPackages(config).has("sohl")).toBe(true);
        expect([...itemPackages(config, new Map())].sort()).toEqual(["demo", "modone"]);
    });

    it("publishes the required modules once, on the package's own record", () => {
        const tree = path.join(root, "own-tree");
        write(path.join(tree, "a.md"), noteText(item("weapongear", "blade", { kind: "weapon" })));
        write(
            path.join(tree, "b.md"),
            noteText({ type: "lore", subType: "law", shortcode: "oath", name: { full: "Oath" } }),
        );
        const records = collectContentIndex(tree, {
            contentPackage: "demo",
            skipDirectories: [],
            requiredModules: ["modone"],
        });
        const packageRecords = records.filter(isPackageRecord);
        expect(packageRecords).toHaveLength(1);
        expect(packageRecords[0].packageModules).toEqual(["modone"]);
        expect(records.filter((record: any) => record.modules)).toEqual([]);
        expect(records.filter(isNoteRecord).every((record: any) => !record.packageModules)).toBe(
            true,
        );
    });

    it("publishes no package record for a package that requires no module", () => {
        const tree = path.join(root, "own-tree");
        const records = collectContentIndex(tree, { contentPackage: "demo", skipDirectories: [] });
        expect(records.filter(isPackageRecord)).toEqual([]);
    });
});

describe("transitive modules", () => {
    let chain: ReturnType<typeof configFromData>;
    let chainRoot: string;

    /** A configuration requiring `modone`, with an optional `recommends` of `modtwo`. */
    function chainConfig(recommendsTwo: boolean) {
        return configFromData(
            {
                contentPackage: "demo",
                packageKind: "modules",
                compatibility: { minimum: "14", verified: "14.367" },
                stats: { lastModifiedBy: "itementries00000" },
                packs: [{ name: "journals", type: "JournalEntry", default: true }],
                relationships: {
                    systems: [
                        {
                            id: "sohl",
                            manifest: MANIFEST,
                            compatibility: { minimum: "0.8.2", verified: "0.8.2" },
                        },
                    ],
                    requires: [{ id: "modone", manifest: MANIFEST, type: "module" }],
                    ...(recommendsTwo ?
                        { recommends: [{ id: "modtwo", manifest: MANIFEST, itemCatalog: true }] }
                    :   {}),
                },
            },
            path.join(chainRoot, "package-build.config.yaml"),
        );
    }

    /** Publish into a chain's own cache. */
    function publishTo(cfg: typeof config, pkg: string, notes: object[], modules: string[] = []) {
        const tree = path.join(chainRoot, "published", pkg);
        notes.forEach((fm: any, at) => write(path.join(tree, `${at}.md`), noteText(fm)));
        const records = collectContentIndex(tree, {
            contentPackage: pkg,
            skipDirectories: [],
            requiredModules: modules,
        });
        const dir = metadataCacheDir(cfg, pkg, "1.0.0");
        write(path.join(dir, metadataFileName(pkg)), serializeContentIndex(records));
        markComplete(dir);
    }

    const lore = { type: "lore", subType: "law", shortcode: "oath", name: { full: "Oath" } };

    function lintWith(cfg: typeof config, address: string) {
        const content = path.join(chainRoot, `tree-${(counter += 1)}`);
        write(path.join(content, "subject.md"), noteText(being([{ model: address }])));
        const parsed = new Map();
        const records = indexRecordsFor({ contentBase: content, config: cfg, parsed });
        const index = buildLinkIndex(content, { config: cfg, records, parsed });
        const { findings } = lintFrontmatter(index, {
            schemas: NOTE_SCHEMAS,
            vocabulary: NOTE_VOCABULARY,
        });
        return findings
            .map((finding: any) => finding.message)
            .filter((m: string) => /model/.test(m));
    }

    beforeAll(() => {
        chainRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "item-chain-")));
        write(
            path.join(chainRoot, "package.json"),
            JSON.stringify({ name: "demo", version: "1.0.0" }),
        );
        chain = chainConfig(false);
        publishTo(chain, "modone", [lore], ["modtwo"]);
        publishTo(chain, "modtwo", [item("miscgear", "rope")], ["sohl"]);
        publishTo(chain, "sohl", [item("weapongear", "dagger", { kind: "weapon" })]);
    });

    afterAll(() => fs.rmSync(chainRoot, { recursive: true, force: true }));

    it("resolves a model through a module holding only lore, without a declaration", () => {
        expect(lintWith(chain, "modtwo-note-miscgear-rope")).toEqual([]);
    });

    it("resolves the same model when the module is also declared", () => {
        const declared = chainConfig(true);
        expect(lintWith(declared, "modtwo-note-miscgear-rope")).toEqual([]);
    });

    it("still refuses a system reached through a module at any depth", () => {
        const lines = lintWith(chain, "sohl-note-weapongear-dagger");
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/a game system — defines/);
    });

    it("names an uncached module's item as resolving to no note", () => {
        const lines = lintWith(chain, "modtwo-note-miscgear-missing");
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/resolves to no note/);
    });

    it("does not load the index of a package reached only through a system", () => {
        publishTo(chain, "sohl", [item("weapongear", "dagger", { kind: "weapon" })], ["viasystem"]);
        publishTo(chain, "viasystem", [item("miscgear", "flask")]);
        const lines = lintWith(chain, "viasystem-note-miscgear-flask");
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/does not require `viasystem` as a module/);
    });
});

describe("`key`", () => {
    it("is unique within `data.items`", () => {
        const lines = lint({
            "subject.md": being([
                { key: "a", name: "Rope", kind: "miscgear" },
                { key: "b", name: "Cord", kind: "miscgear" },
                { key: "a", name: "Twine", kind: "miscgear" },
            ]),
        });
        const repeats = lines.filter((line) => /already the key of/.test(line));
        expect(repeats).toHaveLength(1);
        expect(repeats[0]).toMatch(/items\[2\]\.key` "a" is already the key of `data\.items\[0\]`/);
        expect(repeats[0]).toMatch(/give this entry its own `key`/);
    });

    it("is unique within each system's list, and may repeat across lists", () => {
        const lines = lint({
            "subject.md": {
                ...being([{ key: "a", name: "Rope", kind: "miscgear" }]),
                sohl: {
                    items: [
                        { key: "a", model: "skill-awar" },
                        { key: "a", model: "skill-blad" },
                    ],
                },
                hm3: { items: [{ key: "a", model: "skill-blad" }] },
            },
        });
        const repeats = lines.filter((line) => /already the key of/.test(line));
        expect(repeats).toHaveLength(1);
        expect(repeats[0]).toMatch(
            /sohl\.items\[1\]\.key` "a" is already the key of `sohl\.items\[0\]`/,
        );
    });
});

describe("an item note", () => {
    it("states `kind`, and may state `name`, `img` and `system`", () => {
        const lines = lint({
            "blade.md": item("weapongear", "blade", {
                kind: "weapon",
                name: "Blade",
                system: { subType: "sword", quantity: 1, weight: 1.5 },
            }),
        });
        expect(lines.filter((line) => /blade\.md/.test(line) && /kind|system/.test(line))).toEqual(
            [],
        );
    });

    it.each(ITEM_NOTE_TYPES)("requires `data.kind` on a %s note", (type) => {
        const lines = lint({ "thing.md": item(type, "thing", {}) });
        expect(
            lines.filter((line) => /states what sort of item it is; add `data.kind`/.test(line)),
        ).toHaveLength(1);
    });

    it("refuses a `kind` outside the list", () => {
        const lines = lint({ "thing.md": item("miscgear", "thing", { kind: "trinket" }) });
        expect(lines.some((line) => /data\.kind` should be .*"trinket"/.test(line))).toBe(true);
    });

    it("refuses a non-number `system.weight`", () => {
        const lines = lint({
            "thing.md": item("miscgear", "thing", {
                kind: "miscgear",
                system: { weight: "heavy" },
            }),
        });
        expect(lines.some((line) => /data\.system\.weight` should be number/.test(line))).toBe(
            true,
        );
    });
});

describe("resolved item defaults in the content index", () => {
    for (const [system, Compiler] of [
        ["sohl", Actors],
        ["hm3", Hm3Actors],
    ] as const) {
        for (const foreign of [false, true]) {
            it(`${system} compiles a ${foreign ? "required-module" : "local"} model through the normal corpus`, async () => {
                const content = path.join(root, `corpus-${(counter += 1)}`);
                const model = foreign ? "modone-note-weapongear-axe" : "weapongear-blade";
                if (!foreign)
                    write(
                        path.join(content, "model.md"),
                        noteText({
                            ...item("weapongear", "blade", { kind: "weapon", name: "Blade" }),
                            [system]: {
                                type: "weapongear",
                                templatePriority: null,
                                system: { weight: 3 },
                            },
                        }),
                    );
                write(
                    path.join(content, "being.md"),
                    noteText({ ...being([{ model }]), [system]: {} }),
                );
                const problems: object[] = [];
                const corpus = await buildCompileCorpus({
                    contentBase: content,
                    skipDirectories: [],
                    router: routerFor(config),
                    config,
                    problems,
                });
                expect(problems).toEqual([]);
                if (foreign)
                    corpus.linkIndex.foreign.set("modone-note-weapongear-axe", {
                        anchors: {
                            $lead: "Compendium.modone.docs.JournalEntry.axe.JournalEntryPage.intro",
                        },
                    });
                const compiler = new Compiler({
                    contentBase: content,
                    dest: path.join(root, "out"),
                    skipDirectories: [],
                    corpus,
                    packSystem: system,
                });
                await compiler.prepare();
                const fm = corpus.records.find((r: any) => isNoteRecord(r) && r.type === "being");
                const items = compiler.buildEmbeddedItems(
                    compiler.itemsMap,
                    "actor0000000000",
                    fm,
                    "test",
                );
                expect(items).toHaveLength(1);
                expect(items[0]).toMatchObject({ type: "weapongear", system: { weight: 3 } });
                if (foreign)
                    expect(items[0].system[system === "sohl" ? "docHtml" : "description"]).toBe(
                        "@UUID[Compendium.modone.docs.JournalEntry.axe.JournalEntryPage.intro]{axe}",
                    );
                expect(compiler.errorCount).toBe(0);
            });
        }
    }
    it("compiles a required module model from its index without a catalogue", () => {
        const content = path.join(root, `resolved-${(counter += 1)}`);
        write(
            path.join(content, "being.md"),
            noteText({ ...being([{ model: "modone-note-weapongear-axe" }]), sohl: {} }),
        );
        const parsed = new Map();
        const records = indexRecordsFor({ contentBase: content, config, parsed });
        const compiler = new Actors({
            contentBase: content,
            dest: path.join(root, "out"),
            skipDirectories: [],
            folderResolver: () => {
                throw new Error("local folder resolver called");
            },
        });
        compiler.corpus = { records } as any;
        compiler.linkIndex = buildContentLinkIndex(content, routerFor(config), { config, records });
        const fm = records.find((r: any) => isNoteRecord(r) && r.type === "being");
        const items = compiler.buildEmbeddedItems(new Map(), "actor0000000000", fm, "test");
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ name: "axe", system: { weight: 3, shortcode: "axe" } });
        expect(items[0]).not.toHaveProperty("folder");
        expect(compiler.errorCount).toBe(0);
    });
    it("compiles a model-only entry through the content index and item catalogue", () => {
        const content = path.join(root, `resolved-${(counter += 1)}`);
        const model = {
            ...item("weapongear", "blade", {
                kind: "weapon",
                name: "Blade",
                system: { quantity: 2 },
            }),
            sohl: { type: "weapongear", system: { weight: 3 } },
        };
        write(path.join(content, "model.md"), noteText(model));
        write(
            path.join(content, "being.md"),
            noteText({ ...being([{ model: "weapongear-blade" }]), sohl: {} }),
        );
        const parsed = new Map();
        const records = indexRecordsFor({ contentBase: content, config, parsed });
        const linkIndex = buildContentLinkIndex(content, routerFor(config), { config, records });
        const fm = records.find((r: any) => isNoteRecord(r) && r.type === "being");
        const compiler = new Actors({
            contentBase: content,
            dest: path.join(root, "out"),
            skipDirectories: [],
        });
        compiler.linkIndex = linkIndex;
        compiler.corpus = { records } as any;
        const catalogue = new Map([
            [
                "demo:weapongear:blade",
                { type: "weapongear", name: "Compiled", system: { shortcode: "blade", weight: 3 } },
            ],
        ]);
        const items = compiler.buildEmbeddedItems(catalogue, "actor0000000000", fm, "test");
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ name: "Blade", system: { quantity: 2, weight: 3 } });
        expect(compiler.errorCount).toBe(0);
    });
    it("retains entry identity and merges neutral fields from a local model", () => {
        const content = path.join(root, `resolved-${(counter += 1)}`);
        write(
            path.join(content, "model.md"),
            noteText(
                item("weapongear", "blade", {
                    kind: "weapon",
                    name: "Blade",
                    system: { quantity: 1, weight: 3 },
                    packFolder: "weapons",
                }),
            ),
        );
        write(
            path.join(content, "being.md"),
            noteText(
                being([
                    {
                        key: "blade",
                        model: "weapongear-blade",
                        chance: 60,
                        system: { quantity: 2 },
                    },
                ]),
            ),
        );
        const records = indexRecordsFor({ contentBase: content, config });
        const record = records.find((r: any) => isNoteRecord(r) && r.type === "being");
        expect(record.data.items[0]).toMatchObject({
            key: "blade",
            chance: 60,
            kind: "weapon",
            name: "Blade",
            system: { quantity: 2, weight: 3 },
        });
        expect(encodeAddresses(record.authoredItems)).toEqual([
            {
                key: "blade",
                model: "demo-note-weapongear-blade",
                chance: 60,
                system: { quantity: 2 },
            },
        ]);
        const published = JSON.parse(serializeContentIndex([record]).trim());
        const decoded = decodeIndexAddresses(published, { package: "demo" });
        expect(encodeAddresses(decoded.authoredItems)).toEqual([
            {
                key: "blade",
                model: "demo-note-weapongear-blade",
                chance: 60,
                system: { quantity: 2 },
            },
        ]);
        expect(record.data.items[0].model).toBeDefined();
        expect(record.data.items[0].packFolder).toBeUndefined();
    });

    it("transports authored and resolved entries through a published dependency index", () => {
        publish("fixture", [
            item("weapongear", "blade", { kind: "weapon", name: "Sword", system: { weight: 3 } }),
            being([{ key: "blade", model: "weapongear-blade", system: { quantity: 2 } }]),
        ]);
        const consumer = {
            ...config,
            relationships: { requires: [{ id: "fixture", type: "module", manifest: MANIFEST }] },
        };
        const foreign = loadForeignIndexes(consumer, new Set(["demo"])).index;
        const hit = foreign.get("fixture-sohl-being-subject");
        expect(hit).toBeDefined();
        expect(encodeAddresses(hit.data.items)).toMatchObject([
            {
                key: "blade",
                model: "fixture-note-weapongear-blade",
                kind: "weapon",
                name: "Sword",
                system: { quantity: 2, weight: 3 },
            },
        ]);
        expect(encodeAddresses(hit.authoredItems)).toEqual([
            { key: "blade", model: "fixture-note-weapongear-blade", system: { quantity: 2 } },
        ]);
    });

    it("resolves defaults from a required module's published index", () => {
        const content = path.join(root, `resolved-${(counter += 1)}`);
        write(
            path.join(content, "being.md"),
            noteText(being([{ model: "modone-note-weapongear-axe", name: "Hatchet" }])),
        );
        const records = indexRecordsFor({ contentBase: content, config });
        const record = records.find((r: any) => isNoteRecord(r) && r.type === "being");
        expect(record.data.items[0]).toMatchObject({ kind: "weapon", name: "Hatchet" });
    });
});
