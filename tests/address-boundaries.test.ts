/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import {
    decodeIndexAddresses,
    decodeNoteAddresses,
    encodeAddresses,
    addressPositions,
    AddressEntries,
} from "../engine/note-addresses.mjs";
import { isAddressTuple } from "../engine/address.mjs";
import { dataFields, NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { ITEM_FIELDS } from "../sohl/item-fields.mjs";
import { buildIndexRecord, serializeContentIndex } from "../engine/content-index.mjs";
import { cloneAddressState } from "../engine/address-values.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { resolveShortcodeReference } from "../engine/shortcode-references.mjs";
import { resolveInfoboxRef } from "../engine/site-index.mjs";
import { SystemActorCompiler } from "../engine/actor-compiler.mjs";
import { resolveReference } from "../engine/wikilinks.mjs";
import { beingSections } from "../sohl/infobox.mjs";
import { presentValue } from "../engine/infobox.mjs";
import { buildReferenceTargets } from "../engine/reference-targets.mjs";
const context = {
    package: "world",
    system: "note",
    systemBlocks: { sohl: { fields: ITEM_FIELDS } },
};
describe("Address read and write boundaries", () => {
    it("stores equal complete tuples for alternate authored spellings", () => {
        const a = decodeNoteAddresses({ type: "place", data: { parents: ["north"] } }, context);
        const b = decodeNoteAddresses(
            { type: "place", data: { parents: ["world-note-place-north"] } },
            context,
        );
        expect(a.data.parents).toEqual(b.data.parents);
        expect(isAddressTuple(a.data.parents[0])).toBe(true);
        expect(encodeAddresses(a).data.parents).toEqual(["world-note-place-north"]);
    });
    it("derives every vocabulary position instead of duplicating the field list", () => {
        for (const type of Object.keys(NOTE_VOCABULARY)) {
            const positions = addressPositions({ type });
            for (const field of dataFields(type))
                if ([field.kind, field.entryKind, field.keyKind].includes("address")) {
                    expect(positions.some((p) => p.path.join(".") === `data.${field.name}`)).toBe(
                        true,
                    );
                }
        }
    });
    it("decodes and emits every registry position using generated specimens", () => {
        let count = 0;
        for (const type of Object.keys(NOTE_VOCABULARY)) {
            for (const p of addressPositions({ type }, context)) {
                const fm: any = { type };
                let owner = fm;
                p.path.forEach((part, index) => {
                    const key = part === "*" ? 0 : part;
                    if (index === p.path.length - 1) {
                        const text = `${p.type ?? "lore"}-sample`;
                        owner[key] =
                            p.shape === "keys" ? { [text]: "rival" }
                            : p.shape === "list" ? [text]
                            : p.shape === "scalar-or-map" ? { default: text }
                            : text;
                    } else owner = owner[key] = p.path[index + 1] === "*" ? [] : {};
                });
                decodeNoteAddresses(fm, context);
                const read = (tree: any) =>
                    p.path.reduce((value, key) => value[key === "*" ? 0 : key], tree);
                const result = read(fm);
                const tuple =
                    p.shape === "keys" ? result.entries[0].target
                    : p.shape === "list" ? result[0]
                    : p.shape === "scalar-or-map" ? result.default
                    : result;
                expect(isAddressTuple(tuple), `${type}:${p.path.join(".")}`).toBe(true);
                expect(JSON.stringify(read(encodeAddresses(fm)))).toContain(
                    `world-${tuple.system}-${tuple.type}-sample`,
                );
                count++;
            }
        }
        expect(count).toBeGreaterThan(0);
    });
    it("decodes structured references, art, folder maps and embedded models", () => {
        const fm = decodeNoteAddresses(
            {
                type: "affiliation",
                packFolder: { default: "root" },
                data: { governance: { ranks: [{ lore: "freefolk" }] } },
                sohl: {
                    items: [
                        {
                            model: "skill-sword",
                            data: { icon: "image-blade" },
                            system: { shortcode: "mine" },
                        },
                    ],
                },
            },
            context,
        );
        expect(isAddressTuple(fm.packFolder.default)).toBe(true);
        expect(isAddressTuple(fm.data.governance.ranks[0].lore)).toBe(true);
        expect(fm.sohl.items[0].model).toEqual({
            package: "world",
            system: "sohl",
            type: "skill",
            shortcode: "sword",
        });
        expect(fm.sohl.items[0].data.icon.system).toBe("none");
        expect(fm.sohl.items[0].system.shortcode).toBe("mine");
    });
    it("keeps relation keys as tuples and renders only at output", () => {
        const fm = decodeNoteAddresses(
            { type: "affiliation", data: { relations: { "affiliation-guild": "rival" } } },
            context,
        );
        expect(fm.data.relations).toBeInstanceOf(AddressEntries);
        expect(fm.data.relations.entries[0].target).toEqual({
            package: "world",
            system: "note",
            type: "affiliation",
            shortcode: "guild",
        });
        expect(encodeAddresses(fm).data.relations).toEqual({
            "world-note-affiliation-guild": "rival",
        });
    });
    it("uses enclosing system context while preserving native species and Shortcodes", () => {
        const fm = decodeNoteAddresses(
            {
                type: "being",
                data: { species: "human" },
                hm3: { system: { species: "Human" } },
                sohl: { system: { parentSkillCode: "sword" } },
            },
            context,
        );
        expect(fm.data.species.shortcode).toBe("human");
        expect(fm.hm3.system.species).toBe("Human");
        expect(fm.sohl.system.parentSkillCode).toBe("sword");
    });
    it("derives system destinations from declarations and preserves their enclosing context", () => {
        const fm = decodeNoteAddresses(
            {
                type: "affiliation",
                data: { parents: ["guild"] },
                sohl: { system: { parents: ["guild"] } },
            },
            context,
        );
        expect(fm.data.parents[0].system).toBe("note");
        expect(fm.sohl.system.parents[0].system).toBe("sohl");
        const custom = {
            package: "world",
            systemBlocks: {
                sohl: {
                    fields: {
                        place: [
                            {
                                name: "data.neighbour",
                                to: "territory",
                                legacyKey: "neighbour",
                                address: { type: "place", accepts: ["place"] },
                            },
                        ],
                    },
                },
            },
        };
        const next = decodeNoteAddresses(
            { type: "place", sohl: { system: { territory: "north" } } },
            custom,
        );
        expect(isAddressTuple(next.sohl.system.territory)).toBe(true);
    });
    it("refuses two spellings of one map key before serialization can discard a standing", () => {
        const fm = decodeNoteAddresses(
            {
                type: "affiliation",
                data: {
                    relations: { guild: "rival", "world-note-affiliation-guild": "aligned" },
                },
            },
            context,
        );
        expect(() => encodeAddresses(fm)).toThrow("Repeated Address map key");
    });
    it("refuses authored object values that resemble internal tuples", () => {
        expect(() =>
            decodeNoteAddresses(
                {
                    type: "being",
                    data: {
                        species: {
                            package: "world",
                            system: "none",
                            type: "lore",
                            shortcode: "human",
                        },
                    },
                },
                context,
            ),
        ).toThrow();
    });
    it("decodes both structured place destinations independently", () => {
        const fm = decodeNoteAddresses(
            {
                type: "place",
                data: { borders: [{ to: "north" }], routes: [{ to: "place-south" }] },
            },
            context,
        );
        expect(isAddressTuple(fm.data.borders[0].to)).toBe(true);
        expect(isAddressTuple(fm.data.routes[0].to)).toBe(true);
        expect(encodeAddresses(fm).data).toEqual({
            borders: [{ to: "world-note-place-north" }],
            routes: [{ to: "world-note-place-south" }],
        });
    });
    it("completes every accepted suffix without retaining authored spellings", () => {
        for (const value of [
            "north",
            "place-north",
            "note-place-north",
            "world-note-place-north",
        ]) {
            expect(
                encodeAddresses(
                    decodeNoteAddresses({ type: "place", data: { parents: [value] } }, context),
                ).data.parents,
            ).toEqual(["world-note-place-north"]);
        }
    });
    it("rejects malformed declared containers before generated output", () => {
        for (const data of [{ parents: "north" }, { parents: { north: true } }]) {
            expect(() =>
                encodeAddresses(decodeNoteAddresses({ type: "place", data }, context)),
            ).toThrow("must be a list");
        }
    });
    it("rejects invalid canonical index properties instead of dropping their identity", () => {
        for (const field of ["documentation", "documents"])
            expect(() =>
                decodeIndexAddresses({ type: "place", [field]: "place-north" }, context),
            ).toThrow("not a complete Address");
        expect(() =>
            decodeIndexAddresses({ type: "place", address: { canonical: "wrong" } }, context),
        ).toThrow("not a complete Address");
    });

    it("preserves accepted model case folding without changing native Shortcodes", () => {
        const fm = decodeNoteAddresses(
            {
                type: "being",
                sohl: { items: [{ model: "armorgear-LLeg", system: { shortcode: "LLeg" } }] },
            },
            context,
        );
        expect(encodeAddresses(fm).sohl.items[0]).toEqual({
            model: "world-sohl-armorgear-lleg",
            system: { shortcode: "LLeg" },
        });
        expect(() =>
            decodeNoteAddresses({ type: "place", data: { parents: ["North"] } }, context),
        ).toThrow();
    });
    it("derives embedded native Address overrides from the target type declaration", () => {
        const fm = decodeNoteAddresses(
            {
                type: "being",
                sohl: {
                    items: [
                        {
                            model: "affiliation-guild",
                            system: { seat: "north", relations: { rival: "hostile" } },
                        },
                    ],
                },
            },
            context,
        );
        expect(isAddressTuple(fm.sohl.items[0].system.seat)).toBe(true);
        expect(fm.sohl.items[0].system.relations).toBeInstanceOf(AddressEntries);
    });

    it("retains authored order internally while generated JSONL sorts keys", () => {
        const record = buildIndexRecord({
            frontmatter: {
                type: "being",
                shortcode: "person",
                sohl: { system: { body: { weight: 1, structure: 2 } } },
            },
            relPath: "Person.md",
            contentPackage: "world",
            body: "Prose.",
            addressContext: context,
        });
        expect(Object.keys(cloneAddressState(record).sohl.system.body)).toEqual([
            "weight",
            "structure",
        ]);
        expect(Object.keys(JSON.parse(serializeContentIndex([record])).sohl.system.body)).toEqual([
            "structure",
            "weight",
        ]);
    });
    it("retains inert-art advisories after decoding", () => {
        const fm = decodeNoteAddresses({ type: "lore", data: { icon: "image-art" } }, context);
        const findings = lintNote(
            {
                file: "Lore.md",
                type: "lore",
                raw: "---\ntype: lore\ndata:\n  icon: image-art\n---\n",
                fm,
            },
            {
                schemas: {},
                addressContext: context,
                emittedArt: () => ({ art: [], document: null }),
            },
        );
        expect(findings.some((f) => f.message.includes("reaches no document"))).toBe(true);
    });
    it("resolves native Shortcodes only within their declared system and type", () => {
        const index = new Map([
            ["foreign-sohl-skill-lang", { name: "Language", uuid: "Item.lang" }],
            ["foreign-note-skill-lang", { name: "Language", uuid: "Journal.lang" }],
            ["foreign-sohl-affiliation-lang", { name: "Unrelated" }],
        ]);
        const hint = { type: "skill", system: "sohl" };
        expect(resolveShortcodeReference([index, index], "lang", hint)).toMatchObject({
            name: "Language",
            uuid: "Journal.lang",
            address: { package: "foreign", system: "note", type: "skill", shortcode: "lang" },
        });
        expect(resolveShortcodeReference([index], "missing", hint)).toBeUndefined();
        expect(
            resolveInfoboxRef({ index } as any, "lang", { ...hint, kind: "shortcode" }),
        ).not.toHaveProperty("uuid");
        const ambiguous = new Map([
            ...index,
            ["other-sohl-skill-lang", { name: "Other language" }],
        ]);
        expect(resolveShortcodeReference([ambiguous], "lang", hint)).toBeUndefined();
    });
    it("preserves shared generated containers while serializing tuple values", () => {
        const shared = { label: "Shared" };
        const encoded = encodeAddresses({ first: shared, second: shared });
        expect(encoded.first).toBe(encoded.second);
    });

    it("reads aliased containers independently in each enclosing system", () => {
        const fields = { being: [{ name: "owner", to: "owner", address: { type: "being" } }] };
        const shared = { owner: "person" };
        const fm = decodeNoteAddresses(
            { type: "being", sohl: { system: shared }, hm3: { system: shared } },
            { ...context, systemBlocks: { sohl: { fields }, hm3: { fields } } },
        );
        expect(fm.sohl.system.owner.system).toBe("sohl");
        expect(fm.hm3.system.owner.system).toBe("hm3");
        expect(shared.owner).toBe("person");
        const full = { owner: "foreign-sohl-being-person" };
        const qualified = decodeNoteAddresses(
            { type: "being", sohl: { system: full }, hm3: { system: full } },
            { ...context, systemBlocks: { sohl: { fields }, hm3: { fields } } },
        );
        expect(qualified.sohl.system.owner).toEqual(qualified.hm3.system.owner);
    });
    it("preserves primitive display capitalization for decoded values", () => {
        const fm = decodeNoteAddresses(
            { type: "folder", data: { parent: "organizations" } },
            context,
        );
        expect(presentValue(fm.data.parent)).toBe("Organizations");
    });
    it("retains stub names without inventing published destinations", () => {
        const published = new Map();
        const names = buildReferenceTargets(
            [
                {
                    package: "foreign",
                    type: "lore",
                    shortcode: "culture",
                    name: { full: "Culture Name" },
                    stub: true,
                },
            ],
            published,
        );
        expect(names.get("foreign-note-lore-culture")).toEqual({
            name: "Culture Name",
            subType: undefined,
        });
        expect(published.size).toBe(0);
    });
    it("presents inline equipment through its native Shortcode namespace", () => {
        const index = new Map([
            ["foreign-sohl-miscgear-parchment", { name: "Parchment" }],
            ["foreign-note-miscgear-parchment", { name: "Parchment", uuid: "Journal.parchment" }],
        ]);
        const sections = beingSections(
            {
                sohl: {
                    items: [{ type: "miscgear", shortcode: "parchment", name: "Premium sheets" }],
                },
            },
            {
                block: "sohl",
                resolve: (ref, hint) =>
                    hint.kind === "shortcode" ?
                        resolveShortcodeReference([index], ref, hint)
                    :   undefined,
            },
        );
        expect(sections[0].groups[0].entries[0]).toMatchObject({
            text: "Premium sheets",
            uuid: "Journal.parchment",
        });
    });
    it("indexes native identity records once for repeated presentation lookups", () => {
        let traversals = 0;
        class CountedIndex extends Map<string, any> {
            *[Symbol.iterator]() {
                traversals++;
                yield* super[Symbol.iterator]();
            }
        }
        const index = new CountedIndex([
            ["foreign-sohl-skill-lang", { name: "Language" }],
            ["foreign-note-skill-lang", { name: "Language" }],
        ]);
        for (let i = 0; i < 20; i++)
            expect(
                resolveShortcodeReference([index], "lang", { type: "skill", system: "sohl" })?.name,
            ).toBe("Language");
        expect(traversals).toBe(1);
    });
    it("keeps published documentation when its native record follows it", () => {
        const records = [
            {
                package: "world",
                type: "skill",
                shortcode: "language",
                name: { full: "Language" },
                foundry: { note: { uuid: "Journal.language" } },
            },
            {
                package: "world",
                type: "skill",
                shortcode: "language",
                name: { full: "Language" },
                foundry: { sohl: { uuid: "Item.language" } },
            },
        ];
        for (const ordered of [records, [...records].reverse()]) {
            const targets = buildReferenceTargets(ordered);
            expect(targets.get("world-note-skill-language")?.uuid).toBe("Journal.language");
            expect(targets.get("world-sohl-skill-language")?.uuid).toBe("Item.language");
        }
    });
    it("rejects malformed containers at every structured wildcard boundary", () => {
        let count = 0;
        for (const type of Object.keys(NOTE_VOCABULARY)) {
            for (const position of addressPositions({ type }, context)) {
                const wildcard = position.path.indexOf("*");
                if (wildcard < 0) continue;
                const containerPath = position.path.slice(0, wildcard);
                for (const invalid of [{ to: "north" }, "north", 42]) {
                    const fm: any = { type };
                    let owner = fm;
                    containerPath.forEach((key, i) => {
                        if (i === containerPath.length - 1) owner[key] = invalid;
                        else owner = owner[key] = {};
                    });
                    let finding: any;
                    try {
                        decodeNoteAddresses(fm, context);
                    } catch (error) {
                        finding = error;
                    }
                    expect(finding?.keyPath).toEqual(containerPath);
                    expect(finding?.message).toContain("must be a list");
                    count++;
                }
                for (const empty of [null, "", []]) {
                    const fm: any = { type };
                    let owner = fm;
                    containerPath.forEach((key, i) => {
                        if (i === containerPath.length - 1) owner[key] = empty;
                        else owner = owner[key] = {};
                    });
                    expect(() => decodeNoteAddresses(fm, context)).not.toThrow();
                }
            }
        }
        expect(count).toBeGreaterThan(0);
    });
    it.each([true, false, "absent"])(
        "presents a native model through its documentation (%s)",
        (published) => {
            const fm = decodeNoteAddresses(
                { type: "being", sohl: { items: [{ model: "mysticalability-eblt" }] } },
                { ...context, package: "thalorna" },
            );
            const model = fm.sohl.items[0].model;
            const records: any[] = [
                {
                    package: "thalorna",
                    type: "mysticalability",
                    shortcode: "eblt",
                    name: { full: "Elemental Bolt" },
                    foundry: { sohl: { uuid: "Item.bolt" } },
                },
            ];
            if (published !== "absent")
                records.push({
                    package: "thalorna",
                    type: "mysticalability",
                    shortcode: "eblt",
                    name: { full: "Elemental Bolt" },
                    foundry: published ? { note: { uuid: "Journal.bolt" } } : null,
                });
            const index = {
                contentPackage: "thalorna",
                referenceTargets: buildReferenceTargets(records),
            };
            const sections = beingSections(fm, {
                block: "sohl",
                resolve: (ref, hint) => resolveReference(index, ref, hint),
            });
            const value = sections[0].entries[0];
            expect(value.text).toBe("Elemental Bolt");
            expect(value.uuid).toBe(published === true ? "Journal.bolt" : undefined);
            expect(value.address).toMatchObject({
                package: "thalorna",
                system: "note",
                type: "mysticalability",
                shortcode: "eblt",
            });
            expect(fm.sohl.items[0].model).toBe(model);
            const compiler = {
                documentSubtypes: { block: "sohl", types: { mysticalability: "mysticalability" } },
                system: "sohl",
                foreignPackages: new Set(),
                noteError: () => {},
                errorCount: 0,
            };
            expect(SystemActorCompiler.prototype.readModel.call(compiler, model, 0, "Being")).toBe(
                model,
            );
            expect(model).toMatchObject({
                package: "thalorna",
                system: "sohl",
                type: "mysticalability",
                shortcode: "eblt",
            });
        },
    );
    it("uses the model documentation identity for skill-family presentation", () => {
        const fm = decodeNoteAddresses(
            {
                type: "being",
                sohl: {
                    items: [{ model: "foreign-sohl-skill-lang", system: { masteryLevelBase: 42 } }],
                },
            },
            context,
        );
        const seen: any[] = [];
        const sections = beingSections(fm, {
            block: "sohl",
            resolve: (ref) => {
                seen.push(ref);
                return {
                    name: "Language",
                    subType: "language",
                    uuid: ref.system === "note" ? "Journal.language" : "Item.language",
                };
            },
        });
        expect(sections[0].groups[0].entries[0]).toMatchObject({
            text: "Language 42",
            uuid: "Journal.language",
        });
        expect(
            seen.every(
                (ref) => ref.package === "foreign" && ref.system === "note" && ref.type === "skill",
            ),
        ).toBe(true);
    });
});
