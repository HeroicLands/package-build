/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `templatePriority`, the name that replaces `archetype` (#266).
 *
 * The number deciding which of several competing templates the Create dialog
 * offers was called `archetype`, one letter from `archetypes` — a list of what
 * *sort* a character is. A priority and a taxonomy cannot be told apart by a
 * plural `s`, so the priority takes the name that says what it is.
 */

import { describe, it, expect } from "vitest";

import { resolveArchetype, systemArchetype } from "../engine/helpers.mjs";
import { RETIRED_FIELD_ALIASES, declaresRetiredAlias } from "../engine/retired-fields.mjs";
import { UNIVERSAL_KEYS, lintNote } from "../engine/frontmatter-lint.mjs";

describe("reading the priority", () => {
    it("prefers `data.templatePriority`, which is where the specification puts it", () => {
        // `sohl-thalorna` already writes it there on 941 notes, beside the
        // `archetype` the build has been reading.
        expect(resolveArchetype({ data: { templatePriority: 7 } }, "x")).toBe(7);
    });

    it("reads the new spelling from a system block or the top level", () => {
        expect(resolveArchetype({ sohl: { templatePriority: 5 } }, "x")).toBe(5);
        expect(resolveArchetype({ templatePriority: 3 }, "x")).toBe(3);
    });

    it("still reads the retiring spelling, so no tree breaks before its sweep", () => {
        expect(resolveArchetype({ sohl: { archetype: 2 } }, "x")).toBe(2);
        expect(resolveArchetype({ archetype: 0 }, "x")).toBe(0);
    });

    it("treats `null` as not-a-template, and `0` as a real priority", () => {
        // `0` is falsy and is the priority SoHL's own templates ship at, so
        // every caller must ask `typeof`, never truthiness.
        expect(resolveArchetype({ sohl: { templatePriority: null } }, "x")).toBeUndefined();
        expect(systemArchetype({ sohl: { templatePriority: null } }, "x")).toBeNull();
        expect(systemArchetype({ sohl: { templatePriority: 0 } }, "x")).toBe(0);
    });

    it("requires one of them, because not-a-template has to be said", () => {
        expect(() => resolveArchetype({}, "Bowl")).toThrow(/Missing required templatePriority/);
    });

    it("refuses a value that is neither a number nor null, naming what it read", () => {
        expect(() => resolveArchetype({ data: { templatePriority: "high" } }, "x")).toThrow(
            /Invalid templatePriority .*expected a number or null/,
        );
    });
});

describe("a note carrying both spellings", () => {
    it("passes when they agree", () => {
        expect(resolveArchetype({ data: { templatePriority: 0 }, sohl: { archetype: 0 } }, "x")).toBe(
            0,
        );
        expect(
            resolveArchetype({ data: { templatePriority: null }, sohl: { archetype: null } }, "x"),
        ).toBeUndefined();
    });

    it("is refused when they contradict each other", () => {
        // 145 of `sohl-thalorna`'s 941 dual-spelled notes are in exactly this
        // state: `templatePriority: null` against `archetype: 0`, which is "not
        // a template" against "a template at priority 0". Preferring either
        // silently would decide that on the author's behalf.
        expect(() =>
            resolveArchetype({ data: { templatePriority: null }, sohl: { archetype: 0 } }, "Spirit"),
        ).toThrow(/Conflicting templatePriority for Spirit/);
    });

    it("names both values, so the author can see which to keep", () => {
        try {
            resolveArchetype({ data: { templatePriority: null }, sohl: { archetype: 0 } }, "x");
            throw new Error("expected a throw");
        } catch (err: any) {
            expect(err.message).toMatch(/templatePriority is null/);
            expect(err.message).toMatch(/retiring archetype is 0/);
        }
    });
});

describe("the retirement", () => {
    it("pairs the two names in the shared alias table", () => {
        expect(RETIRED_FIELD_ALIASES.templatePriority).toBe("archetype");
    });

    it("finds the retiring spelling in either region", () => {
        expect(declaresRetiredAlias({ sohl: { archetype: 0 } }, "templatePriority")).toBe(true);
        expect(declaresRetiredAlias({ archetype: 0 }, "templatePriority")).toBe(true);
        expect(declaresRetiredAlias({ sohl: { templatePriority: 0 } }, "templatePriority")).toBe(
            false,
        );
    });

    it("is a shared source, so both spellings are keys any note may write", () => {
        expect(UNIVERSAL_KEYS.has("templatePriority")).toBe(true);
        expect(UNIVERSAL_KEYS.has("archetype")).toBe(true);
    });

    it("warns rather than fails, since the note compiles identically either way", () => {
        const note = {
            file: "/t/x.md",
            type: "skill",
            raw: "---\ntype: skill\nsohl:\n  archetype: 0\n---\n",
            fm: { type: "skill", sohl: { archetype: 0 } },
        };
        const [finding] = lintNote(note as any, { schemas: {} } as any).filter((f: any) =>
            /archetype/.test(f.message),
        );

        expect(finding.severity).toBe("warning");
        expect(finding.message).toMatch(/write `templatePriority:` instead/);
    });

    it("says nothing about a note already on the new spelling", () => {
        const note = {
            file: "/t/x.md",
            type: "skill",
            raw: "---\ntype: skill\nsohl:\n  templatePriority: 0\n---\n",
            fm: { type: "skill", sohl: { templatePriority: 0 } },
        };

        expect(
            lintNote(note as any, { schemas: {} } as any).filter((f: any) =>
                /retired frontmatter field/.test(f.message),
            ),
        ).toEqual([]);
    });
});
