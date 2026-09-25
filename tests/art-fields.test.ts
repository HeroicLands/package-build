/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The art slots are one declaration, and every surface reads it.
 *
 * Four statements have to agree about which slots exist and what each names:
 * `ART_SLOTS`, the note vocabulary an author is checked against, the passes'
 * `emitsArt`, and the specification. Nothing compared them, and each is a list
 * somebody could extend without the others.
 *
 * So the cases below **derive** what they check from `ART_SLOTS` rather than
 * restating it: a slot added there is asked of the vocabulary, of the passes
 * and of the resolver with no second edit, and one added anywhere else is
 * reported here as a slot nothing declares.
 *
 * A guard proves every slot is named, never that a claim about one is true, so
 * the resolution cases after it sample the answers.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import {
    ART_SLOTS,
    artSlot,
    artTarget,
    artPathname,
    beingDefaultArt,
    resolveArtRecord,
    unacceptedArtMessage,
    unresolvedArtMessage,
    BEING_DEFAULT_ART,
} from "../engine/art-fields.mjs";
import { ASSET_TYPE_NAMES } from "../engine/asset-types.mjs";
import { ART_FIELDS } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
import { emittedArtFor } from "../engine/generate.mjs";
import { Items } from "../sohl/items.mjs";
import { Actors } from "../sohl/actors.mjs";
import { Hm3Actors } from "../hm3/actors.mjs";
import { Macros } from "../engine/macros.mjs";
import { Scenes } from "../engine/scenes.mjs";
import { Bundles } from "../engine/bundles.mjs";
import { Journals } from "../engine/journals.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SPEC = readFileSync(path.resolve(here, "../docs/content-format.md"), "utf8");

/**
 * The default type and the accepted set *The four art slots* tabulates, keyed
 * by field — read from the document's own table rather than a transcription
 * of it, so a slot the table adds or drops is caught here without a second
 * list to maintain.
 */
function documentedArtSlots(): Map<string, { type: string; accepts: string[] }> {
    const lines = SPEC.split("\n");
    const heading = lines.findIndex((line) => /^####\s+The four art slots\s*$/.test(line));
    const header = lines.findIndex((line, i) => i > heading && /^\|\s*field\s*\|/.test(line));
    const out = new Map<string, { type: string; accepts: string[] }>();
    for (let i = header + 2; lines[i]?.trim().startsWith("|"); i++) {
        const [field, type, accepts] = lines[i]
            .trim()
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((cell) => cell.trim().replace(/`/g, ""));
        out.set(field, { type, accepts: accepts.split(",").map((s) => s.trim()) });
    }
    return out;
}

/** Every pass this package ships, for the `emitsArt` comparison. */
const SHIPPED = [Items, Actors, Hm3Actors, Macros, Scenes, Bundles, Journals];

describe("the art slots are declared once", () => {
    it("declares slots to check, so the comparison is not vacuous", () => {
        expect(ART_SLOTS.length).toBeGreaterThan(3);
        expect(ART_SLOTS.map((slot) => slot.key)).toContain("icon");
    });

    it("gives every slot a type an address can actually name", () => {
        const wrong = ART_SLOTS.filter((slot) => !ASSET_TYPE_NAMES.has(slot.type));
        expect(wrong.map((slot) => `${slot.key} → ${slot.type}`)).toEqual([]);
    });

    it("declares a non-empty accepted set for every slot, of real asset types", () => {
        // Derived from ART_SLOTS itself, so a fifth slot omitting `accepts` — or
        // naming something that is not an asset type — is reported here rather
        // than silently accepting nothing, or accepting a type no address can
        // name.
        const missing = ART_SLOTS.filter(
            (slot) => !Array.isArray(slot.accepts) || slot.accepts.length === 0,
        );
        expect(missing.map((slot) => slot.key)).toEqual([]);
        const wrong = ART_SLOTS.flatMap((slot) =>
            slot.accepts
                .filter((type: string) => !ASSET_TYPE_NAMES.has(type))
                .map((type: string) => `${slot.key} → ${type}`),
        );
        expect(wrong).toEqual([]);
    });

    it("accepts a type beyond its own default — the deity-symbol case", () => {
        // `sohl-kethira-basic` authors `icon: image-…` twenty times, one per
        // faith tradition: the profile art is a full illustration rather than a
        // game icon. The accepted set, not the default, is what makes that
        // legal.
        for (const slot of ART_SLOTS) {
            expect(slot.accepts, slot.key).toContain(slot.type);
            expect(slot.accepts, slot.key).not.toEqual([slot.type]);
        }
    });

    it("refuses `audio` at every slot — a sound is not art", () => {
        for (const slot of ART_SLOTS) {
            expect(slot.accepts, slot.key).not.toContain("audio");
        }
    });

    it("is the default type and the accepted set the specification tabulates", () => {
        const documented = documentedArtSlots();
        // Guards the guard: were the table's shape or its heading to change,
        // every comparison below would run against an empty map.
        expect(documented.size).toBe(ART_SLOTS.length);
        const wrong = ART_SLOTS.flatMap((slot) => {
            const row = documented.get(slot.key);
            if (!row) return [`${slot.key}: the specification's table names no such field`];
            const problems: string[] = [];
            if (row.type !== slot.type) {
                problems.push(`${slot.key}: default type \`${row.type}\` !== \`${slot.type}\``);
            }
            const documentedSet = new Set(row.accepts);
            const declaredSet = new Set(slot.accepts);
            const same =
                documentedSet.size === declaredSet.size &&
                [...declaredSet].every((type) => documentedSet.has(type));
            if (!same) {
                problems.push(
                    `${slot.key}: accepts \`${row.accepts.join(", ")}\` !== \`${slot.accepts.join(", ")}\``,
                );
            }
            return problems;
        });
        expect(wrong).toEqual([]);
    });

    it("is the list the frontmatter lint checks, rather than a second one", () => {
        expect(ART_FIELDS.map((field) => field.key)).toEqual(ART_SLOTS.map((slot) => slot.key));
    });

    it("looks a slot up by key, and answers nothing for a key that is not one", () => {
        expect(artSlot("icon")?.type).toBe("icon");
        expect(artSlot("bgImage")?.type).toBe("image");
        expect(artSlot("portrait")).toBeUndefined();
    });
});

