/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A finding quotes what the author wrote.** The lint reads a note whose
 * Addresses are already resolved to their canonical form; a message ending
 * `but reads "…"` still quotes the value as it stands in the file, so an
 * author can search for it.
 */

import YAML from "yaml";
import { describe, expect, it } from "vitest";

import { parseAddress, renderAddress } from "../engine/address.mjs";
import { frontmatterValueAt } from "../engine/diagnostics.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { decodeNoteAddresses } from "../engine/note-addresses.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const PACKAGE = "thalorna";
const TYPES = new Set(Object.keys(NOTE_VOCABULARY));

/** A note as the link index hands one over: its Addresses read, its file as written. */
function note(fm: Record<string, any>) {
    const raw = `---\n${YAML.stringify(fm)}---\n\nProse.\n`;
    const read = structuredClone(fm);
    decodeNoteAddresses(read, { package: PACKAGE, system: "note", types: TYPES });
    return {
        file: `${fm.type}-${fm.shortcode}.md`,
        raw,
        fm: read,
        body: "\nProse.\n",
        type: fm.type,
    };
}

/** An index holding `notes`. */
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

const lint = (subject: ReturnType<typeof note>) =>
    lintFrontmatter(indexOf([subject]) as any, {
        schemas: NOTE_SCHEMAS as any,
        vocabulary: NOTE_VOCABULARY,
    }).findings.filter((f: any) => f.file === subject.file);

describe("a finding about an Address", () => {
    it("reads the authored value at a frontmatter path", () => {
        const raw = "---\ntype: lore\ndata:\n    subjects: [ being-aran , 'place-x#y' ]\n---\n";
        expect(frontmatterValueAt(raw, ["data", "subjects", 0])).toBe("being-aran");
        expect(frontmatterValueAt(raw, ["data", "subjects", 1])).toBe("place-x#y");
        expect(frontmatterValueAt(raw, ["data", "nothing"])).toBeUndefined();
    });

    it("quotes a gear `made` as written", () => {
        const found = lint(
            note({
                type: "weapongear",
                shortcode: "blade",
                name: { full: "Blade" },
                data: { made: "forging" },
            }),
        );
        const made = found.find((f: any) => f.message.includes("data.made"));
        expect(made?.message).toMatch(/but reads "forging"$/);
    });

    it("quotes a literature `language` as written", () => {
        const found = lint(
            note({
                type: "lore",
                subType: "literature",
                shortcode: "lay",
                name: { full: "Lay" },
                data: { language: "skill-tongue" },
            }),
        );
        const language = found.find((f: any) => f.message.includes("data.language"));
        expect(language?.message).toMatch(/but reads "skill-tongue"$/);
    });

    it("quotes an event's `follows` as written", () => {
        const found = lint(
            note({
                type: "lore",
                subType: "history",
                shortcode: "later",
                name: { full: "Later" },
                data: {
                    events: [
                        {
                            when: 10,
                            summary: "Later.",
                            follows: [{ event: "gone", how: "caused" }],
                        },
                    ],
                },
            }),
        );
        const follows = found.find((f: any) => f.message.includes("follows"));
        expect(follows?.message).toMatch(/but reads "gone"$/);
    });
});
