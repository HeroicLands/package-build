/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **An Address may carry an anchor only where its field accepts one.** Every
 * Address position the vocabulary and the system blocks declare is derived
 * here rather than listed, and each refuses a `#<anchor>`; the anchor parser is
 * the one the wikilink reads through; and a note's anchors — headings,
 * captions, blocks and its events' ids — carry a kind and share one namespace.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";
import { describe, expect, it } from "vitest";

import { splitAnchor } from "../engine/address.mjs";
import {
    ANCHOR_KINDS,
    collectAnchors,
    eventAnchors,
    noteAnchorFindings,
} from "../engine/anchors.mjs";
import { collectContentIndex, serializeContentIndex } from "../engine/content-index.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { addressPositions, decodeNoteAddresses } from "../engine/note-addresses.mjs";
import { NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
import { parseWikilink } from "../engine/wikilink-syntax.mjs";
import { ITEM_FIELDS } from "../sohl/item-fields.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const context = {
    package: "world",
    system: "note",
    systemBlocks: { sohl: { fields: ITEM_FIELDS } },
};

/** A specimen value of `shape` whose Address carries an anchor. */
function anchored(shape: string, text: string) {
    return (
        shape === "keys" ? { [text]: "rival" }
        : shape === "list" ? [text]
        : shape === "scalar-or-map" ? { default: text }
        : text
    );
}

describe("the anchor grammar", () => {
    it("splits an anchor off every written form", () => {
        expect(splitAnchor("place-ironfells#sack")).toEqual({
            address: "place-ironfells",
            anchor: "sack",
        });
        expect(splitAnchor("thalorna-note-place-ironfells#sack")).toEqual({
            address: "thalorna-note-place-ironfells",
            anchor: "sack",
        });
        expect(splitAnchor("ironfells#sack")).toEqual({ address: "ironfells", anchor: "sack" });
        expect(splitAnchor("place-ironfells")).toEqual({ address: "place-ironfells" });
    });

    it("is the parser a wikilink reads its anchor through", () => {
        const link = parseWikilink(" place-ironfells # sack |the sack");
        const split = splitAnchor("place-ironfells # sack");
        expect(link.target).toBe(split.address);
        expect(link.anchor).toBe(split.anchor);
    });
});

describe("every Address field that declares no anchor kind refuses one", () => {
    it("at the note boundary, for every declared position", () => {
        let count = 0;
        for (const type of Object.keys(NOTE_VOCABULARY)) {
            for (const p of addressPositions({ type }, context)) {
                if ((p as any).anchors) continue;
                const shapes = p.shape === "keys-or-list" ? ["keys", "list"] : [p.shape as string];
                for (const shape of shapes) {
                    const fm: any = { type };
                    let owner = fm;
                    p.path.forEach((part, index) => {
                        const key = part === "*" ? 0 : part;
                        if (index === p.path.length - 1) {
                            const text = `${p.type ?? (p.path.join(".") === "data.socialTies" ? "being" : "lore")}-sample#part`;
                            owner[key] = anchored(shape, text);
                        } else owner = owner[key] = p.path[index + 1] === "*" ? [] : {};
                    });
                    const where = `${type}:${p.path.join(".")}:${shape}`;
                    expect(() => decodeNoteAddresses(fm, context), where).toThrow(/anchor/);
                    count++;
                }
            }
        }
        expect(count).toBeGreaterThan(50);
    });

    it("in the frontmatter lint, for every declared data field", () => {
        let count = 0;
        for (const type of Object.keys(NOTE_VOCABULARY)) {
            for (const field of dataFields(type) ?? []) {
                if ((field as any).anchors) continue;
                const shapes: string[] = [];
                if (field.kind === "address") shapes.push("value");
                else if (field.kind === "list-or-map") shapes.push("keys", "list");
                else if (field.keyKind === "address") shapes.push("keys");
                else if (field.entryKind === "address")
                    shapes.push(field.kind === "scalar-or-map" ? "value" : "list");
                for (const shape of shapes) {
                    const text = `${field.ref ?? (field.name === "socialTies" ? "being" : "lore")}-sample#part`;
                    const data: any = {};
                    let owner = data;
                    const segments = field.name.split(".");
                    segments.forEach((segment, i) => {
                        if (i === segments.length - 1) owner[segment] = anchored(shape, text);
                        else owner = owner[segment] = {};
                    });
                    const fm = { type, shortcode: "subject", data };
                    const raw = `---\n${YAML.stringify(fm)}---\n\nProse.\n`;
                    const findings = lintNote({ file: "n.md", raw, fm, type } as any, {
                        schemas: NOTE_SCHEMAS as any,
                        vocabulary: NOTE_VOCABULARY,
                    });
                    const where = `${type}.${field.name}:${shape}`;
                    const hit = findings.find(
                        (f: any) =>
                            f.message.includes(`data.${field.name}`) &&
                            f.message.includes("takes no anchor"),
                    );
                    expect(
                        hit,
                        `${where}\n${findings.map((f: any) => f.message).join("\n")}`,
                    ).toBeTruthy();
                    expect(hit?.line, where).toBeGreaterThan(0);
                    count++;
                }
            }
        }
        expect(count).toBeGreaterThan(20);
    });
});

