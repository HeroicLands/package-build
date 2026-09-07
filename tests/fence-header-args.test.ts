/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **Org-babel header arguments on a fence info string** (#246).
 *
 * A content-table fence carries statements *about the directive* that are not
 * part of the query — whether an empty result is intended, what heading level a
 * section takes. Those were an ad-hoc mix of a bare word and a `key=value`, each
 * matched by its own regex, which is a grammar only in the sense that two
 * regexes are.
 *
 * Org-mode already settled this. A babel source block writes them after the
 * language as `:key value` pairs, and that is a real grammar with a
 * specification, a parser and an editor that understands it.
 *
 * **The language word stays first and stays plain.** `` ```sql `` is what
 * GitHub, Prettier and every other markdown reader match on to highlight the
 * block; the header args follow it and are ignored by anything that does not
 * know them.
 */

import { describe, it, expect } from "vitest";

import { parseHeaderArgs } from "../engine/code-fences.mjs";

describe("parseHeaderArgs", () => {
    it("reads the language and nothing else from a bare fence", () => {
        expect(parseHeaderArgs("sql")).toEqual({ language: "sql", args: {} });
    });

    it("reads a valueless key as `true`", () => {
        // `:allow-empty` is a statement, not a setting with a value.
        expect(parseHeaderArgs("sql :allow-empty")).toEqual({
            language: "sql",
            args: { "allow-empty": true },
        });
    });

    it("reads a key and its value", () => {
        expect(parseHeaderArgs("sql :section-level 3").args).toEqual({ "section-level": "3" });
    });

    it("reads several, in any order", () => {
        expect(parseHeaderArgs("sql :section-level 3 :allow-empty").args).toEqual({
            "section-level": "3",
            "allow-empty": true,
        });
    });

    it("lets a value run to the next key, spaces and all", () => {
        expect(parseHeaderArgs("sql :caption Gear and armour :allow-empty").args).toEqual({
            caption: "Gear and armour",
            "allow-empty": true,
        });
    });

    it("keeps a colon that is not a key inside the value", () => {
        // The edge org has too: a key is a colon *starting a word*. `Gear:` ends
        // one, so it is text.
        expect(parseHeaderArgs("sql :caption Gear: the tables").args).toEqual({
            caption: "Gear: the tables",
        });
    });

    it("takes a quoted value whole, so a value may contain a key-like word", () => {
        expect(parseHeaderArgs('sql :caption "Gear :and armour"').args).toEqual({
            caption: "Gear :and armour",
        });
    });

    it("is case-preserving on values and case-insensitive on the language", () => {
        expect(parseHeaderArgs("SQL :caption Mixed Case").language).toBe("sql");
        expect(parseHeaderArgs("SQL :caption Mixed Case").args.caption).toBe("Mixed Case");
    });

    it("reports a repeated key as the last one written", () => {
        expect(parseHeaderArgs("sql :section-level 2 :section-level 4").args["section-level"]).toBe(
            "4",
        );
    });

    it("ignores surrounding whitespace", () => {
        expect(parseHeaderArgs("  sql   :allow-empty  ").args).toEqual({ "allow-empty": true });
    });

    it("returns no language for an empty info string", () => {
        expect(parseHeaderArgs("")).toEqual({ language: "", args: {} });
        expect(parseHeaderArgs(undefined as never)).toEqual({ language: "", args: {} });
    });
});