describe("every slot is a key some type accepts", () => {
    it("declares each slot in the vocabulary of at least one type", () => {
        const declared = new Set(
            Object.keys(NOTE_VOCABULARY).flatMap((type) =>
                (dataFields(type) ?? []).map((field: { name: string }) => field.name),
            ),
        );
        const missing = ART_SLOTS.filter((slot) => !declared.has(slot.key));
        expect(missing.map((slot) => slot.key)).toEqual([]);
    });

    it("accepts `icon` and `banner` on every type, whatever its own vocabulary", () => {
        // The two that are legal everywhere, including on the types whose own
        // `data:` vocabulary is empty and which therefore have no list to put a
        // row in.
        for (const type of Object.keys(NOTE_VOCABULARY)) {
            const names = (dataFields(type) ?? []).map((field: { name: string }) => field.name);
            expect(names, type).toContain("icon");
            expect(names, type).toContain("banner");
        }
    });
});

describe("what a pass emits is a slot, and nothing else", () => {
    it("names only declared slots in every shipped pass's `emitsArt`", () => {
        const keys = new Set(ART_SLOTS.map((slot) => slot.key));
        const stray: Record<string, string[]> = {};
        for (const pass of SHIPPED) {
            const bad = [...((pass as { emitsArt: readonly string[] }).emitsArt ?? [])].filter(
                (key) => !keys.has(key),
            );
            if (bad.length) stray[(pass as { name: string }).name] = bad;
        }
        expect(stray).toEqual({});
    });

    it("never claims to emit `banner`, which reaches no compiled document", () => {
        for (const pass of SHIPPED) {
            expect(
                [...((pass as { emitsArt: readonly string[] }).emitsArt ?? [])],
                (pass as { name: string }).name,
            ).not.toContain("banner");
        }
    });

    it("routes each document-bound slot to the type that carries it", () => {
        expect(emittedArtFor("being")!.art).toEqual(expect.arrayContaining(["icon", "tokenIcon"]));
        expect(emittedArtFor("skill")!.art).toEqual(["icon"]);
        expect(emittedArtFor("map")!.art).toEqual(["bgImage"]);
    });
});

describe("an authored value names an Address, checked against what a slot accepts", () => {
    const vocabulary = {
        types: new Set(["icon", "image", "audio"]),
        packages: new Set(["sohl"]),
    };

    it("takes the slot's own type for a bare shortcode", () => {
        expect(artTarget("anvil", "icon", undefined, vocabulary)).toMatchObject({
            type: "icon",
            shortcode: "anvil",
        });
        expect(artTarget("anvil", "image", undefined, vocabulary)).toMatchObject({
            type: "image",
            shortcode: "anvil",
        });
    });

    it("leaves a written address alone, whatever its length", () => {
        expect(artTarget("icon-anvil", "icon", undefined, vocabulary)).toMatchObject({
            type: "icon",
            shortcode: "anvil",
        });
        expect(artTarget("sohl-none-icon-anvil", "icon", undefined, vocabulary)).toMatchObject({
            package: "sohl",
            type: "icon",
            shortcode: "anvil",
        });
    });

    it("accepts a type outside the default when the accepted set names it — the deity-symbol case", () => {
        // `sohl-kethira-basic` writes `icon: image-kpagrik` on a deity's
        // Affiliation and Skill notes. The default is `icon`; the accepted set
        // is what lets `image` resolve instead of being refused.
        expect(artTarget("image-kpagrik", "icon", ["icon", "image"], vocabulary)).toMatchObject({
            type: "image",
            shortcode: "kpagrik",
        });
    });

    it("refuses a type the accepted set does not name, without resolving it", () => {
        expect(artTarget("audio-boom", "icon", ["icon", "image"], vocabulary)).toEqual({
            reason: "not-accepted",
            type: "audio",
        });
    });

    it("parses whatever the vocabulary knows when no accepted set is given", () => {
        // The embed's rule, not an art slot's: a position takes any type that
        // parses, and a narrower question is left to its own caller.
        expect(artTarget("audio-boom", "icon", undefined, vocabulary)).toMatchObject({
            type: "audio",
            shortcode: "boom",
        });
    });
});