describe("every anchor has a kind, and a note has one namespace", () => {
    const body = [
        "# Overview {#overview}",
        "",
        "Text.",
        "",
        ":::secret {#note1}",
        "Aside.",
        ":::",
    ].join("\n");

    it("records the kind of each body anchor", () => {
        const kinds = Object.fromEntries(collectAnchors(body).map((a) => [a.slug, a.kind]));
        expect(kinds).toMatchObject({ overview: "heading", note1: "block" });
    });

    it("records each event id as an event anchor at its own line", () => {
        const fm = {
            type: "place",
            shortcode: "ironfells",
            data: {
                events: [
                    { id: "raise", when: "-900", summary: "The holds are cut." },
                    { id: "sack", when: "-500", summary: "The holds are sacked." },
                ],
            },
        };
        const raw = `---\n${YAML.stringify(fm)}---\n\n${body}\n`;
        const events = eventAnchors(fm, raw);
        expect(events.map((a) => [a.slug, a.kind])).toEqual([
            ["raise", "event"],
            ["sack", "event"],
        ]);
        expect(events[0].line).toBeGreaterThan(1);
        expect(events[0].name).toBe("The holds are cut.");
    });

    it("refuses an event id equal to a heading slug in the same note", () => {
        const fm = {
            type: "lore",
            shortcode: "x",
            data: { events: [{ id: "overview", when: "1", summary: "S." }] },
        };
        const raw = `---\n${YAML.stringify(fm)}---\n\n${body}\n`;
        const findings = noteAnchorFindings({ file: "x.md", fm, raw, body } as any);
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain("overview");
        expect(findings[0].line).toBeGreaterThan(0);
    });
});

describe("the published index carries every anchor with its kind", () => {
    it("writes a kind on every anchor, and each event id as an event anchor", () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anchor-kinds-"));
        try {
            const fm = {
                shortcode: "ironfells",
                name: { full: "Ironfells" },
                type: "place",
                subType: "region",
                data: {
                    events: [
                        { id: "raise", when: "-900", summary: "The holds are cut." },
                        { id: "sack", when: "-500", summary: "The holds are sacked." },
                    ],
                },
            };
            fs.writeFileSync(
                path.join(tmp, "Ironfells.md"),
                `---\n${YAML.stringify(fm)}---\n\n# The Holds {#holds}\n\nProse.\n`,
            );
            const records = collectContentIndex(tmp, {
                contentPackage: "thalorna",
                skipDirectories: [],
            });
            const published = serializeContentIndex(records)
                .split("\n")
                .filter(Boolean)
                .map((line) => JSON.parse(line));
            const anchors = published.flatMap((record) => record.anchors ?? []);
            expect(anchors.length).toBeGreaterThan(0);
            for (const anchor of anchors) expect(ANCHOR_KINDS).toContain(anchor.kind);
            expect(anchors.map((a: any) => [a.slug, a.kind])).toEqual([
                ["raise", "event"],
                ["sack", "event"],
                ["holds", "heading"],
            ]);
            expect(anchors[1].line).toBeGreaterThan(anchors[0].line);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});
