/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * An empty label is not a label (#113).
 *
 * `[[x|]]` is deliberately writable — `parseWikilink` says so in its own
 * docstring, "`null` and `""` differ: an author may write `[[x|]]`" — and it
 * means "address this target, and show the target's own name". The packs
 * resolver read it that way by testing falsiness; the web resolver tested `??`,
 * which falls through on `null` only, and so emitted `[](/url/)`: a link with
 * no clickable text, silently, through every build.
 *
 * That is the third instance of the drift `wikilink-syntax.mjs` exists to
 * prevent, in the case its own docstring names — so the reading now lives in
 * {@link authoredLabel} and both resolvers consult it.
 *
 * These tests pin the rule from both ends: the empty label falls back, and the
 * *presence* of the pipe still means what it meant, because #1409 depends on
 * `labelled` rather than on the label's contents.
 */

import { describe, it, expect } from "vitest";

import { authoredLabel, parseWikilink } from "../engine/wikilink-syntax.mjs";
import { resolveWebWikilinks } from "../engine/web-wikilinks.mjs";

const shock = { url: "/rules/sohl-shock/", name: "Shock" };

function ctx(overrides = {}) {
    return {
        index: new Map<string, object>([
            ["rules/sohl-shock", shock],
            ["doc/shock", shock],
        ]),
        typeAlias: new Map<string, object>([["doc|shock state", shock]]),
        collide: new Set<string>(),
        typeCollide: new Set<string>(),
        sections: new Set<string>(["rules"]),
        contentTypes: new Set<string>(["doc", "skill", "docskill"]),
        type: "doc",
        errors: [] as object[],
        src: "rules/Bleeding.md",
        ...overrides,
    };
}

const web = (body: string, c = ctx()) => resolveWebWikilinks(body, c as never);

describe("authoredLabel", () => {
    it("reads an empty label as no label", () => {
        expect(authoredLabel(parseWikilink("doc-shock|"))).toBeNull();
    });

    it("reads a missing label as no label", () => {
        expect(authoredLabel(parseWikilink("doc-shock"))).toBeNull();
    });

    it("reads a whitespace-only label as no label", () => {
        expect(authoredLabel(parseWikilink("doc-shock|   "))).toBeNull();
    });

    it("returns a real label unchanged", () => {
        expect(authoredLabel(parseWikilink("doc-shock|Shock State"))).toBe("Shock State");
    });

    // The distinction the fallback must not erase: `labelled` is what #1409
    // reads, and it still separates `[[x]]` from `[[x|]]`.
    it("leaves `labelled` distinguishing the two forms", () => {
        expect(parseWikilink("doc-shock").labelled).toBe(false);
        expect(parseWikilink("doc-shock|").labelled).toBe(true);
    });
});

describe("the web resolver honours an empty label (#113)", () => {
    it("shows the target's name rather than an empty anchor", () => {
        expect(web("[[doc-shock|]]")).toBe("[Shock](/rules/sohl-shock/)");
    });

    it("renders identically to the unlabelled form", () => {
        expect(web("[[doc-shock|]]")).toBe(web("[[doc-shock]]"));
    });

    it("shows the anchor for a same-page link", () => {
        expect(web("[[#some-section|]]")).toBe("[some-section](#some-section)");
    });

    it("shows the target for an unresolved link", () => {
        const c = ctx();
        const out = web("[[doc-nosuch|]]", c);
        expect(out).toContain("doc-nosuch");
        expect(out).not.toContain("[]");
    });

    it("leaves a genuinely labelled link alone", () => {
        expect(web("[[doc-shock|Shock State]]")).toBe("[Shock State](/rules/sohl-shock/)");
    });

    // #1409: a bare `[[Text]]` is already the prose the author wrote, so the
    // canonical name must not be substituted there. Unchanged by this fix.
    it("keeps an unlabelled alias showing the author's own prose", () => {
        expect(web("[[Shock State]]")).toBe("[Shock State](/rules/sohl-shock/)");
    });
});
