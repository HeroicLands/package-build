/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { completeAddress } from "../engine/address.mjs";
import { checkAuthoredSystemData } from "../engine/schema-check.mjs";
import { Items } from "../sohl/items.mjs";
import { systemItemEntries } from "../engine/system-item-entries.mjs";
/** Install a model record and the normal compiler's foreign index view. */
function setModelIndex(compiler: any, index: any) {
    const hit = index.addressHit?.("demo-note-weapongear-blade");
    const model = hit?.fm ?? hit;
    compiler.corpus = {
        records:
            model ? [{ ...model, package: "demo", type: "weapongear", shortcode: "blade" }] : [],
    };
    compiler.linkIndex = { foreign: index.foreign?.index ?? new Map() };
}

describe("system item entries", () => {
    it("merges system defaults, neutral fields and matching overrides once", () => {
        const neutral = [
            {
                key: "a",
                model: "blade",
                kind: "weapon",
                name: "Small blade",
                system: { quantity: 2, tags: ["neutral"] },
            },
        ];
        const system = [
            { key: "a", type: "weapongear", system: { weight: 4, tags: ["system"] } },
            { type: "skill", name: "Climb" },
        ];
        const model = {
            sohl: { type: "weapongear", system: { quantity: 1, weight: 3, reach: 2 } },
        };
        const result = systemItemEntries(neutral, system, "sohl", () => model);
        expect(result.entries).toEqual([
            {
                key: "a",
                model: "blade",
                type: "weapongear",
                name: "Small blade",
                system: { quantity: 2, weight: 4, reach: 2, tags: ["system"] },
            },
        ]);
        expect(result.remaining).toEqual([system[1]]);
        expect(neutral[0].kind).toBe("weapon");
    });
    it("accepts an inline item only when its matching system entry supplies a type", () => {
        const result = systemItemEntries(
            [
                { key: "a", kind: "weapon", name: "A" },
                { kind: "armor", name: "B" },
            ],
            [{ key: "a", type: "weapongear" }],
            "hm3",
            () => undefined,
        );
        expect(result.entries).toEqual([{ key: "a", name: "A", type: "weapongear" }]);
        expect(result.remaining).toEqual([]);
        expect(result.missingType).toEqual([]);
    });
    it("reports an existing model block lacking type but ignores an absent block", () => {
        const result = systemItemEntries([{ model: "a" }, { model: "b" }], [], "sohl", (model) =>
            model === "a" ? { sohl: { system: {} } } : {},
        );
        expect(result.entries).toEqual([]);
        expect(result.missingType).toEqual([0]);
    });
    it("keeps a matching system entry when the model block lacks a type", () => {
        const declared = [{ key: "a", type: "weapongear", name: "Blade", system: {} }];
        const result = systemItemEntries([{ key: "a", model: "blade" }], declared, "sohl", () => ({
            sohl: { system: {} },
        }));
        expect(result.missingType).toEqual([0]);
        expect(result.remaining).toEqual(declared);
        expect(result.remainingIndices).toEqual([0]);
    });
});

import { Actors } from "../sohl/actors.mjs";
import { Hm3Actors } from "../hm3/actors.mjs";

