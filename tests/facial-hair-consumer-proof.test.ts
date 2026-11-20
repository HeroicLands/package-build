/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { verifyIndexedProfiles } from "../ci/facial-hair-consumer-overlay.mjs";

describe("facial-hair consumer index evidence", () => {
    const profiles = {
        "thalorna-note-lore-example": { facial_hair: { none: 1 }, facial_hair_genders: [] },
    };
    const row = {
        address: { canonical: "thalorna-note-lore-example" },
        data: { appearanceProfile: profiles["thalorna-note-lore-example"] },
    };
    it("records the indexed list from the matching canonical address", () => {
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
