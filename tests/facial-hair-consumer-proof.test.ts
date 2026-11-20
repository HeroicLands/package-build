/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { buildIndexRecord, serializeContentIndex } from "../engine/content-index.mjs";
import { verifyIndexedProfiles } from "../ci/facial-hair-consumer-overlay.mjs";

describe("facial-hair consumer index evidence", () => {
    const profiles = {
        "thalorna-note-lore-example": { facial_hair: { none: 1 }, facial_hair_genders: [] },
    };
    const record = buildIndexRecord({
        frontmatter: {
            type: "lore",
            subType: "culture",
            shortcode: "example",
            data: { appearanceProfile: profiles["thalorna-note-lore-example"] },
        },
        relPath: "example.md",
        contentPackage: "thalorna",
        body: "",
    });
    const row = JSON.parse(serializeContentIndex([record]));
    it("records the indexed list from the matching canonical address", () => {
        expect(row.address.canonical).toEqual({
            address: "thalorna-note-lore-example",
            anchor: null,
            anchorKind: null,
        });
        expect(verifyIndexedProfiles(profiles, [row])).toEqual({
            "thalorna-note-lore-example": [],
        });
    });
    it("rejects missing, duplicate and changed indexed profiles", () => {
        expect(() => verifyIndexedProfiles(profiles, [])).toThrow();
        expect(() => verifyIndexedProfiles(profiles, [row, row])).toThrow();
        expect(() =>
            verifyIndexedProfiles(profiles, [
                {
                    ...row,
                    data: {
                        appearanceProfile: {
                            ...row.data.appearanceProfile,
                            facial_hair_genders: ["male"],
                        },
                    },
                },
            ]),
        ).toThrow();
    });
});