it("propagates receiving-schema findings from the indexed model compiler", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "item-model-schema-"));
    fs.mkdirSync(path.join(root, "build"));
    fs.writeFileSync(
        path.join(root, "build", "schema.json"),
        JSON.stringify({
            version: 1,
            system: "sohl",
            systemVersion: "1.0.0",
            documents: { Item: { weapongear: { own: ["weight"], inherited: [] } } },
        }),
    );
    const config = {
        rootDir: root,
        packageKind: "systems",
        foundryPackage: "sohl",
        stats: { systemId: "sohl", systemVersion: "1.0.0" },
    };
    const check = vi
        .spyOn(Items.prototype, "reportUndeclaredSystemData")
        .mockImplementation(function (fm, block, documentType, subType) {
            expect(this.packSystem).toBe("sohl");
            const findings = checkAuthoredSystemData(fm, {
                block,
                documentType,
                subType,
                system: this.packSystem,
                config,
            });
            this.errorCount += findings.length;
            return findings.length;
        });
    const emitted = vi
        .spyOn(Items.prototype, "reportEmittedSystemData")
        .mockImplementation(function () {
            this.emittedFindings.set("Item|weapongear|invalid", {
                message: "invalid emitted field",
            });
            return 1;
        });
    try {
        const compiler = new Actors({ contentBase: ".", dest: ".", skipDirectories: [] });
        const model = completeAddress({
            package: "demo",
            system: "note",
            type: "weapongear",
            shortcode: "blade",
        });
        setModelIndex(compiler, {
            addressHit: () => ({
                type: "weapongear",
                shortcode: "blade",
                id: "item000000000000",
                name: { full: "Blade" },
                data: { kind: "weapon" },
                sohl: { type: "weapongear", templatePriority: null, system: { invalid: 1 } },
            }),
        } as any);
        const items = compiler.buildEmbeddedItems(
            new Map(),
            "actor0000000000",
            { data: { items: [{ model }] }, sohl: {} },
            "test",
        );
        expect(items).toEqual([]);
        expect(compiler.errorCount).toBe(1);
        expect(compiler.emittedFindings.has("Item|weapongear|invalid")).toBe(true);
    } finally {
        check.mockRestore();
        emitted.mockRestore();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

for (const [system, Compiler] of [
    ["sohl", Actors],
    ["hm3", Hm3Actors],
] as const) {
    describe(`${system} neutral embedded items`, () => {
        it("locates a missing documentation page at the neutral model and gives a remedy", () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), "item-model-position-"));
            const file = path.join(dir, "being.md");
            fs.writeFileSync(
                file,
                `---\n${system}:\n  items:\n    - type: weapongear\ndata:\n  items:\n    - model: weapongear-blade\n---\n`,
            );
            try {
                const compiler = new Compiler({ contentBase: dir, dest: dir, skipDirectories: [] });
                compiler.currentNote = { absPath: file };
                const error = vi.spyOn(compiler, "noteError").mockImplementation(() => {});
                const model = completeAddress({
                    package: "demo",
                    system: "note",
                    type: "weapongear",
                    shortcode: "blade",
                });
                setModelIndex(compiler, {
                    addressHit: () => ({
                        type: "weapongear",
                        shortcode: "blade",
                        id: "item000000000000",
                        name: { full: "Blade" },
                        data: { kind: "weapon" },
                        [system]: { type: "weapongear", templatePriority: null },
                    }),
                    foreign: {
                        index: new Map([
                            [
                                "demo-note-weapongear-blade",
                                { uuid: "Compendium.demo.docs.JournalEntry.blade" },
                            ],
                        ]),
                    },
                } as any);
                compiler.buildEmbeddedItems(
                    new Map(),
                    "actor0000000000",
                    { data: { items: [{ model }] }, [system]: {} },
                    "test",
                );
                expect(error).toHaveBeenCalledWith(
                    expect.stringMatching(/publish.*page.*correct.*model/i),
                    expect.objectContaining({ line: 7 }),
                );
                expect(compiler.errorCount).toBe(1);
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        });
        it("replaces a model's list with the same-key system list", () => {
            const compiler = new Compiler({ contentBase: ".", dest: ".", skipDirectories: [] });
            const model = completeAddress({
                package: "demo",
                system: "note",
                type: "weapongear",
                shortcode: "blade",
            });
            setModelIndex(compiler, {
                addressHit: () => ({ fm: { [system]: { type: "weapongear" } } }),
            } as any);
            const catalogue = new Map([
                [
                    "demo:weapongear:blade",
                    {
                        type: "weapongear",
                        name: "Blade",
                        effects: [{ _id: "effectold0000000" }],
                        system: { shortcode: "blade" },
                    },
                ],
            ]);
            const fm = {
                data: { items: [{ key: "a", model }] },
                [system]: {
                    items: [
                        { key: "a", type: "weapongear", effects: [{ _id: "effectnew0000000" }] },
                    ],
                },
            };
            const items = compiler.buildEmbeddedItems(catalogue, "actor0000000000", fm, "test");
            expect(items).toHaveLength(1);
            expect(items[0].effects.map((effect: any) => effect._id)).toEqual(["effectnew0000000"]);
        });
        it("does not resolve a foreign model's pack folder while embedding", () => {
            const compiler = new Compiler({
                contentBase: ".",
                dest: ".",
                skipDirectories: [],
                folderResolver: () => {
                    throw new Error("local folder resolver called");
                },
            });
            const model = completeAddress({
                package: "demo",
                system: "note",
                type: "weapongear",
                shortcode: "blade",
            });
            setModelIndex(compiler, {
                addressHit: () => ({
                    type: "weapongear",
                    shortcode: "blade",
                    id: "item000000000000",
                    name: { full: "Blade" },
                    data: { kind: "weapon", packFolder: "demo-note-folder-weapons" },
                    [system]: { type: "weapongear", templatePriority: null, system: { weight: 3 } },
                }),
            } as any);
            const items = compiler.buildEmbeddedItems(
                new Map(),
                "actor0000000000",
                { data: { items: [{ model }] }, [system]: {} },
                "test",
            );
            expect(items).toHaveLength(1);
            expect(items[0]).not.toHaveProperty("folder");
            expect(compiler.errorCount).toBe(0);
        });
        it("uses the model's catalogue identity when a same-key entry overrides its type", () => {
            const compiler = new Compiler({ contentBase: ".", dest: ".", skipDirectories: [] });
            const model = completeAddress({
                package: "demo",
                system: "note",
                type: "weapongear",
                shortcode: "blade",
            });
            setModelIndex(compiler, {
                addressHit: () => ({
                    type: "weapongear",
                    shortcode: "blade",
                    id: "item000000000000",
                    name: { full: "Blade" },
                    data: { kind: "weapon" },
                    [system]: { type: "weapongear", templatePriority: null, system: { weight: 3 } },
                }),
            } as any);
            const catalogue = new Map([
                [
                    "demo:weapongear:blade",
                    {
                        type: "weapongear",
                        name: "Blade",
                        img: "catalogue.webp",
                        system: { shortcode: "blade", weight: 3 },
                    },
                ],
            ]);
            const fm = {
                data: { items: [{ key: "a", model }] },
                [system]: { items: [{ key: "a", type: "armorgear" }] },
            };
            const items = compiler.buildEmbeddedItems(catalogue, "actor0000000000", fm, "test");
            expect(items).toHaveLength(1);
            expect(items[0]).toMatchObject({
                type: "armorgear",
                img: "catalogue.webp",
                system: { weight: 3 },
            });
            expect(catalogue.has("demo:armorgear:blade")).toBe(false);
            expect(compiler.errorCount).toBe(0);

            const fallback = new Map();
            const secondCompiler = new Compiler({
                contentBase: ".",
                dest: ".",
                skipDirectories: [],
            });
            secondCompiler.linkIndex = compiler.linkIndex;
            secondCompiler.corpus = compiler.corpus;
            const rebuilt = secondCompiler.buildEmbeddedItems(
                fallback,
                "actor0000000001",
                fm,
                "test",
            );
            expect(rebuilt).toHaveLength(1);
            expect(rebuilt[0]).toMatchObject({ type: "armorgear", system: { weight: 3 } });
            expect(fallback.has("demo:weapongear:blade")).toBe(true);
            expect(fallback.has("demo:armorgear:blade")).toBe(false);
            expect(secondCompiler.errorCount).toBe(0);
        });
        it("uses a required module's indexed model without a compiled catalogue", () => {
            const compiler = new Compiler({ contentBase: ".", dest: ".", skipDirectories: [] });
            const model = completeAddress({
                package: "demo",
                system: "note",
                type: "weapongear",
                shortcode: "blade",
            });
            setModelIndex(compiler, {
                addressHit: () => ({
                    type: "weapongear",
                    shortcode: "blade",
                    id: "item000000000000",
                    name: { full: "Blade" },
                    data: { kind: "weapon", system: { quantity: 2 } },
                    [system]: { type: "weapongear", templatePriority: null, system: { weight: 3 } },
                }),
                foreign: {
                    index: new Map([
                        [
                            "demo-note-weapongear-blade",
                            {
                                anchors: {
                                    $lead: "Compendium.demo.docs.JournalEntry.blade.JournalEntryPage.intro",
                                },
                            },
                        ],
                    ]),
                },
            } as any);
            const fm = { data: { items: [{ model }] }, [system]: {} };
            const items = compiler.buildEmbeddedItems(new Map(), "actor0000000000", fm, "test");
            expect(items).toHaveLength(1);
            expect(items[0]).toMatchObject({ name: "Blade", system: { quantity: 2, weight: 3 } });
            expect(items[0].system[system === "sohl" ? "docHtml" : "description"]).toBe(
                "@UUID[Compendium.demo.docs.JournalEntry.blade.JournalEntryPage.intro]{Blade}",
            );
            expect(compiler.errorCount).toBe(0);
        });
        it("emits an inline item with a type and silently skips absent system blocks", () => {
            const compiler = new Compiler({ contentBase: ".", dest: ".", skipDirectories: [] });
            const model = completeAddress({
                package: "demo",
                system: "note",
                type: "weapongear",
                shortcode: "blade",
            });
            setModelIndex(compiler, {
                addressHit: () => ({ fm: { data: { kind: "weapon", name: "Blade" } } }),
            } as any);
            const fm = {
                data: {
                    items: [
                        { model },
                        {
                            key: "a",
                            name: "Inline",
                            kind: "weapon",
                            system: { shortcode: "inline" },
                        },
                        { name: "Unmapped", kind: "armor" },
                    ],
                },
                [system]: { items: [{ key: "a", type: "weapongear" }] },
            };
            const items = compiler.buildEmbeddedItems(new Map(), "actor0000000000", fm, "test");
            expect(items).toHaveLength(1);
            expect(items[0].name).toBe("Inline");
            expect(compiler.errorCount).toBe(0);
        });
        it("reports a model block without a type", () => {
            const compiler = new Compiler({ contentBase: ".", dest: ".", skipDirectories: [] });
            const model = completeAddress({
                package: "demo",
                system: "note",
                type: "weapongear",
                shortcode: "blade",
            });
            setModelIndex(compiler, {
                addressHit: () => ({ fm: { [system]: { system: {} } } }),
            } as any);
            const fm = { data: { items: [{ model }] }, [system]: {} };
            expect(compiler.buildEmbeddedItems(new Map(), "actor0000000000", fm, "test")).toEqual(
                [],
            );
            expect(compiler.errorCount).toBe(1);
        });
        it("reports a missing model type while retaining the matching system item", () => {
            const compiler = new Compiler({ contentBase: ".", dest: ".", skipDirectories: [] });
            const model = completeAddress({
                package: "demo",
                system: "note",
                type: "weapongear",
                shortcode: "blade",
            });
            setModelIndex(compiler, {
                addressHit: () => ({ fm: { [system]: { system: {} } } }),
            } as any);
            const fm = {
                data: { items: [{ key: "a", model }] },
                [system]: {
                    items: [
                        {
                            key: "a",
                            type: "weapongear",
                            name: "Blade",
                            system: { shortcode: "blade" },
                        },
                    ],
                },
            };
            const items = compiler.buildEmbeddedItems(new Map(), "actor0000000000", fm, "test");
            expect(items).toHaveLength(1);
            expect(items[0].name).toBe("Blade");
            expect(compiler.errorCount).toBe(1);
        });
        it("reports a missing subclass item compiler", () => {
            class IncompleteCompiler extends Compiler {
                static itemCompiler = undefined;
            }
            const compiler = new IncompleteCompiler({
                contentBase: ".",
                dest: ".",
                skipDirectories: [],
            });
            const model = completeAddress({
                package: "demo",
                system: "note",
                type: "weapongear",
                shortcode: "blade",
            });
            setModelIndex(compiler, {
                addressHit: () => ({
                    type: "weapongear",
                    shortcode: "blade",
                    [system]: { type: "weapongear" },
                }),
            } as any);
            expect(() =>
                compiler.buildEmbeddedItems(
                    new Map(),
                    "actor0000000000",
                    { data: { items: [{ model }] }, [system]: {} },
                    "test",
                ),
            ).toThrow(/IncompleteCompiler must declare a static itemCompiler/);
        });
        it.each(["elixir", "potion", "simples"])(
            "compiles a model with kind %s without mapping its type",
            (kind) => {
                const compiler = new Compiler({ contentBase: ".", dest: ".", skipDirectories: [] });
                const model = completeAddress({
                    package: "demo",
                    system: "note",
                    type: "weapongear",
                    shortcode: "blade",
                });
                const note = {
                    data: { kind, name: "Model name" },
                    [system]: { type: "weapongear", system: { weight: 3 } },
                };
                setModelIndex(compiler, { addressHit: () => ({ fm: note }) } as any);
                const catalogue = new Map([
                    [
                        "demo:weapongear:blade",
                        {
                            type: "weapongear",
                            name: "Compiled",
                            system: { shortcode: "blade", weight: 3 },
                        },
                    ],
                ]);
                const items = compiler.buildEmbeddedItems(
                    catalogue,
                    "actor0000000000",
                    { data: { items: [{ model }] }, [system]: {} },
                    "test",
                );
                expect(items).toHaveLength(1);
                expect(items[0]).toMatchObject({
                    type: "weapongear",
                    name: "Model name",
                    system: { weight: 3 },
                });
                expect(items[0]).not.toHaveProperty("kind");
            },
        );
        it("uses neutral model defaults and applies entry fields", () => {
            const compiler = new Compiler({ contentBase: ".", dest: ".", skipDirectories: [] });
            const model = completeAddress({
                package: "demo",
                system: "note",
                type: "weapongear",
                shortcode: "blade",
            });
            const note = {
                data: { kind: "weapon", name: "Model name", system: { quantity: 2, weight: 7 } },
                [system]: { type: "weapongear", system: { weight: 3 } },
            };
            setModelIndex(compiler, { addressHit: () => ({ fm: note }) } as any);
            const catalogue = new Map([
                [
                    `demo:weapongear:blade`,
                    {
                        type: "weapongear",
                        name: "Compiled",
                        system: { shortcode: "blade", weight: 3 },
                    },
                ],
            ]);
            const fm = { data: { items: [{ model, system: { quantity: 4 } }] }, [system]: {} };
            const items = compiler.buildEmbeddedItems(catalogue, "actor0000000000", fm, "test");
            expect(items).toHaveLength(1);
            expect(items[0]).toMatchObject({
                name: "Model name",
                system: { quantity: 4, weight: 7 },
            });
        });
        it("embeds a model once and applies its same-key override", () => {
            const compiler = new Compiler({ contentBase: ".", dest: ".", skipDirectories: [] });
            const model = completeAddress({
                package: "demo",
                system: "note",
                type: "weapongear",
                shortcode: "blade",
            });
            const note = { [system]: { type: "weapongear", system: { weight: 3 } } };
            setModelIndex(compiler, { addressHit: () => ({ fm: note }) } as any);
            const catalogue = new Map([
                [
                    `${system}:weapongear:blade`,
                    {
                        type: "weapongear",
                        name: "Blade",
                        system: { shortcode: "blade", weight: 3, quantity: 1 },
                    },
                ],
                [
                    `demo:weapongear:blade`,
                    {
                        type: "weapongear",
                        name: "Blade",
                        system: { shortcode: "blade", weight: 3, quantity: 1 },
                    },
                ],
            ]);
            const fm = {
                data: {
                    items: [
                        {
                            key: "a",
                            model,
                            kind: "weapon",
                            name: "Short blade",
                            system: { quantity: 2 },
                        },
                    ],
                },
                [system]: { items: [{ key: "a", type: "weapongear", system: { weight: 4 } }] },
            };
            const items = compiler.buildEmbeddedItems(catalogue, "actor0000000000", fm, "test");
            expect(items).toHaveLength(1);
            expect(items[0]).toMatchObject({
                name: "Short blade",
                system: { quantity: 2, weight: 4 },
            });
            expect(items[0]).not.toHaveProperty("kind");
            expect(items[0]).not.toHaveProperty("key");
        });
    });
}
