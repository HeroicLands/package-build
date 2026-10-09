/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **Gear names the events of its making and its loss, and a work of literature
 * may name the event it concerns.** Each is an Address of an event — an anchor
 * of kind `event`, or for `made` and `lost` a note holding exactly one event —
 * resolved through the index, refused where it names nothing or names a prose
 * anchor, and drawn on by no infobox row.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";
import { describe, expect, it } from "vitest";

import { parseAddress, renderAddress } from "../engine/address.mjs";
import { AddressLink } from "../engine/address-values.mjs";
import { worksNode, worksPages } from "../engine/literature-works.mjs";
import { collectContentIndex, serializeContentIndex } from "../engine/content-index.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { NOTE_FIELD_PRESENTATION } from "../engine/infobox.mjs";
import { noteInfoboxes } from "../engine/infobox-registry.mjs";
import { NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const PACKAGE = "thalorna";
const TYPES = new Set([...Object.keys(NOTE_VOCABULARY)]);

/** Every gear type: the types that declare the carried-thing values. */
const GEAR_TYPES = Object.keys(NOTE_VOCABULARY).filter((type) => type.endsWith("gear"));

/** A note as the link index hands one over, with a real frontmatter fence. */
function note(fm: Record<string, any>, body = "Prose.\n") {
    const raw = `---\n${YAML.stringify(fm)}---\n\n${body}`;
    return { file: `${fm.type}-${fm.shortcode}.md`, raw, fm, body: `\n${body}`, type: fm.type };
}

/** An index over the given notes, resolving Addresses the way the real one does. */
function indexOf(notes: ReturnType<typeof note>[]) {
    const context = {
        package: PACKAGE,
        system: "note",
        types: TYPES,
        packages: new Set([PACKAGE]),
    };
    const byKey = new Map<string, unknown>();
    for (const n of notes)
        byKey.set(renderAddress(parseAddress(`${n.fm.type}-${n.fm.shortcode}`, context) as any), n);
    return {
        notes,
        contentPackage: PACKAGE,
        types: TYPES,
        packages: new Set([PACKAGE]),
        addressHit(target: string) {
            const tuple = parseAddress(target, context);
            return (tuple as any).reason ? undefined : byKey.get(renderAddress(tuple as any));
        },
    };
}

/** The notes every reference below names. */
const WORLD = [
    note(
        {
            type: "place",
            subType: "settlement",
            shortcode: "ironfells",
            name: { full: "Ironfells" },
            data: {
                events: [
                    { id: "raising", when: 120, summary: "Ironfells is raised." },
                    { id: "sack", when: 280, summary: "Ironfells is sacked." },
                ],
            },
        },
        "# History {#history}\n\nProse.\n",
    ),
    note({
        type: "lore",
        subType: "history",
        shortcode: "forging",
        name: { full: "The Forging" },
        data: { events: [{ when: 200, kind: "making", summary: "The blade is forged." }] },
    }),
    note({ type: "lore", subType: "history", shortcode: "quiet", name: { full: "Quiet" } }),
    note({ type: "being", subType: "npc", shortcode: "aran", name: { full: "Aran" } }),
];

/** Lint one note against the world, returning its own findings. */
function lint(subject: ReturnType<typeof note>) {
    const { findings } = lintFrontmatter(indexOf([...WORLD, subject]) as any, {
        schemas: NOTE_SCHEMAS as any,
        vocabulary: NOTE_VOCABULARY,
    });
    return findings.filter((finding: any) => finding.file === subject.file);
}

/** A gear note of `type` stating `data`. */
const gear = (type: string, data: Record<string, unknown>) =>
    note({ type, shortcode: "blade", name: { full: "Blade" }, data });

/** A work of literature naming `subjects`. */
const work = (subjects: unknown[]) =>
    note({
        type: "lore",
        subType: "literature",
        shortcode: "lay",
        name: { full: "The Lay" },
        data: { subjects },
    });

const messages = (findings: Array<{ message: string }>) => findings.map((f) => f.message);

/** The messages about `made` or `lost`, apart from what a gear type asks of its system block. */
const about = (findings: Array<{ message: string }>) =>
    messages(findings).filter((message) => /data\.(made|lost)/.test(message));

describe("made and lost on every gear type", () => {
    it("is declared on each gear type as an event Address, defaulting to lore", () => {
        expect(GEAR_TYPES.length).toBeGreaterThan(0);
        for (const type of GEAR_TYPES) {
            for (const name of ["made", "lost"]) {
                const field = dataFields(type).find((f: any) => f.name === name);
                expect(field, `${type}.${name}`).toMatchObject({
                    kind: "address",
                    ref: "lore",
                    anchors: ["event"],
                });
            }
        }
    });

    it("resolves an event anchor, a note holding one event, and a bare lore shortcode", () => {
        for (const type of GEAR_TYPES) {
            expect(
                about(lint(gear(type, { made: "place-ironfells#raising", lost: "forging" }))),
                type,
            ).toEqual([]);
            expect(about(lint(gear(type, { made: "lore-forging" }))), type).toEqual([]);
        }
    });

    it("reports a dangling one at its own key", () => {
        const cases: Array<[Record<string, unknown>, string]> = [
            [{ made: "place-ironfells#melting" }, "declares no anchor melting"],
            [{ lost: "lore-nowhere" }, "does not resolve"],
            [{ made: "place-ironfells" }, "holds 2 events"],
            [{ lost: "lore-quiet" }, "holds no events"],
        ];
        for (const [data, expected] of cases) {
            const found = lint(gear("weapongear", data));
            expect(messages(found).join("\n"), JSON.stringify(data)).toContain(expected);
            const key = Object.keys(data)[0];
            expect(found[0].message).toContain(`data.${key}`);
            expect(found[0].line).toBeGreaterThan(0);
            expect(found[0].column).toBeGreaterThan(0);
        }
    });

    it("refuses an anchor of kind prose", () => {
        const found = lint(gear("miscgear", { made: "place-ironfells#history" }));
        expect(messages(found)).toEqual([expect.stringContaining("prose anchor")]);
    });

    it("is withheld from the infobox, with a reason, and draws no row", () => {
        for (const name of ["made", "lost"])
            expect((NOTE_FIELD_PRESENTATION as any)[name]?.withheld, name).toBeTruthy();
        for (const type of GEAR_TYPES) {
            const boxes = noteInfoboxes(
                {
                    type,
                    shortcode: "blade",
                    name: { full: "Blade" },
                    data: { made: "lore-forging", lost: "place-ironfells#sack" },
                },
                { resolve: () => undefined },
            );
            const rows = boxes.flatMap((box: any) =>
                box.sections.flatMap((section: any) => section.rows ?? []),
            );
            expect(
                rows.filter((row: any) => /made|lost|forg|sack/i.test(JSON.stringify(row))),
                type,
            ).toEqual([]);
        }
    });

    it("reads into the index, and publishes as an Address carrying its event anchor", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "event-references-"));
        try {
            for (const n of [...WORLD, gear("weapongear", { made: "place-ironfells#sack" })])
                fs.writeFileSync(path.join(dir, n.file), n.raw);
            const records = serializeContentIndex(
                collectContentIndex(dir, { contentPackage: PACKAGE, skipDirectories: [] }),
            )
                .split("\n")
                .filter(Boolean)
                .map((line) => JSON.parse(line));
            const blade = records.find((record) => record.shortcode === "blade");
            expect(blade.data.made).toEqual({
                address: "thalorna-note-place-ironfells",
                anchor: "sack",
                anchorKind: "event",
            });
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("a literature note's subjects", () => {
    it("declares that an entry may name an event", () => {
        const field = dataFields("lore").find((f: any) => f.name === "subjects");
        expect(field).toMatchObject({ kind: "list", entryKind: "address", anchors: ["event"] });
    });

    it("accepts an event address beside a note address", () => {
        expect(messages(lint(work(["place-ironfells#sack", "being-aran"])))).toEqual([]);
    });

    it("reports a dangling event address at its own entry", () => {
        const found = lint(work(["being-aran", "place-ironfells#melting"]));
        expect(messages(found)).toEqual([expect.stringContaining("data.subjects.1")]);
        expect(found[0].message).toContain("declares no anchor melting");
        expect(found[0].line).toBeGreaterThan(0);
    });

    it("refuses an anchor of kind prose", () => {
        const found = lint(work(["place-ironfells#history"]));
        expect(messages(found)).toEqual([expect.stringContaining("prose anchor")]);
    });

    it("still refuses a note address that resolves nowhere", () => {
        expect(messages(lint(work(["being-nobody"]))).join("\n")).toContain("does not resolve");
    });
});

describe("a work naming an event", () => {
    it("lists on the page of the note that holds the event, whether written or read", () => {
        const place = worksNode(
            { type: "place", subType: "settlement", shortcode: "ironfells" },
            { title: "Ironfells", url: "/thalorna/place-ironfells/", package: PACKAGE },
        );
        const written = worksNode(
            {
                type: "lore",
                subType: "literature",
                shortcode: "lay",
                data: { subjects: ["place-ironfells#sack"] },
            },
            { title: "The Lay", url: "/thalorna/lore-lay/", package: PACKAGE },
        );
        const read = worksNode(
            {
                type: "lore",
                subType: "literature",
                shortcode: "dirge",
                data: {
                    subjects: [
                        new AddressLink(
                            parseAddress("place-ironfells", {
                                package: PACKAGE,
                                system: "note",
                                types: TYPES,
                            }) as any,
                            "sack",
                            "event",
                        ),
                    ],
                },
            },
            { title: "The Dirge", url: "/thalorna/lore-dirge/", package: PACKAGE },
        );
        expect(
            worksPages([place, written, read], { types: TYPES }).get("/thalorna/place-ironfells/"),
        ).toEqual({
            works: [
                {
                    title: "The Dirge",
                    url: "/thalorna/lore-dirge/",
                    address: "thalorna-note-lore-dirge",
                },
                { title: "The Lay", url: "/thalorna/lore-lay/", address: "thalorna-note-lore-lay" },
            ],
        });
    });
});