describe("resolving an art value", () => {
    /** An index holding one local file and one a dependency published. */
    const index: any = {
        types: new Set(ASSET_TYPE_NAMES),
        packages: new Set(["thalorna", "sohl"]),
        contentPackage: "thalorna",
        assets: new Map([
            [
                "thalorna-none-image-thorn",
                { package: "thalorna", asset: { path: "images/beings/thorn.webp" } },
            ],
        ]),
        foreign: new Map([
            [
                "sohl-none-icon-anvil",
                { package: "sohl", asset: { path: "icons/game-icons/lorc/anvil.svg" } },
            ],
        ]),
    };

    it("answers a bare shortcode from this package's own files", () => {
        expect(artPathname(index, "thorn", "image")).toEqual({
            pathname: "thalorna/assets/images/beings/thorn.webp",
            resolved: true,
        });
    });

    it("answers a qualified address from a dependency's published index", () => {
        expect(artPathname(index, "sohl-none-icon-anvil", "icon")).toEqual({
            pathname: "sohl/assets/icons/game-icons/lorc/anvil.svg",
            resolved: true,
        });
    });

    it("keeps the two empties apart, as the pathname rule does", () => {
        // `null` and an absent key mean "no art named, apply the default";
        // `""` means "ship blank on purpose", and no default may replace it.
        expect(artPathname(index, null, "icon")).toEqual({ pathname: null, resolved: true });
        expect(artPathname(index, undefined, "icon")).toEqual({ pathname: null, resolved: true });
        expect(artPathname(index, "", "icon")).toEqual({ pathname: "", resolved: true });
    });

    it("says an address nothing answers is unresolved, rather than unnamed", () => {
        // The distinction a caller applying a default needs: a note that named
        // nothing and a note whose address is wrong take the same art, and only
        // the second is worth reporting.
        expect(artPathname(index, "nosuchthing", "icon")).toMatchObject({
            pathname: null,
            resolved: false,
            reason: "unresolved",
        });
    });

    it("reads a slot's own type, so one shortcode in two roots is two files", () => {
        expect(resolveArtRecord(index, "thorn", "icon")).toBeNull();
        expect(resolveArtRecord(index, "thorn", "image")).not.toBeNull();
    });

    it("resolves a type outside the default when the accepted set names it — the deity-symbol case", () => {
        // `sohl-kethira-basic` authors `icon: image-…` on a deity's Affiliation
        // and Skill notes, twenty times over: a full illustration rather than a
        // game icon. Naming the accepted set is what lets it resolve.
        const accepts = ["icon", "image"];
        expect(artPathname(index, "thalorna-none-image-thorn", "icon", accepts)).toEqual({
            pathname: "thalorna/assets/images/beings/thorn.webp",
            resolved: true,
        });
    });

    it("refuses a type the accepted set does not name, as an error rather than a fallback", () => {
        const accepts = ["icon", "image"];
        expect(artPathname(index, "audio-boom", "icon", accepts)).toEqual({
            pathname: null,
            resolved: false,
            reason: "not-accepted",
            type: "audio",
        });
        expect(resolveArtRecord(index, "audio-boom", "icon", accepts)).toBeNull();
    });
});

describe("what an unresolved or unaccepted art address is reported as", () => {
    it("names the value exactly as authored when nothing answers it", () => {
        const message = unresolvedArtMessage("icon", "sohl-none-icon-nosuchfile");
        expect(message).toContain("`data.icon`");
        expect(message).toContain("`sohl-none-icon-nosuchfile`");
        expect(message).toContain("default art");
    });

    it("names the accepted set when the type is refused", () => {
        const message = unacceptedArtMessage("icon", "audio-boom", "audio", ["icon", "image"]);
        expect(message).toContain("`data.icon`");
        expect(message).toContain("`audio-boom`");
        expect(message).toContain("`audio`");
        expect(message).toContain("does not");
        expect(message).toContain("icon");
        expect(message).toContain("image");
    });
});

describe("a being's default art comes from the kind it is tagged", () => {
    it("chooses by tag, which only a compiler can read", () => {
        expect(beingDefaultArt({ tags: ["character"] })).toBe(BEING_DEFAULT_ART.character);
        expect(beingDefaultArt({ tags: ["creature", "animal"] })).toBe(BEING_DEFAULT_ART.creature);
    });

    it("answers nothing for a being carrying neither, so a lower default applies", () => {
        expect(beingDefaultArt({ tags: ["draft"] })).toBeNull();
        expect(beingDefaultArt({})).toBeNull();
    });

    it("names both defaults as addresses rather than as paths", () => {
        for (const address of Object.values(BEING_DEFAULT_ART)) {
            expect(address).toMatch(/^[a-z0-9]+-none-icon-[a-z0-9]+$/);
        }
    });
});
