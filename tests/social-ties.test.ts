/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { SOCIAL_TIES, checkSocialTies } from "../engine/social-ties.mjs";
import { isAddressSegment } from "../engine/address-charset.mjs";
import { noteInfobox } from "../engine/infobox.mjs";

const index = {
    contentPackage: "thalorna",
    types: new Set(["being", "affiliation", "place"]),
    packages: new Set(["thalorna", "kethira"]),
    addressHit: (address: string) =>
        new Set([
            "thalorna-note-being-ally",
            "thalorna-note-being-foe",
            "thalorna-note-affiliation-guild",
            "kethira-note-being-kin",
            "kethira-note-being-ally",
        ]).has(address),
};
const note = (socialTies: unknown) => ({
    fm: { type: "being", shortcode: "subject", data: { socialTies } },
    file: "subject.md",
    raw: `---\nshortcode: subject\ntype: being\ndata:\n  socialTies:\n    being-ally: patron\n---`,
});

describe("defining social ties", () => {
    it("declares every term in the Address charset", () => {
        for (const { term, meaning } of SOCIAL_TIES) {
            expect(isAddressSegment(term)).toBe(true);
            expect(meaning.length).toBeGreaterThan(10);
            expect(checkSocialTies(note({ "being-ally": term }), { index })).toEqual([]);
        }
    });

    it("rejects malformed, unaccepted, dead, self, and unknown ties", () => {
        expect(checkSocialTies(note([]), { index })[0].message).toMatch(/must be a map/);
        expect(checkSocialTies(note({ ally: "friend" }), { index })[0].message).toMatch(/type/);
        expect(checkSocialTies(note({ "place-village": "friend" }), { index })[0].message).toMatch(
            /being or affiliation/,
        );
        expect(checkSocialTies(note({ "being-missing": "friend" }), { index })[0].message).toMatch(
            /does not resolve/,
        );
        expect(checkSocialTies(note({ "being-subject": "friend" }), { index })[0].message).toMatch(
            /itself/,
        );
        expect(checkSocialTies(note({ "being-ally": "kin" }), { index })[0].message).toMatch(
            /one of/,
        );
        expect(checkSocialTies(note({ "kethira-note-being-kin": "dependent" }), { index })).toEqual(
            [],
        );
    });

    it("locates a malformed value on its Address key", () => {
        expect(checkSocialTies(note({ "being-ally": "unknown" }), { index })).toEqual([
            expect.objectContaining({ file: "subject.md", line: 6, column: 5, severity: "error" }),
        ]);
    });

    it("rejects two spellings of one target on the later key", () => {
        const subject = note({
            "being-ally": "friend",
            "thalorna-note-being-ally": "nemesis",
        });
        subject.raw = `---\nshortcode: subject\ntype: being\ndata:\n  socialTies:\n    being-ally: friend\n    thalorna-note-being-ally: nemesis\n---`;
        expect(checkSocialTies(subject, { index })).toEqual([
            expect.objectContaining({
                file: "subject.md",
                line: 7,
                column: 5,
                severity: "error",
                message: expect.stringMatching(/same target.*being-ally/),
            }),
        ]);
    });

    it("keeps identically named targets in different packages distinct", () => {
        expect(
            checkSocialTies(
                note({ "being-ally": "friend", "kethira-note-being-ally": "nemesis" }),
                { index },
            ),
        ).toEqual([]);
    });

    it("renders one row for a target written in short and full forms", () => {
        const rows = noteInfobox({
            type: "being",
            package: "thalorna",
            name: { full: "Subject" },
            data: {
                socialTies: {
                    "being-ally": "friend",
                    "thalorna-note-being-ally": "nemesis",
                },
            },
        }).sections[0].rows;
        expect(rows.filter((row: { label: string }) => row.label === "Friend")).toHaveLength(1);
        expect(rows.some((row: { label: string }) => row.label === "Nemesis")).toBe(false);
    });

    it("shows one linked row per used term and omits empty maps", () => {
        const fm = {
            type: "being",
            name: { full: "Subject" },
            data: {
                socialTies: {
                    "being-ally": "patron",
                    "affiliation-guild": "patron",
                    "being-foe": "nemesis",
                    "kethira-note-being-kin": "friend",
                },
            },
        };
        const resolve = (ref: unknown) => ({ name: String(ref), url: `/notes/${ref}` });
        const rows = noteInfobox(fm, { resolve }).sections[0].rows;
        expect(rows.find((row: { label: string }) => row.label === "Patron").value).toHaveLength(2);
        expect(rows.find((row: { label: string }) => row.label === "Friend").kind).toBe("links");
        expect(rows.find((row: { label: string }) => row.label === "Nemesis").kind).toBe("links");
        expect(noteInfobox({ ...fm, data: { socialTies: {} } }).sections[0].rows).toHaveLength(1);
        expect(noteInfobox({ ...fm, data: { socialTies: [] } }).sections[0].rows).toHaveLength(1);
        expect(
            noteInfobox({
                ...fm,
                data: { socialTies: { "place-village": "friend", "being-ally": "unknown" } },
            }).sections[0].rows,
        ).toHaveLength(1);
    });
});
