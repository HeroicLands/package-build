/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `templatePriority`, the number deciding which of several competing templates
 * the Create dialog offers. `archetypes` is a different field — a list of what
 * *sort* a character is.
 */

import { describe, it, expect } from "vitest";

import { resolveTemplatePriority, systemTemplatePriority } from "../engine/helpers.mjs";
import { UNIVERSAL_KEYS, lintNote } from "../engine/frontmatter-lint.mjs";

describe("reading the priority", () => {
    it("prefers `data.templatePriority`, which is where the specification puts it", () => {
        expect(resolveTemplatePriority({ data: { templatePriority: 7 } }, "x")).toBe(7);
    });

    it("reads the new spelling from a system block or the top level", () => {
        expect(resolveTemplatePriority({ sohl: { templatePriority: 5 } }, "x")).toBe(5);
        expect(resolveTemplatePriority({ templatePriority: 3 }, "x")).toBe(3);
    });

    it("treats `null` as not-a-template, and `0` as a real priority", () => {
        // `0` is falsy and is the priority SoHL's own templates ship at, so
        // every caller must ask `typeof`, never truthiness.
        expect(resolveTemplatePriority({ sohl: { templatePriority: null } }, "x")).toBeUndefined();
        expect(systemTemplatePriority({ sohl: { templatePriority: null } }, "x")).toBeNull();
        expect(systemTemplatePriority({ sohl: { templatePriority: 0 } }, "x")).toBe(0);
    });

    it("requires one of them, because not-a-template has to be said", () => {
        expect(() => resolveTemplatePriority({}, "Bowl")).toThrow(
            /Missing required templatePriority/,
        );
    });

    it("refuses a value that is neither a number nor null, naming what it read", () => {
        expect(() => resolveTemplatePriority({ data: { templatePriority: "high" } }, "x")).toThrow(
            /Invalid templatePriority .*expected a number or null/,
        );
    });
});

describe("the spelling", () => {
    it("reads no `archetype` key as a priority", () => {
        expect(() => resolveTemplatePriority({ sohl: { archetype: 2 } }, "x")).toThrow(
            /Missing required templatePriority/,
        );
        expect(
            resolveTemplatePriority({ data: { templatePriority: 4 }, sohl: { archetype: 0 } }, "x"),
        ).toBe(4);
    });

    it("is a universal key, and `archetype` is not", () => {
        expect(UNIVERSAL_KEYS.has("templatePriority")).toBe(true);
        expect(UNIVERSAL_KEYS.has("archetype")).toBe(false);
    });

    it("reports `archetype` as an unrecognised block key", () => {
        const note = {
            file: "/t/x.md",
            type: "skill",
            raw: "---\ntype: skill\nsohl:\n  archetype: 0\n---\n",
            fm: { type: "skill", sohl: { archetype: 0 } },
        };
        const findings = lintNote(note as any, { schemas: { skill: [] } } as any).filter((f: any) =>
            /archetype/.test(f.message),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].line).toBe(4);
        expect(findings[0].message).toMatch(/"archetype" is not a property of a skill/);
        expect(findings[0].message).not.toMatch(/retired|templatePriority/);
    });

    it("says nothing about a note on the current spelling", () => {
        const note = {
            file: "/t/x.md",
            type: "skill",
            raw: "---\ntype: skill\nsohl:\n  templatePriority: 0\n---\n",
            fm: { type: "skill", sohl: { templatePriority: 0 } },
        };
        expect(
            lintNote(note as any, { schemas: { skill: [] } } as any).filter((f: any) =>
                /templatePriority/.test(f.message),
            ),
        ).toEqual([]);
    });
});
