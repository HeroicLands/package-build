/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { lintNote } from "../engine/frontmatter-lint.mjs";
import { completeFrontmatter } from "./complete-note.js";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

function nameFindings(frontmatter: string) {
    const complete = completeFrontmatter(frontmatter);
    const raw = `---\n${complete}\n---\n`;
    const fm = YAML.parse(complete);
    return lintNote(
        { file: "Names/Example.md", raw, fm, type: fm.type },
        { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY },
    ).filter((finding) => finding.message.includes("`name"));
}

describe("the name contract", () => {
    it("accepts universal names and character components in block and flow YAML", () => {
        for (const name of [
            "name: {full: Ada, aliases: [The Swift], given: Ada, clan: Vale}",
            "name:\n  full: Ada\n  aliases: [The Swift]\n  given: Ada\n  clan: Vale",
        ]) {
            expect(nameFindings(`type: being\nsubType: character\n${name}`)).toEqual([]);
        }
        expect(
            nameFindings("type: being\nsubType: npc\nname: {full: Guard, aliases: [Watchman]}"),
        ).toEqual([]);
        expect(nameFindings("type: lore\nname: {full: A Legend, aliases: []}")).toEqual([]);
    });

    it("rejects all undeclared keys at their authored position", () => {
        const block = nameFindings(
            "type: being\nsubType: character\nname:\n  full: Ada\n  home: vale\n  title: Captain\n  aliases: []",
        );
        expect(block.map((finding) => [finding.line, finding.column])).toEqual([
            [6, 3],
            [7, 3],
        ]);
        const flow = nameFindings(
            "type: being\nsubType: npc\nname: {full: Guard, home: vale, given: Ada, clan: Vale, aliases: []}",
        );
        expect(flow.map((finding) => finding.column)).toEqual([21, 33, 45]);
        expect(
            nameFindings("type: lore\nname: {full: A Legend, given: Ada, aliases: []}"),
        ).toHaveLength(1);
        expect(
            nameFindings(
                "type: being\nsubType: creature\nname: {full: Wolf, clan: Pack, aliases: []}",
            ),
        ).toHaveLength(1);
    });

    it("requires a nonempty full name and validates optional values", () => {
        expect(nameFindings("type: lore\nname: {aliases: []}")).toHaveLength(1);
        expect(nameFindings("type: lore\nname: {full: '', aliases: []}")).toHaveLength(1);
        expect(nameFindings("type: lore\nname: Legend")).toHaveLength(1);
        expect(nameFindings("type: lore\nname: {full: Legend, aliases: [Alias, '']}")).toHaveLength(
            1,
        );
        expect(
            nameFindings(
                "type: being\nsubType: character\nname: {full: Ada, given: '', aliases: []}",
            ),
        ).toHaveLength(1);
    });
});
