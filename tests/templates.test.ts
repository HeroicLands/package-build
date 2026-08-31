/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The template half of the localization guards: does user-visible text go
 * through `{{localize}}`, and does the template still compile once it does.
 *
 * These run against source text, so a case is a template rather than a fixture
 * tree — which is the point of the rules being pure.
 */

import { describe, it, expect } from "vitest";

import { VISIBLE_ATTRIBUTES, findHardcodedText, findTemplateSyntaxErrors } from "../templates.mjs";

describe("findHardcodedText", () => {
    it("passes a template whose every visible string is localized", () => {
        const source = [
            '<section class="tab">',
            "    <h2>{{localize 'SOHL.Skill.label'}}</h2>",
            '    <button data-action="roll" title="{{localize \'SOHL.Skill.roll\'}}">',
            "        {{localize 'SOHL.Skill.roll'}}",
            "    </button>",
            "</section>",
        ].join("\n");
        expect(findHardcodedText(source)).toEqual([]);
    });

    it("reports English left in a text node", () => {
        const source = "<h2>Mastery Level</h2>";
        const findings = findHardcodedText(source);

        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].message).toContain("Mastery Level");
    });

    it.each(VISIBLE_ATTRIBUTES)("reports English in %s", (attr) => {
        const findings = findHardcodedText(`<input ${attr}="Skill name">`);

        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain(`${attr}="Skill name"`);
    });

    it("locates a finding at the line the literal is on", () => {
        // The literal is what the reader searches for, so the position must be
        // the literal's own — not the top of the file.
        const source = ["<div>", "  {{name}}", "  <p>Well met.</p>", "</div>"].join("\n");
        const [finding] = findHardcodedText(source);

        expect(finding.line).toBe(3);
        expect(finding.column).toBe(6);
    });

    // Handlebars substitutions change length, so an offset taken in the
    // stripped text cannot be carried back to the source (SoHL #1668).
    it("locates a literal that follows a longer expression", () => {
        const source = [
            "<div>",
            "  {{#if actor.system.somethingRatherLong}}<span>Wounded</span>{{/if}}",
            "</div>",
        ].join("\n");
        const [finding] = findHardcodedText(source);

        expect(finding.line).toBe(2);
        expect(source.split("\n")[1]!.slice(finding.column! - 1)).toMatch(/^Wounded/);
    });

    it("ignores markup with no prose in it", () => {
        const source = [
            "<hr>",
            "<span>&infin;</span>",
            "<span>&middot;</span>",
            "<span>42</span>",
            "<span>—</span>",
            "<span>{{value}}</span>",
        ].join("\n");
        expect(findHardcodedText(source)).toEqual([]);
    });

    it("ignores the contents of script and style elements", () => {
        const source = [
            "<style>.sohl-skill { color: red; }</style>",
            '<script>const label = "not prose to a player";</script>',
        ].join("\n");
        expect(findHardcodedText(source)).toEqual([]);
    });

    it("ignores a Handlebars comment", () => {
        expect(findHardcodedText("{{!-- an explanatory note --}}<p>{{x}}</p>")).toEqual([]);
    });

    it("accepts a literal the repository has justified", () => {
        const source = "<input placeholder=\"item.system.code === 'pyrn'\">";
        expect(findHardcodedText(source)).toHaveLength(1);
        expect(
            findHardcodedText(source, {
                allow: ["item.system.code === 'pyrn'"],
            }),
        ).toEqual([]);
    });
});

describe("findTemplateSyntaxErrors", () => {
    it("passes a template that compiles", () => {
        expect(findTemplateSyntaxErrors('<p>{{localize "SOHL.a"}}</p>')).toEqual([]);
    });

    // The usual way to break a template while localizing it: legal in an HTML
    // attribute, a parse error inside a helper's hash.
    it("reports a {{localize}} nested inside another mustache", () => {
        const findings = findTemplateSyntaxErrors(
            '{{formGroup field label="{{localize "SOHL.a"}}"}}',
        );

        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].message).toContain("does not compile");
    });

    // Handlebars populates `hash.loc` for almost no parse error, but it names
    // the line in its message every time — so the finding still points at it
    // rather than dropping to a bare file name.
    it("reports the line Handlebars names in its message", () => {
        const findings = findTemplateSyntaxErrors("<p>\n{{#if a}}\n</p>");

        expect(findings).toHaveLength(1);
        expect(findings[0].line).toBe(3);
    });
});
