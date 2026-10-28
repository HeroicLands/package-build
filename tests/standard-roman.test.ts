/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { romanInventoryProblems, romanTextProblems } from "../engine/roman-characters.mjs";
import { isAllowedCodePoint } from "../engine/content-charset.mjs";

const inventory = {
    language: "aelw",
    characters: new Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZáéíóú'’^0123456789"),
};
const problems = (text: string) => romanTextProblems(text, inventory);

describe("the shared Roman punctuation standard", () => {
    it("adds standard marks and exact whitespace to every language's additions", () => {
        expect(
            problems("Go, «yes ‹now›». Ask? Go‼ Yes! /^again\u00A0\u2003\t\v\f\r\n{name}. …resume"),
        ).toEqual([]);
    });
    it.each([".", "?", "‼", "!"])("requires sentence text before terminal %s", (terminal) => {
        for (const prefix of [
            "",
            " \t\r\n",
            "a. ",
            "a?",
            "a‼\n",
            "a! ",
            "^",
            "^^",
            "a./^",
            "a.\n^^",
            ",",
            "a. ,",
            "—",
            "a. —",
            "{",
        ]) {
            const text = prefix + terminal + " a";
            expect(problems(text), text).toEqual([
                {
                    offset: prefix.length,
                    message: expect.stringContaining("no sentence text"),
                },
            ]);
        }
        for (const text of [
            "a" + terminal,
            "a\n" + terminal,
            "a/^" + terminal,
            "«a»" + terminal,
            "a—" + terminal,
            "a…" + terminal,
            "…a" + terminal,
            "…" + terminal,
            "{}" + terminal,
            "{a}" + terminal,
            "⟦U+F0200⟧" + terminal,
        ])
            expect(problems(text), text).toEqual([]);
    });
    it("checks each quotation's sentence without treating its closer as a terminal", () => {
        const text = "a «! b ‹? c. ‼ d›!»!";
        expect(problems(text).map(({ offset }) => offset)).toEqual([
            text.indexOf("!"),
            text.indexOf("?"),
            text.indexOf("‼"),
        ]);
        expect(problems("«a.»! «b ‹c?›!».")).toEqual([]);
    });
    it("does not count empty quotations as sentence text", () => {
        for (const prefix of ["«»", "«‹›»", "a. «»", "a. «‹›»"])
            expect(
                problems(prefix + "!").filter(({ message }) =>
                    message.includes("no sentence text"),
                ),
            ).toContainEqual({
                offset: prefix.length,
                message: expect.stringContaining("no sentence text"),
            });
        expect(problems("a «»! «a. ‹›»!")).toEqual([]);
    });
    it("locates a terminal after supplementary sentence text in UTF-16 units", () => {
        const text = "😀. !";
        const extended = { ...inventory, characters: new Set([...inventory.characters, "😀"]) };
        expect(romanTextProblems(text, extended)).toEqual([
            { offset: 4, message: expect.stringContaining("no sentence text") },
        ]);
    });
    it.each([",", ";", ":", '"', "“", "”", "«", "⟦"])(
        "refuses %s in the language additions",
        (char) => {
            expect(romanInventoryProblems("abc" + char)).toEqual(
                expect.arrayContaining([expect.stringContaining("additions")]),
            );
        },
    );
    it("allows contextual Pirzath numeral ^ as an addition", () => {
        expect(romanInventoryProblems("abc#$^@%&")).toEqual([]);
        expect(problems("^a 0^ ^a")).toEqual([]);
    });
    it.each([";", ":"])("explains the replacement for %s", (char) => {
        expect(problems("a" + char + "b")).toEqual([
            { offset: 1, message: expect.stringMatching(/`,`.*`\.`/) },
        ]);
    });
    it.each(['"', "“", "”"])("uses standard quotation instead of %s", (char) => {
        expect(problems(char)).toEqual([{ offset: 0, message: expect.stringContaining("«") }]);
    });
    it.each([
        ["<<", "«"],
        [">>", "»"],
    ])("refuses %s once at its first character", (text, replacement) => {
        expect(problems(text)).toEqual([
            { offset: 0, message: expect.stringContaining(replacement) },
        ]);
    });
    it("uses the ellipsis character rather than three periods", () => {
        expect(problems("a...b")).toEqual([{ offset: 1, message: expect.stringContaining("…") }]);
    });
    it("balances alternating quotations at every depth", () => {
        expect(problems("a «b ‹c «d»› e»")).toEqual([]);
        for (const text of ["«a «b»»", "‹a›", "a»", "«a", "«a›"])
            expect(problems(text)).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ message: expect.stringContaining("quotation") }),
                ]),
            );
    });
    it("requires an immediate terminal after an interruption except at run end", () => {
        for (const text of ["a—.", "a—?", "a—‼", "a—!", "a—", "a—   "])
            expect(problems(text)).toEqual([]);
        for (const text of ["a—b", "a— b", "a— ."])
            expect(problems(text)).toEqual([
                { offset: 1, message: expect.stringContaining("terminal") },
            ]);
    });
    it("distinguishes resuming and abandoning ellipses without requiring sentence endings", () => {
        for (const text of ["hello", "…resume", "a. …resume", "a…", "a…. next", "«…resume»"])
            expect(problems(text)).toEqual([]);
        expect(problems("a…next")).toEqual([
            { offset: 1, message: expect.stringContaining("terminal") },
        ]);
        expect(problems("«a.»…next")).toEqual([
            { offset: 4, message: expect.stringContaining("terminal") },
        ]);
        expect(problems("a «b.» …next")).toEqual([
            { offset: 7, message: expect.stringContaining("terminal") },
        ]);
    });
    it("leaves codage contents to the chosen encoding", () => {
        expect(problems("a ⟦U+F0200 FLAME U+003B⟧ b")).toEqual([]);
    });
    it("refuses directly typed setting signs even when a face draws them", () => {
        expect(romanTextProblems("a\u{F0200}", inventory)).toEqual([
            { offset: 1, message: expect.stringContaining("⟦U+F0200⟧") },
        ]);
    });
    it("keeps source offsets in UTF-16 units and refuses nonstandard whitespace", () => {
        expect(problems("a\u2028b")).toEqual([
            { offset: 1, message: expect.stringContaining("U+2028") },
        ]);
        expect(problems("😀a;").at(-1)).toEqual({
            offset: 3,
            message: expect.stringContaining("`,`"),
        });
    });
});

describe("standard typography in content", () => {
    it.each(["«", "»", "‹", "›", "⟦", "⟧", "‼"])("admits %s", (char) => {
        expect(isAllowedCodePoint(char.codePointAt(0)!)).toBe(true);
    });
});
